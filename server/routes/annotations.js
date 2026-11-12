// F7. Пометки (пины) прямо на креативе: точка на картинке, точка + секунда на видео, общее замечание.
// Координаты — доли 0..1 от показанного изображения, чтобы пин стоял на месте при любом размере экрана.
import { Router } from 'express';
import { db, nowIso, logHistory } from '../db.js';
import { HttpError, wrap, auth } from '../http.js';
import { code } from '../creatives.js';
import { getCreativeRow, shapeCreative, previewKind } from './creatives.js';

const router = Router();

const ANN_SQL = `SELECT a.*, u.name AS author_name, u.color AS author_color, u.role AS author_role, r.name AS resolved_by_name
  FROM annotations a JOIN users u ON u.id = a.author_id LEFT JOIN users r ON r.id = a.resolved_by`;

/**
 * «Текущие» пины — на актуальных версиях креативов задачи (последняя версия слота, ещё не принята).
 * Пины перекрытой версии к текущему раунду не относятся: они показываются на новой версии полупрозрачными.
 */
const CURRENT_CR = `c.status = 'draft' AND c.version = (SELECT MAX(c2.version) FROM creatives c2 WHERE c2.task_id = c.task_id AND c2.slot = c.slot)`;

/** Открытые пины текущего раунда: сколько всего и по креативам — для правила «На правки» и записи о правках. */
export function openPins(taskId) {
  const rows = db.prepare(`SELECT a.creative_id, COUNT(*) n FROM annotations a JOIN creatives c ON c.id = a.creative_id
    WHERE a.task_id = ? AND a.status = 'open' AND ${CURRENT_CR} GROUP BY a.creative_id ORDER BY a.creative_id`).all(taskId);
  const count = rows.reduce((s, r) => s + r.n, 0);
  return { count, byCreative: rows.map((r) => ({ creative_id: r.creative_id, code: code(r.creative_id), count: r.n })),
    text: count ? `Замечания: ${rows.map((r) => `${r.n} на ${code(r.creative_id)}`).join(', ')}` : '' };
}

/** SQL-выражение: число открытых пинов текущего раунда задачи t (для карточек и очереди). */
export const OPEN_PINS_SQL = `(SELECT COUNT(*) FROM annotations an JOIN creatives c ON c.id = an.creative_id
  WHERE an.task_id = t.id AND an.status = 'open' AND ${CURRENT_CR})`;

const isCurrent = (c) => !!db.prepare(`SELECT 1 FROM creatives c WHERE c.id = ? AND ${CURRENT_CR}`).get(c.id);

function context(creativeId) {
  const c = getCreativeRow(creativeId);
  const task = db.prepare('SELECT id, title, status, buyer_id, creative_id FROM tasks WHERE id = ?').get(c.task_id);
  return { c, task };
}

/** Что пользователь может делать с пинами этого креатива. */
function permissions(c, task, user) {
  const owner = user.role === 'lead' || (user.role === 'buyer' && task.buyer_id === user.id);
  const executor = user.role === 'creative' && task.creative_id === user.id;
  return {
    create: owner && task.status === 'review' && isCurrent(c),
    resolve: executor || user.role === 'lead',
    reopen: owner,
    owner, executor,
  };
}

const shapeAnn = (a, user, task) => ({
  ...a,
  can_delete: a.author_id === user.id && task.status === 'review',
  can_edit: a.author_id === user.id && task.status === 'review',
});

router.get('/creatives/:id/annotations', auth, wrap((req, res) => {
  const { c, task } = context(req.params.id);
  const round = req.query.round ? Number(req.query.round) : null;
  const items = db.prepare(`${ANN_SQL} WHERE a.creative_id = ? ${round ? 'AND a.round = ?' : ''} ORDER BY a.id`)
    .all(...[c.id, round].filter((v) => v != null)).map((a) => shapeAnn(a, req.user, task));
  // пины прошлой версии того же креатива — показываются на новой версии полупрозрачными
  const prevC = db.prepare('SELECT id, version FROM creatives WHERE task_id = ? AND slot = ? AND version < ? ORDER BY version DESC LIMIT 1').get(c.task_id, c.slot, c.version);
  const previous = prevC ? {
    creative: { id: prevC.id, code: code(prevC.id), version: prevC.version },
    items: db.prepare(`${ANN_SQL} WHERE a.creative_id = ? ORDER BY a.id`).all(prevC.id),
  } : null;
  const versions = db.prepare('SELECT id, version, status FROM creatives WHERE task_id = ? AND slot = ? ORDER BY version').all(c.task_id, c.slot);
  res.json({ creative: shapeCreative(c), task, round: c.version, current: isCurrent(c), items, previous, versions, can: permissions(c, task, req.user) });
}));

function cleanText(t) {
  const s = String(t ?? '').trim().slice(0, 2000);
  if (!s) throw new HttpError(400, 'Напишите замечание');
  return s;
}
const frac = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, `«${label}» — доля от 0 до 1`);
  return Math.round(n * 10000) / 10000;
};

