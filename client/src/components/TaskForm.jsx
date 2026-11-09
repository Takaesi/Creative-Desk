import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { PRIORITY, toLocalInput, fmtSize } from '../utils.js';
import { Field, Modal } from './ui.jsx';

const QUICK_DEADLINES = [
  { label: '+4 ч', h: 4 }, { label: '+1 день', h: 24 }, { label: '+2 дня', h: 48 }, { label: '+3 дня', h: 72 }, { label: '+неделя', h: 168 },
];

/** Форма ТЗ: создание (байер/руководитель) и редактирование. */
export default function TaskForm({ meta, task, onClose, onSaved }) {
  const editing = !!task;
  const [v, setV] = useState(() => ({
    title: task?.title || '',
    offer: task?.offer || '',
    geo: task?.geo || '',
    creative_type: task?.creative_type || meta.creativeTypes[0],
    quantity: task?.quantity || 1,
    description: task?.description || '',
    references_text: task?.references_text || '',
    priority: task?.priority || 'medium',
    deadline: toLocalInput(task?.deadline || new Date(Date.now() + 48 * 3600_000).toISOString()),
  }));
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!v.offer.trim() || !v.geo.trim()) return setError('Заполните оффер и GEO');
    if (!v.deadline) return setError('Укажите дедлайн');
    setBusy(true);
    try {
      const payload = { ...v, deadline: new Date(v.deadline).toISOString() };
      if (editing) {
        await api.patch(`/tasks/${task.id}`, payload);
        onSaved?.(task);
      } else {
        const fd = new FormData();
        Object.entries(payload).forEach(([k, val]) => fd.append(k, val));
        files.forEach((f) => fd.append('files', f));
        onSaved?.(await api.post('/tasks', fd));
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={720}
      title={editing ? `Редактирование задачи #${task.id}` : 'Новое ТЗ для креативщиков'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" form="task-form" disabled={busy}>{editing ? 'Сохранить' : 'Создать задачу'}</button>
        </>
      }
    >
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <Field label="Оффер" required>
          <input className="input" list="offers" value={v.offer} onChange={set('offer')} placeholder="Напр. SlimFit Keto" autoFocus />
          <datalist id="offers">{meta.offers.map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
        <Field label="GEO" required hint="Можно несколько через запятую">
          <input className="input" list="geos" value={v.geo} onChange={set('geo')} placeholder="BR, MX" />
          <datalist id="geos">{meta.geos.map((o) => <option key={o} value={o} />)}</datalist>
        </Field>
        <Field label="Тип креатива" required>
          <select className="input" value={v.creative_type} onChange={set('creative_type')}>
            {meta.creativeTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Количество" required>
          <input className="input" type="number" min={1} max={1000} value={v.quantity} onChange={set('quantity')} />
        </Field>
        <Field label="Название" className="span-2" hint="Если оставить пустым — сгенерируется из типа, оффера и GEO">
          <input className="input" value={v.title} onChange={set('title')} placeholder={`${v.creative_type} · ${v.offer || 'оффер'} · ${v.geo || 'GEO'}`} />
        </Field>
        <Field label="Описание / ТЗ" className="span-2">
          <textarea className="input" rows={5} value={v.description} onChange={set('description')} placeholder="Угол, хук, формат и хронометраж, язык, ограничения модерации, CTA…" />
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
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="Приоритет" required>
          <div className="segmented">
            {Object.entries(PRIORITY).reverse().map(([k, p]) => (
              <button type="button" key={k} className={`${v.priority === k ? 'on' : ''} ${p.cls}`} onClick={() => setV({ ...v, priority: k })}>{p.label}</button>
            ))}
          </div>
        </Field>
        <Field label="Дедлайн" required>
          <input className="input" type="datetime-local" value={v.deadline} onChange={set('deadline')} />
          <div className="quick-row">
            {QUICK_DEADLINES.map((q) => (
              <button type="button" key={q.h} className="link-btn" onClick={() => setV({ ...v, deadline: toLocalInput(new Date(Date.now() + q.h * 3600_000).toISOString()) })}>{q.label}</button>
            ))}
          </div>
        </Field>
        {error && <div className="form-error span-2">{error}</div>}
      </form>
    </Modal>
  );
}
