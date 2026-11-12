// «Моя очередь» — короткий дашборд: ровно 3 блока на роль.
// Байер: summary / my_tasks / to_review. Руководитель: summary / load / problems. Креативщик: summary / my_tasks / available.
import { Router } from 'express';
import { db } from '../db.js';
import { allowedActions, isOverdue } from '../domain.js';
import { wrap, auth } from '../http.js';
import { queryCreatives, needResultsWhere, METRICS_CTE } from './creatives.js';
import { wipInfo, teamLoad } from '../workload.js';
import { planFor, planForAll } from '../plans.js';
import { OPEN_PINS_SQL } from './annotations.js';

const router = Router();
const H = 3600_000;
const DAY = 24 * H;
const LIMIT = 7;
const PRIORITY_ORDER = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

const TASK_SQL = `SELECT t.*, b.name AS buyer_name, b.color AS buyer_color, c.name AS creative_name, c.color AS creative_color,
  ${OPEN_PINS_SQL} AS open_pins
  FROM tasks t JOIN users b ON b.id = t.buyer_id LEFT JOIN users c ON c.id = t.creative_id`;

const iso = (ms) => new Date(ms).toISOString();
const pct = (a, b) => (b ? (a / b) * 100 : null);

function tasks(where, params, order, user) {
  const now = Date.now();
  return db.prepare(`${TASK_SQL} WHERE ${where} ORDER BY ${order}`).all(params).map((t) => ({
    kind: 'task', ...t, overdue: isOverdue(t), actions: allowedActions(t, user), time_left_pct: timeLeft(t, now),
  }));
}

/** Доля оставшегося до дедлайна времени (0..100) — для полосы на карточке. */
function timeLeft(t, now) {
  if (!t.deadline || ['review', 'done'].includes(t.status)) return null;
  const start = Date.parse(t.revision_started_at || t.taken_at || t.created_at);
  const total = Math.max(1, Date.parse(t.deadline) - start);
  return Math.max(0, Math.min(100, ((Date.parse(t.deadline) - now) / total) * 100));
}

/** Список: полный счётчик и до 7 строк (?full=1 — все строки). */
const list = (full, key, title, items, extra = {}) => ({ key, kind: 'list', title, count: items.length, items: full ? items : items.slice(0, LIMIT), ...extra });
const tile = (key, label, value, extra = {}) => ({ key, label, value, fmt: 'num', ...extra });

function doneStats(where, params, from, to) {
  const rows = db.prepare(`SELECT deadline, completed_at, revision_count FROM tasks WHERE status = 'done' AND completed_at >= @from AND completed_at < @to AND ${where}`)
    .all({ ...params, from: iso(from), to: iso(to) });
  return {
    onTime: pct(rows.filter((r) => !r.deadline || r.completed_at <= r.deadline).length, rows.length),
    revisions: pct(rows.filter((r) => r.revision_count > 0).length, rows.length),
  };
}
const winnersSince = (where, params, from, to) => db.prepare(`SELECT COUNT(*) c FROM creatives
  WHERE status IN ('winner','burned') AND verdict_at >= @from AND verdict_at < @to AND ${where}`).get({ ...params, from: iso(from), to: iso(to) }).c;

// ---------- общие выборки по креативам (их используют и сводка, и проблемы) ----------
const BURNING = "c.status = 'winner' AND c.burnout_detected_at IS NOT NULL";
const NEED_VERDICT = "c.status = 'in_test' AND c.suggested_verdict IS NOT NULL";
const countCreatives = (where, params) => db.prepare(`${METRICS_CTE} SELECT COUNT(*) c FROM creatives c LEFT JOIN m ON m.creative_id = c.id WHERE ${where}`).get(params).c;

