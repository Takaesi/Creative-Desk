import { useEffect, useMemo, useState } from 'react';
import { Upload, X, Copy, Save, FileText } from 'lucide-react';
import { defaultUnits, scoreBrief } from '@shared/brief.js';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDicts } from '../dicts.jsx';
import { PRIORITY, toLocalInput, fmtSize } from '../utils.js';
import { Field, Modal, useToast } from './ui.jsx';
import { ParentCreative } from './creative.jsx';

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
export default function TaskForm({ task, initial, parent, onClose, onSaved, title: customTitle }) {
  const { dicts } = useDicts();
  const { user } = useAuth();
  const toast = useToast();
  const editing = !!task;
  const [templates, setTemplates] = useState([]);
  const [recent, setRecent] = useState(null);
  const [templateId, setTemplateId] = useState(initial?.template_id || null);
  const [touched, setTouched] = useState(() => new Set());
  const [savingTpl, setSavingTpl] = useState(null); // { name, shared }

  useEffect(() => {
    if (editing) return;
    api.get('/templates').then(setTemplates).catch(() => {});
  }, [editing]);
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

  const patch = (p) => {
    setV((prev) => ({ ...prev, ...p }));
    setTouched((prev) => new Set([...prev, ...Object.keys(p)]));
  };
  const set = (k) => (e) => patch({ [k]: e.target.value });

  // Поле «заполнено», если пользователь его менял или в нём не значение по умолчанию
  const isFilled = (k) => {
    if (['priority', 'deadline', 'creative_type', 'quantity'].includes(k)) return touched.has(k);
    if (k === 'offer') return !!v.offer_id || !!String(v.offer).trim();
    return !!String(v[k] ?? '').trim();
  };
  /** Применение шаблона / прошлого ТЗ: заполняем пустые поля, заполненные — только с подтверждения. */
  const applyFields = (fields, label) => {
    const incoming = fromTask(fields);
    const keys = Object.keys(EMPTY).filter((k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== '' && k !== 'offer_id');
    const conflicts = keys.filter((k) => isFilled(k) && String(incoming[k]) !== String(v[k]));
    const replace = conflicts.length > 0 && window.confirm(`Заменить заполненные поля (${conflicts.length})?`);
    const next = { ...v };
    for (const k of keys) if (!isFilled(k) || replace) next[k] = incoming[k];
    if (keys.includes('offer') && (!isFilled('offer') || replace)) next.offer_id = fields.offer_id ?? null;
    setV(next);
    if (fields.estimate_units) setUnitsTouched(true);
    toast(`${label} применён`);
  };
  const applyTemplate = async (id) => {
    if (!id) return;
    try { const f = await api.post(`/templates/${id}/use`); setTemplateId(Number(id)); applyFields(f, 'Шаблон'); } catch (e) { toast(e.message, 'error'); }
  };
  const copyTask = async (id) => {
    try { applyFields(await api.get(`/tasks/${id}/duplicate`), 'Прошлое ТЗ'); setRecent(null); } catch (e) { toast(e.message, 'error'); }
  };
  const openRecent = async () => {
    try {
      const all = await api.get('/tasks?mine=1');
      setRecent(all.filter((t) => t.buyer_id === user.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20));
    } catch (e) { toast(e.message, 'error'); }
  };
  const saveTemplate = async () => {
    const p = payload();
    const hours = p.deadline ? Math.max(1, Math.round((Date.parse(p.deadline) - Date.now()) / 3600_000)) : null;
    try {
      await api.post('/templates', {
        name: savingTpl.name, is_shared: savingTpl.shared, offer_id: v.offer_id, approach_id: v.approach_id || null, geo: v.geo, creative_type: v.creative_type,
        quantity: Number(v.quantity) || null, language: v.language, format: v.format, hook: v.hook, description: v.description,
        references_text: v.references_text, priority: v.priority, deadline_hours: hours,
      });
      toast('Шаблон сохранён');
      setSavingTpl(null);
      api.get('/templates').then(setTemplates).catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };
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
    ...(parent ? { parent_creative_id: parent.id } : {}),
    ...(templateId && !editing ? { template_id: templateId } : {}),
  });
  const brief = scoreBrief({
    ...v, approach_id: v.approach_id || null, ref_files: files.length + (task?.references?.length || 0),
    parent_creative_id: parent?.id || task?.parent_creative_id, created_at: task?.created_at,
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!v.offer_id) return setError('Выберите оффер из списка');
    if (!v.geo.trim()) return setError('Заполните GEO');
    if (!v.deadline) return setError('Укажите дедлайн');
    if (!editing && brief.score < 60 && !window.confirm(`ТЗ заполнено на ${brief.score} %. Креативщику может не хватить информации. Отправить всё равно?`)) return;
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
      width={1040}
      title={customTitle || (editing ? `Редактирование задачи #${task.id}` : 'Новое ТЗ для креативщиков')}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" form="task-form" disabled={busy}>{editing ? 'Сохранить' : 'Создать задачу'}</button>
        </>
      }
    >
      <div className="tf-layout">
      <form id="task-form" className="form-grid" onSubmit={submit}>
        {!editing && (templates.length > 0 || user.role !== 'creative') && (
          <div className="tf-sources span-2">
            <select className="input input-sm" value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Из шаблона">
              <option value="">Из шаблона…</option>
              {templates.some((t) => t.mine) && <optgroup label="Мои">{templates.filter((t) => t.mine).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              {templates.some((t) => !t.mine) && <optgroup label="Общие и команды">{templates.filter((t) => !t.mine).map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_shared ? '' : ` · ${t.owner_name}`}</option>)}</optgroup>}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={openRecent}><Copy size={14} /> Скопировать прошлое ТЗ</button>
            {templateId && <span className="muted small"><FileText size={13} /> по шаблону</span>}
          </div>
        )}
        {recent && (
          <div className="tf-recent span-2">
            <div className="tf-recent-head"><b>Ваши последние ТЗ</b><button type="button" className="icon-btn icon-btn-sm" onClick={() => setRecent(null)} aria-label="Закрыть"><X size={14} /></button></div>
            {recent.length === 0 && <p className="muted small">Пока нет ваших задач</p>}
            {recent.map((t) => (
              <button type="button" key={t.id} className="tf-recent-item" onClick={() => copyTask(t.id)}>
                <span className="card-id">#{t.id}</span> {t.title}
              </button>
            ))}
          </div>
        )}
        {parent && <ParentCreative c={parent} className="span-2" />}
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
        {!editing && (
          <div className="span-2 tf-save-tpl">
            {savingTpl ? (
              <>
                <input className="input input-sm" autoFocus placeholder="Название шаблона" value={savingTpl.name} onChange={(e) => setSavingTpl({ ...savingTpl, name: e.target.value })} />
                {user.role === 'lead' && (
                  <label className="chip"><input type="checkbox" checked={savingTpl.shared} onChange={(e) => setSavingTpl({ ...savingTpl, shared: e.target.checked })} />{savingTpl.shared ? '✓ ' : ''}Общий для всех</label>
                )}
                <button type="button" className="btn btn-soft btn-sm" disabled={!savingTpl.name.trim()} onClick={saveTemplate}>Сохранить</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSavingTpl(null)}>Отмена</button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={() => setSavingTpl({ name: v.title || '', shared: false })}><Save size={13} /> Сохранить как шаблон</button>
            )}
          </div>
        )}
      </form>
      <BriefPanel brief={brief} />
      </div>
    </Modal>
  );
}

