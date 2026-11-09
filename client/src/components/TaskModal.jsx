import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Play, Send, CheckCircle2, RotateCcw, Pencil, Trash2, UserPlus, Undo2, Link2, FileText, Download,
  Upload, Coins, Plus, MessageSquare, History, Timer, Paperclip,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  STATUS, STATUS_ORDER, TIME_PARTS, ROLE, ACTION_LABEL, FIELD_LABEL, PRIORITY, fmtDate, fmtDuration, fmtNum, fmtSize,
  deadlineInfo, splitLinks, isUrl, relTime,
} from '../utils.js';
import { Avatar, PriorityBadge, StatusBadge, Modal, Field, useToast } from './ui.jsx';
import TaskForm from './TaskForm.jsx';

export default function TaskModal({ id, meta, users, intent, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(intent); // submit | revision | accept | assign | edit
  const [tab, setTab] = useState('comments');

  const load = useCallback(async () => {
    try { setTask(await api.get(`/tasks/${id}`)); }
    catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const after = (msg) => { toast(msg); setDialog(null); load(); onChanged?.(); };
  const run = async (fn, msg) => {
    try { await fn(); after(msg); } catch (e) { toast(e.message, 'error'); }
  };

  if (error) return <Modal open onClose={onClose} title="Ошибка"><p>{error}</p></Modal>;
  if (!task) return <Modal open onClose={onClose} className="task-modal"><div className="splash small"><div className="spinner" /></div></Modal>;

  const A = new Set(task.actions);
  const dl = deadlineInfo(task);

  return (
    <Modal open onClose={onClose} className="task-modal" width={1120}>
      <div className="tm-head">
        <div className="tm-head-main">
          <div className="tm-badges">
            <span className="card-id">#{task.id}</span>
            <StatusBadge s={task.status} />
            <PriorityBadge p={task.priority} />
            {task.revision_count > 0 && <span className="badge badge-rev"><RotateCcw size={11} /> правок: {task.revision_count}</span>}
            {task.status === 'revision' && <span className="badge badge-rev">{task.revision_started_at ? 'доработка идёт' : 'ждёт доработки'}</span>}
            {dl && <span className={`badge ${dl.cls}`}>{dl.text}</span>}
          </div>
          <h2>{task.title}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={20} /></button>
      </div>

      <StatusTrack status={task.status} />

      <div className="tm-actions">
        {A.has('take') && (
          <button className="btn btn-primary" onClick={() => run(() => api.post(`/tasks/${task.id}/take`), task.status === 'revision' ? 'Доработка начата' : 'Задача в работе')}>
            <Play size={15} /> {task.status === 'revision' ? 'Начать правки' : 'Взять в работу'}
          </button>
        )}
        {A.has('submit') && <button className="btn btn-primary" onClick={() => setDialog('submit')}><Send size={15} /> Сдать работу</button>}
        {A.has('accept') && <button className="btn btn-success" onClick={() => setDialog('accept')}><CheckCircle2 size={15} /> Принять</button>}
        {A.has('revision') && <button className="btn btn-warn" onClick={() => setDialog('revision')}><RotateCcw size={15} /> На правки</button>}
        {A.has('assign') && <button className="btn btn-ghost" onClick={() => setDialog('assign')}><UserPlus size={15} /> {task.creative_id ? 'Переназначить' : 'Назначить'}</button>}
        {A.has('release') && (
          <button className="btn btn-ghost" onClick={() => confirm('Вернуть задачу в «Новые»?') && run(() => api.post(`/tasks/${task.id}/release`), 'Задача возвращена')}>
            <Undo2 size={15} /> Отказаться
          </button>
        )}
        <span className="spacer" />
        {A.has('edit') && <button className="btn btn-ghost" onClick={() => setDialog('edit')}><Pencil size={15} /> Редактировать</button>}
        {A.has('delete') && (
          <button className="btn btn-ghost btn-danger-text" onClick={async () => {
            if (!confirm(`Удалить задачу #${task.id}? Действие необратимо.`)) return;
            try { await api.del(`/tasks/${task.id}`); toast('Задача удалена'); onChanged?.(); onClose(); } catch (e) { toast(e.message, 'error'); }
          }}>
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="tm-grid">
        <div className="tm-left">
          <section className="panel">
            <div className="kv-grid">
              <KV k="Оффер" v={task.offer} />
              <KV k="GEO" v={task.geo} />
              <KV k="Тип креатива" v={task.creative_type} />
              <KV k="Количество" v={`${task.quantity} шт.`} />
              <KV k="Дедлайн" v={fmtDate(task.deadline)} />
              <KV k="Приоритет" v={PRIORITY[task.priority].label} />
              <KV k="Байер" v={<Person name={task.buyer_name} color={task.buyer_color} />} />
              <KV k="Исполнитель" v={task.creative_name ? <Person name={task.creative_name} color={task.creative_color} /> : <span className="muted">не назначен</span>} />
            </div>
            {task.description && <div className="desc">{task.description}</div>}
          </section>

          <section className="panel">
            <PanelHead icon={Paperclip} title="Референсы">
              {A.has('upload_reference') && <UploadRefs taskId={task.id} onDone={() => after('Референсы добавлены')} />}
            </PanelHead>
            <LinkList text={task.references_text} />
            <FileList files={task.references} />
            {!task.references_text && task.references.length === 0 && <p className="muted small">Нет референсов</p>}
          </section>

          <section className="panel">
            <PanelHead icon={Send} title={`Результаты${task.submissions.length ? ` · ${task.submissions.length}` : ''}`} />
            {task.submissions.length === 0 && <p className="muted small">Работа ещё не сдавалась</p>}
            <div className="rounds">
              {[...task.submissions].reverse().map((s) => (
                <div key={s.id} className="round">
                  <div className="round-head">
                    <b>{s.round === 1 ? 'Первая сдача' : `Правки · раунд ${s.round - 1}`}</b>
                    <span className="muted small">{s.creative_name} · {fmtDate(s.created_at)}</span>
                  </div>
                  {s.comment && <p className="round-text">{s.comment}</p>}
                  <LinkList text={s.links} />
                  <FileList files={s.files} preview />
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="tabs">
              <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}><MessageSquare size={14} /> Комментарии · {task.comments.length}</button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}><History size={14} /> История · {task.history.length}</button>
            </div>
            {tab === 'comments' ? <Comments task={task} onPosted={load} /> : <HistoryList items={task.history} />}
          </section>
        </div>

        <div className="tm-right">
          <TimePanel task={task} />
          <ExpensesPanel task={task} meta={meta} canAdd={A.has('expense')} user={user} onChanged={() => { load(); onChanged?.(); }} />
        </div>
      </div>

      {dialog === 'submit' && <SubmitDialog task={task} onClose={() => setDialog(null)} onDone={() => after('Работа отправлена на проверку')} meta={meta} />}
      {dialog === 'revision' && <RevisionDialog task={task} onClose={() => setDialog(null)} onDone={() => after('Отправлено на правки')} />}
      {dialog === 'accept' && <AcceptDialog task={task} onClose={() => setDialog(null)} onDone={() => after('Работа принята 🎉')} onRevision={() => setDialog('revision')} />}
      {dialog === 'assign' && <AssignDialog task={task} users={users} onClose={() => setDialog(null)} onDone={() => after('Исполнитель назначен')} />}
      {dialog === 'edit' && meta && <TaskForm meta={meta} task={task} onClose={() => setDialog(null)} onSaved={() => after('Изменения сохранены')} />}
    </Modal>
  );
}

const KV = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;
const Person = ({ name, color }) => <span className="person"><Avatar name={name} color={color} size={20} />{name}</span>;
const PanelHead = ({ icon: Icon, title, children }) => (
  <div className="panel-head"><h4>{Icon && <Icon size={15} />}{title}</h4>{children}</div>
);

function StatusTrack({ status }) {
  const idx = STATUS_ORDER.indexOf(status);
  return (
    <div className="track">
      {STATUS_ORDER.map((s, i) => (
        <div key={s} className={`track-step ${i < idx ? 'past' : ''} ${s === status ? 'current' : ''}`} style={{ '--c': STATUS[s].color }}>
          <i />{STATUS[s].label}
        </div>
      ))}
    </div>
  );
}

function LinkList({ text }) {
  const links = splitLinks(text);
  if (!links.length) return null;
  return (
    <ul className="links">
      {links.map((l, i) => (
        <li key={i}><Link2 size={13} />{isUrl(l) ? <a href={l} target="_blank" rel="noreferrer">{l}</a> : <span>{l}</span>}</li>
      ))}
    </ul>
  );
}

function FileList({ files, preview }) {
  if (!files?.length) return null;
  return (
    <div className="files">
      {files.map((f) => (
        <a key={f.id} className="file" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
          {preview && f.mime?.startsWith('image/') ? <img src={`/api/files/${f.id}`} alt="" /> : <FileText size={18} />}
          <span><b>{f.original_name}</b><small>{fmtSize(f.size)} · {f.uploader}</small></span>
          <Download size={14} className="muted" />
        </a>
      ))}
    </div>
  );
}

function UploadRefs({ taskId, onDone }) {
  const toast = useToast();
  return (
    <label className="btn btn-ghost btn-sm">
      <Upload size={14} /> Добавить файлы
      <input type="file" multiple hidden onChange={async (e) => {
        const fd = new FormData();
        [...e.target.files].forEach((f) => fd.append('files', f));
        try { await api.post(`/tasks/${taskId}/references`, fd); onDone(); } catch (err) { toast(err.message, 'error'); }
        e.target.value = '';
      }} />
    </label>
  );
}

// ---------- Учёт времени ----------
function TimePanel({ task }) {
  const d = task.durations;
  const resubmitted = task.submitted_at && task.first_submitted_at && task.submitted_at !== task.first_submitted_at;
  const milestones = [
    { k: 'Создана', at: task.created_at },
    { k: 'Взята в работу', at: task.taken_at },
    { k: 'Первая сдача', at: task.first_submitted_at },
    ...(resubmitted ? [{ k: 'Последняя сдача', at: task.submitted_at }] : []),
    ...(task.status === 'revision' && task.revision_started_at ? [{ k: 'Начата доработка', at: task.revision_started_at }] : []),
    { k: 'Завершена', at: task.completed_at },
  ];
  const parts = TIME_PARTS.filter((p) => d.byStatus[p.k] > 0);
  const total = parts.reduce((s, p) => s + d.byStatus[p.k], 0) || 1;
  return (
    <section className="panel">
      <PanelHead icon={Timer} title="Учёт времени" />
      <ol className="milestones">
        {milestones.map((m) => (
          <li key={m.k} className={m.at ? 'on' : ''}>
            <span>{m.k}</span>
            <b>{m.at ? fmtDate(m.at) : '—'}</b>
          </li>
        ))}
      </ol>
      <div className="time-big">
        <div><small>Общее время</small><b>{fmtDuration(d.leadTime ?? (Date.now() - Date.parse(task.created_at)))}</b>{!d.leadTime && <em>идёт</em>}</div>
        <div><small>В работе</small><b>{fmtDuration(d.workTime)}</b></div>
        <div><small>До взятия</small><b>{fmtDuration(d.waitToTake)}</b></div>
        <div><small>До первой сдачи</small><b>{fmtDuration(d.toFirstSubmit)}</b></div>
      </div>
      <div className="stacked" title="Распределение времени по статусам">
        {parts.map((p) => <i key={p.k} style={{ flex: d.byStatus[p.k] / total, background: p.color }} />)}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.k}><i style={{ background: p.color }} />{p.label}<b>{fmtDuration(d.byStatus[p.k])}</b></li>
        ))}
      </ul>
    </section>
  );
}

// ---------- AI-расходы ----------
function ExpensesPanel({ task, meta, canAdd, user, onChanged }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const total = task.expenses.reduce((s, e) => s + e.credits, 0);
  const byService = {};
  task.expenses.forEach((e) => { byService[e.service] = (byService[e.service] || 0) + e.credits; });
  const rounds = [...new Set(task.expenses.map((e) => e.round))].sort();

  return (
    <section className="panel">
      <PanelHead icon={Coins} title="AI-расходы">
        {canAdd && !adding && <button className="btn btn-soft btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Добавить</button>}
      </PanelHead>
      <div className="credits-total"><b>{fmtNum(total, 2)}</b><span>кредитов всего</span></div>
      {Object.keys(byService).length > 0 && (
        <div className="svc-bars">
          {Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([s, c]) => (
            <div key={s} className="svc-bar"><span>{s}</span><i style={{ width: `${(c / total) * 100}%` }} /><b>{fmtNum(c, 2)}</b></div>
          ))}
        </div>
      )}
      {adding && <ExpenseForm task={task} meta={meta} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); toast('Расходы сохранены'); onChanged(); }} />}
      {rounds.map((r) => (
        <div key={r} className="exp-round">
          <div className="exp-round-head">{r === 0 ? 'Основная работа' : `Правки · раунд ${r}`}</div>
          {task.expenses.filter((e) => e.round === r).map((e) => (
            <div key={e.id} className="exp-row">
              <span><b>{e.service}</b>{e.note && <small> · {e.note}</small>}<small className="muted"> · {e.user_name}, {fmtDate(e.created_at)}</small></span>
              <b>{fmtNum(e.credits, 2)}</b>
              {(e.user_id === user.id || user.role === 'lead') && (
                <button className="icon-btn icon-btn-sm" title="Удалить" onClick={async () => {
                  if (!confirm('Удалить запись о расходе?')) return;
                  try { await api.del(`/expenses/${e.id}`); onChanged(); } catch (err) { toast(err.message, 'error'); }
                }}><X size={13} /></button>
              )}
            </div>
          ))}
        </div>
      ))}
      {task.expenses.length === 0 && !adding && <p className="muted small">{canAdd ? 'Укажите, какие AI-сервисы использовались и сколько кредитов потрачено.' : 'Расходов пока нет'}</p>}
    </section>
  );
}

