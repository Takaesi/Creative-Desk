// Метрики креативов: расчёт показателей, предложение вердикта, выгорание, разбор CSV.
// Только чистые функции — без обращения к БД, чтобы их было легко тестировать.

const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Суммы и производные показатели по набору дневных строк. */
export function computeMetrics(rows = []) {
  const s = { impressions: 0, clicks: 0, conversions: 0, spend: 0, revenue: 0, days: rows.length };
  for (const r of rows) {
    s.impressions += Number(r.impressions) || 0;
    s.clicks += Number(r.clicks) || 0;
    s.conversions += Number(r.conversions) || 0;
    s.spend += Number(r.spend) || 0;
    s.revenue += Number(r.revenue) || 0;
  }
  s.spend = round(s.spend);
  s.revenue = round(s.revenue);
  return { ...s, ...derived(s) };
}

/** CTR, CR, CPA, ROI, профит из сумм; при нулевом знаменателе — null. */
export function derived(s) {
  return {
    ctr: s.impressions > 0 ? round((s.clicks / s.impressions) * 100, 3) : null,
    cr: s.clicks > 0 ? round((s.conversions / s.clicks) * 100, 3) : null,
    cpa: s.conversions > 0 ? round(s.spend / s.conversions) : null,
    roi: s.spend > 0 ? round(((s.revenue - s.spend) / s.spend) * 100, 2) : null,
    profit: round((s.revenue || 0) - (s.spend || 0)),
  };
}

/** Что предложить по итогам теста. Система только предлагает — вердикт ставит человек. */
export function suggestVerdict(summary, settings) {
  if (!summary || summary.spend < settings.verdict_min_spend || summary.roi == null) return null;
  if (summary.roi >= settings.verdict_winner_roi) return 'winner';
  if (summary.roi < settings.verdict_loser_roi) return 'loser';
  return 'average';
}

/**
 * Выгорание: скользящий CTR по 3 дням с показами; если последнее окно упало от пика на burnout_drop_pct — сигнал.
 * @returns {{ burnout: boolean, analyzed: boolean, peak?: number, current?: number, dropPct?: number }}
 */
export function detectBurnout(rows, settings) {
  const days = [...rows].filter((r) => Number(r.impressions) > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < settings.burnout_min_days || days.length < 3) return { burnout: false, analyzed: false };
  const windows = [];
  for (let i = 2; i < days.length; i++) {
    const w = days.slice(i - 2, i + 1);
    const imp = w.reduce((s, r) => s + Number(r.impressions), 0);
    const clk = w.reduce((s, r) => s + Number(r.clicks), 0);
    windows.push((clk / imp) * 100);
  }
  const peak = Math.max(...windows);
  const current = windows[windows.length - 1];
  const dropPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;
  // небольшой допуск на погрешность плавающей точки
  const burnout = peak > 0 && current <= peak * (1 - settings.burnout_drop_pct / 100) + 1e-9;
  return { burnout, analyzed: true, peak: round(peak, 3), current: round(current, 3), dropPct: round(dropPct, 1) };
}

// ---------- CSV ----------
const HEADER_SYNONYMS = {
  creative: ['creative', 'креатив', 'code', 'код'],
  date: ['date', 'дата'],
  impressions: ['impressions', 'показы'],
  clicks: ['clicks', 'клики'],
  conversions: ['conversions', 'конверсии', 'leads'],
  spend: ['spend', 'расход', 'cost'],
  revenue: ['revenue', 'доход'],
};
export const CSV_TEMPLATE = 'creative;date;impressions;clicks;conversions;spend;revenue\nCD-1;2026-01-15;12000;240;12;1800;2600\nBR_nutra_CD-2_v2;15.01.2026;8000;120;4;900,50;700\n';

