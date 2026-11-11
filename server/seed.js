// Демо-данные: пользователи всех ролей и ~45 задач с правдоподобной историей.
// Запуск вручную: `npm run seed` (пересоздаёт данные). При старте сервера вызывается seedIfEmpty().
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, SETTINGS_SCHEMA } from './db.js';
import { defaultUnits, scoreBrief } from './domain.js';

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
    for (const t of ['history', 'creative_metrics', 'creatives', 'comments', 'ai_expenses', 'files', 'submissions', 'tasks', 'brief_templates',
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
      const qty = type === 'Статика' || type === 'Баннер' ? Math.ceil(between(3, 10)) : Math.ceil(between(1, 4));
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
          insSub.run(taskId, revisions + 1, creative, pick(SUBMIT_TEXTS), `https://drive.google.com/drive/folders/result-${taskId}-r${revisions + 1}`, hours, iso(t));
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
        for (const tbl of ['history', 'submissions', 'ai_expenses', 'comments']) db.prepare(`UPDATE ${tbl} SET ${sh('created_at')} WHERE task_id = ?`).run(taskId);
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
  })();
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
