// Демо-данные: пользователи всех ролей и ~45 задач с правдоподобной историей.
// Запуск вручную: `npm run seed` (пересоздаёт данные). При старте сервера вызывается seedIfEmpty().
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, SETTINGS_SCHEMA, getSettings, logHistory } from './db.js';
import { defaultUnits, scoreBrief } from './domain.js';
import { createCreativesForSubmission, acceptTaskCreatives, latestSlots, refreshCreativeAfterMetrics, setCreativeStatus } from './creatives.js';
import { computeMetrics } from './metrics.js';
import { moscowMonth, shiftMonth, factFor, elapsedDays, daysInMonth, planPace, monthBounds } from './plans.js';

const H = 3600_000;
const DEMO_PASSWORD = 'demo123';

const USERS = [
  { name: 'Анна Соколова', email: 'lead@demo.ru', role: 'lead', position: 'Руководитель креативного отдела', color: '#8b5cf6' },
  { name: 'Дмитрий Орлов', email: 'buyer1@demo.ru', role: 'buyer', position: 'Медиабайер · FB', color: '#0ea5e9' },
  { name: 'Екатерина Миронова', email: 'buyer2@demo.ru', role: 'buyer', position: 'Медиабайер · TikTok', color: '#14b8a6' },
  { name: 'Артём Белов', email: 'buyer3@demo.ru', role: 'buyer', position: 'Медиабайер · Google UAC', color: '#f59e0b' },
  { name: 'Мария Ким', email: 'creative1@demo.ru', role: 'creative', position: 'Моушн-дизайнер', color: '#ec4899' },
  { name: 'Игорь Лебедев', email: 'creative2@demo.ru', role: 'creative', position: 'Видеомонтажёр', color: '#ef4444' },
  { name: 'Ольга Петрова', email: 'creative3@demo.ru', role: 'creative', position: 'Дизайнер статики', color: '#22c55e' },
  { name: 'Никита Волков', email: 'creative4@demo.ru', role: 'creative', position: 'AI-видео / UGC', color: '#6366f1' },
];

const OFFERS = [
  { name: 'KetoSlim', vertical: 'нутра' }, { name: 'JointFlex', vertical: 'нутра' }, { name: 'LuckySpin', vertical: 'гемблинг' },
  { name: 'CreditFast', vertical: 'финансы' }, { name: 'SmartWatch X', vertical: 'e-com' }, { name: 'VPN Shield', vertical: 'утилиты' },
];
const APPROACHES = [
  { name: 'Боль', description: 'Начинаем с проблемы зрителя и обостряем её' },
  { name: 'Отзыв / UGC', description: 'Живой человек рассказывает о своём опыте' },
  { name: 'До/после', description: 'Наглядный контраст результата' },
  { name: 'Новость / сенсация', description: 'Подача как новостной сюжет или срочное сообщение' },
  { name: 'Эксперт', description: 'Врач, юрист, профи рекомендует продукт' },
  { name: 'Дефицит / таймер', description: 'Ограниченное предложение, обратный отсчёт' },
  { name: 'Юмор / мем', description: 'Мем-формат, неожиданная шутка' },
  { name: 'Сравнение', description: 'Мы против конкурента / обычного способа' },
];
const AI_PRICES = { Midjourney: 4, Runway: 6, Kling: 5, Sora: 9, ElevenLabs: 2, HeyGen: 12, ChatGPT: 1, Claude: 1, 'Stable Diffusion': 0.5, Suno: 3, Leonardo: 2, Pika: 4 };
const CREATIVE_PARAMS = [ // ставка ₽/ч, мощность, WIP-лимит (null — по умолчанию)
  { rate: 900, capacity: 10, wip: null }, { rate: 1100, capacity: 12, wip: null }, { rate: 650, capacity: 8, wip: 2 }, { rate: 1200, capacity: 10, wip: null },
];
const LANG = { RU: 'русский', KZ: 'русский', BR: 'португальский', MX: 'испанский', ES: 'испанский', DE: 'немецкий', PL: 'польский', US: 'EN', IN: 'EN', PH: 'EN', TR: 'турецкий', IT: 'итальянский', ID: 'индонезийский' };
const HOOKS = {
  'Боль': 'Крупный план: человек морщится от проблемы, текст «Знакомо?»',
  'Отзыв / UGC': 'Селфи-видео: «Я не верила, пока не попробовала сама…»',
  'До/после': 'Сплит-экран до/после в первую секунду',
  'Новость / сенсация': 'Плашка «Срочно» и ведущая новостей',
  'Эксперт': 'Врач в халате: «Я запрещаю пациентам…»',
  'Дефицит / таймер': 'Таймер 00:59 и «осталось 12 штук»',
  'Юмор / мем': 'Мем-шаблон с неожиданным поворотом на 2-й секунде',
  'Сравнение': 'Две руки: обычный способ против нашего',
};
const GEOS = ['RU', 'KZ', 'BR', 'MX', 'IN', 'TR', 'DE', 'PL', 'US', 'ES', 'IT', 'ID', 'PH'];
const TYPES = {
  'Видео': { services: ['Runway', 'Kling', 'ElevenLabs', 'Midjourney'], creatives: [1, 3] },
  'UGC': { services: ['HeyGen', 'ElevenLabs', 'ChatGPT', 'Sora'], creatives: [3, 1] },
  'Статика': { services: ['Midjourney', 'Stable Diffusion', 'ChatGPT'], creatives: [2, 0] },
  'Баннер': { services: ['Midjourney', 'Leonardo', 'ChatGPT'], creatives: [2, 0] },
  'Анимация': { services: ['Runway', 'Pika', 'Midjourney'], creatives: [0, 1] },
  'Плейабл': { services: ['ChatGPT', 'Claude', 'Midjourney'], creatives: [0] },
};
const REVISION_TEXTS = [
  'Хук слишком медленный — первые 2 секунды должны цеплять, сделай резкий старт.',
  'Поменяй CTA на «Забери бонус», и кнопку крупнее. Логотип оффера убрать — модерация режет.',
  'Озвучка звучит роботизированно, перегенерируй голос с другой интонацией.',
  'Нужна версия 9:16 и 1:1, сейчас только 16:9.',
  'Цвета не попадают в лендинг, сверься с референсом №2.',
  'Слишком агрессивный текст для FB, смягчи формулировки, без «гарантированно».',
  'Субтитры перекрывают лицо, подними выше и сделай контрастнее.',
];
const SUBMIT_TEXTS = ['Готово, 3 варианта хука внутри.', 'Залил в папку, есть исходники.', 'Сделал по ТЗ, плюс бонусный вариант с другим CTA.', 'Поправил всё по комментариям.', 'Финал, проверь пожалуйста ресайзы.', ''];
const COMMENTS = ['Можно ли использовать лицо из референса?', 'Да, но обязательно с другим фоном.', 'Сколько хронометраж?', '15–20 секунд, не больше.', 'Добавь пожалуйста ещё вариант на испанском.', 'Ок, принято 👍'];