/** Делит строку CSV с учётом кавычек. */
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const parseIntStrict = (s) => (/^\d+$/.test(String(s).replace(/\s/g, '')) ? Number(String(s).replace(/\s/g, '')) : NaN);
const parseMoney = (s) => {
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};
function parseDate(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return null;
}
function validDate(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
export function creativeIdFrom(s) {
  const t = String(s).trim();
  const m = t.match(/CD-(\d+)/i);
  if (m) return Number(m[1]);
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Проверка одной дневной строки метрик. Возвращает текст ошибки или null. */
export function validateMetricRow(r, maxDate) {
  for (const k of ['impressions', 'clicks', 'conversions']) if (!Number.isInteger(r[k]) || r[k] < 0) return `«${k}» должно быть целым неотрицательным числом`;
  for (const k of ['spend', 'revenue']) if (!Number.isFinite(r[k]) || r[k] < 0) return `«${k}» должно быть неотрицательным числом`;
  if (r.clicks > r.impressions) return 'клики больше показов';
  if (r.conversions > r.clicks) return 'конверсий больше, чем кликов';
  if (!r.date) return 'некорректная дата';
  if (maxDate && r.date > maxDate) return 'дата в будущем';
  return null;
}

/**
 * Разбор CSV: автоопределение разделителя, BOM, русские синонимы, код внутри названия объявления.
 * Строки с одинаковыми (креатив, дата) суммируются.
 * @returns {{ rows: {creative_id, date, impressions, clicks, conversions, spend, revenue, lines:number[]}[], errors: {row, message}[] }}
 */
export function parseMetricsCsv(text, { maxDate } = {}) {
  const errors = [];
  const src = String(text || '').replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);
  const headerLine = lines[0] || '';
  const sep = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
  const headers = splitCsvLine(headerLine, sep).map((h) => h.toLowerCase().replace(/^"|"$/g, ''));
  const col = {};
  for (const [key, syn] of Object.entries(HEADER_SYNONYMS)) {
    const idx = headers.findIndex((h) => syn.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const missing = Object.keys(HEADER_SYNONYMS).filter((k) => col[k] === undefined);
  if (missing.length) return { rows: [], errors: [{ row: 1, message: `нет колонок: ${missing.join(', ')}` }] };

  const agg = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const rowNo = i + 1;
    const cells = splitCsvLine(lines[i], sep);
    const cid = creativeIdFrom(cells[col.creative] ?? '');
    if (!cid) { errors.push({ row: rowNo, message: `не найден код креатива в «${cells[col.creative] ?? ''}»` }); continue; }
    const r = {
      creative_id: cid,
      date: parseDate(cells[col.date] ?? ''),
      impressions: parseIntStrict(cells[col.impressions] ?? ''),
      clicks: parseIntStrict(cells[col.clicks] ?? ''),
      conversions: parseIntStrict(cells[col.conversions] ?? ''),
      spend: parseMoney(cells[col.spend] ?? ''),
      revenue: parseMoney(cells[col.revenue] ?? ''),
    };
    if (!r.date) { errors.push({ row: rowNo, message: `некорректная дата «${cells[col.date] ?? ''}»` }); continue; }
    const err = validateMetricRow(r, maxDate);
    if (err) { errors.push({ row: rowNo, message: err }); continue; }
    const key = `${cid}|${r.date}`;
    const prev = agg.get(key);
    if (prev) {
      for (const k of ['impressions', 'clicks', 'conversions', 'spend', 'revenue']) prev[k] += r[k];
      prev.lines.push(rowNo);
    } else agg.set(key, { ...r, lines: [rowNo] });
  }
  // после суммирования повторно проверяем соотношения
  const rows = [];
  for (const r of agg.values()) {
    r.spend = round(r.spend); r.revenue = round(r.revenue);
    const err = validateMetricRow(r, maxDate);
    if (err) errors.push({ row: r.lines[0], message: `${err} (после суммирования строк ${r.lines.join(', ')})` });
    else rows.push(r);
  }
  return { rows, errors };
}
