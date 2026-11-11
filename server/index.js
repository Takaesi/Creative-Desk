import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso, logHistory, UPLOAD_DIR, runDbMigrations } from './db.js';
import { STATUSES, PRIORITIES, CREATIVE_TYPES, AI_SERVICES, GEOS, computeDurations, isOverdue, allowedActions, defaultUnits } from './domain.js';
import { HttpError, wrap, auth, requireRole, upload, fixName, publicUser, idOrNull } from './http.js';
import dictionariesRouter, { findOffer, findApproach } from './routes/dictionaries.js';
import { buildAnalytics } from './analytics.js';
import { seed, seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

runDbMigrations(AI_SERVICES);

// RESEED_ON_START=1 — пересоздавать демо-данные при каждом старте (даты задач остаются «свежими»)
if (process.env.RESEED_ON_START === '1') seed();
else seedIfEmpty();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

function getTask(id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, 'Задача не найдена');
  return t;
}

function ensureAction(task, user, action) {
  if (!allowedActions(task, user).includes(action)) throw new HttpError(403, 'Действие недоступно для вашей роли или текущего статуса');
}

/** Переход статуса + запись в историю в одной транзакции. */
function transition(task, user, toStatus, extraSet = {}, action = 'status_change', details = null) {
  const at = nowIso();
  const set = { ...extraSet, status: toStatus, updated_at: at };
  const cols = Object.keys(set);
  db.prepare(`UPDATE tasks SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...set, id: task.id });
  logHistory({ taskId: task.id, taskTitle: task.title, userId: user.id, action, from: task.status, to: toStatus, details, at });
  return at;
}

const TASK_LIST_SQL = `
  SELECT t.*,
    b.name AS buyer_name, b.color AS buyer_color,
    c.name AS creative_name, c.color AS creative_color,
    ap.name AS approach_name,
    (SELECT COALESCE(SUM(credits),0) FROM ai_expenses e WHERE e.task_id = t.id) AS credits_total,
    (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id AND f.kind='reference') AS ref_count,
    (SELECT COUNT(*) FROM comments m WHERE m.task_id = t.id) AS comment_count
  FROM tasks t
  JOIN users b ON b.id = t.buyer_id
  LEFT JOIN users c ON c.id = t.creative_id
  LEFT JOIN approaches ap ON ap.id = t.approach_id`;

function decorate(t, user) {
  return { ...t, overdue: isOverdue(t), actions: allowedActions(t, user) };
}

function taskFields(body, { partial = false, current = null } = {}) {
  const out = {};
  const str = (k, max = 200) => {
    if (body[k] === undefined) return;
    out[k] = String(body[k]).trim().slice(0, max);
  };
  str('title'); str('offer'); str('geo', 100); str('creative_type', 60);
  str('description', 10000); str('references_text', 5000);
  str('language', 60); str('format', 200); str('hook', 1000);
  // Оффер: источник истины — offer_id; текст оставлен для совместимости и подставляется из справочника
  if (body.offer_id !== undefined) {
    const oid = idOrNull(body.offer_id);
    if (oid == null) out.offer_id = null;
    else {
      const o = findOffer(oid);
      if (!o) throw new HttpError(400, 'Оффер не найден в справочнике');
      if (!o.is_active && current?.offer_id !== o.id) throw new HttpError(400, `Оффер «${o.name}» деактивирован`);
      out.offer_id = o.id;
      out.offer = o.name;
    }
  }
  if (out.offer && out.offer_id === undefined) {
    const o = db.prepare('SELECT * FROM offers WHERE name = ? COLLATE NOCASE').get(out.offer);
    out.offer_id = o ? o.id : null;
    if (o) out.offer = o.name;
  }
  if (body.approach_id !== undefined) {
    const aid = idOrNull(body.approach_id);
    if (aid != null) {
      const a = findApproach(aid);
      if (!a) throw new HttpError(400, 'Подход не найден в справочнике');
      if (!a.is_active && current?.approach_id !== a.id) throw new HttpError(400, `Подход «${a.name}» деактивирован`);
    }
    out.approach_id = aid;
  }
  if (body.estimate_units !== undefined && body.estimate_units !== '') {
    const u = parseInt(body.estimate_units, 10);
    if (!Number.isFinite(u) || u < 1 || u > 1000) throw new HttpError(400, 'Трудоёмкость должна быть от 1 до 1000');
    out.estimate_units = u;
  }
  if (body.quantity !== undefined) {
    const q = parseInt(body.quantity, 10);
    if (!Number.isFinite(q) || q < 1 || q > 1000) throw new HttpError(400, 'Количество должно быть от 1 до 1000');
    out.quantity = q;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) throw new HttpError(400, 'Некорректный приоритет');
    out.priority = body.priority;
  }
  if (body.deadline !== undefined) {
    if (body.deadline === '' || body.deadline === null) out.deadline = null;
    else {
      const d = Date.parse(body.deadline);
      if (Number.isNaN(d)) throw new HttpError(400, 'Некорректный дедлайн');
      out.deadline = new Date(d).toISOString();
    }
  }
  if (!partial) {
    for (const k of ['offer', 'geo', 'creative_type']) if (!out[k]) throw new HttpError(400, `Поле «${{ offer: 'Оффер', geo: 'GEO', creative_type: 'Тип креатива' }[k]}» обязательно`);
    if (!out.deadline) throw new HttpError(400, 'Укажите дедлайн');
    if (!out.title) out.title = `${out.creative_type} · ${out.offer} · ${out.geo}`;
    if (!out.estimate_units) out.estimate_units = defaultUnits(out.creative_type, out.quantity || 1);
  } else {
    for (const k of ['offer', 'geo', 'creative_type', 'title']) if (k in out && !out[k]) throw new HttpError(400, 'Обязательные поля не могут быть пустыми');
  }
  return out;
}

function saveFiles(files, taskId, userId, kind, submissionId = null) {
  const ins = db.prepare(
    `INSERT INTO files (task_id, submission_id, kind, original_name, stored_name, mime, size, uploaded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const at = nowIso();
  return (files || []).map((f) => ins.run(taskId, submissionId, kind, fixName(f.originalname), f.filename, f.mimetype, f.size, userId, at).lastInsertRowid);
}

// ---------- auth ----------
app.post('/api/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) throw new HttpError(401, 'Неверный email или пароль');
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${req.secure ? '; Secure' : ''}`);
  res.json({ user: publicUser(user), token });
}));

app.post('/api/auth/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/demo-users', (_req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, position, color FROM users ORDER BY CASE role WHEN \'lead\' THEN 0 WHEN \'buyer\' THEN 1 ELSE 2 END, id').all());
});

// ---------- meta ----------
app.get('/api/meta', auth, (_req, res) => {
  res.json({
    statuses: STATUSES, priorities: PRIORITIES, creativeTypes: CREATIVE_TYPES, geos: GEOS,
    aiServices: db.prepare('SELECT name FROM ai_services WHERE is_active = 1 ORDER BY name').all().map((r) => r.name),
    offers: db.prepare('SELECT name FROM offers WHERE is_active = 1 ORDER BY name').all().map((r) => r.name),
  });
});

app.get('/api/users', auth, (req, res) => {
  // ставки — денежные данные, отдаём только руководителю
  const extra = req.user.role === 'lead' ? ', hourly_rate_rub, capacity_units, wip_limit' : ', capacity_units';
  res.json(db.prepare(`SELECT id, name, email, role, position, color${extra} FROM users ORDER BY role, name`).all());
});

app.use('/api', dictionariesRouter);

// ---------- tasks ----------
app.get('/api/tasks', auth, wrap((req, res) => {
  const where = [];
  const params = {};
  const { q, mine, priority, creative_id, buyer_id, geo, type } = req.query;
  if (q) { where.push('(t.title LIKE @q OR t.offer LIKE @q OR t.description LIKE @q OR t.geo LIKE @q OR CAST(t.id AS TEXT) = @qraw)'); params.q = `%${q}%`; params.qraw = String(q).replace('#', ''); }
  if (mine === '1') { where.push('(t.buyer_id = @me OR t.creative_id = @me)'); params.me = req.user.id; }
  if (priority) { where.push('t.priority = @priority'); params.priority = priority; }
  if (creative_id) { where.push('t.creative_id = @creative_id'); params.creative_id = Number(creative_id); }
  if (buyer_id) { where.push('t.buyer_id = @buyer_id'); params.buyer_id = Number(buyer_id); }
  if (geo) { where.push('t.geo LIKE @geo'); params.geo = `%${geo}%`; }
  if (type) { where.push('t.creative_type = @type'); params.type = type; }
  const sql = `${TASK_LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.deadline IS NULL, t.deadline, t.id DESC`;
  res.json(db.prepare(sql).all(params).map((t) => decorate(t, req.user)));
}));

app.post('/api/tasks', auth, requireRole('buyer', 'lead'), upload.array('files', 10), wrap((req, res) => {
  const f = taskFields(req.body);
  const at = nowIso();
  const id = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO tasks (title, offer, offer_id, approach_id, geo, creative_type, quantity, description, references_text, language, format, hook,
         estimate_units, priority, deadline, buyer_id, created_at, updated_at)
       VALUES (@title, @offer, @offer_id, @approach_id, @geo, @creative_type, @quantity, @description, @references_text, @language, @format, @hook,
         @estimate_units, @priority, @deadline, @buyer_id, @at, @at)`
    ).run({
      quantity: 1, description: '', references_text: '', priority: 'medium', language: '', format: '', hook: '', approach_id: null,
      ...f, buyer_id: req.user.id, at,
    });
    const taskId = r.lastInsertRowid;
    saveFiles(req.files, taskId, req.user.id, 'reference');
    logHistory({ taskId, taskTitle: f.title, userId: req.user.id, action: 'created', to: 'new', at, details: { priority: f.priority || 'medium', deadline: f.deadline, files: req.files?.length || 0 } });
    return taskId;
  })();
  res.status(201).json(decorate(db.prepare(`${TASK_LIST_SQL} WHERE t.id = ?`).get(id), req.user));
}));