/** Панель «Качество ТЗ»: круговой индикатор и чек-лист. Отправку не блокирует. */
export function BriefPanel({ brief, compact = false }) {
  const tone = brief.score >= 80 ? 'good' : brief.score >= 60 ? 'mid' : 'bad';
  const R = 26; const C = 2 * Math.PI * R;
  return (
    <aside className={`brief-panel ${compact ? 'brief-compact' : ''}`} aria-label="Качество ТЗ">
      <div className="brief-head">
        <svg width="64" height="64" viewBox="0 0 64 64" className={`brief-ring brief-${tone}`} role="img" aria-label={`Качество ТЗ ${brief.score} из 100`}>
          <circle cx="32" cy="32" r={R} className="brief-track" />
          <circle cx="32" cy="32" r={R} className="brief-value" strokeDasharray={`${(brief.score / 100) * C} ${C}`} transform="rotate(-90 32 32)" />
          <text x="32" y="37" textAnchor="middle">{brief.score}</text>
        </svg>
        <div>
          <b>Качество ТЗ</b>
          <small className="muted">{tone === 'good' ? 'Креативщику всё понятно' : tone === 'mid' ? 'Неплохо, но можно точнее' : 'Высок риск лишнего круга правок'}</small>
        </div>
      </div>
      <ul className="brief-list">
        {brief.checks.map((c) => (
          <li key={c.key} className={c.ok ? 'ok' : ''}>
            <span className="brief-mark" aria-hidden>{c.ok ? '✓' : '○'}</span>
            <span>
              {c.label} <small className="muted">+{c.weight}</small>
              {!c.ok && !compact && <small className="brief-hint">{c.hint}</small>}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
