import { db } from './db.js';
import { computeDurations, isOverdue, STATUSES } from './domain.js';

const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

/**
 * Аналитика для руководителя.
 * Период фильтрует задачи по дате создания; расходы — по дате списания.
 */
export function buildAnalytics({ from, to }) {
  const now = Date.now();
  const fromIso = from ? new Date(from).toISOString() : '0000';
  const toIso = to ? new Date(Date.parse(to) + 86400000 - 1).toISOString() : '9999';

  const users = db.prepare('SELECT id, name, role, color, position FROM users').all();
  const tasks = db.prepare('SELECT * FROM tasks WHERE created_at BETWEEN ? AND ?').all(fromIso, toIso);
  const statusHist = db
    .prepare(`SELECT task_id, to_status, created_at FROM history WHERE to_status IS NOT NULL ORDER BY created_at`)
    .all();
  const histByTask = new Map();
  for (const h of statusHist) {
    if (!histByTask.has(h.task_id)) histByTask.set(h.task_id, []);
    histByTask.get(h.task_id).push(h);
  }
  const expenses = db
    .prepare(
      `SELECT e.*, u.name AS user_name FROM ai_expenses e JOIN users u ON u.id = e.user_id
       WHERE e.created_at BETWEEN ? AND ?`
    )
    .all(fromIso, toIso);

  const enriched = tasks.map((t) => ({
    ...t,
    d: computeDurations(t, histByTask.get(t.id) || [], now),
    overdue: isOverdue(t, now),
  }));
  const done = enriched.filter((t) => t.status === 'done');

  // --- KPI ---
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  enriched.forEach((t) => byStatus[t.status]++);
  const overdueActive = enriched.filter((t) => t.status !== 'done' && t.overdue).length;
  const doneLate = done.filter((t) => t.overdue).length;
  const totalCredits = expenses.reduce((s, e) => s + e.credits, 0);

  const kpi = {
    total: enriched.length,
    active: enriched.length - byStatus.done,
    done: byStatus.done,
    overdueActive,
    doneLate,
    onTimeRate: done.length ? (done.length - doneLate) / done.length : null,
    avgLeadTime: avg(done.map((t) => t.d.leadTime)),
    avgCycleTime: avg(done.map((t) => t.d.cycleTime).filter((x) => x != null)),
    avgWaitToTake: avg(enriched.map((t) => t.d.waitToTake).filter((x) => x != null)),
    avgWorkTime: avg(done.map((t) => t.d.workTime)),
    revisionRate: done.length ? done.filter((t) => t.revision_count > 0).length / done.length : null,
    totalCredits,
    creditsPerDoneTask: done.length ? expenses.filter((e) => done.some((t) => t.id === e.task_id)).reduce((s, e) => s + e.credits, 0) / done.length : null,
  };

  // --- Загрузка креативщиков ---
  const creatives = users.filter((u) => u.role === 'creative').map((u) => {
    const mine = enriched.filter((t) => t.creative_id === u.id);
    const mineDone = mine.filter((t) => t.status === 'done');
    const exp = expenses.filter((e) => e.user_id === u.id);
    return {
      id: u.id, name: u.name, color: u.color, position: u.position,
      inProgress: mine.filter((t) => t.status === 'in_progress').length,
      inReview: mine.filter((t) => t.status === 'review').length,
      inRevision: mine.filter((t) => t.status === 'revision').length,
      active: mine.filter((t) => t.status !== 'done').length,
      activeUnits: mine.filter((t) => t.status !== 'done').reduce((s, t) => s + t.quantity, 0),
      done: mineDone.length,
      doneUnits: mineDone.reduce((s, t) => s + t.quantity, 0),
      overdue: mine.filter((t) => t.overdue).length,
      revisions: mine.reduce((s, t) => s + t.revision_count, 0),
      avgCycleTime: avg(mineDone.map((t) => t.d.cycleTime).filter((x) => x != null)),
      credits: exp.reduce((s, e) => s + e.credits, 0),
    };
  });

  // --- Байеры ---
  const buyers = users.filter((u) => u.role === 'buyer').map((u) => {
    const mine = enriched.filter((t) => t.buyer_id === u.id);
    return {
      id: u.id, name: u.name, color: u.color,
      created: mine.length,
      done: mine.filter((t) => t.status === 'done').length,
      active: mine.filter((t) => t.status !== 'done').length,
      overdue: mine.filter((t) => t.overdue).length,
      avgReviewTime: avg(mine.filter((t) => t.d.reviewTime > 0).map((t) => t.d.reviewTime)),
    };
  });

  // --- AI-расходы ---
  const serviceMap = new Map();
  for (const e of expenses) {
    const s = serviceMap.get(e.service) || { service: e.service, credits: 0, entries: 0, revisionCredits: 0, byUser: {} };
    s.credits += e.credits;
    s.entries++;
    if (e.round > 0) s.revisionCredits += e.credits;
    s.byUser[e.user_id] = (s.byUser[e.user_id] || 0) + e.credits;
    serviceMap.set(e.service, s);
  }
  const byService = [...serviceMap.values()].sort((a, b) => b.credits - a.credits);
  const expenseUsers = users
    .filter((u) => expenses.some((e) => e.user_id === u.id))
    .map((u) => ({ id: u.id, name: u.name, color: u.color }));
  const revisionCredits = expenses.filter((e) => e.round > 0).reduce((s, e) => s + e.credits, 0);

  // --- Типы креативов ---
  const typeMap = new Map();
  for (const t of enriched) {
    const r = typeMap.get(t.creative_type) || { type: t.creative_type, count: 0, done: 0, leadTimes: [] };
    r.count++;
    if (t.status === 'done') { r.done++; r.leadTimes.push(t.d.leadTime); }
    typeMap.set(t.creative_type, r);
  }
  const byType = [...typeMap.values()]
    .map((r) => ({ type: r.type, count: r.count, done: r.done, avgLeadTime: avg(r.leadTimes) }))
    .sort((a, b) => b.count - a.count);

  // --- Динамика по дням ---
  const dayKey = (iso) => iso.slice(0, 10);
  const days = new Map();
  const start = from ? new Date(from) : new Date(Math.min(now, ...enriched.map((t) => Date.parse(t.created_at))));
  const end = to ? new Date(to) : new Date(now);
  for (let d = new Date(dayKey(start.toISOString())); d <= end; d = new Date(d.getTime() + 86400000)) {
    days.set(dayKey(d.toISOString()), { day: dayKey(d.toISOString()), created: 0, done: 0, credits: 0 });
  }
  enriched.forEach((t) => {
    days.get(dayKey(t.created_at)) && days.get(dayKey(t.created_at)).created++;
    if (t.completed_at && days.get(dayKey(t.completed_at))) days.get(dayKey(t.completed_at)).done++;
  });
  expenses.forEach((e) => { if (days.get(dayKey(e.created_at))) days.get(dayKey(e.created_at)).credits += e.credits; });

  // --- Просроченные задачи (список) ---
  const overdueList = enriched
    .filter((t) => t.overdue)
    .map((t) => ({
      id: t.id, title: t.title, status: t.status, deadline: t.deadline, completed_at: t.completed_at,
      creative: users.find((u) => u.id === t.creative_id)?.name ?? null,
      buyer: users.find((u) => u.id === t.buyer_id)?.name ?? null,
      lateBy: (t.completed_at ? Date.parse(t.completed_at) : now) - Date.parse(t.deadline),
    }))
    .sort((a, b) => b.lateBy - a.lateBy);

  return {
    period: { from: from || null, to: to || null },
    kpi, byStatus, creatives, buyers,
    ai: { byService, users: expenseUsers, revisionCredits, total: totalCredits },
    byType,
    timeline: [...days.values()],
    overdueList,
  };
}
