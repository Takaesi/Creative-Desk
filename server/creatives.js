// Креативы: создание из сдач, версии по слотам, приёмка, смена статусов.
// Используется и HTTP-обработчиками, и сидом (одна логика на реальные и демо-данные).
import { db, nowIso, logHistory, getSettings } from './db.js';
import { canTransitionCreative, VERDICTS } from './domain.js';
import { computeMetrics, suggestVerdict, detectBurnout } from './metrics.js';

export class CreativeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const code = (id) => `CD-${id}`;

/** Элементы сдачи в порядке: сначала файлы (в порядке загрузки), затем ссылки по одной. */
export function submissionItems(files, linksText) {
  const items = (files || []).map((f) => ({ file_id: f.id, link: null, title: f.original_name }));
  for (const l of String(linksText || '').split(/\s+/).map((s) => s.trim()).filter(Boolean)) {
    let title = l;
    try { title = new URL(l).hostname.replace(/^www\./, ''); } catch { /* не URL — оставляем как есть */ }
    items.push({ file_id: null, link: l, title });
  }
  return items;
}

/** Последняя версия каждого слота задачи. */
export function latestSlots(taskId) {
  return db.prepare(
    `SELECT c.* FROM creatives c
     WHERE c.task_id = ? AND c.version = (SELECT MAX(c2.version) FROM creatives c2 WHERE c2.task_id = c.task_id AND c2.slot = c.slot)
     ORDER BY c.slot`
  ).all(taskId);
}

/**
 * Создаёт креативы из сдачи.
 * targets[i] — слот, новой версией которого является i-й элемент, или 'new'. Если не задано — сопоставление по порядку.
 * Прежняя версия перекрытого слота (draft) становится superseded.
 */
export function createCreativesForSubmission({ task, submissionId, round, authorId, items, targets, at = nowIso(), userId = authorId, log = true }) {
  const existing = latestSlots(task.id);
  const slotNums = existing.map((c) => c.slot);
  let nextSlot = Math.max(0, ...slotNums) + 1;
  const used = new Set();
  const ins = db.prepare(
    `INSERT INTO creatives (task_id, submission_id, file_id, link, title, slot, version, author_id, buyer_id, offer_id, approach_id, geo, creative_type,
       parent_creative_id, status, created_at, updated_at)
     VALUES (@task_id, @submission_id, @file_id, @link, @title, @slot, @version, @author_id, @buyer_id, @offer_id, @approach_id, @geo, @creative_type,
       @parent_creative_id, 'draft', @at, @at)`
  );
  const created = [];
  items.forEach((item, i) => {
    let target = targets?.[i];
    if (target === undefined || target === null || target === '') target = slotNums[i] ?? 'new';
    let slot;
    if (target === 'new') slot = nextSlot++;
    else {
      slot = Number(target);
      if (!slotNums.includes(slot)) throw new CreativeError(400, `Креатива №${target} нет в прошлых сдачах`);
      if (used.has(slot)) throw new CreativeError(400, `Для креатива №${slot} выбрано несколько новых версий`);
      used.add(slot);
      const prev = existing.find((c) => c.slot === slot);
      if (prev.status === 'draft') {
        db.prepare("UPDATE creatives SET status = 'superseded', updated_at = ? WHERE id = ?").run(at, prev.id);
        if (log) logHistory({ taskId: task.id, taskTitle: task.title, userId, action: 'creative_status', creativeId: prev.id, at, details: { code: code(prev.id), from: 'draft', to: 'superseded', auto: true } });
      }
    }
    const id = ins.run({
      task_id: task.id, submission_id: submissionId, file_id: item.file_id, link: item.link, title: String(item.title).slice(0, 200),
      slot, version: round, author_id: authorId, buyer_id: task.buyer_id, offer_id: task.offer_id ?? null, approach_id: task.approach_id ?? null,
      geo: task.geo, creative_type: task.creative_type, parent_creative_id: task.parent_creative_id ?? null, at,
    }).lastInsertRowid;
    created.push(id);
    if (log) logHistory({ taskId: task.id, taskTitle: task.title, userId, action: 'creative_created', creativeId: id, at, details: { code: code(id), slot, version: round } });
  });
  return created;
}

