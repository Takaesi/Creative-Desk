// F5. «Моя очередь»: что делать прямо сейчас — свой набор блоков для каждой роли.
import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { allowedActions, isOverdue } from '../domain.js';
import { wrap, auth } from '../http.js';
import { queryCreatives } from './creatives.js';
import { wipInfo, teamLoad } from '../workload.js';
import { computeTaskCost } from '../analytics.js';

const router = Router();
const H = 3600_000;
const DAY = 24 * H;
const PRIORITY_ORDER = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

const TASK_SQL = `SELECT t.*, b.name AS buyer_name, b.color AS buyer_color, c.name AS creative_name, c.color AS creative_color
  FROM tasks t JOIN users b ON b.id = t.buyer_id LEFT JOIN users c ON c.id = t.creative_id`;

const tasks = (where, params, order, user) => db.prepare(`${TASK_SQL} WHERE ${where} ORDER BY ${order}`).all(params)
  .map((t) => ({ kind: 'task', ...t, overdue: isOverdue(t), actions: allowedActions(t, user) }));

/** Блок: полный счётчик и до 5 элементов (?full=1 — все элементы). */
// обработчик синхронный, поэтому флаг на время одного запроса безопасен
let full = false;
const block = (key, title, items, { link = null, empty = '', limit = 5 } = {}) => ({ key, title, count: items.length, items: full ? items : items.slice(0, limit), link, empty });

const iso = (ms) => new Date(ms).toISOString();
const pct = (a, b) => (b ? (a / b) * 100 : null);

function doneStats(where, params, from, to) {
  const rows = db.prepare(`SELECT deadline, completed_at, revision_count FROM tasks WHERE status = 'done' AND completed_at >= @from AND completed_at < @to AND ${where}`)
    .all({ ...params, from: iso(from), to: iso(to) });
  return {
    done: rows.length,
    onTime: pct(rows.filter((r) => !r.deadline || r.completed_at <= r.deadline).length, rows.length),
    revisions: pct(rows.filter((r) => r.revision_count > 0).length, rows.length),
  };
}

function verdictStats(where, params, from, to) {
  const r = db.prepare(`SELECT SUM(status IN ('winner','burned')) AS winners, COUNT(*) AS verdicts FROM creatives
    WHERE verdict_at >= @from AND verdict_at < @to AND status IN ('winner','average','loser','burned') AND ${where}`).get({ ...params, from: iso(from), to: iso(to) });
  return { winners: r.winners || 0, verdicts: r.verdicts || 0, winnerPct: pct(r.winners || 0, r.verdicts) };
}

const tile = (key, label, value, prev, fmt = 'num', better = 'up') => ({ key, label, value, prev, fmt, better });

// ---------- креативщик ----------
function creativeBlocks(user) {
  const me = { me: user.id };
  const wip = wipInfo(user.id);
  const revisions = tasks("t.status = 'revision' AND t.creative_id = @me AND t.revision_started_at IS NULL", me, 't.deadline IS NULL, t.deadline', user)
    .map((t) => ({ ...t, revision_comment: db.prepare("SELECT text FROM comments WHERE task_id = ? AND kind = 'revision' ORDER BY id DESC LIMIT 1").get(t.id)?.text || '' }));
  const now = Date.now();
  const inWork = tasks("t.creative_id = @me AND (t.status = 'in_progress' OR (t.status = 'revision' AND t.revision_started_at IS NOT NULL))", me, 't.deadline IS NULL, t.deadline', user)
    .map((t) => {
      if (!t.deadline) return t;
      const start = Date.parse(t.revision_started_at || t.taken_at || t.created_at);
      const total = Math.max(1, Date.parse(t.deadline) - start);
      return { ...t, time_left_pct: Math.max(0, Math.min(100, ((Date.parse(t.deadline) - now) / total) * 100)) };
    });
  const available = tasks("t.status = 'new'", {}, `${PRIORITY_ORDER}, t.deadline IS NULL, t.deadline`, user)
    .map((t) => (wip.reached ? { ...t, take_blocked: `Сначала сдайте одну из текущих задач (лимит ${wip.limit})` } : t));

  const cur = [now - 30 * DAY, now]; const prev = [now - 60 * DAY, now - 30 * DAY];
  const submitted = (a, b) => db.prepare('SELECT COUNT(*) c FROM tasks WHERE creative_id = ? AND first_submitted_at >= ? AND first_submitted_at < ?').get(user.id, iso(a), iso(b)).c;
  const d1 = doneStats('creative_id = @me', me, ...cur); const d0 = doneStats('creative_id = @me', me, ...prev);
  const v1 = verdictStats('author_id = @me', me, ...cur); const v0 = verdictStats('author_id = @me', me, ...prev);
  const inTest = db.prepare("SELECT COUNT(*) c FROM creatives WHERE author_id = ? AND status = 'in_test'").get(user.id).c;

  return [
    block('revisions_waiting', 'Правки — ждут вас', revisions, { link: '/board', empty: 'Правок нет — всё принято с первого раза' }),
    block('in_work', 'В работе', inWork, { link: '/board', empty: 'Ничего в работе — возьмите задачу ниже' }),
    { ...block('available', 'Можно взять', available, { link: '/board', empty: 'Новых задач нет' }), wip },
    {
      key: 'my_stats', title: 'Мои показатели за 30 дней', kind: 'stats', count: null,
      tiles: [
        tile('submitted', 'Сдано задач', submitted(...cur), submitted(...prev)),
        tile('on_time', 'В срок', d1.onTime, d0.onTime, 'pct'),
        tile('revisions', 'С правками', d1.revisions, d0.revisions, 'pct', 'down'),
        tile('in_test', 'Креативов в тесте', inTest, null),
        tile('winners', 'Победителей', v1.winners, v0.winners, 'num', 'up', v1.winnerPct),
        tile('winner_pct', '% победителей', v1.winnerPct, v0.winnerPct, 'pct'),
      ],
    },
  ];
}

