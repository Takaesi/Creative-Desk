// F6. Шаблоны ТЗ: личные (байер) и общие (ставит руководитель).
import { Router } from 'express';
import { db, nowIso, logHistory } from '../db.js';
import { PRIORITIES } from '../domain.js';
import { HttpError, wrap, auth, requireRole, idOrNull } from '../http.js';

const router = Router();
const FIELDS = ['offer_id', 'approach_id', 'geo', 'creative_type', 'quantity', 'language', 'format', 'hook', 'description', 'references_text', 'priority', 'deadline_hours'];

const LIST_SQL = `SELECT bt.*, u.name AS owner_name, o.name AS offer_name, o.is_active AS offer_active, a.name AS approach_name, a.is_active AS approach_active
  FROM brief_templates bt JOIN users u ON u.id = bt.owner_id
  LEFT JOIN offers o ON o.id = bt.offer_id LEFT JOIN approaches a ON a.id = bt.approach_id`;

const canSee = (t, user) => user.role === 'lead' || t.owner_id === user.id || t.is_shared;
const canEdit = (t, user) => user.role === 'lead' || t.owner_id === user.id;

function getTemplate(id) {
  const t = db.prepare(`${LIST_SQL} WHERE bt.id = ?`).get(id);
  if (!t) throw new HttpError(404, 'Шаблон не найден');
  return t;
}

function clean(body, { partial = false } = {}) {
  const out = {};
  if (body.name !== undefined || !partial) {
    out.name = String(body.name ?? '').trim().slice(0, 120);
    if (!out.name) throw new HttpError(400, 'Укажите название шаблона');
  }
  const str = (k, max) => { if (body[k] !== undefined) out[k] = body[k] === null ? null : String(body[k]).trim().slice(0, max) || null; };
  str('geo', 100); str('creative_type', 60); str('language', 60); str('format', 200); str('hook', 1000);
  if (body.description !== undefined) out.description = String(body.description ?? '').slice(0, 10000);
  if (body.references_text !== undefined) out.references_text = String(body.references_text ?? '').slice(0, 5000);
  for (const k of ['offer_id', 'approach_id']) if (body[k] !== undefined) out[k] = idOrNull(body[k]);
  if (out.offer_id && !db.prepare('SELECT 1 FROM offers WHERE id = ?').get(out.offer_id)) throw new HttpError(400, 'Оффер не найден');
  if (out.approach_id && !db.prepare('SELECT 1 FROM approaches WHERE id = ?').get(out.approach_id)) throw new HttpError(400, 'Подход не найден');
  if (body.priority !== undefined) {
    if (body.priority && !PRIORITIES.includes(body.priority)) throw new HttpError(400, 'Некорректный приоритет');
    out.priority = body.priority || null;
  }
  for (const [k, max] of [['quantity', 1000], ['deadline_hours', 24 * 60]]) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === '') { out[k] = null; continue; }
    const n = Number(body[k]);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `«${k === 'quantity' ? 'Количество' : 'Срок, ч'}» — целое от 1 до ${max}`);
    out[k] = n;
  }
  if (body.is_shared !== undefined) out.is_shared = body.is_shared === true || body.is_shared === 1 || body.is_shared === '1' ? 1 : 0;
  return out;
}

router.get('/templates', auth, requireRole('buyer', 'lead'), wrap((req, res) => {
  const rows = req.user.role === 'lead'
    ? db.prepare(`${LIST_SQL} ORDER BY bt.owner_id = ? DESC, bt.use_count DESC, bt.name`).all(req.user.id)
    : db.prepare(`${LIST_SQL} WHERE bt.owner_id = ? OR bt.is_shared = 1 ORDER BY bt.owner_id = ? DESC, bt.use_count DESC, bt.name`).all(req.user.id, req.user.id);
  res.json(rows.map((t) => ({ ...t, mine: t.owner_id === req.user.id, can_edit: canEdit(t, req.user) })));
}));

router.post('/templates', auth, requireRole('buyer', 'lead'), wrap((req, res) => {
  const f = clean(req.body || {});
  if (f.is_shared && req.user.role !== 'lead') throw new HttpError(403, 'Общие шаблоны создаёт руководитель');
  const at = nowIso();
  const row = { offer_id: null, approach_id: null, geo: null, creative_type: null, quantity: null, language: null, format: null, hook: null,
    description: '', references_text: '', priority: null, deadline_hours: null, is_shared: 0, ...f, owner_id: req.user.id, at };
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO brief_templates (name, owner_id, is_shared, ${FIELDS.join(', ')}, created_at, updated_at)
      VALUES (@name, @owner_id, @is_shared, ${FIELDS.map((k) => `@${k}`).join(', ')}, @at, @at)`).run(row);
    logHistory({ userId: req.user.id, action: 'template_changed', at, details: { op: 'created', name: row.name, shared: !!row.is_shared } });
    return r.lastInsertRowid;
  })();
  res.status(201).json(getTemplate(id));
}));

router.patch('/templates/:id', auth, requireRole('buyer', 'lead'), wrap((req, res) => {
  const t = getTemplate(req.params.id);
  if (!canEdit(t, req.user)) throw new HttpError(403, 'Это чужой шаблон');
  const f = clean(req.body || {}, { partial: true });
  if (f.is_shared !== undefined && f.is_shared !== t.is_shared && req.user.role !== 'lead') throw new HttpError(403, 'Делать шаблон общим может только руководитель');
  const keys = Object.keys(f);
  if (keys.length) {
    const at = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE brief_templates SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @at WHERE id = @id`).run({ ...f, at, id: t.id });
      logHistory({ userId: req.user.id, action: 'template_changed', at, details: { op: 'updated', name: f.name || t.name, fields: keys } });
    })();
  }
  res.json(getTemplate(t.id));
}));

router.delete('/templates/:id', auth, requireRole('buyer', 'lead'), wrap((req, res) => {
  const t = getTemplate(req.params.id);
  if (!canEdit(t, req.user)) throw new HttpError(403, 'Это чужой шаблон');
  db.transaction(() => {
    db.prepare('DELETE FROM brief_templates WHERE id = ?').run(t.id);
    logHistory({ userId: req.user.id, action: 'template_changed', details: { op: 'deleted', name: t.name } });
  })();
  res.json({ ok: true });
}));

/** Применение шаблона: счётчик использований + поля для формы с вычисленным дедлайном. */
router.post('/templates/:id/use', auth, requireRole('buyer', 'lead'), wrap((req, res) => {
  const t = getTemplate(req.params.id);
  if (!canSee(t, req.user)) throw new HttpError(403, 'Шаблон недоступен');
  db.prepare('UPDATE brief_templates SET use_count = use_count + 1 WHERE id = ?').run(t.id);
  const fields = { template_id: t.id };
  for (const k of ['geo', 'creative_type', 'quantity', 'language', 'format', 'hook', 'priority']) if (t[k] != null && t[k] !== '') fields[k] = t[k];
  if (t.description) fields.description = t.description;
  if (t.references_text) fields.references_text = t.references_text;
  if (t.offer_id && t.offer_active) { fields.offer_id = t.offer_id; fields.offer = t.offer_name; }
  if (t.approach_id && t.approach_active) fields.approach_id = t.approach_id;
  if (t.deadline_hours) fields.deadline = new Date(Date.now() + t.deadline_hours * 3600_000).toISOString();
  res.json(fields);
}));

export default router;