// ---------- байер ----------
function buyerBlocks(user, full) {
  const me = { me: user.id };
  const now = Date.now();
  const myTasks = tasks("t.buyer_id = @me AND t.status IN ('new','in_progress','revision')", me, 't.deadline IS NULL, t.deadline', user);
  const toReview = tasks("t.status = 'review' AND t.buyer_id = @me", me, 't.submitted_at', user)
    .map((t) => ({ ...t, waiting_ms: now - Date.parse(t.submitted_at) }));
  const nr = needResultsWhere(now);
  const avgRoi = db.prepare(`SELECT AVG(roi) r FROM (
      SELECT (SUM(cm.revenue) - SUM(cm.spend)) * 100.0 / SUM(cm.spend) AS roi FROM creative_metrics cm JOIN creatives c ON c.id = cm.creative_id
      WHERE c.buyer_id = @me AND cm.date >= @since GROUP BY cm.creative_id HAVING SUM(cm.spend) > 0)`).get({ ...me, since: iso(now - 30 * DAY).slice(0, 10) }).r;
  const lib = (q) => `/library?buyer_id=${user.id}&${q}`;
  const alerts = [
    tile('burning', 'Выгорают', countCreatives(`c.buyer_id = @me AND ${BURNING}`, me), { link: lib('burnout=1') }),
    tile('need_verdict', 'Ждут вердикта', countCreatives(`c.buyer_id = @me AND ${NEED_VERDICT}`, me), { link: lib('need=verdict') }),
    tile('need_results', 'Без результатов', countCreatives(`c.buyer_id = @me AND ${nr.sql}`, { ...me, ...nr.params }), { link: lib('need=results') }),
  ].filter((a) => a.value > 0);
  return [
    {
      key: 'summary', kind: 'summary', title: 'Сводка',
      tiles: [
        tile('in_work', 'Задач в работе', myTasks.length, { link: '/board?mine=1' }),
        tile('to_review', 'Ждут проверки', toReview.length, { link: '/board?mine=1' }),
        tile('in_test', 'Креативов в тесте', countCreatives("c.buyer_id = @me AND c.status = 'in_test'", me), { link: lib('status=in_test') }),
        tile('winners', 'Победителей за 7 дней', winnersSince('buyer_id = @me', me, now - 7 * DAY, now), { link: lib('status=winner&sort=roi') }),
        tile('roi', 'Средний ROI за 30 дней', avgRoi, { fmt: 'pct', link: lib('sort=roi') }),
      ],
      alerts,
    },
    list(full, 'my_tasks', 'Мои задачи в работе', myTasks, { link: '/board?mine=1', empty: 'Активных задач нет — поставьте новое ТЗ' }),
    list(full, 'to_review', 'Ждут проверки', toReview, { link: '/board?mine=1', empty: 'Всё проверено' }),
  ];
}

// ---------- руководитель ----------
function aiRub(from, to) {
  return db.prepare(`SELECT COALESCE(SUM(e.credits * COALESCE(a.credit_price_rub, 0)), 0) AS rub FROM ai_expenses e
    LEFT JOIN ai_services a ON a.name = e.service WHERE e.created_at >= ? AND e.created_at < ?`).get(iso(from), iso(to)).rub;
}

const PROBLEM = {
  overdue: { rank: 0, label: 'Просрочена' },
  urgent: { rank: 1, label: 'Срочная без исполнителя' },
  stuck: { rank: 2, label: 'Зависла на проверке' },
  overload: { rank: 3, label: 'Перегруз' },
  burnout: { rank: 4, label: 'Выгорает' },
};

/** Один общий список проблем. Сначала по типу (просрочки — самые срочные), внутри типа — по остроте. */
export function leadProblems(user, now = Date.now()) {
  const P = (type, item, sev) => ({ kind: 'problem', type, label: PROBLEM[type].label, sev, ...item });
  const items = [
    ...tasks("t.status != 'done' AND t.deadline IS NOT NULL AND t.deadline < @now", { now: iso(now) }, 't.deadline', user)
      .map((t) => P('overdue', { id: t.id, title: `#${t.id} ${t.title}`, link: `/board/${t.id}`, person: t.creative_name, ms: now - Date.parse(t.deadline) }, -(now - Date.parse(t.deadline)))),
    ...tasks("t.status = 'new' AND t.deadline IS NOT NULL AND t.deadline >= @now AND t.deadline < @soon", { now: iso(now), soon: iso(now + DAY) }, 't.deadline', user)
      .map((t) => P('urgent', { id: t.id, title: `#${t.id} ${t.title}`, link: `/board/${t.id}`, person: t.buyer_name, ms: Date.parse(t.deadline) - now }, Date.parse(t.deadline) - now)),
    ...tasks("t.status = 'review' AND t.submitted_at < @since", { since: iso(now - DAY) }, 't.submitted_at', user)
      .map((t) => P('stuck', { id: t.id, title: `#${t.id} ${t.title}`, link: `/board/${t.id}`, person: t.buyer_name, ms: now - Date.parse(t.submitted_at) }, -(now - Date.parse(t.submitted_at)))),
    ...teamLoad().filter((u) => u.load_pct > 100)
      .map((u) => P('overload', { id: u.id, title: u.name, link: null, load_pct: u.load_pct, load_units: u.load_units, capacity_units: u.capacity_units }, -u.load_pct)),
    ...queryCreatives(BURNING, {}, 'c.burnout_detected_at')
      .map((c) => P('burnout', { id: c.id, title: `${c.code} ${c.title}`, link: `/library/${c.id}`, person: c.buyer_name }, Date.parse(c.burnout_detected_at))),
  ];
  return items.sort((a, b) => PROBLEM[a.type].rank - PROBLEM[b.type].rank || a.sev - b.sev);
}