// ---------- байер ----------
function buyerBlocks(user) {
  const me = { me: user.id };
  const st = getSettings();
  const now = Date.now();
  const toReview = tasks("t.status = 'review' AND t.buyer_id = @me", me, 't.submitted_at', user)
    .map((t) => ({ ...t, waiting_ms: now - Date.parse(t.submitted_at) }));
  const burning = queryCreatives("c.buyer_id = @me AND c.status = 'winner' AND c.burnout_detected_at IS NOT NULL", me, 'c.burnout_detected_at')
    .map((c) => ({ kind: 'creative', ...c, burnout: burnoutInfo(c.id, st) }));
  const staleDay = iso(now - 3 * DAY).slice(0, 10);
  const needResults = queryCreatives(
    `c.buyer_id = @me AND ((c.status = 'accepted' AND c.accepted_at < @acc AND m.metric_days IS NULL) OR (c.status = 'in_test' AND m.last_metric_date <= @stale))`,
    { ...me, acc: iso(now - st.no_results_reminder_days * DAY), stale: staleDay }, 'c.accepted_at',
  ).map((c) => ({ kind: 'creative', ...c, reason: c.status === 'accepted' ? 'нет результатов' : 'нет свежих данных 3+ дня' }));
  const needVerdict = queryCreatives("c.buyer_id = @me AND c.status = 'in_test' AND c.suggested_verdict IS NOT NULL", me, 'c.updated_at DESC')
    .map((c) => ({ kind: 'creative', ...c }));
  const myTasks = tasks("t.buyer_id = @me AND t.status IN ('new','in_progress','revision')", me, 't.deadline IS NULL, t.deadline', user);
  const winners = queryCreatives("c.buyer_id = @me AND c.status = 'winner' AND c.verdict_at >= @since", { ...me, since: iso(now - 7 * DAY) }, 'c.verdict_at DESC')
    .map((c) => ({ kind: 'creative', ...c }));
  return [
    block('to_review', 'Ждут вашей проверки', toReview, { link: '/board', empty: 'Всё проверено 🎉' }),
    block('burning', 'Выгорают', burning, { link: `/library?burnout=1&buyer_id=${user.id}`, empty: 'Выгорающих креативов нет' }),
    block('need_results', 'Внесите результаты', needResults, { link: `/library?status=accepted,in_test&buyer_id=${user.id}`, empty: 'Результаты по всем креативам внесены' }),
    block('need_verdict', 'Ждут вердикта', needVerdict, { link: `/library?status=in_test&buyer_id=${user.id}`, empty: 'Вердикты проставлены' }),
    block('my_tasks', 'Мои задачи в работе', myTasks, { link: '/board', empty: 'Активных задач нет — поставьте новое ТЗ' }),
    block('recent_winners', 'Победители за 7 дней', winners, { link: `/library?status=winner&buyer_id=${user.id}&sort=roi`, empty: 'За неделю победителей пока нет', limit: 6 }),
  ];
}

/** Падение CTR от пика — для подписи «−41 %». */
function burnoutInfo(creativeId, st) {
  const rows = db.prepare('SELECT date, impressions, clicks FROM creative_metrics WHERE creative_id = ? ORDER BY date').all(creativeId);
  const days = rows.filter((r) => r.impressions > 0);
  const win = [];
  for (let i = 2; i < days.length; i++) {
    const w = days.slice(i - 2, i + 1);
    win.push((w.reduce((s, r) => s + r.clicks, 0) / w.reduce((s, r) => s + r.impressions, 0)) * 100);
  }
  if (!win.length) return null;
  const peak = Math.max(...win); const current = win[win.length - 1];
  return { peak, current, drop_pct: peak ? ((peak - current) / peak) * 100 : 0, threshold: st.burnout_drop_pct };
}

