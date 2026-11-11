// Сопоставление элементов сдачи со слотами прошлых версий («Новая версия креатива №…» / «Новый креатив»).
// Используется формой сдачи на клиенте и тестами — одна логика.

/** Цель i-го элемента: выбор пользователя или, по умолчанию, слот по порядку; лишние — 'new'. */
export function slotTarget(slots, overrides, i) {
  const o = overrides?.[i];
  if (o !== undefined && o !== null && o !== '') return String(o);
  return slots[i] ? String(slots[i].slot) : 'new';
}

/** slot_map для POST /api/tasks/:id/submit: по элементу на каждый файл и ссылку, в порядке «файлы, затем ссылки». */
export function buildSlotMap(slots, itemCount, overrides = {}) {
  return Array.from({ length: itemCount }, (_, i) => {
    const t = slotTarget(slots, overrides, i);
    return t === 'new' ? 'new' : Number(t);
  });
}
