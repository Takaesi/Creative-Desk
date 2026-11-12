// План и норма креативщиков на месяц. Месяц и «сегодня» — по московскому времени (UTC+3, без перехода на летнее время).
import { db } from './db.js';

import { moscowMonth, monthBounds, shiftMonth, planPace } from './plan-math.js';

export * from './plan-math.js';

// ---------- данные ----------
/** Норма на месяц: запись в creative_plans, иначе users.monthly_norm, иначе null. */
export function normFor(userId, month) {
  const p = db.prepare('SELECT norm FROM creative_plans WHERE user_id = ? AND month = ?').get(userId, month);
  if (p) return { norm: p.norm, source: 'month' };
  const u = db.prepare('SELECT monthly_norm, monthly_norm_from FROM users WHERE id = ?').get(userId);
  if (!u?.monthly_norm) return null;
  if (u.monthly_norm_from && month < u.monthly_norm_from) return null; // норму тогда ещё не задали
  return { norm: u.monthly_norm, source: 'default' };
}

/** Факт: креативы автора, принятые в этом месяце (по Москве). Перекрытые версии не считаются. */
export function factFor(userId, month) {
  const [from, to] = monthBounds(month);
  return db.prepare(`SELECT COUNT(*) c FROM creatives WHERE author_id = ? AND accepted_at >= ? AND accepted_at < ?
    AND status NOT IN ('superseded','draft')`).get(userId, from, to).c;
}

/** План/факт креативщика на месяц. null — норма не задана. */
export function planFor(userId, now = Date.now(), month = moscowMonth(now)) {
  const n = normFor(userId, month);
  if (!n) return null;
  return { ...planPace({ norm: n.norm, fact: factFor(userId, month), month, now }), source: n.source };
}

/** Map userId → план текущего месяца по всем креативщикам. */
export function planForAll(now = Date.now(), month = moscowMonth(now)) {
  const ids = db.prepare("SELECT id FROM users WHERE role = 'creative'").all();
  return new Map(ids.map(({ id }) => [id, planFor(id, now, month)]));
}

/**
 * Смена нормы по умолчанию. Старую норму сначала фиксируем записями в прошлых месяцах, где она действовала
 * (с monthly_norm_from до прошлого месяца), — иначе новое значение «переписало» бы историю план/факт.
 * Новая норма действует с текущего месяца.
 */
export function setDefaultNorm(userId, norm, now = Date.now()) {
  const u = db.prepare('SELECT monthly_norm, monthly_norm_from FROM users WHERE id = ?').get(userId);
  const cur = moscowMonth(now);
  const at = new Date(now).toISOString();
  if (u.monthly_norm) {
    const ins = db.prepare('INSERT OR IGNORE INTO creative_plans (user_id, month, norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    // без даты начала (старые данные) — фиксируем хотя бы прошлый месяц
    for (let m = u.monthly_norm_from || shiftMonth(cur, -1); m < cur; m = shiftMonth(m, 1)) ins.run(userId, m, u.monthly_norm, at, at);
  }
  db.prepare('UPDATE users SET monthly_norm = ?, monthly_norm_from = ? WHERE id = ?').run(norm, norm ? cur : null, userId);
}