const OFFER_COLORS = { KetoSlim: ['#22c55e', '#065f46'], JointFlex: ['#38bdf8', '#1e3a8a'], LuckySpin: ['#f59e0b', '#7c2d12'],
  CreditFast: ['#a78bfa', '#312e81'], 'SmartWatch X': ['#f472b6', '#831843'], 'VPN Shield': ['#2dd4bf', '#134e4a'] };
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** Простое превью креатива: градиент оффера, код и подписи. Видео — с иконкой play и в 9:16. */
function previewSvg({ code, offer, geo, type, variant, version }) {
  const [c1, c2] = OFFER_COLORS[offer] || ['#6366f1', '#1e1b4b'];
  const video = ['Видео', 'UGC', 'Анимация'].includes(type);
  const w = 540; const h = video ? 960 : 540;
  const angle = (variant * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * 0.8}" cy="${h * 0.2}" r="${80 + (variant % 4) * 25}" fill="#fff" opacity=".12"/>
<circle cx="${w * 0.15}" cy="${h * 0.85}" r="${60 + (variant % 3) * 30}" fill="#000" opacity=".12"/>
${video ? `<circle cx="${w / 2}" cy="${h / 2}" r="64" fill="#000" opacity=".35"/><path d="M${w / 2 - 20} ${h / 2 - 34} L${w / 2 + 36} ${h / 2} L${w / 2 - 20} ${h / 2 + 34} Z" fill="#fff"/>` : ''}
<text x="36" y="${h - 120}" font-family="Inter, Arial, sans-serif" font-size="64" font-weight="800" fill="#fff">${esc(code)}</text>
<text x="36" y="${h - 72}" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="600" fill="#fff" opacity=".92">${esc(offer)} · ${esc(geo)}</text>
<text x="36" y="${h - 36}" font-family="Inter, Arial, sans-serif" font-size="22" fill="#fff" opacity=".75">${esc(type)} · v${version}</text>
</svg>`;
}

// детерминированный PRNG (mulberry32), чтобы демо выглядело одинаково после пересоздания
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed() {
  const rand = rng(99);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + rand() * (b - a);
  const iso = (ms) => new Date(ms).toISOString();
  const now = Date.now();

  db.function('shift_iso', (v, ms) => (v ? new Date(Date.parse(v) - ms).toISOString() : null));
  db.transaction(() => {
    // старые загруженные файлы демо больше не нужны
    for (const f of db.prepare('SELECT stored_name FROM files').all()) fs.rmSync(path.join(UPLOAD_DIR, f.stored_name), { force: true });
    db.exec('UPDATE tasks SET parent_creative_id = NULL, template_id = NULL');
    for (const t of ['creative_plans', 'history', 'creative_metrics', 'creatives', 'comments', 'ai_expenses', 'files', 'submissions', 'tasks', 'brief_templates',
      'sessions', 'users', 'offers', 'approaches', 'ai_services', 'settings']) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");

    const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    Object.entries(SETTINGS_SCHEMA).forEach(([k, v]) => insSetting.run(k, v.def));
    const dictAt = iso(now - 40 * 24 * H);
    const offerIds = OFFERS.map((o) => db.prepare('INSERT INTO offers (name, vertical, created_at) VALUES (?,?,?)').run(o.name, o.vertical, dictAt).lastInsertRowid);
    const approachIds = APPROACHES.map((a) => db.prepare('INSERT INTO approaches (name, description, created_at) VALUES (?,?,?)').run(a.name, a.description, dictAt).lastInsertRowid);
    Object.entries(AI_PRICES).forEach(([name, price]) => db.prepare('INSERT INTO ai_services (name, credit_price_rub) VALUES (?,?)').run(name, price));

    const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
    const insUser = db.prepare('INSERT INTO users (name, email, password_hash, role, position, color) VALUES (?,?,?,?,?,?)');
    const ids = USERS.map((u) => insUser.run(u.name, u.email, hash, u.role, u.position, u.color).lastInsertRowid);
    const buyers = ids.filter((_, i) => USERS[i].role === 'buyer');
    const creatives = ids.filter((_, i) => USERS[i].role === 'creative');
    const lead = ids[0];
    creatives.forEach((id, k) => db.prepare('UPDATE users SET hourly_rate_rub = ?, capacity_units = ?, wip_limit = ? WHERE id = ?')
      .run(CREATIVE_PARAMS[k].rate, CREATIVE_PARAMS[k].capacity, CREATIVE_PARAMS[k].wip, id));

    const insTask = db.prepare(`INSERT INTO tasks (title, offer, offer_id, approach_id, geo, creative_type, quantity, description, references_text,
        language, format, hook, estimate_units, priority, deadline, status, buyer_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)`);
    const insHist = db.prepare('INSERT INTO history (task_id, task_title, user_id, action, from_status, to_status, details, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const insSub = db.prepare('INSERT INTO submissions (task_id, round, creative_id, comment, links, hours_spent, created_at) VALUES (?,?,?,?,?,?,?)');
    const insExp = db.prepare('INSERT INTO ai_expenses (task_id, user_id, service, credits, round, note, created_at) VALUES (?,?,?,?,?,?,?)');
    const insCom = db.prepare('INSERT INTO comments (task_id, user_id, text, kind, created_at) VALUES (?,?,?,?,?)');
    const insFile = db.prepare(`INSERT INTO files (task_id, submission_id, kind, original_name, stored_name, mime, size, uploaded_by, created_at)
      VALUES (?,?,'result',?,?,'image/svg+xml',0,?,?)`);
    let variantSeq = 0;
    /** Сдача с файлами-превью: креативы создаются той же функцией, что и в API. */
    const seedSubmit = (task, round, creativeId, comment, hours, at) => {
      const sid = insSub.run(task.id, round, creativeId, comment, '', hours, at).lastInsertRowid;
      const prev = latestSlots(task.id);
      // первая сдача — по штуке на единицу (до 5), правки — новые версии 1–2 слотов
      const n = round === 1 ? Math.min(task.quantity, 5) : Math.min(prev.length, 1 + Math.floor(rand() * 2));
      const targets = round === 1 ? undefined : prev.slice(0, n).map((c) => c.slot);
      const items = [];
      for (let k = 0; k < n; k++) {
        const stored = `seed-${task.id}-r${round}-${k + 1}.svg`;
        const name = `${task.creative_type.toLowerCase()}_${task.offer.replace(/\s+/g, '')}_${k + 1}${round > 1 ? `_v${round}` : ''}.svg`;
        const fid = insFile.run(task.id, sid, name, stored, creativeId, at).lastInsertRowid;
        items.push({ file_id: fid, link: null, title: name, stored });
      }
      const ids = createCreativesForSubmission({ task, submissionId: sid, round, authorId: creativeId, items, targets, at, log: false });
      ids.forEach((cid, k) => {
        const svg = previewSvg({ code: `CD-${cid}`, offer: task.offer, geo: task.geo.split(',')[0], type: task.creative_type, variant: variantSeq++, version: round });
        fs.writeFileSync(path.join(UPLOAD_DIR, items[k].stored), svg);
        db.prepare('UPDATE files SET size = ? WHERE id = ?').run(Buffer.byteLength(svg), items[k].file_id);
      });
      return ids;
    };

    const N = 46;
    for (let i = 0; i < N; i++) {
      const type = pick(Object.keys(TYPES));
      const offerIdx = Math.floor(rand() * OFFERS.length);
      const offer = OFFERS[offerIdx].name;
      const geo = rand() < 0.2 ? `${pick(GEOS)}, ${pick(GEOS)}` : pick(GEOS);
      const apIdx = Math.floor(rand() * APPROACHES.length);
      const angle = APPROACHES[apIdx].name;
      // качество ТЗ: от него зависит вероятность правок — чтобы связь была видна в аналитике
      const quality = rand() < 0.55 ? 'good' : rand() < 0.5 ? 'mid' : 'bad';
      const qty = type === 'Статика' || type === 'Баннер' ? Math.ceil(between(3, 8)) : type === 'Плейабл' ? 1 : Math.ceil(between(1, 3));
      const priority = rand() < 0.12 ? 'urgent' : rand() < 0.3 ? 'high' : rand() < 0.75 ? 'medium' : 'low';
      const buyer = pick(buyers);
      // распределяем создание по последним 30 дням, часть задач — совсем свежие
      // Последние 18 задач — «живые»: доводим до заданного статуса и сдвигаем по времени к текущему моменту.
      const RECENT_TARGETS = ['new', 'new', 'new', 'new', 'in_progress', 'in_progress', 'in_progress', 'in_progress', 'in_progress', 'review', 'review', 'review', 'review', 'revision', 'revision', 'done', 'done', 'done'];
      const target = i >= N - RECENT_TARGETS.length ? RECENT_TARGETS[i - (N - RECENT_TARGETS.length)] : null;
      const created = target ? now - 200 * H : now - between(72, 30 * 24) * H;
      const deadlineH = { urgent: between(8, 20), high: between(18, 48), medium: between(36, 96), low: between(72, 168) }[priority];
      const deadline = created + deadlineH * H;
      const title = `${type}: ${offer} — ${angle.toLowerCase()}`;
      const isVideo = ['Видео', 'UGC', 'Анимация'].includes(type);
      const format = quality === 'bad' ? '' : isVideo ? '9:16, 1080×1920, 15–30 сек' : '1080×1080 и 1080×1920';
      const description = quality === 'bad'
        ? `${qty} шт. под ${offer}, ${geo}.`
        : `Нужно ${qty} шт. «${type.toLowerCase()}» под ${offer} на ГЕО ${geo}.\nПодход: ${angle}.\n${isVideo ? 'Субтитры на языке ГЕО, CTA в конце.' : 'Крупный оффер, контрастная кнопка.'}\nБез запрещённых обещаний, логотипы платформ не использовать.`;
      const refs = quality === 'bad' ? '' : `https://www.facebook.com/ads/library/?id=${Math.floor(between(1e14, 9e14))}${quality === 'good' ? `\nhttps://drive.google.com/drive/folders/demo-ref-${i + 1}` : ''}`;
      const hook = quality === 'good' ? HOOKS[angle] : '';
      const language = quality === 'bad' ? '' : LANG[geo.split(',')[0].trim()] || 'EN';
      const approachId = quality === 'bad' ? null : approachIds[apIdx];
      const units = defaultUnits(type, qty);

      const taskId = insTask.run(title, offer, offerIds[offerIdx], approachId, geo, type, qty, description, refs, language, format, hook, units,
        priority, iso(deadline), buyer, iso(created), iso(created)).lastInsertRowid;
      const brief = scoreBrief({ offer_id: offerIds[offerIdx], description, hook, approach_id: approachId, references_text: refs, language, format, creative_type: type, deadline: iso(deadline), created_at: iso(created), priority });
      db.prepare('UPDATE tasks SET brief_score = ? WHERE id = ?').run(brief.score, taskId);
      insHist.run(taskId, title, buyer, 'created', null, 'new', JSON.stringify({ priority, deadline: iso(deadline) }), iso(created));

      // ---- симуляция жизненного цикла с обрезкой по «сейчас» ----
      const preferred = TYPES[type].creatives.map((k) => creatives[k]);
      const creative = rand() < 0.8 ? pick(preferred) : pick(creatives);
      const speed = { urgent: 0.35, high: 0.6, medium: 1, low: 1.4 }[priority];
      let t = created;
      let status = 'new';
      let revisions = 0;
      const state = { taken_at: null, first_submitted_at: null, submitted_at: null, revision_started_at: null, completed_at: null, creative_id: null };
      const limit = target ? Infinity : now;
      let stopped = false;
      const step = (dt) => { if (stopped) return false; t += dt; return t <= limit; };
      const move = (to, action, userId, details = null) => {
        insHist.run(taskId, title, userId, action, status, to, details ? JSON.stringify(details) : null, iso(t));
        status = to;
        if (target && status === target) stopped = true;
      };
      const addExpenses = () => {
        const n = Math.ceil(between(1, 3));
        const used = new Set();
        for (let k = 0; k < n; k++) {
          const svc = pick(TYPES[type].services);
          if (used.has(svc)) continue;
          used.add(svc);
          const base = { Runway: 120, Kling: 90, Sora: 150, ElevenLabs: 40, HeyGen: 80, Midjourney: 30, 'Stable Diffusion': 15, Leonardo: 25, ChatGPT: 10, Claude: 10, Pika: 60 }[svc] || 20;
          const credits = Math.round(base * between(0.5, 2.2) * (revisions ? 0.5 : 1) * Math.max(1, qty / 3));
          insExp.run(taskId, creative, svc, credits, revisions, revisions ? 'на правки' : '', iso(t));
        }
      };

      if (target !== 'new' && step(between(0.3, 14) * H * speed)) {
        state.creative_id = creative; state.taken_at = t;
        move('in_progress', 'taken', creative);
        let finished = false;
        while (!finished && !stopped) {
          if (!step(between(2, revisions ? 10 : 30) * H * speed)) break;
          addExpenses();
          const hours = Math.round(between(1, revisions ? 4 : 8) * 2) / 2;
          seedSubmit(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId), revisions + 1, creative, pick(SUBMIT_TEXTS), hours, iso(t));
          state.submitted_at = t;
          state.first_submitted_at ??= t;
          state.revision_started_at = null;
          move('review', 'submitted', creative, { round: revisions + 1, files: 0, links: 1 });
          if (!step(between(0.3, 10) * H)) break;
          const reviewer = rand() < 0.9 ? buyer : lead;
          const revP = { good: 0.18, mid: 0.4, bad: 0.65 }[quality];
          if (revisions < 2 && (target === 'revision' || rand() < revP)) {
            revisions++;
            insCom.run(taskId, reviewer, pick(REVISION_TEXTS), 'revision', iso(t));
            move('revision', 'revision_requested', reviewer, { round: revisions });
            if (!step(between(0.3, 8) * H)) break;
            // «Начать правки» — событие без смены статуса, задача остаётся в «Правках»
            insHist.run(taskId, title, creative, 'revision_started', null, null, JSON.stringify({ round: revisions }), iso(t));
            state.revision_started_at = t;
          } else {
            state.completed_at = t;
            move('done', 'accepted', reviewer);
            acceptTaskCreatives({ id: taskId, title }, { at: iso(t), log: false });
            finished = true;
          }
        }
      }
      if (target === 'revision' && i % 2 === 1) {
        t += between(0.3, 3) * H;
        insHist.run(taskId, title, creative, 'revision_started', null, null, JSON.stringify({ round: revisions }), iso(t));
        state.revision_started_at = t;
      }
      if (target) {
        // сдвигаем всю историю задачи так, чтобы последнее событие было недавно
        const lastAt = target === 'new' ? created : t;
        const shiftSec = Math.round((lastAt - (now - between(0.2, target === 'done' ? 30 : 9) * H)) / 1000);
        const sh = (col) => `${col} = shift_iso(${col}, ${shiftSec * 1000})`;
        db.prepare(`UPDATE tasks SET ${sh('created_at')}, ${sh('deadline')} WHERE id = ?`).run(taskId);
        for (const tbl of ['history', 'submissions', 'ai_expenses', 'comments', 'files']) db.prepare(`UPDATE ${tbl} SET ${sh('created_at')} WHERE task_id = ?`).run(taskId);
        db.prepare(`UPDATE creatives SET ${sh('created_at')}, ${sh('accepted_at')}, ${sh('updated_at')} WHERE task_id = ?`).run(taskId);
        for (const k of ['taken_at', 'first_submitted_at', 'submitted_at', 'revision_started_at', 'completed_at']) if (state[k]) state[k] -= shiftSec * 1000;
        t -= shiftSec * 1000;
      }
      const createdFinal = Date.parse(db.prepare('SELECT created_at FROM tasks WHERE id = ?').get(taskId).created_at);
      if (rand() < 0.35) {
        const ct = Math.min(now, createdFinal + between(0.2, 6) * H);
        insCom.run(taskId, state.creative_id || pick(creatives), pick(COMMENTS.slice(0, 3)), 'comment', iso(ct));
        insCom.run(taskId, buyer, pick(COMMENTS.slice(3)), 'comment', iso(Math.min(now, ct + 0.5 * H)));
      }
      db.prepare(`UPDATE tasks SET status=?, creative_id=?, taken_at=?, first_submitted_at=?, submitted_at=?, revision_started_at=?, completed_at=?, revision_count=?, updated_at=? WHERE id=?`).run(
        status, state.creative_id, state.taken_at && iso(state.taken_at), state.first_submitted_at && iso(state.first_submitted_at),
        state.submitted_at && iso(state.submitted_at), state.revision_started_at && iso(state.revision_started_at),
        state.completed_at && iso(state.completed_at), revisions, iso(Math.min(t, now)), taskId
      );
    }

    enforceWipLimits(creatives);
    seedResults({ rand, between, iso, now, insTask, insHist, seedSubmit, lead });
    topUpResults({ rand, between, iso, now });
    seedTemplates({ lead, buyers, offerIds, approachIds, iso, now });
    seedPlans(now);
    seedAnnotations(now);
  })();
}