function leadBlocks(user, full) {
  const now = Date.now();
  const w1 = [now - 7 * DAY, now]; const w0 = [now - 14 * DAY, now - 7 * DAY];
  const count = (sql, [a, b]) => db.prepare(sql).get(iso(a), iso(b)).c;
  const created = (w) => count('SELECT COUNT(*) c FROM tasks WHERE created_at >= ? AND created_at < ?', w);
  const submitted = (w) => count('SELECT COUNT(*) c FROM tasks WHERE first_submitted_at >= ? AND first_submitted_at < ?', w);
  const d1 = doneStats('1 = 1', {}, ...w1); const d0 = doneStats('1 = 1', {}, ...w0);
  const plans = planForAll(now);
  const load = teamLoad().map((u) => ({ kind: 'person', ...u, plan: plans.get(u.id) || null }));
  const problems = leadProblems(user, now);
  return [
    {
      key: 'summary', kind: 'summary', title: 'Сводка за 7 дней',
      tiles: [
        tile('created', 'Создано задач', created(w1), { prev: created(w0), link: '/board' }),
        tile('submitted', 'Сдано', submitted(w1), { prev: submitted(w0), link: '/board' }),
        tile('on_time', 'В срок', d1.onTime, { prev: d0.onTime, fmt: 'pct', link: '/analytics' }),
        tile('revisions', 'С правками', d1.revisions, { prev: d0.revisions, fmt: 'pct', better: 'down', link: '/analytics' }),
        tile('winners', 'Победителей', winnersSince('1 = 1', {}, ...w1), { prev: winnersSince('1 = 1', {}, ...w0), link: '/library?status=winner&sort=roi' }),
        tile('ai_rub', 'Расходы на AI', aiRub(...w1), { prev: aiRub(...w0), fmt: 'rub', better: 'down', link: '/analytics' }),
      ].map((t) => ({ better: 'up', ...t })),
      alerts: [],
    },
    { key: 'load', kind: 'load', title: 'Нагрузка', count: load.length, items: load },
    list(full, 'problems', 'Проблемы', problems, { link: '/queue?full=1', empty: 'Проблем нет' }),
  ];
}

// ---------- креативщик ----------
function creativeBlocks(user, full) {
  const me = { me: user.id };
  const now = Date.now();
  const wip = wipInfo(user.id);
  const lastRevision = db.prepare("SELECT text FROM comments WHERE task_id = ? AND kind = 'revision' ORDER BY id DESC LIMIT 1");
  // сначала правки (ещё не начатые — выше), потом задачи в работе по дедлайну
  const mine = tasks(`t.creative_id = @me AND t.status IN ('in_progress','revision')`, me,
    "t.status != 'revision', t.revision_started_at IS NOT NULL, t.deadline IS NULL, t.deadline", user)
    .map((t) => (t.status === 'revision' ? { ...t, revision_comment: lastRevision.get(t.id)?.text || '' } : t));
  const available = tasks("t.status = 'new'", {}, `${PRIORITY_ORDER}, t.deadline IS NULL, t.deadline`, user)
    .map((t) => (wip.reached ? { ...t, take_blocked: `Сначала сдайте одну из текущих задач (лимит ${wip.limit})` } : t));
  const m30 = [now - 30 * DAY, now];
  const d = doneStats('creative_id = @me', me, ...m30);
  const submitted30 = db.prepare('SELECT COUNT(*) c FROM tasks WHERE creative_id = ? AND first_submitted_at >= ?').get(user.id, iso(m30[0])).c;
  const plan = planFor(user.id, now);
  const tiles = [
    tile('in_work', 'В работе', wip.count, { hint: `лимит ${wip.limit}`, link: '/board?mine=1' }),
    tile('revisions', 'На правках', mine.filter((t) => t.status === 'revision').length, { link: '/board?mine=1' }),
    tile('submitted', 'Сдано за 30 дней', submitted30),
    tile('on_time', 'В срок', d.onTime, { fmt: 'pct' }),
    tile('winners', 'Победителей', winnersSince('author_id = @me', me, ...m30), { link: `/library?author_id=${user.id}&status=winner&sort=roi` }),
  ];
  if (plan) tiles.push(tile('plan', 'План месяца', plan.fact, { fmt: 'plan', plan }));
  return [
    { key: 'summary', kind: 'summary', title: 'Сводка', tiles, alerts: [] },
    list(full, 'my_tasks', 'Мои задачи и правки', mine, { link: '/board?mine=1', empty: 'Ничего в работе — возьмите задачу справа' }),
    list(full, 'available', 'Можно взять', available, { link: '/board', empty: 'Новых задач нет', wip }),
  ];
}

router.get('/queue', auth, wrap((req, res) => {
  const u = req.user;
  const full = req.query.full === '1';
  const blocks = u.role === 'creative' ? creativeBlocks(u, full) : u.role === 'buyer' ? buyerBlocks(u, full) : leadBlocks(u, full);
  res.json({ role: u.role, blocks });
}));

export default router;
