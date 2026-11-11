// Сквозной тест API: полный цикл задачи по ролям. Запуск: npm test (сервер поднимается сам на временной БД).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

// Схема БД версии 1 (до v2) — для проверки миграции
const OLD_SCHEMA = `
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('buyer','creative','lead')), position TEXT, color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, offer TEXT NOT NULL, geo TEXT NOT NULL, creative_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '', references_text TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium', deadline TEXT, status TEXT NOT NULL DEFAULT 'new', buyer_id INTEGER NOT NULL REFERENCES users(id),
  creative_id INTEGER REFERENCES users(id), revision_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, taken_at TEXT,
  submitted_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, round INTEGER NOT NULL,
  creative_id INTEGER NOT NULL REFERENCES users(id), comment TEXT NOT NULL DEFAULT '', links TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE, kind TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL,
  mime TEXT, size INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE ai_expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), service TEXT NOT NULL, credits REAL NOT NULL, round INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'comment', created_at TEXT NOT NULL);
CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, task_title TEXT,
  user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, from_status TEXT, to_status TEXT, details TEXT, created_at TEXT NOT NULL);
`;

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdesk-'));
const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function as(email) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo123' }) });
  assert.equal(r.status, 200, `login ${email}`);
  const { token } = await r.json();
  const call = async (method, url, body) => {
    const opts = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body instanceof FormData) opts.body = body;
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(BASE + url, opts);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
}

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

