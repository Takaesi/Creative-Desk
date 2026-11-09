// Сквозной тест API: полный цикл задачи по ролям. Запуск: npm test (сервер поднимается сам на временной БД).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

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
    assert.equal((await cr2.post(`/tasks/${id}/expenses`, { service: 'Runway', credits: 5 })).status, 403);
    const r = await cr.post(`/tasks/${id}/expenses`, { items: [{ service: 'Runway', credits: 120 }, { service: 'ElevenLabs', credits: 30 }] });
    assert.equal(r.status, 200);
  });
  await step('сдача без результата отклоняется', async () => {
    assert.equal((await cr.post(`/tasks/${id}/submit`, new FormData())).status, 400);
  });
  await step('сдача работы → На проверке', async () => {
    const fd = new FormData(); fd.append('links', 'https://drive.google.com/x'); fd.append('comment', 'v1');
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
    const fd = new FormData(); fd.append('links', 'https://drive.google.com/y');
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
    const fresh = (await buyer.get('/tasks?mine=1')).body.find((t) => t.status === 'new');
    assert.ok(fresh, 'есть новая задача байера');
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
  console.log(`\n${passed} проверок пройдено`);
} catch (e) {
  console.error('\n✗ FAILED:', e.message);
  process.exitCode = 1;
} finally {
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