/** Приёмка задачи: последняя версия каждого слота → accepted, прочие черновики → superseded. */
export function acceptTaskCreatives(task, { at = nowIso(), userId = null, log = true } = {}) {
  const latest = new Set(latestSlots(task.id).map((c) => c.id));
  const drafts = db.prepare("SELECT id FROM creatives WHERE task_id = ? AND status = 'draft'").all(task.id);
  const acc = db.prepare("UPDATE creatives SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?");
  const sup = db.prepare("UPDATE creatives SET status = 'superseded', updated_at = ? WHERE id = ?");
  const accepted = [];
  for (const { id } of drafts) {
    if (latest.has(id)) { acc.run(at, at, id); accepted.push(id); } else sup.run(at, id);
  }
  if (log && accepted.length) {
    logHistory({ taskId: task.id, taskTitle: task.title, userId, action: 'creatives_accepted', at, details: { codes: accepted.map(code) } });
  }
  return accepted;
}

const STATUS_TIMESTAMP = { in_test: 'launched_at', winner: 'verdict_at', average: 'verdict_at', loser: 'verdict_at' };

/** Смена статуса креатива с проверкой перехода и записью в историю. to = 'restore' — возврат из архива. */
export function setCreativeStatus(creative, to, { userId, at = nowIso(), auto = false, extra = null } = {}) {
  let target = to;
  if (to === 'restore') {
    if (creative.status !== 'archived') throw new CreativeError(409, 'Креатив не в архиве');
    const h = db.prepare("SELECT details FROM history WHERE creative_id = ? AND action = 'creative_status' AND json_extract(details, '$.to') = 'archived' ORDER BY id DESC LIMIT 1").get(creative.id);
    target = h ? JSON.parse(h.details).from : 'accepted';
  } else if (!canTransitionCreative(creative.status, to)) {
    throw new CreativeError(409, `Нельзя перевести креатив из «${creative.status}» в «${to}»`);
  }
  const set = { status: target, updated_at: at };
  const ts = STATUS_TIMESTAMP[target];
  if (ts && (ts !== 'launched_at' || !creative.launched_at)) set[ts] = at;
  if (target === 'in_test' && !creative.launched_at) set.launched_at = at;
  db.prepare(`UPDATE creatives SET ${Object.keys(set).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...set, id: creative.id });
  const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(creative.task_id);
  logHistory({
    taskId: task?.id, taskTitle: task?.title, userId, action: 'creative_status', creativeId: creative.id, at,
    details: { code: code(creative.id), from: creative.status, to: target, auto, ...(extra || {}) },
  });
  return target;
}

/** После изменения метрик: авто-запуск в тест, пересчёт предложения вердикта и сигнала выгорания. */
export function refreshCreativeAfterMetrics(creativeId, { userId, at = nowIso(), settings = getSettings() } = {}) {
  let c = db.prepare('SELECT * FROM creatives WHERE id = ?').get(creativeId);
  const rows = db.prepare('SELECT * FROM creative_metrics WHERE creative_id = ? ORDER BY date').all(creativeId);
  if (c.status === 'accepted' && rows.length) {
    setCreativeStatus(c, 'in_test', { userId, at, auto: true });
    c = db.prepare('SELECT * FROM creatives WHERE id = ?').get(creativeId);
  }
  const summary = computeMetrics(rows);
  const suggested = suggestVerdict(summary, settings);
  let burnoutAt = c.burnout_detected_at;
  let burnoutNew = false;
  if (c.status === 'winner') {
    const b = detectBurnout(rows, settings);
    if (b.burnout && !burnoutAt) { burnoutAt = at; burnoutNew = true; }
    if (!b.burnout) burnoutAt = null;
  }
  db.prepare('UPDATE creatives SET suggested_verdict = ?, burnout_detected_at = ?, updated_at = ? WHERE id = ?').run(suggested, burnoutAt, at, creativeId);
  return { summary, suggested, burnoutNew };
}

export const isVerdict = (s) => VERDICTS.includes(s);

/** Миграция: креативы для сдач, созданных до v2. Идемпотентна — обрабатывает только сдачи без креативов. */
export function migrateLegacyCreatives() {
  const subs = db.prepare(
    `SELECT s.* FROM submissions s WHERE NOT EXISTS (SELECT 1 FROM creatives c WHERE c.submission_id = s.id) ORDER BY s.task_id, s.round`
  ).all();
  if (!subs.length) return 0;
  let count = 0;
  const touched = new Set();
  db.transaction(() => {
    for (const s of subs) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(s.task_id);
      const files = db.prepare("SELECT * FROM files WHERE submission_id = ? AND kind = 'result' ORDER BY id").all(s.id);
      const items = submissionItems(files, s.links);
      if (!items.length) continue;
      count += createCreativesForSubmission({ task, submissionId: s.id, round: s.round, authorId: s.creative_id, items, at: s.created_at, log: false }).length;
      touched.add(task.id);
    }
    for (const taskId of touched) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      if (task.status === 'done') acceptTaskCreatives(task, { at: task.completed_at || task.updated_at, log: false });
    }
  })();
  return count;
}
