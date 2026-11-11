// F2. Креативы и Библиотека.
import { Router } from 'express';
import { db, nowIso, logHistory, getSettings } from '../db.js';
import { allowedCreativeActions, canManageCreative, CREATIVE_STATUSES } from '../domain.js';
import { HttpError, wrap, auth, idOrNull } from '../http.js';
import { computeMetrics, derived } from '../metrics.js';
import { computeTaskCost } from '../analytics.js';
import { setCreativeStatus, CreativeError, code } from '../creatives.js';

const router = Router();

const METRICS_CTE = `WITH m AS (
  SELECT creative_id, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(conversions) AS conversions,
         SUM(spend) AS spend, SUM(revenue) AS revenue, COUNT(*) AS metric_days, MAX(date) AS last_metric_date
  FROM creative_metrics GROUP BY creative_id)`;

const CREATIVE_SELECT = `
  SELECT c.*, f.mime AS file_mime, f.original_name AS file_name, f.size AS file_size,
    o.name AS offer_name, ap.name AS approach_name,
    au.name AS author_name, au.color AS author_color, b.name AS buyer_name, b.color AS buyer_color,
    t.title AS task_title, t.iteration AS task_iteration, t.status AS task_status,
    m.impressions, m.clicks, m.conversions, m.spend, m.revenue, m.metric_days, m.last_metric_date,
    CASE WHEN m.spend > 0 THEN (m.revenue - m.spend) * 100.0 / m.spend END AS roi,
    CASE WHEN m.impressions > 0 THEN m.clicks * 100.0 / m.impressions END AS ctr
  FROM creatives c
  JOIN tasks t ON t.id = c.task_id
  JOIN users au ON au.id = c.author_id
  JOIN users b ON b.id = c.buyer_id
  LEFT JOIN files f ON f.id = c.file_id
  LEFT JOIN offers o ON o.id = c.offer_id
  LEFT JOIN approaches ap ON ap.id = c.approach_id
  LEFT JOIN m ON m.creative_id = c.id`;

export function previewKind(c) {
  if (c.link) return 'link';
  if (c.file_mime?.startsWith('image/')) return 'image';
  if (c.file_mime?.startsWith('video/')) return 'video';
  return 'file';
}

/** Строка из БД → объект для клиента: код, превью, сводка метрик. */
export function shapeCreative(c) {
  const hasMetrics = c.metric_days > 0;
  const sums = { impressions: c.impressions || 0, clicks: c.clicks || 0, conversions: c.conversions || 0, spend: c.spend || 0, revenue: c.revenue || 0 };
  let domain = null;
  if (c.link) { try { domain = new URL(c.link).hostname.replace(/^www\./, ''); } catch { domain = c.link; } }
  return {
    id: c.id, code: code(c.id), title: c.title, status: c.status, slot: c.slot, version: c.version,
    task_id: c.task_id, task_title: c.task_title, task_iteration: c.task_iteration, task_status: c.task_status, submission_id: c.submission_id,
    file_id: c.file_id, file_name: c.file_name, file_mime: c.file_mime, file_size: c.file_size, link: c.link, domain,
    preview_kind: previewKind(c), preview_url: c.file_id ? `/api/files/${c.file_id}` : null,
    offer_id: c.offer_id, offer_name: c.offer_name, approach_id: c.approach_id, approach_name: c.approach_name,
    geo: c.geo, creative_type: c.creative_type, tags: c.tags ? c.tags.split(',').filter(Boolean) : [],
    author_id: c.author_id, author_name: c.author_name, author_color: c.author_color,
    buyer_id: c.buyer_id, buyer_name: c.buyer_name, buyer_color: c.buyer_color,
    parent_creative_id: c.parent_creative_id, suggested_verdict: c.suggested_verdict,
    burnout: !!c.burnout_detected_at, burnout_detected_at: c.burnout_detected_at,
    created_at: c.created_at, accepted_at: c.accepted_at, launched_at: c.launched_at, verdict_at: c.verdict_at, updated_at: c.updated_at,
    last_metric_date: c.last_metric_date || null,
    metrics_summary: hasMetrics ? { ...sums, days: c.metric_days, ...derived(sums) } : null,
  };
}