/**
 * Дозаполнение результатов: у каждого байера в «Без результатов» остаётся 3–5 креативов, а не два десятка.
 * Остальным принятым без метрик добавляем статистику по вчерашний день, «застоявшимся» в тесте — продлеваем её до вчера.
 * Если система после этого предлагает вердикт — байер его подтверждает (иначе разрастётся «Ждут вердикта»).
 */
function topUpResults({ rand, between, iso, now }) {
  const { settings, genDays, after, get } = metricsTools({ rand, between, iso, now });
  const accCut = iso(now - settings.no_results_reminder_days * DAY);
  const staleDay = iso(now - 3 * DAY).slice(0, 10);
  const need = db.prepare(`SELECT c.*, (SELECT MAX(date) FROM creative_metrics m WHERE m.creative_id = c.id) AS last_date
    FROM creatives c WHERE c.buyer_id = ? AND (
      (c.status = 'accepted' AND c.accepted_at < ? AND NOT EXISTS (SELECT 1 FROM creative_metrics m WHERE m.creative_id = c.id))
      OR (c.status = 'in_test' AND (SELECT MAX(date) FROM creative_metrics m WHERE m.creative_id = c.id) <= ?))
    ORDER BY c.accepted_at DESC, c.id DESC`);
  for (const { id } of db.prepare("SELECT id FROM users WHERE role = 'buyer' ORDER BY id").all()) {
    const list = need.all(id, accCut, staleDay);
    const keep = 3 + Math.floor(rand() * 3); // 3–5
    for (const c of list.slice(keep)) {
      const hadSuggestion = !!c.suggested_verdict;
      const start = c.last_date ? Date.parse(c.last_date) + DAY : Math.max(Date.parse(c.accepted_at) + DAY, now - Math.round(between(8, 16)) * DAY);
      const n = Math.max(1, Math.floor((now - DAY / 2 - start) / DAY) + 1);
      const r = rand();
      const last = genDays(c, start, n, r < 0.2 ? between(35, 110) : r < 0.65 ? between(3, 26) : between(-70, -8));
      const at = after(c, last);
      const fresh = get(c.id);
      if (!hadSuggestion && fresh.status === 'in_test' && fresh.suggested_verdict) {
        setCreativeStatus(fresh, fresh.suggested_verdict, { userId: c.buyer_id, at, extra: { suggested: fresh.suggested_verdict } });
      }
    }
  }
}