app.get('/api/tasks/:id', auth, wrap((req, res) => {
  const task = db.prepare(`${TASK_LIST_SQL} WHERE t.id = ?`).get(req.params.id);
  if (!task) throw new HttpError(404, 'Задача не найдена');
  const history = db.prepare(
    `SELECT h.*, u.name AS user_name, u.color AS user_color, u.role AS user_role FROM history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.task_id = ? ORDER BY h.created_at, h.id`
  ).all(task.id).map((h) => ({ ...h, details: h.details ? JSON.parse(h.details) : null }));
  const files = db.prepare('SELECT f.*, u.name AS uploader FROM files f JOIN users u ON u.id = f.uploaded_by WHERE f.task_id = ? ORDER BY f.id').all(task.id);
  const submissions = db.prepare(
    'SELECT s.*, u.name AS creative_name FROM submissions s JOIN users u ON u.id = s.creative_id WHERE s.task_id = ? ORDER BY s.round'
  ).all(task.id).map((s) => ({ ...s, files: files.filter((f) => f.submission_id === s.id) }));
  const expenses = db.prepare(
    'SELECT e.*, u.name AS user_name FROM ai_expenses e JOIN users u ON u.id = e.user_id WHERE e.task_id = ? ORDER BY e.created_at'
  ).all(task.id);
  const comments = db.prepare(
    'SELECT c.*, u.name AS user_name, u.color AS user_color, u.role AS user_role FROM comments c JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at'
  ).all(task.id);
  res.json({
    ...decorate(task, req.user),
    references: files.filter((f) => f.kind === 'reference'),
    submissions, expenses, comments, history,
    durations: computeDurations(task, history),
  });
}));