// ---------- руководитель ----------
function aiRub(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(e.credits * COALESCE(a.credit_price_rub, 0)), 0) AS rub FROM ai_expenses e
    LEFT JOIN ai_services a ON a.name = e.service WHERE e.created_at >= ? AND e.created_at < ?`).get(iso(from), iso(to)).rub;
}
function avgCreativeCost(from, to) {
  const ids = db.prepare("SELECT id FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?").all(iso(from), iso(to));
  if (!ids.length) return null;
  const costs = ids.map((t) => computeTaskCost(t.id)).filter(Boolean);
  const total = costs.reduce((s, c) => s + c.total, 0);
  const n = costs.reduce((s, c) => s + c.creatives, 0);
  return n ? total / n : null;
}

function leadBlocks(user) {
  const now = Date.now();
  const st = getSettings();
  const overdue = tasks("t.status != 'done' AND t.deadline IS NOT NULL AND t.deadline < @now", { now: iso(now) }, 't.deadline', user);
  const urgent = tasks("t.status = 'new' AND t.deadline IS NOT NULL AND t.deadline >= @now AND t.deadline < @soon", { now: iso(now), soon: iso(now + DAY) }, 't.deadline', user);
  const stuck = tasks("t.status = 'review' AND t.submitted_at < @since", { since: iso(now - DAY) }, 't.submitted_at', user)
    .map((t) => ({ ...t, waiting_ms: now - Date.parse(t.submitted_at) }));
  const load = teamLoad();
  const issues = [
    ...load.filter((u) => u.load_pct > 100).map((u) => ({ kind: 'person', ...u, issue: 'overload' })),
    ...load.filter((u) => u.load_units === 0).map((u) => ({ kind: 'person', ...u, issue: 'idle' })),
  ];
  const burning = queryCreatives("c.status = 'winner' AND c.burnout_detected_at IS NOT NULL", {}, 'c.burnout_detected_at')
    .map((c) => ({ kind: 'creative', ...c, burnout: burnoutInfo(c.id, st) }));

  const w1 = [now - 7 * DAY, now]; const w0 = [now - 14 * DAY, now - 7 * DAY];
  const count = (sql, [a, b]) => db.prepare(sql).get(iso(a), iso(b)).c;
  const created = (w) => count('SELECT COUNT(*) c FROM tasks WHERE created_at >= ? AND created_at < ?', w);
  const submitted = (w) => count('SELECT COUNT(*) c FROM tasks WHERE first_submitted_at >= ? AND first_submitted_at < ?', w);
  const d1 = doneStats('1 = 1', {}, ...w1); const d0 = doneStats('1 = 1', {}, ...w0);
  const v1 = verdictStats('1 = 1', {}, ...w1); const v0 = verdictStats('1 = 1', {}, ...w0);

  return [
    block('overdue', 'Просрочено', overdue, { link: '/board', empty: 'Просрочек нет' }),
    block('urgent_unassigned', 'Горит без исполнителя', urgent, { link: '/board', empty: 'Все срочные задачи разобраны' }),
    block('stuck_review', 'Зависло на проверке', stuck, { link: '/board', empty: 'Байеры проверяют вовремя' }),
    block('load_issues', 'Перегруз и простой', issues, { empty: 'Загрузка команды в норме', limit: 8 }),
    block('team_burning', 'Выгорающие победители', burning, { link: '/library?burnout=1', empty: 'Выгорающих креативов нет' }),
    {
      key: 'week_kpi', title: 'KPI недели', kind: 'stats', count: null,
      tiles: [
        tile('created', 'Задач создано', created(w1), created(w0)),
        tile('submitted', 'Сдано', submitted(w1), submitted(w0)),
        tile('on_time', 'В срок', d1.onTime, d0.onTime, 'pct'),
        tile('revisions', 'С правками', d1.revisions, d0.revisions, 'pct', 'down'),
        tile('winners', 'Победителей', v1.winners, v0.winners),
        tile('ai_rub', 'Расходы на AI', aiRub(...w1), aiRub(...w0), 'rub', 'down'),
        tile('creative_cost', 'Себестоимость креатива', avgCreativeCost(...w1), avgCreativeCost(...w0), 'rub', 'down'),
      ],
    },
  ];
}

router.get('/queue', auth, wrap((req, res) => {
  const u = req.user;
  full = req.query.full === '1';
  const blocks = u.role === 'creative' ? creativeBlocks(u) : u.role === 'buyer' ? buyerBlocks(u) : leadBlocks(u);
  res.json({ role: u.role, blocks });
}));

export default router;