/** F7: на задаче в правках — замечания байера прямо на картинке (одно уже исправлено), чтобы демо показывало пины. */
function seedAnnotations(now) {
  const t = db.prepare(`SELECT t.* FROM tasks t WHERE t.status = 'revision' AND EXISTS (
      SELECT 1 FROM creatives c JOIN files f ON f.id = c.file_id WHERE c.task_id = t.id AND c.status = 'draft' AND f.mime LIKE 'image/%')
    ORDER BY t.id LIMIT 1`).get();
  if (!t) return;
  const crs = db.prepare(`SELECT c.* FROM creatives c JOIN files f ON f.id = c.file_id WHERE c.task_id = ? AND c.status = 'draft' AND f.mime LIKE 'image/%'
    AND c.version = (SELECT MAX(c2.version) FROM creatives c2 WHERE c2.task_id = c.task_id AND c2.slot = c.slot) ORDER BY c.slot LIMIT 2`).all(t.id);
  const at = new Date(Math.min(now, Date.parse(t.updated_at))).toISOString();
  const ins = db.prepare(`INSERT INTO annotations (creative_id, task_id, round, author_id, x, y, text, status, resolved_by, resolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const notes = [
    [0.5, 0.18, 'Заголовок крупнее и контрастнее — сейчас теряется на фоне', 'open'],
    [0.78, 0.86, 'Кнопку CTA сдвинуть выше, её режет интерфейс площадки', 'open'],
    [null, null, 'Цвета в целом ок, оставляем', 'resolved'],
  ];
  crs.forEach((c, i) => notes.slice(i === 0 ? 0 : 1, i === 0 ? 3 : 2).forEach(([x, y, text, status]) => {
    ins.run(c.id, t.id, c.version, t.buyer_id, x, y, text, status, status === 'resolved' ? t.creative_id : null, status === 'resolved' ? at : null, at, at);
  }));
}

/**
 * Нормы подбираются под реальный темп каждого креативщика в демо (факт к сегодняшнему дню зависит от даты запуска):
 * в текущем месяце все «в графике» или «опережают», кроме одного — у него лёгкое отставание.
 * Прошлый месяц — отдельной записью: большинство выполнили план, один чуть не дотянул.
 */
function seedPlans(now) {
  const month = moscowMonth(now);
  const prev = shiftMonth(month, -1);
  const at = new Date(now).toISOString();
  const ins = db.prepare('INSERT INTO creative_plans (user_id, month, norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  const rate30 = db.prepare(`SELECT COUNT(*) c FROM creatives WHERE author_id = ? AND accepted_at >= ? AND status NOT IN ('superseded','draft')`);
  const elapsed = elapsedDays(month, now);
  const since30 = new Date(now - 30 * DAY).toISOString();
  // отстающий — у кого факт месяца ниже всего относительно его обычного темпа (выбираем до любых правок данных)
  const lagger = db.prepare("SELECT id FROM users WHERE role = 'creative' ORDER BY id").all()
    .map((u) => ({ id: u.id, k: factFor(u.id, month) / Math.max(1, rate30.get(u.id, since30).c) }))
    .sort((a, b) => a.k - b.k)[0].id;
  // в первые дни месяца у кого-то может не быть ни одного принятого креатива — тогда «в графике» не бывает.
  // Переносим в этот месяц приёмку одной недавней задачи (закрыта ≤ 14 дней назад; статистика креативов, если есть, — не раньше новой даты).
  if (elapsed > 0) {
    const [monthStart] = monthBounds(month);
    const newAt = new Date(Math.min(now - H, Date.parse(monthStart) + 6 * H)).toISOString();
    for (const { id } of db.prepare("SELECT id FROM users WHERE role = 'creative'").all()) {
      if ((id === lagger && elapsed < 4) || factFor(id, month) > 0) continue;
      const t = db.prepare(`SELECT t.id FROM tasks t WHERE t.creative_id = ? AND t.status = 'done' AND t.completed_at >= ? AND t.completed_at < ?
          AND t.submitted_at < ? AND NOT EXISTS (SELECT 1 FROM creatives c WHERE c.task_id = t.id AND (c.launched_at < ? OR c.verdict_at < ?))
          AND NOT EXISTS (SELECT 1 FROM creative_metrics m JOIN creatives c ON c.id = m.creative_id WHERE c.task_id = t.id AND m.date <= ?)
        ORDER BY t.completed_at DESC LIMIT 1`).get(id, new Date(now - 14 * DAY).toISOString(), monthStart, newAt, newAt, newAt, newAt.slice(0, 10));
      if (!t) {
        // нечего переносить — байер принимает его работу, которая лежит на проверке (обычная приёмка)
        const r = db.prepare("SELECT * FROM tasks WHERE creative_id = ? AND status = 'review' AND submitted_at < ? ORDER BY submitted_at LIMIT 1").get(id, new Date(now - 2 * H).toISOString());
        if (!r) continue;
        const accAt = new Date(Math.min(now - H, Math.max(Date.parse(r.submitted_at) + H, Date.parse(monthStart) + 6 * H))).toISOString();
        db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(accAt, accAt, r.id);
        logHistory({ taskId: r.id, taskTitle: r.title, userId: r.buyer_id, action: 'accepted', from: 'review', to: 'done', at: accAt });
        acceptTaskCreatives(r, { at: accAt, userId: r.buyer_id });
        continue;
      }
      db.prepare('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?').run(newAt, newAt, t.id);
      db.prepare("UPDATE creatives SET accepted_at = ? WHERE task_id = ? AND accepted_at IS NOT NULL").run(newAt, t.id);
      db.prepare("UPDATE history SET created_at = ? WHERE task_id = ? AND (to_status = 'done' OR action = 'creatives_accepted')").run(newAt, t.id);
    }
  }
  const people = db.prepare("SELECT id FROM users WHERE role = 'creative' ORDER BY id").all()
    .map((u) => ({ id: u.id, fact: factFor(u.id, month), prevFact: factFor(u.id, prev), rate: rate30.get(u.id, since30).c }));
  const share = elapsed / daysInMonth(month);
  const status = (norm, fact) => planPace({ norm, fact, month, now }).status;
  const prevTargets = [1.08, 0.94, 1.02, 0.9]; // факт / норма за прошлый месяц: выполнил или почти выполнил
  people.forEach((p, i) => {
    // месячный темп: со второй трети месяца — по текущему факту, раньше — по последним 30 дням
    const monthly = Math.max(1, share >= 0.35 ? p.fact / share : p.rate);
    let norm = Math.max(1, Math.round(monthly * (p.id === lagger ? 1 : i % 2 ? 1.05 : 0.95)));
    if (p.id === lagger) {
      // наименьшая норма, при которой уже «отстаёт» (чуть ниже 85 % ожидаемого), — лёгкое отставание.
      // При нулевом факте — обычный темп; утром 1-го отстать нельзя: ожидаемо 0.
      if (elapsed > 0 && p.fact > 0) { norm = 1; while (norm < 10000 && status(norm, p.fact) !== 'behind') norm++; }
      else norm = Math.max(1, p.rate);
    } else {
      while (norm > 1 && status(norm, p.fact) === 'behind') norm--;
    }
    db.prepare('UPDATE users SET monthly_norm = ?, monthly_norm_from = ? WHERE id = ?').run(norm, month, p.id);
    if (p.prevFact > 0) {
      const r = p.id === lagger ? 0.82 : prevTargets[i % prevTargets.length];
      ins.run(p.id, prev, Math.max(1, Math.round(p.prevFact / r)), at, at);
    }
    p.norm = norm;
  });
  // у одного — отдельная, сниженная норма на следующий месяц (отпуск)
  const last = people.find((p) => p.id !== lagger && p.norm > 1);
  if (last) ins.run(last.id, shiftMonth(month, 1), Math.max(1, Math.round(last.norm * 0.7)), at, at);
}

/**
 * Демо должно соблюдать WIP-лимиты: симуляция раздаёт задачи без оглядки на них,
 * поэтому лишние активные задачи целиком (сдачи, креативы, расходы, история) передаются
 * креативщикам со свободным лимитом. Если свободных нет — доработка по правкам «откладывается».
 */
function enforceWipLimits(creativeIds) {
  const def = getSettings().wip_limit_default;
  const ACTIVE = "(status = 'in_progress' OR (status = 'revision' AND revision_started_at IS NOT NULL))";
  const limitOf = (id) => db.prepare('SELECT wip_limit FROM users WHERE id = ?').get(id).wip_limit ?? def;
  const active = (id) => db.prepare(`SELECT id FROM tasks WHERE creative_id = ? AND ${ACTIVE} ORDER BY deadline DESC`).all(id);
  const moveTask = (taskId, from, to) => {
    db.prepare('UPDATE tasks SET creative_id = ? WHERE id = ?').run(to, taskId);
    db.prepare('UPDATE submissions SET creative_id = ? WHERE task_id = ? AND creative_id = ?').run(to, taskId, from);
    db.prepare('UPDATE creatives SET author_id = ? WHERE task_id = ? AND author_id = ?').run(to, taskId, from);
    for (const [tbl, col] of [['ai_expenses', 'user_id'], ['history', 'user_id'], ['comments', 'user_id'], ['files', 'uploaded_by']]) {
      db.prepare(`UPDATE ${tbl} SET ${col} = ? WHERE task_id = ? AND ${col} = ?`).run(to, taskId, from);
    }
  };
  for (const from of creativeIds) {
    const excess = active(from).slice(0, Math.max(0, active(from).length - limitOf(from)));
    for (const { id: taskId } of excess) {
      const to = creativeIds.find((c) => c !== from && active(c).length < limitOf(c));
      if (to) { moveTask(taskId, from, to); continue; }
      db.prepare("UPDATE tasks SET revision_started_at = NULL WHERE id = ? AND status = 'revision'").run(taskId);
      db.prepare("DELETE FROM history WHERE task_id = ? AND action = 'revision_started' AND id = (SELECT MAX(id) FROM history WHERE task_id = ? AND action = 'revision_started')").run(taskId, taskId);
    }
  }
}

function seedTemplates({ lead, buyers, offerIds, approachIds, iso, now }) {
  const ins = db.prepare(`INSERT INTO brief_templates (name, owner_id, is_shared, offer_id, approach_id, geo, creative_type, quantity, language, format, hook,
    description, references_text, priority, deadline_hours, use_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const at = iso(now - 20 * 24 * H);
  const rows = [
    ['UGC-отзыв 9:16', lead, 1, null, approachIds[1], null, 'UGC', 3, null, '9:16, 1080×1920, 20–30 сек', 'Селфи-видео: «Я не верила, пока не попробовала сама…»',
      'Живой отзыв от лица покупателя: проблема → как нашёл продукт → результат → CTA. Субтитры крупно, без музыки на фоне голоса. Без обещаний «гарантированно».',
      'https://www.facebook.com/ads/library/?id=demo-ugc', 'high', 48, 14],
    ['Статика для пушей', lead, 1, null, approachIds[5], null, 'Статика', 6, null, '1080×1080 и 720×480', 'Крупная цифра скидки и таймер',
      'Набор статичных картинок для пуш-сетей: крупный оффер, контрастная кнопка, минимум текста. Разные фоны и цвета кнопки.', '', 'medium', 24, 9],
    ['Видео «до/после» 15 сек', buyers[0], 0, offerIds[0], approachIds[2], 'BR', 'Видео', 2, 'португальский', '9:16, 15 сек', 'Сплит-экран до/после в первую секунду',
      'Сравнение до/после, плавный переход, в конце — упаковка продукта и CTA. Озвучка на языке ГЕО.', 'https://drive.google.com/drive/folders/demo-before-after', 'medium', 72, 6],
    ['Баннеры 4 размера', buyers[1], 0, null, null, null, 'Баннер', 4, null, '300×250, 728×90, 160×600, 320×50', '',
      'Один визуал в четырёх размерах для Google Display. Логотип оффера, короткий заголовок, кнопка.', '', 'low', 96, 3],
  ];
  rows.forEach((r) => ins.run(...r, at, at));
}

const DAY = 24 * H;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Результаты тестов: метрики ~60 % принятых креативов, вердикты (у части — только предложение),
 * два выгорающих победителя и одно «семейство» с вариациями.
 */
/** Генератор дневной статистики креатива и пересчёт статуса после неё — общий для seedResults и дозаполнения. */
function metricsTools({ rand, between, iso, now }) {
  const settings = getSettings();
  const upsert = db.prepare(`INSERT INTO creative_metrics (creative_id, date, impressions, clicks, conversions, spend, revenue, source, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (creative_id, date) DO UPDATE SET impressions = excluded.impressions, clicks = excluded.clicks,
    conversions = excluded.conversions, spend = excluded.spend, revenue = excluded.revenue`);
  const get = (id) => db.prepare('SELECT * FROM creatives WHERE id = ?').get(id);

  /** Дневная статистика с целевым ROI и формой CTR (shape(i) — множитель CTR в i-й день). */
  const genDays = (c, startMs, n, roi, shape = () => 1) => {
    const baseImp = between(4000, 16000);
    const baseCtr = between(0.9, 3.2) / 100;
    const payout = between(500, 1400);
    let last = startMs;
    for (let i = 0; i < n; i++) {
      const dms = startMs + i * DAY;
      if (dms > now - DAY / 2) break;
      const impressions = Math.round(baseImp * between(0.75, 1.25));
      const clicks = Math.max(1, Math.round(impressions * baseCtr * shape(i) * between(0.9, 1.1)));
      const spend = Math.round(between(300, 2200) * 100) / 100;
      const revenue = Math.max(0, Math.round(spend * (1 + (roi + between(-12, 12)) / 100) * 100) / 100);
      const conversions = Math.min(clicks, Math.round(revenue / payout));
      upsert.run(c.id, dayStr(dms), impressions, clicks, conversions, spend, revenue, rand() < 0.5 ? 'csv' : 'manual', c.buyer_id, iso(dms + 10 * H), iso(dms + 10 * H));
      last = dms;
    }
    return last;
  };
  const after = (c, lastMs) => {
    const at = iso(Math.min(now - H, lastMs + 11 * H));
    refreshCreativeAfterMetrics(c.id, { userId: c.buyer_id, at, settings });
    return at;
  };

  return { settings, genDays, after, get };
}

function seedResults({ rand, between, iso, now, insTask, insHist, seedSubmit }) {
  const { settings, genDays, after, get } = metricsTools({ rand, between, iso, now });
  const accepted = db.prepare("SELECT * FROM creatives WHERE status = 'accepted' AND accepted_at < ? ORDER BY id").all(iso(now - 2 * DAY));
  let pendingLeft = 4; // креативы, у которых только предложение вердикта — для блока «Ждут вердикта»
  const tested = [];
  for (const c of accepted) {
    if (rand() > 0.62) continue;
    const r = rand();
    const roi = r < 0.15 ? between(35, 120) : r < 0.6 ? between(3, 26) : between(-75, -8);
    const daysAvail = Math.floor((now - Date.parse(c.accepted_at)) / DAY) - 1;
    const n = Math.min(Math.round(between(7, 21)), daysAvail);
    if (n < 3) continue;
    const start = Date.parse(c.accepted_at) + DAY;
    const last = genDays(c, start, n, roi);
    const at = after(c, last);
    const fresh = get(c.id);
    if (!fresh.suggested_verdict) continue;
    tested.push(fresh.id);
    if (pendingLeft > 0 && rand() < 0.25) { pendingLeft--; continue; }
    // обычно соглашаются с системой, иногда — нет (на карточке появится «по данным — …»)
    let verdict = fresh.suggested_verdict;
    if (rand() < 0.08) verdict = verdict === 'average' ? 'winner' : 'average';
    setCreativeStatus(fresh, verdict, { userId: c.buyer_id, at, extra: { suggested: fresh.suggested_verdict } });
  }

  // два выгорающих победителя: CTR явно падает к последним дням
  const longOnes = db.prepare(`SELECT c.* FROM creatives c WHERE c.id IN (${tested.join(',') || 0})
    AND (SELECT COUNT(*) FROM creative_metrics m WHERE m.creative_id = c.id) >= 9 ORDER BY c.id DESC LIMIT 2`).all();
  for (const c of longOnes) {
    const rows = db.prepare('SELECT * FROM creative_metrics WHERE creative_id = ? ORDER BY date').all(c.id);
    const n = rows.length;
    rows.forEach((row, i) => {
      const k = 1 - 0.55 * (i / (n - 1)) ** 1.6;
      const clicks = Math.max(1, Math.round(row.impressions * 0.031 * k));
      const revenue = Math.round(row.spend * between(1.5, 1.9) * 100) / 100;
      db.prepare('UPDATE creative_metrics SET clicks = ?, conversions = MIN(conversions, ?), revenue = ? WHERE id = ?').run(clicks, clicks, revenue, row.id);
    });
    const lastMs = Date.parse(rows[n - 1].date);
    let fresh = get(c.id);
    if (fresh.status !== 'winner') setCreativeStatus(fresh, 'winner', { userId: c.buyer_id, at: iso(Date.parse(rows[3].date) + 12 * H) });
    after(get(c.id), lastMs);
  }

  // «семейство»: победитель → задача-вариация (итерация 2) с 3 креативами, один превзошёл родителя
  const parent = db.prepare(`SELECT c.* FROM creatives c WHERE c.status = 'winner' AND c.burnout_detected_at IS NULL
    AND c.accepted_at < ? ORDER BY c.id LIMIT 1`).get(iso(now - 14 * DAY));
  if (!parent) return;
  const pTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parent.task_id);
  const pRoi = computeMetrics(db.prepare('SELECT * FROM creative_metrics WHERE creative_id = ?').all(parent.id)).roi;
  const created = now - 11 * DAY;
  const title = `Вариации CD-${parent.id}: ${parent.title}`;
  const desc = `Сделать вариации креатива-победителя CD-${parent.id}.\nРезультат оригинала: ROI ${Math.round(pRoi)} %.\nСохранить: подход и хук.\nИзменить: первые 3 секунды и персонажа.`;
  const vid = insTask.run(title, pTask.offer, pTask.offer_id, pTask.approach_id, pTask.geo, pTask.creative_type, 3, desc, '', pTask.language, pTask.format, pTask.hook,
    defaultUnits(pTask.creative_type, 3), 'high', iso(created + 48 * H), pTask.buyer_id, iso(created), iso(created)).lastInsertRowid;
  const author = parent.author_id;
  const taken = created + 2 * H; const submitted = created + 20 * H; const done = created + 26 * H;
  db.prepare(`UPDATE tasks SET parent_creative_id = ?, iteration = 2, status = 'done', creative_id = ?, taken_at = ?, first_submitted_at = ?, submitted_at = ?,
    completed_at = ?, updated_at = ? WHERE id = ?`).run(parent.id, author, iso(taken), iso(submitted), iso(submitted), iso(done), iso(done), vid);
  const vTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(vid);
  db.prepare('UPDATE tasks SET brief_score = ? WHERE id = ?').run(scoreBrief({ ...vTask, references_text: '' }).score, vid);
  insHist.run(vid, title, pTask.buyer_id, 'created', null, 'new', JSON.stringify({ priority: 'high', parent: `CD-${parent.id}`, iteration: 2 }), iso(created));
  insHist.run(vid, title, author, 'taken', 'new', 'in_progress', null, iso(taken));
  seedSubmit(vTask, 1, author, 'Три вариации: новый хук, другой персонаж, другой фон.', 5, iso(submitted));
  insHist.run(vid, title, author, 'submitted', 'in_progress', 'review', JSON.stringify({ round: 1, files: 3, links: 0, hours: 5 }), iso(submitted));
  insHist.run(vid, title, pTask.buyer_id, 'accepted', 'review', 'done', null, iso(done));
  acceptTaskCreatives(vTask, { at: iso(done), log: false });
  const kids = db.prepare('SELECT * FROM creatives WHERE task_id = ? ORDER BY slot').all(vid);
  const rois = [Math.max(pRoi + 25, 60), between(5, 20), between(-50, -15)];
  kids.forEach((k, i) => {
    const last = genDays(k, done + DAY, 8, rois[i] ?? 10);
    const at = after(k, last);
    const fresh = get(k.id);
    if (fresh.suggested_verdict) setCreativeStatus(fresh, fresh.suggested_verdict, { userId: k.buyer_id, at });
  });
}

export function seedIfEmpty() {
  const { c } = db.prepare('SELECT COUNT(*) c FROM users').get();
  if (c === 0) {
    seed();
    console.log('Демо-данные созданы (пароль для всех пользователей: demo123)');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed();
  const counts = db.prepare('SELECT status, COUNT(*) c FROM tasks GROUP BY status').all();
  console.log('Демо-данные пересозданы:', counts.map((r) => `${r.status}=${r.c}`).join(', '));
}
