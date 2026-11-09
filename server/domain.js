// Справочники и бизнес-логика, не зависящая от HTTP.

export const STATUSES = ['new', 'in_progress', 'review', 'revision', 'done'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const CREATIVE_TYPES = ['Видео', 'Статика', 'Баннер', 'UGC', 'Анимация', 'Плейабл', 'Прелендинг', 'Иконки/скриншоты'];
export const AI_SERVICES = ['Midjourney', 'Runway', 'Kling', 'Sora', 'ElevenLabs', 'HeyGen', 'ChatGPT', 'Claude', 'Stable Diffusion', 'Suno', 'Leonardo', 'Pika'];
export const GEOS = ['RU', 'KZ', 'UA', 'BR', 'MX', 'IN', 'ID', 'TR', 'DE', 'PL', 'US', 'ES', 'IT', 'FR', 'PH', 'VN'];

/**
 * Считает, сколько времени задача провела в каждом статусе, по истории переходов.
 * Текущий статус учитывается до `now`.
 * Псевдостатус revision_work — доработка: от «Начать правки» до повторной сдачи (статус при этом остаётся revision).
 * @returns {{byStatus: Record<string, number>, waitToTake:number|null, leadTime:number|null, cycleTime:number|null, toFirstSubmit:number|null, workTime:number, reviewTime:number, revisionWaitTime:number, revisionWorkTime:number}} — значения в мс
 */
export function computeDurations(task, statusHistory, now = Date.now()) {
  const byStatus = Object.fromEntries([...STATUSES, 'revision_work'].map((s) => [s, 0]));
  // revision_started не меняет статус, но делит время «Правок» на ожидание и доработку
  const events = statusHistory
    .filter((h) => h.to_status || h.action === 'revision_started')
    .map((h) => ({ at: Date.parse(h.created_at), status: h.to_status || 'revision_work' }))
    .sort((a, b) => a.at - b.at);

  let cursorStatus = 'new';
  let cursorAt = Date.parse(task.created_at);
  for (const e of events) {
    if (e.at >= cursorAt) byStatus[cursorStatus] += e.at - cursorAt;
    cursorStatus = e.status;
    cursorAt = Math.max(cursorAt, e.at);
  }
  if (cursorStatus !== 'done') byStatus[cursorStatus] += Math.max(0, now - cursorAt);

  const created = Date.parse(task.created_at);
  return {
    byStatus,
    waitToTake: task.taken_at ? Date.parse(task.taken_at) - created : null,
    leadTime: task.completed_at ? Date.parse(task.completed_at) - created : null,
    cycleTime: task.completed_at && task.taken_at ? Date.parse(task.completed_at) - Date.parse(task.taken_at) : null,
    toFirstSubmit: task.first_submitted_at ? Date.parse(task.first_submitted_at) - created : null,
    workTime: byStatus.in_progress + byStatus.revision_work,
    reviewTime: byStatus.review,
    revisionWaitTime: byStatus.revision,
    revisionWorkTime: byStatus.revision_work,
  };
}

export function isOverdue(task, now = Date.now()) {
  if (!task.deadline) return false;
  const dl = Date.parse(task.deadline);
  if (task.status === 'done') return task.completed_at ? Date.parse(task.completed_at) > dl : false;
  return now > dl;
}

/**
 * Матрица допустимых действий: кто и из какого статуса может что сделать.
 * Возвращает список доступных действий для пользователя над задачей.
 */
export function allowedActions(task, user) {
  const a = [];
  const isOwner = task.buyer_id === user.id;
  const isAssignee = task.creative_id === user.id;
  const isLead = user.role === 'lead';
  const canManage = isOwner || isLead;

  if (user.role === 'creative') {
    if (task.status === 'new') a.push('take');
    if (isAssignee && task.status === 'revision' && !task.revision_started_at) a.push('take');
    if (isAssignee && (task.status === 'in_progress' || (task.status === 'revision' && task.revision_started_at))) a.push('submit');
    if (isAssignee && task.status === 'in_progress' && task.revision_count === 0) a.push('release');
  }
  if (canManage && task.status === 'review') a.push('accept', 'revision');
  if (canManage && task.status !== 'done') a.push('edit');
  if ((isOwner && task.status === 'new') || isLead) a.push('delete');
  if (isLead && task.status !== 'done') a.push('assign');
  if ((isAssignee || isLead) && task.status !== 'new') a.push('expense');
  if (canManage && task.status !== 'done') a.push('upload_reference');
  return a;
}
