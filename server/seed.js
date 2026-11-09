// Демо-данные: пользователи всех ролей и ~45 задач с правдоподобной историей.
// Запуск вручную: `npm run seed` (пересоздаёт данные). При старте сервера вызывается seedIfEmpty().
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

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

const OFFERS = ['LuckyBox Casino', 'SlimFit Keto', 'CryptoNova', 'HairPro Max', 'Joint Relax', 'VPN Shield', 'FitTrack App', 'Bet Arena', 'Dental White', 'Sugar Balance'];
const GEOS = ['RU', 'KZ', 'BR', 'MX', 'IN', 'TR', 'DE', 'PL', 'US', 'ES', 'IT', 'ID', 'PH'];
const TYPES = {
  'Видео': { services: ['Runway', 'Kling', 'ElevenLabs', 'Midjourney'], creatives: [1, 3] },
  'UGC': { services: ['HeyGen', 'ElevenLabs', 'ChatGPT', 'Sora'], creatives: [3, 1] },
  'Статика': { services: ['Midjourney', 'Stable Diffusion', 'ChatGPT'], creatives: [2, 0] },
  'Баннер': { services: ['Midjourney', 'Leonardo', 'ChatGPT'], creatives: [2, 0] },
  'Анимация': { services: ['Runway', 'Pika', 'Midjourney'], creatives: [0, 1] },
  'Плейабл': { services: ['ChatGPT', 'Claude', 'Midjourney'], creatives: [0] },
};
const ANGLES = ['до/после', 'отзыв врача', 'новостной формат', 'испуг/боль', 'big win', 'скидка −50%', 'история пользователя', 'сравнение с конкурентом', 'стрим-нарезка', 'уведомление на телефоне'];
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
    for (const t of ['history', 'comments', 'ai_expenses', 'files', 'submissions', 'tasks', 'sessions', 'users']) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sqlite_sequence");

    const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
    const insUser = db.prepare('INSERT INTO users (name, email, password_hash, role, position, color) VALUES (?,?,?,?,?,?)');
    const ids = USERS.map((u) => insUser.run(u.name, u.email, hash, u.role, u.position, u.color).lastInsertRowid);
    const buyers = ids.filter((_, i) => USERS[i].role === 'buyer');
    const creatives = ids.filter((_, i) => USERS[i].role === 'creative');
    const lead = ids[0];

    const insTask = db.prepare(`INSERT INTO tasks (title, offer, geo, creative_type, quantity, description, references_text, priority, deadline, status, buyer_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'new',?,?,?)`);
    const insHist = db.prepare('INSERT INTO history (task_id, task_title, user_id, action, from_status, to_status, details, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const insSub = db.prepare('INSERT INTO submissions (task_id, round, creative_id, comment, links, created_at) VALUES (?,?,?,?,?,?)');
    const insExp = db.prepare('INSERT INTO ai_expenses (task_id, user_id, service, credits, round, note, created_at) VALUES (?,?,?,?,?,?,?)');
    const insCom = db.prepare('INSERT INTO comments (task_id, user_id, text, kind, created_at) VALUES (?,?,?,?,?)');

    const N = 46;
    for (let i = 0; i < N; i++) {
      const type = pick(Object.keys(TYPES));
      const offer = pick(OFFERS);
      const geo = rand() < 0.2 ? `${pick(GEOS)}, ${pick(GEOS)}` : pick(GEOS);
      const angle = pick(ANGLES);
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
      const title = `${type}: ${offer} — ${angle}`;
      const description = `Нужно ${qty} шт. «${type.toLowerCase()}» под ${offer} на ГЕО ${geo}.\nУгол: ${angle}.\nФормат: ${type === 'Видео' || type === 'UGC' ? '9:16, 15–30 сек, субтитры на языке ГЕО' : '1080×1080 и 1080×1920'}.\nБез запрещённых обещаний, логотипы платформ не использовать.`;
      const refs = `https://www.facebook.com/ads/library/?id=${Math.floor(between(1e14, 9e14))}\nhttps://drive.google.com/drive/folders/demo-ref-${i + 1}`;

      const taskId = insTask.run(title, offer, geo, type, qty, description, refs, priority, iso(deadline), buyer, iso(created), iso(created)).lastInsertRowid;
      insHist.run(taskId, title, buyer, 'created', null, 'new', JSON.stringify({ priority, deadline: iso(deadline) }), iso(created));

      // ---- симуляция жизненного цикла с обрезкой по «сейчас» ----
      const preferred = TYPES[type].creatives.map((k) => creatives[k]);
      const creative = rand() < 0.8 ? pick(preferred) : pick(creatives);
      const speed = { urgent: 0.35, high: 0.6, medium: 1, low: 1.4 }[priority];
      let t = created;
      let status = 'new';
      let revisions = 0;
      const state = { taken_at: null, submitted_at: null, completed_at: null, creative_id: null };
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
          insSub.run(taskId, revisions + 1, creative, pick(SUBMIT_TEXTS), `https://drive.google.com/drive/folders/result-${taskId}-r${revisions + 1}`, iso(t));
          state.submitted_at = t;
          move('review', 'submitted', creative, { round: revisions + 1, files: 0, links: 1 });
          if (!step(between(0.3, 10) * H)) break;
          const reviewer = rand() < 0.9 ? buyer : lead;
          if (revisions < 2 && rand() < 0.38) {
            revisions++;
            insCom.run(taskId, reviewer, pick(REVISION_TEXTS), 'revision', iso(t));
            move('revision', 'revision_requested', reviewer, { round: revisions });
            if (!step(between(0.3, 8) * H)) break;
            move('in_progress', 'revision_started', creative);
          } else {
            state.completed_at = t;
            move('done', 'accepted', reviewer);
            finished = true;
          }
        }
      }
      if (target) {
        // сдвигаем всю историю задачи так, чтобы последнее событие было недавно
        const lastAt = target === 'new' ? created : t;
        const shiftSec = Math.round((lastAt - (now - between(0.2, target === 'done' ? 30 : 9) * H)) / 1000);
        const sh = (col) => `${col} = shift_iso(${col}, ${shiftSec * 1000})`;
        db.prepare(`UPDATE tasks SET ${sh('created_at')}, ${sh('deadline')} WHERE id = ?`).run(taskId);
        for (const tbl of ['history', 'submissions', 'ai_expenses', 'comments']) db.prepare(`UPDATE ${tbl} SET ${sh('created_at')} WHERE task_id = ?`).run(taskId);
        for (const k of ['taken_at', 'submitted_at', 'completed_at']) if (state[k]) state[k] -= shiftSec * 1000;
        t -= shiftSec * 1000;
      }
      const createdFinal = Date.parse(db.prepare('SELECT created_at FROM tasks WHERE id = ?').get(taskId).created_at);
      if (rand() < 0.35) {
        const ct = Math.min(now, createdFinal + between(0.2, 6) * H);
        insCom.run(taskId, state.creative_id || pick(creatives), pick(COMMENTS.slice(0, 3)), 'comment', iso(ct));
        insCom.run(taskId, buyer, pick(COMMENTS.slice(3)), 'comment', iso(Math.min(now, ct + 0.5 * H)));
      }
      db.prepare(`UPDATE tasks SET status=?, creative_id=?, taken_at=?, submitted_at=?, completed_at=?, revision_count=?, updated_at=? WHERE id=?`).run(
        status, state.creative_id, state.taken_at && iso(state.taken_at), state.submitted_at && iso(state.submitted_at),
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