router.post('/creatives/:id/annotations', auth, wrap((req, res) => {
  const { c, task } = context(req.params.id);
  const can = permissions(c, task, req.user);
  if (!can.owner) throw new HttpError(403, 'Замечания ставят байер-владелец задачи и руководитель');
  if (task.status !== 'review') throw new HttpError(409, 'Замечания можно ставить, только пока задача на проверке');
  if (!can.create) throw new HttpError(409, 'Замечания ставятся на актуальную версию креатива, а не на заменённую или принятую');
  const b = req.body || {};
  const kind = previewKind(c);
  const hasPoint = b.x != null || b.y != null;
  if (hasPoint && (b.x == null || b.y == null)) throw new HttpError(400, 'Нужны обе координаты: x и y');
  if (hasPoint && !['image', 'video'].includes(kind)) throw new HttpError(400, 'К ссылке и файлу — только общие замечания, без точки');
  if (b.time_sec != null && kind !== 'video') throw new HttpError(400, 'Время указывается только для видео');
  const row = {
    creative_id: c.id, task_id: task.id, round: c.version, author_id: req.user.id,
    x: hasPoint ? frac(b.x, 'x') : null, y: hasPoint ? frac(b.y, 'y') : null,
    time_sec: b.time_sec != null && b.time_sec !== '' ? Math.max(0, Math.round(Number(b.time_sec) * 100) / 100) : null,
    text: cleanText(b.text), at: nowIso(),
  };
  if (row.time_sec != null && !Number.isFinite(row.time_sec)) throw new HttpError(400, 'Некорректное время');
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO annotations (creative_id, task_id, round, author_id, x, y, time_sec, text, created_at, updated_at)
      VALUES (@creative_id, @task_id, @round, @author_id, @x, @y, @time_sec, @text, @at, @at)`).run(row);
    logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'annotation_added', creativeId: c.id, at: row.at,
      details: { code: code(c.id), round: row.round, text: row.text.slice(0, 120), time_sec: row.time_sec, point: hasPoint } });
    return r.lastInsertRowid;
  })();
  res.status(201).json(shapeAnn(db.prepare(`${ANN_SQL} WHERE a.id = ?`).get(id), req.user, task));
}));

function getAnn(id) {
  const a = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id);
  if (!a) throw new HttpError(404, 'Замечание не найдено');
  return a;
}

router.patch('/annotations/:id', auth, wrap((req, res) => {
  const a = getAnn(req.params.id);
  const { c, task } = context(a.creative_id);
  const can = permissions(c, task, req.user);
  const b = req.body || {};
  const set = {};
  const at = nowIso();
  if (b.text !== undefined) {
    if (a.author_id !== req.user.id) throw new HttpError(403, 'Менять текст может только автор замечания');
    if (task.status !== 'review') throw new HttpError(409, 'Текст замечания меняется, только пока задача на проверке');
    set.text = cleanText(b.text);
  }
  if (b.status !== undefined && b.status !== a.status) {
    if (b.status === 'resolved') {
      if (!can.resolve) throw new HttpError(403, 'Отметить «Исправлено» может исполнитель задачи');
      Object.assign(set, { status: 'resolved', resolved_by: req.user.id, resolved_at: at });
    } else if (b.status === 'open') {
      if (!can.reopen) throw new HttpError(403, 'Вернуть замечание может байер-владелец или руководитель');
      Object.assign(set, { status: 'open', resolved_by: null, resolved_at: null });
    } else throw new HttpError(400, 'Статус — open или resolved');
  }
  if (Object.keys(set).length) {
    db.transaction(() => {
      db.prepare(`UPDATE annotations SET ${Object.keys(set).map((k) => `${k} = @${k}`).join(', ')}, updated_at = @at WHERE id = @id`).run({ ...set, at, id: a.id });
      const action = set.status === 'resolved' ? 'annotation_resolved' : set.status === 'open' ? 'annotation_reopened' : 'annotation_edited';
      logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action, creativeId: c.id, at, details: { code: code(c.id), round: a.round, text: (set.text || a.text).slice(0, 120) } });
    })();
  }
  res.json(shapeAnn(db.prepare(`${ANN_SQL} WHERE a.id = ?`).get(a.id), req.user, task));
}));

router.delete('/annotations/:id', auth, wrap((req, res) => {
  const a = getAnn(req.params.id);
  const { c, task } = context(a.creative_id);
  if (a.author_id !== req.user.id) throw new HttpError(403, 'Удалить замечание может только его автор');
  if (task.status !== 'review') throw new HttpError(409, 'Удалять замечания можно, только пока задача на проверке');
  db.transaction(() => {
    db.prepare('DELETE FROM annotations WHERE id = ?').run(a.id);
    logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'annotation_deleted', creativeId: c.id, details: { code: code(c.id), text: a.text.slice(0, 120) } });
  })();
  res.json({ ok: true });
}));

export default router;