/** WHERE по фильтрам библиотеки. По умолчанию прячем черновики, перекрытые версии и архив. */
function libraryWhere(q) {
  const where = [];
  const p = {};
  const add = (sql, key, val) => { where.push(sql); p[key] = val; };
  if (q.offer_id) add('c.offer_id = @offer_id', 'offer_id', Number(q.offer_id));
  if (q.approach_id) add('c.approach_id = @approach_id', 'approach_id', Number(q.approach_id));
  if (q.author_id) add('c.author_id = @author_id', 'author_id', Number(q.author_id));
  if (q.buyer_id) add('c.buyer_id = @buyer_id', 'buyer_id', Number(q.buyer_id));
  if (q.type) add('c.creative_type = @type', 'type', String(q.type));
  if (q.geo) add('c.geo LIKE @geo', 'geo', `%${q.geo}%`);
  if (q.task_id) add('c.task_id = @task_id', 'task_id', Number(q.task_id));
  if (q.parent_id) add('c.parent_creative_id = @parent_id', 'parent_id', Number(q.parent_id));
  if (q.from) add('c.created_at >= @from', 'from', new Date(q.from).toISOString());
  if (q.to) add('c.created_at <= @to', 'to', new Date(Date.parse(q.to) + 86400000 - 1).toISOString());
  if (q.burnout === '1') where.push('c.burnout_detected_at IS NOT NULL');
  if (q.q) {
    const m = String(q.q).match(/^\s*(?:CD-)?(\d+)\s*$/i);
    where.push(`(c.title LIKE @q OR c.tags LIKE @q${m ? ' OR c.id = @qid' : ''})`);
    p.q = `%${String(q.q).trim()}%`;
    if (m) p.qid = Number(m[1]);
  }
  const statuses = String(q.status || '').split(',').filter((s) => CREATIVE_STATUSES.includes(s));
  if (statuses.length) {
    where.push(`c.status IN (${statuses.map((_, i) => `@st${i}`).join(',')})`);
    statuses.forEach((s, i) => { p[`st${i}`] = s; });
  } else if (q.all !== '1') where.push("c.status NOT IN ('draft','superseded','archived')");
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params: p };
}

const SORTS = {
  new: 'c.created_at DESC, c.id DESC',
  roi: 'roi IS NULL, roi DESC, c.id DESC',
  spend: 'm.spend IS NULL, m.spend DESC, c.id DESC',
  ctr: 'ctr IS NULL, ctr DESC, c.id DESC',
};

