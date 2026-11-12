export const STATUS = {
  new: { label: 'Новые', short: 'Новая', color: 'var(--st-new)' },
  in_progress: { label: 'В работе', short: 'В работе', color: 'var(--st-progress)' },
  review: { label: 'На проверке', short: 'На проверке', color: 'var(--st-review)' },
  revision: { label: 'Правки', short: 'Правки', color: 'var(--st-revision)' },
  done: { label: 'Готово', short: 'Готово', color: 'var(--st-done)' },
};
export const STATUS_ORDER = ['new', 'in_progress', 'review', 'revision', 'done'];

// Части времени для панели «Учёт времени»: «Правки» делятся на ожидание и доработку
export const TIME_PARTS = [
  { k: 'new', label: 'Ожидание взятия', color: 'var(--st-new)' },
  { k: 'in_progress', label: 'В работе', color: 'var(--st-progress)' },
  { k: 'review', label: 'На проверке', color: 'var(--st-review)' },
  { k: 'revision', label: 'Правки: ожидание', color: 'var(--st-revision)' },
  { k: 'revision_work', label: 'Правки: доработка', color: 'var(--st-revision-work)' },
];

export const PRIORITY = {
  urgent: { label: 'Срочно', cls: 'p-urgent' },
  high: { label: 'Высокий', cls: 'p-high' },
  medium: { label: 'Средний', cls: 'p-medium' },
  low: { label: 'Низкий', cls: 'p-low' },
};

export const ROLE = { buyer: 'Байер', creative: 'Креативщик', lead: 'Руководитель' };

export const ACTION_LABEL = {
  created: 'создал(а) задачу',
  taken: 'взял(а) в работу',
  released: 'отказался(-ась) от задачи',
  submitted: 'сдал(а) работу на проверку',
  accepted: 'принял(а) работу',
  revision_requested: 'отправил(а) на правки',
  revision_started: 'начал(а) правки',
  assigned: 'назначил(а) исполнителя',
  edited: 'изменил(а) задачу',
  deleted: 'удалил(а) задачу',
  expense_added: 'добавил(а) AI-расходы',
  expense_removed: 'удалил(а) AI-расход',
  references_added: 'добавил(а) референсы',
  dictionary_changed: 'изменил(а) справочник',
  creative_status: 'сменил(а) статус креатива',
  creative_created: 'создан креатив',
  creatives_accepted: 'приняты креативы',
  creative_edited: 'изменил(а) креатив',
  metrics_saved: 'внёс(ла) результаты',
  metrics_deleted: 'удалил(а) результаты за день',
  metrics_imported: 'импортировал(а) результаты из CSV',
  template_changed: 'изменил(а) шаблон ТЗ',
  plan_changed: 'изменил(а) план креативщика',
  annotation_added: 'оставил(а) замечание на креативе',
  annotation_edited: 'изменил(а) замечание',
  annotation_resolved: 'отметил(а) замечание исправленным',
  annotation_reopened: 'вернул(а) замечание в работу',
  annotation_deleted: 'удалил(а) замечание',
};

export const FIELD_LABEL = {
  title: 'Название', offer: 'Оффер', geo: 'GEO', creative_type: 'Тип', quantity: 'Кол-во',
  description: 'Описание', references_text: 'Референсы', priority: 'Приоритет', deadline: 'Дедлайн',
  offer_id: 'Оффер (справочник)', approach_id: 'Подход', language: 'Язык', format: 'Формат', hook: 'Хук', estimate_units: 'Трудоёмкость',
  name: 'Название', vertical: 'Вертикаль', is_active: 'Активен', credit_price_rub: 'Цена кредита, ₽',
  hourly_rate_rub: 'Ставка, ₽/ч', capacity_units: 'Мощность', wip_limit: 'WIP-лимит', brief_score: 'Качество ТЗ',
};

export const DICT_ENTITY = { offer: 'оффер', approach: 'подход', ai_service: 'AI-сервис', user: 'сотрудник', settings: 'пороги' };

/** Человекочитаемая длительность: 2д 4ч, 3ч 15м, 12м */
export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч ${m % 60 ? `${m % 60}м` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d}д ${h % 24 ? `${h % 24}ч` : ''}`.trim();
}

const dtf = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' });
export const fmtDate = (iso) => (iso ? dtf.format(new Date(iso)).replace('.', '') : '—');
export const fmtDay = (iso) => (iso ? df.format(new Date(iso)).replace('.', '') : '—');

export function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60000) return 'только что';
  if (diff < 0) return `через ${fmtDuration(-diff)}`;
  return `${fmtDuration(diff)} назад`;
}

/** Сколько осталось до дедлайна (отрицательное — просрочка) */
export function deadlineInfo(task) {
  if (!task.deadline) return null;
  const end = task.completed_at ? Date.parse(task.completed_at) : Date.now();
  const left = Date.parse(task.deadline) - end;
  if (task.status === 'done') return { cls: left < 0 ? 'dl-late' : 'dl-ok', text: left < 0 ? `сдано с опозданием ${fmtDuration(-left)}` : 'в срок' };
  if (left < 0) return { cls: 'dl-late', text: `просрочено на ${fmtDuration(-left)}` };
  if (left < 6 * 3600_000) return { cls: 'dl-soon', text: `осталось ${fmtDuration(left)}` };
  return { cls: 'dl-ok', text: `осталось ${fmtDuration(left)}` };
}

/** Деньги: 12 500 ₽ */
export const fmtMoney = (n, cur = '₽') => (n == null || Number.isNaN(n) ? '—' : `${Math.round(n).toLocaleString('ru-RU')} ${cur}`);
/** Проценты из значения в процентах, один знак: 47,2 % */
export const fmtPct1 = (x) => (x == null || Number.isNaN(x) ? '—' : `${Number(x).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
export const creativeCode = (id) => `CD-${id}`;
export const PLURAL = (n, one, few, many) => {
  const m10 = n % 10; const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export const fmtNum = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d }));
export const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const fmtSize = (b) => (b < 1024 ? `${b} Б` : b < 1048576 ? `${(b / 1024).toFixed(0)} КБ` : `${(b / 1048576).toFixed(1)} МБ`);

export const initials = (name = '') => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** datetime-local <-> ISO */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const splitLinks = (text = '') => text.split(/\s+/).map((s) => s.trim()).filter(Boolean);
export const isUrl = (s) => /^https?:\/\//i.test(s);

// ---------- креативы ----------
export const CREATIVE_STATUS = {
  draft: { label: 'Черновик', color: '#8a93a6' },
  superseded: { label: 'Старая версия', color: '#a3a9b6' },
  accepted: { label: 'Принят', color: '#2a78d6' },
  in_test: { label: 'В тесте', color: '#7c5cf0' },
  winner: { label: 'Победитель', color: '#16a34a' },
  average: { label: 'Средний', color: '#d4a106' },
  loser: { label: 'Не зашёл', color: '#dc2626' },
  burned: { label: 'Выгорел', color: '#ea6a12' },
  archived: { label: 'В архиве', color: '#6b7280' },
};
export const LIBRARY_STATUSES = ['accepted', 'in_test', 'winner', 'average', 'loser', 'burned', 'draft', 'superseded', 'archived'];
export const VERDICT_LABEL = { winner: 'Победитель', average: 'Средний', loser: 'Не зашёл' };
export const isoDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const fmtDayFull = (day) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '') : '—');