try {
  await waitUp();
  const buyer = await as('buyer1@demo.ru');
  const buyer2 = await as('buyer2@demo.ru');
  const cr = await as('creative1@demo.ru');
  const cr2 = await as('creative2@demo.ru');
  const lead = await as('lead@demo.ru');
  let id;

  await step('демо-данные засеяны', async () => {
    const r = await lead.get('/tasks');
    assert.ok(r.body.length >= 40);
  });
  await step('неавторизованный доступ запрещён', async () => {
    assert.equal((await fetch(`${BASE}/tasks`)).status, 401);
  });
  await step('креативщик не может создать задачу', async () => {
    assert.equal((await cr.post('/tasks', { offer: 'X', geo: 'RU', creative_type: 'Видео', deadline: new Date().toISOString() })).status, 403);
  });
  await step('валидация формы ТЗ', async () => {
    const r = await buyer.post('/tasks', { offer: '', geo: 'RU', creative_type: 'Видео' });
    assert.equal(r.status, 400);
  });
  // ---------- F1: справочники и настройки ----------
  await step('F1: руководитель создаёт оффер, байер получает 403', async () => {
    const r = await lead.post('/offers', { name: 'Smoke Offer', vertical: 'нутра' });
    assert.equal(r.status, 201);
    assert.equal((await buyer.post('/offers', { name: 'Buyer Offer' })).status, 403);
    assert.equal((await lead.post('/offers', { name: 'Smoke Offer' })).status, 409, 'дубль оффера');
  });
  await step('F1: у всех задач демо-базы проставлен offer_id', async () => {
    const tasks = (await lead.get('/tasks')).body;
    assert.ok(tasks.every((t) => t.offer_id), 'offer_id у всех задач');
  });
  await step('F1: деактивированный оффер не принимается в новой задаче, старые задачи открываются', async () => {
    const d = (await lead.get('/dictionaries')).body;
    const offer = d.offers.find((o) => o.task_count > 0);
    assert.equal((await lead.patch(`/offers/${offer.id}`, { is_active: false })).status, 200);
    const r = await buyer.post('/tasks', { offer_id: offer.id, geo: 'RU', creative_type: 'Видео', deadline: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(r.status, 400);
    const old = (await lead.get('/tasks')).body.find((t) => t.offer_id === offer.id);
    assert.equal((await lead.get(`/tasks/${old.id}`)).status, 200);
    await lead.patch(`/offers/${offer.id}`, { is_active: true });
  });
  await step('F1: PATCH /settings — неизвестный ключ и нечисловое значение → 400', async () => {
    assert.equal((await lead.patch('/settings', { foo: 1 })).status, 400);
    assert.equal((await lead.patch('/settings', { verdict_winner_roi: 'abc' })).status, 400);
    assert.equal((await buyer.patch('/settings', { verdict_winner_roi: 40 })).status, 403);
    const r = await lead.patch('/settings', { verdict_winner_roi: 30 });
    assert.equal(r.status, 200);
    assert.equal(r.body.verdict_winner_roi, 30);
  });
  await step('F1: креативщик не видит цены AI-сервисов, байер видит', async () => {
    const c = (await cr.get('/dictionaries')).body;
    assert.ok(c.aiServices.length > 0 && c.aiServices.every((s) => s.credit_price_rub === undefined));
    const b = (await buyer.get('/dictionaries')).body;
    assert.ok(b.aiServices.every((s) => typeof s.credit_price_rub === 'number'));
  });
  await step('F1: ставки и WIP меняет только руководитель', async () => {
    assert.equal((await buyer.patch('/users/5', { hourly_rate_rub: 1 })).status, 403);
    assert.equal((await lead.patch('/users/5', { capacity_units: 0 })).status, 400);
    assert.equal((await lead.patch('/users/5', { hourly_rate_rub: 900, wip_limit: null })).status, 200);
  });
  await step('F8: трудоёмкость по умолчанию — «Видео × 2» = 6 units', async () => {
    const offerId = (await buyer.get('/dictionaries')).body.offers.find((o) => o.is_active).id;
    const r = await buyer.post('/tasks', { offer_id: offerId, geo: 'BR', creative_type: 'Видео', quantity: 2, deadline: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(r.status, 201);
    assert.equal(r.body.estimate_units, 6);
    await buyer.del(`/tasks/${r.body.id}`);
  });

  await step('байер создаёт ТЗ с файлом-референсом', async () => {
    const fd = new FormData();
    Object.entries({ offer: 'Test Offer', geo: 'BR', creative_type: 'Видео', quantity: '3', priority: 'high', description: 'desc', deadline: new Date(Date.now() + 86400000).toISOString() }).forEach(([k, v]) => fd.append(k, v));
    fd.append('files', new Blob(['hello'], { type: 'text/plain' }), 'референс.txt');
    const r = await buyer.post('/tasks', fd);
    assert.equal(r.status, 201);
    id = r.body.id;
    assert.equal(r.body.status, 'new');
    assert.equal(r.body.ref_count, 1);
  });
  await step('кириллическое имя файла сохраняется', async () => {
    const r = await buyer.get(`/tasks/${id}`);
    assert.equal(r.body.references[0].original_name, 'референс.txt');
  });
  await step('нельзя сдать задачу, не взяв её', async () => {
    const fd = new FormData(); fd.append('links', 'https://x');
    assert.equal((await cr.post(`/tasks/${id}/submit`, fd)).status, 403);
  });
  await step('креативщик берёт задачу → В работе, фиксируется taken_at', async () => {
    assert.equal((await cr.post(`/tasks/${id}/take`)).status, 200);
    const t = (await cr.get(`/tasks/${id}`)).body;
    assert.equal(t.status, 'in_progress');
    assert.ok(t.taken_at);
  });
  await step('второй креативщик не может перехватить задачу', async () => {
    assert.equal((await cr2.post(`/tasks/${id}/take`)).status, 403);
  });
  await step('AI-расходы: валидация и запись (раунд 0)', async () => {
    assert.equal((await cr.post(`/tasks/${id}/expenses`, { service: 'Runway', credits: -5 })).status, 400);
    assert.equal((await cr.post(`/tasks/${id}/expenses`, { service: 'NoSuchAI', credits: 5 })).status, 400, 'сервис не из справочника');
    assert.equal((await cr2.post(`/tasks/${id}/expenses`, { service: 'Runway', credits: 5 })).status, 403);
    const r = await cr.post(`/tasks/${id}/expenses`, { items: [{ service: 'Runway', credits: 120 }, { service: 'ElevenLabs', credits: 30 }] });
    assert.equal(r.status, 200);
  });
  await step('сдача без результата отклоняется', async () => {
    assert.equal((await cr.post(`/tasks/${id}/submit`, new FormData())).status, 400);
  });
  await step('сдача работы → На проверке', async () => {
    const noHours = new FormData(); noHours.append('links', 'https://drive.google.com/x');
    assert.equal((await cr.post(`/tasks/${id}/submit`, noHours)).status, 400, 'часы обязательны');
    const fd = new FormData(); fd.append('links', 'https://drive.google.com/x'); fd.append('comment', 'v1'); fd.append('hours_spent', '3');
    assert.equal((await cr.post(`/tasks/${id}/submit`, fd)).status, 200);
    assert.equal((await cr.get(`/tasks/${id}`)).body.status, 'review');
  });
  await step('чужой байер не может принять работу', async () => {
    assert.equal((await buyer2.post(`/tasks/${id}/accept`)).status, 403);
  });
  await step('правки без комментария отклоняются', async () => {
    assert.equal((await buyer.post(`/tasks/${id}/revision`, { comment: '' })).status, 400);
  });
  await step('байер отправляет на правки → Правки, счётчик правок 1', async () => {
    assert.equal((await buyer.post(`/tasks/${id}/revision`, { comment: 'Сделай хук резче' })).status, 200);
    const t = (await buyer.get(`/tasks/${id}`)).body;
    assert.equal(t.status, 'revision');
    assert.equal(t.revision_count, 1);
  });
  await step('«Начать правки» оставляет задачу в «Правках» и открывает сдачу', async () => {
    assert.equal((await cr.post(`/tasks/${id}/take`)).status, 200);
    const t = (await cr.get(`/tasks/${id}`)).body;
    assert.equal(t.status, 'revision');
    assert.ok(t.revision_started_at);
    assert.ok(t.actions.includes('submit') && !t.actions.includes('take'));
  });
  await step('расходы на правках пишутся в раунд 1, повторная сдача', async () => {
    await cr.post(`/tasks/${id}/expenses`, { service: 'Runway', credits: 40 });
    const fd = new FormData(); fd.append('links', 'https://drive.google.com/y'); fd.append('hours_spent', '1.5');
    fd.append('files', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'result.png');
    assert.equal((await cr.post(`/tasks/${id}/submit`, fd)).status, 200);
    const t = (await cr.get(`/tasks/${id}`)).body;
    assert.deepEqual(t.expenses.map((e) => e.round), [0, 0, 1]);
    assert.equal(t.submissions.length, 2);
    assert.equal(t.submissions[1].files.length, 1);
    assert.equal(t.status, 'review');
    assert.equal(t.revision_started_at, null);
    assert.ok(t.first_submitted_at < t.submitted_at, 'первая сдача сохранена отдельно');
  });
  await step('байер принимает → Готово, completed_at и lead time посчитаны', async () => {
    assert.equal((await buyer.post(`/tasks/${id}/accept`)).status, 200);
    const t = (await buyer.get(`/tasks/${id}`)).body;
    assert.equal(t.status, 'done');
    assert.ok(t.completed_at);
    assert.ok(t.durations.leadTime >= 0);
    assert.ok(t.durations.byStatus.in_progress >= 0);
    assert.ok(t.durations.toFirstSubmit >= 0);
  });
  await step('история содержит полный цикл статусов', async () => {
    const t = (await buyer.get(`/tasks/${id}`)).body;
    const transitions = t.history.filter((h) => h.to_status).map((h) => h.to_status);
    assert.deepEqual(transitions, ['new', 'in_progress', 'review', 'revision', 'review', 'done']);
    assert.ok(t.history.some((h) => h.action === 'expense_added'));
    assert.ok(t.history.some((h) => h.action === 'revision_started'));
  });
  await step('после завершения редактирование недоступно', async () => {
    assert.equal((await buyer.patch(`/tasks/${id}`, { title: 'x' })).status, 403);
  });
  await step('редактирование логирует изменённые поля', async () => {
    const fresh = (await buyer.post('/tasks', { offer: 'Edit Offer', geo: 'RU', creative_type: 'Баннер', deadline: new Date(Date.now() + 86400000).toISOString() })).body;
    assert.ok(fresh.id, 'задача создана');
    assert.equal((await buyer.patch(`/tasks/${fresh.id}`, { priority: 'urgent', quantity: 7 })).status, 200);
    const h = (await buyer.get(`/tasks/${fresh.id}`)).body.history.at(-1);
    assert.equal(h.action, 'edited');
    assert.equal(h.details.quantity.to, 7);
  });
  await step('руководитель назначает исполнителя', async () => {
    const t = (await lead.get('/tasks')).body.find((x) => x.status === 'new');
    assert.equal((await lead.post(`/tasks/${t.id}/assign`, { creative_id: 6 })).status, 200);
    const d = (await lead.get(`/tasks/${t.id}`)).body;
    assert.equal(d.status, 'in_progress');
    assert.equal(d.creative_id, 6);
  });
  await step('аналитика доступна только руководителю и учитывает новые расходы', async () => {
    assert.equal((await buyer.get('/analytics')).status, 403);
    const a = (await lead.get('/analytics')).body;
    assert.ok(a.kpi.total > 0);
    assert.ok(a.ai.byService.find((s) => s.service === 'Runway').credits >= 160);
    assert.equal(a.creatives.length, 4);
    assert.ok(Array.isArray(a.timeline) && a.timeline.length > 0);
  });
  await step('файлы без авторизации не отдаются', async () => {
    const t = (await buyer.get(`/tasks/${id}`)).body;
    const res = await fetch(`${BASE}/files/${t.references[0].id}`, { headers: { Authorization: 'Bearer x' } });
    assert.equal(res.status, 401);
  });

  // ---------- F2: креативы и библиотека ----------
  const offerId = (await buyer.get('/dictionaries')).body.offers.find((o) => o.is_active).id;
  const newTask = async (extra = {}) => {
    const r = await buyer.post('/tasks', { offer_id: offerId, geo: 'BR', creative_type: 'Баннер', quantity: 2, deadline: new Date(Date.now() + 3 * 86400000).toISOString(), ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const submit = async (who, taskId, { files = [], links = '', hours = '2', slotMap } = {}) => {
    const fd = new FormData();
    files.forEach((n) => fd.append('files', png(), n));
    if (links) fd.append('links', links);
    fd.append('hours_spent', hours);
    if (slotMap) fd.append('slot_map', JSON.stringify(slotMap));
    return who.post(`/tasks/${taskId}/submit`, fd);
  };
  const crsOf = async (taskId) => (await lead.get(`/creatives?task_id=${taskId}&all=1&limit=200`)).body.items.sort((a, b) => a.slot - b.slot || a.version - b.version);

  await step('F2: сдача 3 файлов и 2 ссылок создаёт 5 креативов-черновиков со слотами 1–5', async () => {
    const tid = await newTask();
    await cr2.post(`/tasks/${tid}/take`);
    assert.equal((await submit(cr2, tid, { files: ['a.png', 'b.png', 'c.png'], links: 'https://drive.google.com/1\nhttps://figma.com/2' })).status, 200);
    const list = await crsOf(tid);
    assert.equal(list.length, 5);
    assert.deepEqual(list.map((c) => c.slot), [1, 2, 3, 4, 5]);
    assert.ok(list.every((c) => c.status === 'draft' && c.version === 1));
    assert.equal(list[3].preview_kind, 'link');
  });

  let flowTask;
  await step('F2: правки → новая версия слота 1 перекрывает v1; приёмка — последние версии accepted', async () => {
    flowTask = await newTask();
    await cr2.post(`/tasks/${flowTask}/take`);
    await submit(cr2, flowTask, { files: ['one.png', 'two.png'] });
    await buyer.post(`/tasks/${flowTask}/revision`, { comment: 'поправь первый' });
    await cr2.post(`/tasks/${flowTask}/take`);
    assert.equal((await submit(cr2, flowTask, { files: ['one-v2.png'], slotMap: [9] })).status, 400, 'несуществующий слот');
    assert.equal((await submit(cr2, flowTask, { files: ['one-v2.png'], slotMap: [1], hours: '1' })).status, 200);
    let list = await crsOf(flowTask);
    const s1 = list.filter((c) => c.slot === 1);
    assert.deepEqual(s1.map((c) => [c.version, c.status]), [[1, 'superseded'], [2, 'draft']]);
    assert.equal((await buyer.post(`/tasks/${flowTask}/accept`)).status, 200);
    list = await crsOf(flowTask);
    assert.deepEqual(list.map((c) => [c.slot, c.version, c.status]), [[1, 1, 'superseded'], [1, 2, 'accepted'], [2, 1, 'accepted']]);
  });
  await step('F2: права на статус креатива — креативщик и чужой байер получают 403', async () => {
    const c = (await crsOf(flowTask)).find((x) => x.status === 'accepted');
    assert.equal((await cr2.post(`/creatives/${c.id}/status`, { to: 'in_test' })).status, 403);
    assert.equal((await buyer2.post(`/creatives/${c.id}/status`, { to: 'in_test' })).status, 403);
    assert.equal((await buyer.post(`/creatives/${c.id}/status`, { to: 'winner' })).status, 409, 'вердикт до запуска');
    assert.equal((await buyer.post(`/creatives/${c.id}/status`, { to: 'archived' })).status, 200);
    const r = await buyer.post(`/creatives/${c.id}/status`, { to: 'restore' });
    assert.equal(r.body.status, 'accepted', 'возврат из архива в прежний статус');
  });
  await step('F2: страница креатива — версии, действия, история; фильтры библиотеки', async () => {
    const c = (await crsOf(flowTask)).find((x) => x.slot === 1 && x.version === 2);
    const d = (await buyer.get(`/creatives/${c.id}`)).body;
    assert.equal(d.versions.length, 2);
    assert.ok(d.actions.includes('in_test'));
    assert.ok(d.cost && d.cost.hours === 3, 'себестоимость видна байеру-владельцу');
    assert.equal((await cr2.get(`/creatives/${c.id}`)).body.cost, undefined, 'креативщику денежные поля не отдаются');
    assert.equal((await buyer.patch(`/creatives/${c.id}`, { title: 'Главный баннер', tags: 'Яркий, ugc' })).status, 200);
    const found = (await buyer.get(`/creatives?q=CD-${c.id}`)).body;
    assert.equal(found.items[0].title, 'Главный баннер');
    assert.deepEqual(found.items[0].tags, ['яркий', 'ugc']);
    const byTag = (await buyer.get('/creatives?q=яркий')).body;
    assert.ok(byTag.items.some((x) => x.id === c.id));
    const hidden = (await buyer.get(`/creatives?task_id=${flowTask}`)).body;
    assert.ok(hidden.items.every((x) => !['draft', 'superseded', 'archived'].includes(x.status)), 'по умолчанию скрыты черновики');
  });
  await step('F2: модалка задачи — у сдач есть коды креативов', async () => {
    const t = (await buyer.get(`/tasks/${flowTask}`)).body;
    assert.ok(t.submissions[0].creatives.length === 2 && t.submissions[0].creatives[0].code.startsWith('CD-'));
  });

  await step('Миграция: база старой схемы обновляется без потерь и получает креативы', async () => {
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdesk-old-'));
    try {
      const odb = new Database(path.join(oldDir, 'app.db'));
      odb.exec(OLD_SCHEMA);
      const h = bcrypt.hashSync('demo123', 4);
      odb.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('Lead','old-lead@x.ru',?,'lead'),('Buyer','old-buyer@x.ru',?,'buyer'),('Cr','old-cr@x.ru',?,'creative')").run(h, h, h);
      const at = new Date(Date.now() - 86400000).toISOString();
      odb.prepare(`INSERT INTO tasks (title, offer, geo, creative_type, quantity, status, buyer_id, creative_id, revision_count, created_at, completed_at, updated_at)
        VALUES ('Old task','Old Offer','BR','Видео',2,'done',2,3,1,?,?,?)`).run(at, at, at);
      odb.prepare("INSERT INTO submissions (task_id, round, creative_id, links, created_at) VALUES (1,1,3,'https://a.com/1 https://a.com/2',?),(1,2,3,'https://a.com/1v2',?)").run(at, at);
      odb.prepare("INSERT INTO ai_expenses (task_id, user_id, service, credits, created_at) VALUES (1,3,'Midjourney',10,?)").run(at);
      odb.close();
      const port = PORT + 1;
      const old = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: port, DATA_DIR: oldDir }, stdio: ['ignore', 'pipe', 'inherit'] });
      try {
        let up = false;
        for (let i = 0; i < 50 && !up; i++) {
          try { up = (await fetch(`http://localhost:${port}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
        }
        const login = await (await fetch(`http://localhost:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'old-lead@x.ru', password: 'demo123' }) })).json();
        const get = async (u) => (await fetch(`http://localhost:${port}/api${u}`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
        const task = await get('/tasks/1');
        assert.ok(task.offer_id, 'offer_id проставлен');
        const d = await get('/dictionaries');
        assert.ok(d.offers.some((o) => o.name === 'Old Offer'));
        assert.ok(d.aiServices.some((x) => x.name === 'Midjourney'));
        const list = (await get('/creatives?task_id=1&all=1')).items.sort((a, b) => a.slot - b.slot || a.version - b.version);
        assert.deepEqual(list.map((c) => [c.slot, c.version, c.status]), [[1, 1, 'superseded'], [1, 2, 'accepted'], [2, 1, 'accepted']]);
      } finally { old.kill(); }
    } finally { fs.rmSync(oldDir, { recursive: true, force: true }); }
  });

  console.log(`\n${passed} проверок пройдено`);
} catch (e) {
  console.error('\n✗ FAILED:', e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