function ExpenseForm({ task, meta, onCancel, onDone }) {
  const toast = useToast();
  const [rows, setRows] = useState([{ service: '', credits: '', note: '' }]);
  const set = (i, k, val) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const save = async () => {
    const items = rows.filter((r) => r.service && r.credits);
    if (!items.length) return toast('Заполните сервис и количество кредитов', 'error');
    try { await api.post(`/tasks/${task.id}/expenses`, { items }); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="exp-form">
      <p className="muted small">Раунд: {task.revision_count === 0 ? 'основная работа' : `правки №${task.revision_count}`}</p>
      {rows.map((r, i) => (
        <div key={i} className="exp-form-row">
          <input className="input input-sm" list="ai-services" placeholder="Сервис" value={r.service} onChange={(e) => set(i, 'service', e.target.value)} />
          <input className="input input-sm" type="number" min="0" step="any" placeholder="Кредиты" value={r.credits} onChange={(e) => set(i, 'credits', e.target.value)} />
          <input className="input input-sm" placeholder="Комментарий" value={r.note} onChange={(e) => set(i, 'note', e.target.value)} />
          {rows.length > 1 && <button className="icon-btn icon-btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={13} /></button>}
        </div>
      ))}
      <datalist id="ai-services">{meta?.aiServices.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="exp-form-actions">
        <button className="link-btn" onClick={() => setRows([...rows, { service: '', credits: '', note: '' }])}><Plus size={13} /> ещё сервис</button>
        <span className="spacer" />
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Отмена</button>}
        {onDone && <button className="btn btn-primary btn-sm" onClick={save}>Сохранить</button>}
      </div>
    </div>
  );
}

// ---------- Комментарии и история ----------
function Comments({ task, onPosted }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const post = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try { await api.post(`/tasks/${task.id}/comments`, { text }); setText(''); onPosted(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="comments">
      {task.comments.length === 0 && <p className="muted small">Комментариев нет</p>}
      {task.comments.map((c) => (
        <div key={c.id} className={`comment ${c.kind === 'revision' ? 'comment-rev' : ''}`}>
          <Avatar name={c.user_name} color={c.user_color} size={28} />
          <div>
            <div className="comment-head"><b>{c.user_name}</b><small>{ROLE[c.user_role]} · {fmtDate(c.created_at)}</small>{c.kind === 'revision' && <span className="badge badge-rev">правки</span>}</div>
            <p>{c.text}</p>
          </div>
        </div>
      ))}
      <form className="comment-form" onSubmit={post}>
        <input className="input" placeholder="Написать комментарий…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-soft" disabled={!text.trim()}><Send size={15} /></button>
      </form>
    </div>
  );
}

export function HistoryList({ items, showTask }) {
  return (
    <ul className="history">
      {items.map((h) => (
        <li key={h.id}>
          <Avatar name={h.user_name} color={h.user_color} size={24} />
          <div>
            <p>
              <b>{h.user_name || 'Система'}</b> {ACTION_LABEL[h.action] || h.action}
              {showTask && h.task_title && <> · {h.task_id ? <Link to={`/board/${h.task_id}`}>#{h.task_id} {h.task_title}</Link> : <span className="muted">{h.task_title}</span>}</>}
              {h.from_status && h.to_status && (
                <span className="hist-status"><StatusBadge s={h.from_status} /> → <StatusBadge s={h.to_status} /></span>
              )}
            </p>
            <HistoryDetails h={h} />
            <small className="muted" title={fmtDate(h.created_at)}>{fmtDate(h.created_at)} · {relTime(h.created_at)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HistoryDetails({ h }) {
  const d = h.details;
  if (!d) return null;
  if (h.action === 'edited') {
    return (
      <ul className="hist-changes">
        {Object.entries(d).map(([k, v]) => (
          <li key={k}>{FIELD_LABEL[k] || k}: <s>{fmtVal(k, v.from)}</s> → <b>{fmtVal(k, v.to)}</b></li>
        ))}
      </ul>
    );
  }
  if (h.action === 'expense_added') return <small className="hist-extra">{d.items.map((i) => `${i.service}: ${i.credits}`).join(', ')}{d.round ? ` (правки №${d.round})` : ''}</small>;
  if (h.action === 'expense_removed') return <small className="hist-extra">{d.service}: {d.credits}</small>;
  if (h.action === 'assigned') return <small className="hist-extra">{d.prev ? `${d.prev} → ` : ''}{d.creative}</small>;
  if (h.action === 'submitted') return <small className="hist-extra">раунд {d.round}</small>;
  if (h.action === 'references_added') return <small className="hist-extra">{d.files.join(', ')}</small>;
  return null;
}
const fmtVal = (k, v) => {
  if (v == null || v === '') return '∅';
  if (k === 'deadline') return fmtDate(v);
  if (k === 'priority') return PRIORITY[v]?.label || v;
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

// ---------- Диалоги действий ----------
function SubmitDialog({ task, meta, onClose, onDone }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [links, setLinks] = useState('');
  const [files, setFiles] = useState([]);
  const [exp, setExp] = useState([{ service: '', credits: '' }]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!links.trim() && !files.length) return toast('Прикрепите файлы или ссылку на результат', 'error');
    setBusy(true);
    try {
      const items = exp.filter((r) => r.service && r.credits);
      if (items.length) await api.post(`/tasks/${task.id}/expenses`, { items });
      const fd = new FormData();
      fd.append('comment', comment);
      fd.append('links', links);
      files.forEach((f) => fd.append('files', f));
      await api.post(`/tasks/${task.id}/submit`, fd);
      onDone();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={task.revision_count ? `Сдать правки (раунд ${task.revision_count})` : 'Сдать работу на проверку'} width={620}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={busy} onClick={submit}><Send size={15} /> Отправить на проверку</button></>}>
      <div className="stack">
        <Field label="Ссылки на результат" hint="Google Drive, Figma, Frame.io… каждая с новой строки">
          <textarea className="input" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://drive.google.com/…" autoFocus />
        </Field>
        <div className="field">
          <span className="field-label">Файлы</span>
          <label className="dropzone"><Upload size={18} /><span>Выбрать файлы результата</span>
            <input type="file" multiple onChange={(e) => setFiles([...files, ...e.target.files].slice(0, 10))} />
          </label>
          {files.length > 0 && <div className="file-list">{files.map((f, i) => <span key={i} className="file-chip">{f.name}<small>{fmtSize(f.size)}</small><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>}
        </div>
        <Field label="Комментарий для байера">
          <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что сделано, на что обратить внимание" />
        </Field>
        <div className="field">
          <span className="field-label"><Coins size={14} /> AI-расходы за этот раунд <span className="muted">(можно добавить и позже)</span></span>
          {exp.map((r, i) => (
            <div key={i} className="exp-form-row">
              <input className="input input-sm" list="ai-services-submit" placeholder="Сервис" value={r.service} onChange={(e) => setExp(exp.map((x, j) => (j === i ? { ...x, service: e.target.value } : x)))} />
              <input className="input input-sm" type="number" min="0" step="any" placeholder="Кредиты" value={r.credits} onChange={(e) => setExp(exp.map((x, j) => (j === i ? { ...x, credits: e.target.value } : x)))} />
              {exp.length > 1 && <button className="icon-btn icon-btn-sm" onClick={() => setExp(exp.filter((_, j) => j !== i))}><X size={13} /></button>}
            </div>
          ))}
          <datalist id="ai-services-submit">{meta?.aiServices.map((s) => <option key={s} value={s} />)}</datalist>
          <button className="link-btn" onClick={() => setExp([...exp, { service: '', credits: '' }])}><Plus size={13} /> ещё сервис</button>
        </div>
      </div>
    </Modal>
  );
}

function RevisionDialog({ task, onClose, onDone }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const send = async () => {
    try { await api.post(`/tasks/${task.id}/revision`, { comment }); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Отправить на правки" width={540}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Отмена</button><button className="btn btn-warn" disabled={!comment.trim()} onClick={send}><RotateCcw size={15} /> Отправить на правки</button></>}>
      <Field label="Что нужно исправить" required>
        <textarea className="input" rows={5} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus placeholder="Конкретно: что, где и как поменять" />
      </Field>
      <p className="muted small">Это будет раунд правок №{task.revision_count + 1}. Время на правках и AI-расходы по нему учитываются отдельно.</p>
    </Modal>
  );
}

function AcceptDialog({ task, onClose, onDone, onRevision }) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const last = task.submissions[task.submissions.length - 1];
  const accept = async () => {
    try { await api.post(`/tasks/${task.id}/accept`, { comment }); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Проверка работы" width={620}
      footer={<><button className="btn btn-warn" onClick={onRevision}><RotateCcw size={15} /> На правки</button><span className="spacer" /><button className="btn btn-ghost" onClick={onClose}>Закрыть</button><button className="btn btn-success" onClick={accept}><CheckCircle2 size={15} /> Принять работу</button></>}>
      {last ? (
        <div className="round">
          <div className="round-head"><b>Сдача №{last.round}</b><span className="muted small">{last.creative_name} · {fmtDate(last.created_at)}</span></div>
          {last.comment && <p className="round-text">{last.comment}</p>}
          <LinkList text={last.links} />
          <FileList files={last.files} preview />
        </div>
      ) : <p className="muted">Нет сданных материалов</p>}
      <Field label="Комментарий (необязательно)" className="mt">
        <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Отличная работа!" />
      </Field>
    </Modal>
  );
}

function AssignDialog({ task, users, onClose, onDone }) {
  const toast = useToast();
  const [cid, setCid] = useState(task.creative_id || '');
  const creatives = users.filter((u) => u.role === 'creative');
  const assign = async () => {
    try { await api.post(`/tasks/${task.id}/assign`, { creative_id: Number(cid) }); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Назначить исполнителя" width={460}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={!cid} onClick={assign}>Назначить</button></>}>
      <div className="pick-list">
        {creatives.map((u) => (
          <label key={u.id} className={`pick ${String(cid) === String(u.id) ? 'on' : ''}`}>
            <input type="radio" name="cid" value={u.id} checked={String(cid) === String(u.id)} onChange={() => setCid(u.id)} />
            <Avatar name={u.name} color={u.color} size={30} />
            <span><b>{u.name}</b><small>{u.position}</small></span>
          </label>
        ))}
      </div>
      {task.status === 'new' && <p className="muted small mt">Задача сразу перейдёт в статус «В работе».</p>}
    </Modal>
  );
}
