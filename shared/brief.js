// Общий модуль: импортируется и сервером (Node), и клиентом (Vite, алиас @shared).
// Только чистые функции без зависимостей.

/** Веса трудоёмкости по типам креатива (единицы на одну штуку). */
export const TYPE_UNITS = {
  'Статика': 1,
  'Баннер': 1,
  'Иконки/скриншоты': 1,
  'Анимация': 2,
  'UGC': 3,
  'Видео': 3,
  'Прелендинг': 4,
  'Плейабл': 5,
};

export const defaultUnits = (type, quantity) => Math.max(1, (TYPE_UNITS[type] || 1) * (Number(quantity) || 1));

const VIDEO_TYPES = ['Видео', 'UGC', 'Анимация'];
const DURATION_RE = /\d+\s*(с|сек|s|sec)/i;
const H = 3600_000;

/**
 * Оценка качества ТЗ по чек-листу (0–100).
 * task: { offer_id, description, hook, approach_id, references_text, ref_files, parent_creative_id,
 *         language, format, creative_type, deadline, created_at, priority }
 * @returns {{ score: number, checks: {key:string, label:string, weight:number, ok:boolean, hint:string}[] }}
 */
export function scoreBrief(task, now = Date.now()) {
  const t = task || {};
  const str = (v) => String(v ?? '').trim();
  const isVideo = VIDEO_TYPES.includes(t.creative_type);
  const created = t.created_at ? Date.parse(t.created_at) : now;
  const deadline = t.deadline ? Date.parse(t.deadline) : NaN;

  const checks = [
    { key: 'offer', label: 'Оффер из справочника', weight: 10, ok: !!t.offer_id, hint: 'Выберите оффер из списка' },
    { key: 'description', label: 'Подробное описание (от 80 символов)', weight: 20, ok: str(t.description).length >= 80, hint: 'Опишите задачу подробнее: что показать, кому, какое действие' },
    { key: 'hook', label: 'Хук / ключевая идея', weight: 15, ok: !!str(t.hook), hint: 'Какая мысль должна зацепить в первые 3 секунды?' },
    { key: 'approach', label: 'Подход', weight: 10, ok: !!t.approach_id, hint: 'Выберите подход — так проще анализировать результаты' },
    { key: 'references', label: 'Референс', weight: 15, ok: !!str(t.references_text) || Number(t.ref_files) > 0 || !!t.parent_creative_id, hint: 'Добавьте пример — референс экономит круг правок' },
    { key: 'language', label: 'Язык', weight: 10, ok: !!str(t.language), hint: 'На каком языке текст и озвучка?' },
    {
      key: 'format',
      label: isVideo ? 'Формат и длительность' : 'Формат',
      weight: 10,
      ok: !!str(t.format) && (!isVideo || DURATION_RE.test(str(t.format)) || DURATION_RE.test(str(t.description))),
      hint: 'Укажите размеры и длительность',
    },
    {
      key: 'deadline',
      label: 'Реалистичный срок',
      weight: 10,
      ok: t.priority === 'urgent' || (!Number.isNaN(deadline) && deadline - created >= 4 * H),
      hint: 'Слишком короткий срок — поставьте приоритет «Срочно» или сдвиньте дедлайн',
    },
  ];
  const score = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  return { score, checks };
}
