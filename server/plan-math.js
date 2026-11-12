// Чистая арифметика плана: месяцы по Москве и темп. Без БД — чтобы тестировать напрямую.
const MSK = 3 * 3600_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonth = (s) => MONTH_RE.test(String(s));

/** 'YYYY-MM' по Москве для момента ms. */
export function moscowMonth(ms = Date.now()) {
  return new Date(ms + MSK).toISOString().slice(0, 7);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Границы месяца по Москве в UTC ISO: [начало, начало следующего). */
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return [new Date(Date.UTC(y, m - 1, 1) - MSK).toISOString(), new Date(Date.UTC(y, m, 1) - MSK).toISOString()];
}

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Сколько дней месяца прошло к моменту now (текущий день считается прошедшим). Прошлый месяц — все дни, будущий — 0. */
export function elapsedDays(month, now = Date.now()) {
  const cur = moscowMonth(now);
  if (month < cur) return daysInMonth(month);
  if (month > cur) return 0;
  return new Date(now + MSK).getUTCDate();
}

/**
 * Темп выполнения плана.
 * ожидаемо = норма × прошедшие дни / дней в месяце;
 * «опережает» — факт ≥ ожидаемого, «в графике» — ≥ 85 % ожидаемого, «отстаёт» — меньше.
 */
export function planPace({ norm, fact, month, now = Date.now() }) {
  const days = daysInMonth(month);
  const elapsed = elapsedDays(month, now);
  const expected = (norm * elapsed) / days;
  const status = fact >= expected ? 'ahead' : fact >= expected * 0.85 ? 'on_track' : 'behind';
  return {
    month, norm, fact, days, elapsed,
    expected: Math.round(expected * 10) / 10,
    pct: norm > 0 ? (fact / norm) * 100 : null,
    status,
    behind_by: Math.max(0, Math.ceil(expected - fact - 1e-9)),
    ahead_by: Math.max(0, Math.floor(fact - expected + 1e-9)),
  };
}