app.patch('/api/tasks/:id', auth, wrap((req, res) => {
  const task = getTask(req.params.id);
  ensureAction(task, req.user, 'edit');
  const f = taskFields(req.body, { partial: true, current: task });
  const changes = {};
  for (const [k, v] of Object.entries(f)) if (task[k] !== v) changes[k] = { from: task[k], to: v };
  if (Object.keys(changes).length) {
    const at = nowIso();
    const set = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to]));
    db.prepare(`UPDATE tasks SET ${Object.keys(set).map((c) => `${c} = @${c}`).join(', ')}, updated_at = @at WHERE id = @id`).run({ ...set, at, id: task.id });
    logHistory({ taskId: task.id, taskTitle: f.title || task.title, userId: req.user.id, action: 'edited', details: changes, at });
  }
  res.json({ ok: true, changed: Object.keys(changes) });
}));

app.delete('/api/tasks/:id', auth, wrap((req, res) => {
  const task = getTask(req.params.id);
  ensureAction(task, req.user, 'delete');
  const files = db.prepare('SELECT stored_name FROM files WHERE task_id = ?').all(task.id);
  db.transaction(() => {
    logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'deleted', from: task.status });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  })();
  files.forEach((f) => fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {}));
  res.json({ ok: true });
}));

// Креативщик берёт задачу (новую — себе, или свою на правках)
app.post('/api/tasks/:id/take', auth, wrap((req, res) => {
  db.transaction(() => {
    const task = getTask(req.params.id);
    ensureAction(task, req.user, 'take');
    if (task.status === 'revision') {
      // задача остаётся в колонке «Правки» до повторной сдачи; фиксируем начало доработки
      const at = nowIso();
      db.prepare('UPDATE tasks SET revision_started_at = ?, updated_at = ? WHERE id = ?').run(at, at, task.id);
      logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'revision_started', details: { round: task.revision_count }, at });
    } else {
      transition(task, req.user, 'in_progress', { creative_id: req.user.id, taken_at: task.taken_at || nowIso() }, 'taken');
    }
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/release', auth, wrap((req, res) => {
  db.transaction(() => {
    const task = getTask(req.params.id);
    ensureAction(task, req.user, 'release');
    transition(task, req.user, 'new', { creative_id: null, taken_at: null }, 'released');
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/submit', auth, upload.array('files', 10), wrap((req, res) => {
  const task = getTask(req.params.id);
  ensureAction(task, req.user, 'submit');
  const comment = String(req.body.comment || '').trim().slice(0, 5000);
  const links = String(req.body.links || '').trim().slice(0, 5000);
  if (!links && !req.files?.length) throw new HttpError(400, 'Прикрепите файлы или ссылку на результат');
  db.transaction(() => {
    const at = nowIso();
    const round = task.revision_count + 1;
    const sid = db.prepare('INSERT INTO submissions (task_id, round, creative_id, comment, links, created_at) VALUES (?,?,?,?,?,?)')
      .run(task.id, round, req.user.id, comment, links, at).lastInsertRowid;
    saveFiles(req.files, task.id, req.user.id, 'result', sid);
    const extra = { submitted_at: at, revision_started_at: null };
    if (!task.first_submitted_at) extra.first_submitted_at = at;
    transition(task, req.user, 'review', extra, 'submitted', { round, files: req.files?.length || 0, links: links ? links.split(/\s+/).length : 0 });
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/accept', auth, wrap((req, res) => {
  db.transaction(() => {
    const task = getTask(req.params.id);
    ensureAction(task, req.user, 'accept');
    const comment = String(req.body?.comment || '').trim();
    if (comment) db.prepare('INSERT INTO comments (task_id, user_id, text, created_at) VALUES (?,?,?,?)').run(task.id, req.user.id, comment, nowIso());
    transition(task, req.user, 'done', { completed_at: nowIso() }, 'accepted');
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/revision', auth, wrap((req, res) => {
  const comment = String(req.body?.comment || '').trim().slice(0, 5000);
  if (!comment) throw new HttpError(400, 'Опишите, что нужно поправить');
  db.transaction(() => {
    const task = getTask(req.params.id);
    ensureAction(task, req.user, 'revision');
    const at = nowIso();
    db.prepare("INSERT INTO comments (task_id, user_id, text, kind, created_at) VALUES (?,?,?,'revision',?)").run(task.id, req.user.id, comment, at);
    transition(task, req.user, 'revision', { revision_count: task.revision_count + 1, revision_started_at: null }, 'revision_requested', { round: task.revision_count + 1 });
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/assign', auth, requireRole('lead'), wrap((req, res) => {
  const creative = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'creative'").get(req.body?.creative_id);
  if (!creative) throw new HttpError(400, 'Выберите креативщика');
  db.transaction(() => {
    const task = getTask(req.params.id);
    ensureAction(task, req.user, 'assign');
    const prev = task.creative_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(task.creative_id)?.name : null;
    const at = nowIso();
    if (task.status === 'new') {
      transition(task, req.user, 'in_progress', { creative_id: creative.id, taken_at: at }, 'assigned', { creative: creative.name, prev });
    } else {
      db.prepare('UPDATE tasks SET creative_id = ?, updated_at = ? WHERE id = ?').run(creative.id, at, task.id);
      logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'assigned', details: { creative: creative.name, prev }, at });
    }
  })();
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/references', auth, upload.array('files', 10), wrap((req, res) => {
  const task = getTask(req.params.id);
  ensureAction(task, req.user, 'upload_reference');
  if (!req.files?.length) throw new HttpError(400, 'Нет файлов');
  saveFiles(req.files, task.id, req.user.id, 'reference');
  logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'references_added', details: { files: req.files.map((f) => fixName(f.originalname)) } });
  res.json({ ok: true });
}));

// ---------- AI expenses ----------
app.post('/api/tasks/:id/expenses', auth, wrap((req, res) => {
  const task = getTask(req.params.id);
  ensureAction(task, req.user, 'expense');
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  const clean = items.map((i) => {
    const service = String(i?.service || '').trim().slice(0, 60);
    const credits = Number(i?.credits);
    if (!service) throw new HttpError(400, 'Укажите AI-сервис');
    const known = db.prepare('SELECT name FROM ai_services WHERE name = ? COLLATE NOCASE AND is_active = 1').get(service);
    if (!known) throw new HttpError(400, `AI-сервис «${service}» не найден в справочнике`);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 1e6) throw new HttpError(400, 'Кредиты должны быть положительным числом');
    return { service: known.name, credits: Math.round(credits * 100) / 100, note: String(i?.note || '').trim().slice(0, 300) };
  });
  db.transaction(() => {
    const at = nowIso();
    const ins = db.prepare('INSERT INTO ai_expenses (task_id, user_id, service, credits, round, note, created_at) VALUES (?,?,?,?,?,?,?)');
    clean.forEach((c) => ins.run(task.id, req.user.id, c.service, c.credits, task.revision_count, c.note, at));
    logHistory({ taskId: task.id, taskTitle: task.title, userId: req.user.id, action: 'expense_added', details: { items: clean, round: task.revision_count }, at });
  })();
  res.json({ ok: true });
}));

app.delete('/api/expenses/:id', auth, wrap((req, res) => {
  const e = db.prepare('SELECT e.*, t.title FROM ai_expenses e JOIN tasks t ON t.id = e.task_id WHERE e.id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Запись не найдена');
  if (e.user_id !== req.user.id && req.user.role !== 'lead') throw new HttpError(403, 'Можно удалять только свои записи');
  db.transaction(() => {
    db.prepare('DELETE FROM ai_expenses WHERE id = ?').run(e.id);
    logHistory({ taskId: e.task_id, taskTitle: e.title, userId: req.user.id, action: 'expense_removed', details: { service: e.service, credits: e.credits } });
  })();
  res.json({ ok: true });
}));

// ---------- comments ----------
app.post('/api/tasks/:id/comments', auth, wrap((req, res) => {
  const task = getTask(req.params.id);
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  if (!text) throw new HttpError(400, 'Пустой комментарий');
  db.prepare('INSERT INTO comments (task_id, user_id, text, created_at) VALUES (?,?,?,?)').run(task.id, req.user.id, text, nowIso());
  res.json({ ok: true });
}));

// ---------- files ----------
app.get('/api/files/:id', auth, wrap((req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!f) throw new HttpError(404, 'Файл не найден');
  const p = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Файл отсутствует на диске');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  // загруженный пользователем SVG/HTML не должен исполнять скрипты на нашем домене
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  const disp = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  fs.createReadStream(p).pipe(res);
}));

// ---------- activity & analytics ----------
app.get('/api/activity', auth, wrap((req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare(
    `SELECT h.*, u.name AS user_name, u.color AS user_color, u.role AS user_role FROM history h LEFT JOIN users u ON u.id = h.user_id
     ORDER BY h.created_at DESC, h.id DESC LIMIT ?`
  ).all(limit);
  res.json(rows.map((h) => ({ ...h, details: h.details ? JSON.parse(h.details) : null })));
}));

app.get('/api/analytics', auth, requireRole('lead'), wrap((req, res) => {
  res.json(buildAnalytics({ from: req.query.from, to: req.query.to }));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// ---------- static client ----------
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ---------- errors ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // запрос отклонён — удаляем уже загруженные multer'ом файлы, чтобы не копить мусор
  (req.files || []).forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 25 МБ' : err.message });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Внутренняя ошибка сервера' : err.message });
});

app.listen(PORT, () => console.log(`Creative Desk API on http://localhost:${PORT}`));