router.get('/creatives', auth, wrap((req, res) => {
  const { sql, params } = libraryWhere(req.query);
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const order = SORTS[req.query.sort] || SORTS.new;
  const items = db.prepare(`${METRICS_CTE} ${CREATIVE_SELECT} ${sql} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(params).map(shapeCreative);
  const s = db.prepare(`${METRICS_CTE} SELECT COUNT(*) AS total,
      SUM(c.status = 'in_test') AS in_test, SUM(c.status = 'winner') AS winners,
      SUM(c.status IN ('winner','average','loser','burned')) AS with_verdict,
      AVG(CASE WHEN m.spend > 0 THEN (m.revenue - m.spend) * 100.0 / m.spend END) AS avg_roi
    FROM creatives c LEFT JOIN m ON m.creative_id = c.id ${sql}`).get(params);
  res.json({
    items, total: s.total, offset, limit,
    summary: {
      total: s.total, in_test: s.in_test || 0, winners: s.winners || 0, with_verdict: s.with_verdict || 0,
      winner_pct: s.total ? ((s.winners || 0) / s.total) * 100 : null,
      avg_roi: s.avg_roi == null ? null : Math.round(s.avg_roi * 10) / 10,
    },
  });
}));

export function getCreativeRow(id) {
  const c = db.prepare(`${METRICS_CTE} ${CREATIVE_SELECT} WHERE c.id = ?`).get(id);
  if (!c) throw new HttpError(404, 'Креатив не найден');
  return c;
}

/** Видит ли пользователь деньги (себестоимость) по этому креативу. */
export const canSeeCost = (c, user) => user.role === 'lead' || (user.role === 'buyer' && c.buyer_id === user.id);

router.get('/creatives/:id', auth, wrap((req, res) => {
  const row = getCreativeRow(req.params.id);
  const creative = shapeCreative(row);
  const versions = db.prepare(`${METRICS_CTE} ${CREATIVE_SELECT} WHERE c.task_id = ? AND c.slot = ? ORDER BY c.version`).all(row.task_id, row.slot).map(shapeCreative);
  const metrics = db.prepare('SELECT date, impressions, clicks, conversions, spend, revenue, source, updated_at FROM creative_metrics WHERE creative_id = ? ORDER BY date').all(row.id)
    .map((r) => ({ ...r, ...derived(r) }));
  const parent = row.parent_creative_id ? db.prepare(`${METRICS_CTE} ${CREATIVE_SELECT} WHERE c.id = ?`).get(row.parent_creative_id) : null;
  const children = db.prepare(`${METRICS_CTE} ${CREATIVE_SELECT} WHERE c.parent_creative_id = ? AND c.status NOT IN ('superseded') ORDER BY c.id`).all(row.id).map(shapeCreative);
  const variationTasks = db.prepare(`SELECT id, title, status, created_at FROM tasks WHERE parent_creative_id = ? ORDER BY id`).all(row.id);
  const task = db.prepare('SELECT id, title, hook, language, format, iteration, buyer_id FROM tasks WHERE id = ?').get(row.task_id);
  const history = db.prepare(
    `SELECT h.*, u.name AS user_name, u.color AS user_color, u.role AS user_role FROM history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.creative_id = ? ORDER BY h.created_at, h.id`
  ).all(row.id).map((h) => ({ ...h, details: h.details ? JSON.parse(h.details) : null }));
  const out = {
    creative, task, versions, metrics, metrics_summary: metrics.length ? computeMetrics(metrics) : null,
    family: { parent: parent ? shapeCreative(parent) : null, children, tasks: variationTasks },
    history, actions: allowedCreativeActions(row, req.user),
  };
  // денежные поля креативщику не отдаём вообще, а не прячем на клиенте
  if (canSeeCost(row, req.user)) out.cost = computeTaskCost(row.task_id);
  res.json(out);
}));

router.patch('/creatives/:id', auth, wrap((req, res) => {
  const c = getCreativeRow(req.params.id);
  if (!allowedCreativeActions(c, req.user).includes('edit')) throw new HttpError(403, 'Редактировать креатив может байер-владелец или руководитель');
  const set = {};
  if (req.body.title !== undefined) {
    const t = String(req.body.title).trim().slice(0, 200);
    if (!t) throw new HttpError(400, 'Название не может быть пустым');
    set.title = t;
  }
  if (req.body.tags !== undefined) {
    const list = (Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags).split(','))
      .map((s) => String(s).trim().toLowerCase().replace(/,/g, '')).filter(Boolean).slice(0, 20);
    set.tags = [...new Set(list)].join(',');
  }
  if (req.body.approach_id !== undefined) {
    const aid = idOrNull(req.body.approach_id);
    if (aid != null && !db.prepare('SELECT 1 FROM approaches WHERE id = ?').get(aid)) throw new HttpError(400, 'Подход не найден');
    set.approach_id = aid;
  }
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => c[k] !== v).map(([k, v]) => [k, { from: c[k], to: v }]));
  if (Object.keys(changes).length) {
    const at = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE creatives SET ${Object.keys(changes).map((k) => `${k} = @${k}`).join(', ')}, updated_at = @at WHERE id = @id`).run({ ...set, at, id: c.id });
      logHistory({ taskId: c.task_id, taskTitle: c.task_title, userId: req.user.id, action: 'creative_edited', creativeId: c.id, at, details: { code: code(c.id), changes } });
    })();
  }
  res.json({ ok: true });
}));

const STATUS_ACTION = { in_test: 'in_test', winner: 'winner', average: 'average', loser: 'loser', burned: 'burned', archived: 'archive', restore: 'restore' };

router.post('/creatives/:id/status', auth, wrap((req, res) => {
  const to = req.body?.to;
  if (!STATUS_ACTION[to]) throw new HttpError(400, 'Некорректный статус');
  let status;
  db.transaction(() => {
    const c = getCreativeRow(req.params.id);
    if (!canManageCreative(c, req.user)) throw new HttpError(403, 'Менять статус креатива может байер-владелец или руководитель');
    if (!allowedCreativeActions(c, req.user).includes(STATUS_ACTION[to])) throw new HttpError(409, 'Это действие недоступно в текущем статусе креатива');
    try {
      status = setCreativeStatus(c, to, { userId: req.user.id, extra: c.suggested_verdict && ['winner', 'average', 'loser'].includes(to) ? { suggested: c.suggested_verdict } : null });
    } catch (e) {
      if (e instanceof CreativeError) throw new HttpError(e.status, e.message);
      throw e;
    }
  })();
  res.json({ ok: true, status, settings: getSettings() });
}));

export default router;
