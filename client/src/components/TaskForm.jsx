import { useMemo, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { defaultUnits } from '@shared/brief.js';
import { api } from '../api.js';
import { useDicts } from '../dicts.jsx';
import { PRIORITY, toLocalInput, fmtSize } from '../utils.js';
import { Field, Modal } from './ui.jsx';

const QUICK_DEADLINES = [
  { label: '+4 ч', h: 4 }, { label: '+1 день', h: 24 }, { label: '+2 дня', h: 48 }, { label: '+3 дня', h: 72 }, { label: '+неделя', h: 168 },
];

const EMPTY = {
  title: '', offer: '', offer_id: null, approach_id: '', geo: '', creative_type: '', quantity: 1, description: '', references_text: '',
  language: '', format: '', hook: '', estimate_units: '', priority: 'medium', deadline: '',
};

function fromTask(t) {
  const v = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (t?.[k] !== undefined && t?.[k] !== null) v[k] = t[k];
  v.approach_id = t?.approach_id ? String(t.approach_id) : '';
  v.deadline = t?.deadline ? toLocalInput(t.deadline) : '';
  v.estimate_units = t?.estimate_units ? String(t.estimate_units) : '';
  return v;
}

/**
 * Форма ТЗ: создание (байер/руководитель) и редактирование.
 * initial — предзаполнение новой задачи (вариации, дублирование, шаблон).
 */
export default function TaskForm({ task, initial, onClose, onSaved, title: customTitle }) {
  const { dicts } = useDicts();
  const editing = !!task;
  const [v, setV] = useState(() => {
    const base = fromTask(task || initial || {});
    if (!base.creative_type) base.creative_type = dicts?.creativeTypes[0] || 'Видео';
    if (!base.deadline) base.deadline = toLocalInput(new Date(Date.now() + 48 * 3600_000).toISOString());
    return base;
  });
  // трудоёмкость пересчитывается от типа и количества, пока пользователь не ввёл её вручную
  const [unitsTouched, setUnitsTouched] = useState(!!(task || initial?.estimate_units));
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const offers = useMemo(() => (dicts?.offers || []).filter((o) => o.is_active || o.id === task?.offer_id), [dicts, task]);
  const approaches = useMemo(() => (dicts?.approaches || []).filter((a) => a.is_active || a.id === task?.approach_id), [dicts, task]);
  const autoUnits = defaultUnits(v.creative_type, v.quantity);

  const patch = (p) => setV((prev) => ({ ...prev, ...p }));
  const set = (k) => (e) => patch({ [k]: e.target.value });
  const setOffer = (e) => {
    const name = e.target.value;
    const o = offers.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    patch({ offer: name, offer_id: o ? o.id : null });
  };

  const payload = () => ({
    ...v,
    offer: offers.find((o) => o.id === v.offer_id)?.name || v.offer,
    deadline: v.deadline ? new Date(v.deadline).toISOString() : '',
    estimate_units: unitsTouched && v.estimate_units ? v.estimate_units : autoUnits,
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!v.offer_id) return setError('Выберите оффер из списка');
    if (!v.geo.trim()) return setError('Заполните GEO');
    if (!v.deadline) return setError('Укажите дедлайн');
    setBusy(true);
    try {
      const p = payload();
      if (editing) {
        await api.patch(`/tasks/${task.id}`, p);
        onSaved?.(task);
      } else {
        const fd = new FormData();
        Object.entries(p).forEach(([k, val]) => { if (val !== null && val !== undefined) fd.append(k, val); });
        files.forEach((f) => fd.append('files', f));
        onSaved?.(await api.post('/tasks', fd));
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!dicts) return <Modal open onClose={onClose}><div className="splash small"><div className="spinner" /></div></Modal>;

  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title={customTitle || (editing ? `Редактирование задачи #${task.id}` : 'Новое ТЗ для креативщиков')}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" form="task-form" disabled={busy}>{editing ? 'Сохранить' : 'Создать задачу'}</button>
        </>
      }
    >
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <Field label="Оффер" required hint={v.offer && !v.offer_id ? 'Нет в справочнике — выберите из списка' : undefined}>
          <input className={`input ${v.offer && !v.offer_id ? 'input-bad' : ''}`} list="offers" value={v.offer} onChange={setOffer} placeholder="Начните вводить название" autoFocus={!editing} />
          <datalist id="offers">{offers.map((o) => <option key={o.id} value={o.name}>{o.vertical}</option>)}</datalist>
        </Field>
        <Field label="Подход">
          <select className="input" value={v.approach_id} onChange={set('approach_id')}>
            <option value="">— не выбран —</option>
            {approaches.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="GEO" required hint="Можно несколько через запятую">
          <input className="input" list="geos" value={v.geo} onChange={set('geo')} placeholder="BR, MX" />
          <datalist id="geos">{dicts.geos.map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
        <Field label="Язык">
          <input className="input" value={v.language} onChange={set('language')} placeholder="португальский, EN…" />
        </Field>
        <Field label="Тип креатива" required>
          <select className="input" value={v.creative_type} onChange={set('creative_type')}>
            {dicts.creativeTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <div className="form-pair">
          <Field label="Количество" required>
            <input className="input" type="number" min={1} max={1000} value={v.quantity} onChange={set('quantity')} />
          </Field>
          <Field label="Трудоёмкость" hint={unitsTouched ? <button type="button" className="link-btn" onClick={() => { setUnitsTouched(false); patch({ estimate_units: '' }); }}>по типу: {autoUnits}</button> : 'units, по типу × кол-во'}>
            <input className="input" type="number" min={1} max={1000} value={unitsTouched ? v.estimate_units : autoUnits}
              onChange={(e) => { setUnitsTouched(true); patch({ estimate_units: e.target.value }); }} />
          </Field>
        </div>
        <Field label="Формат" className="span-2" hint="Размеры и для видео — длительность">
          <input className="input" value={v.format} onChange={set('format')} placeholder="9:16, 1080×1920, до 30 сек" />
        </Field>
        <Field label="Хук / ключевая идея" className="span-2">
          <input className="input" value={v.hook} onChange={set('hook')} placeholder="Что должно зацепить в первые 3 секунды" />
        </Field>
        <Field label="Название" className="span-2" hint="Если оставить пустым — сгенерируется из типа, оффера и GEO">
          <input className="input" value={v.title} onChange={set('title')} placeholder={`${v.creative_type} · ${v.offer || 'оффер'} · ${v.geo || 'GEO'}`} />
        </Field>
        <Field label="Описание / ТЗ" className="span-2">
          <textarea className="input" rows={5} value={v.description} onChange={set('description')} placeholder="Что показать, кому, какое действие; ограничения модерации, CTA…" />
        </Field>
        <Field label="Референсы (ссылки)" className="span-2" hint="Каждая ссылка с новой строки">
          <textarea className="input" rows={2} value={v.references_text} onChange={set('references_text')} placeholder="https://www.facebook.com/ads/library/…" />
        </Field>
        {!editing && (
          <div className="field span-2">
            <span className="field-label">Файлы-референсы</span>
            <label className="dropzone">
              <Upload size={18} />
              <span>Перетащите или выберите файлы (до 10, по 25 МБ)</span>
              <input type="file" multiple onChange={(e) => setFiles([...files, ...e.target.files].slice(0, 10))} />
            </label>
            {files.length > 0 && (
              <div className="file-list">
                {files.map((f, i) => (
                  <span key={i} className="file-chip">{f.name} <small>{fmtSize(f.size)}</small>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Убрать файл"><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="Приоритет" required>
          <div className="segmented">
            {Object.entries(PRIORITY).reverse().map(([k, p]) => (
              <button type="button" key={k} className={`${v.priority === k ? 'on' : ''} ${p.cls}`} onClick={() => patch({ priority: k })}>{p.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Дедлайн" required>
          <input className="input" type="datetime-local" value={v.deadline} onChange={set('deadline')} />
          <div className="quick-row">
            {QUICK_DEADLINES.map((q) => (
              <button type="button" key={q.h} className="link-btn" onClick={() => patch({ deadline: toLocalInput(new Date(Date.now() + q.h * 3600_000).toISOString()) })}>{q.label}</button>
            ))}
          </div>
        </Field>
        {error && <div className="form-error span-2">{error}</div>}
      </form>
    </Modal>
  );
}
