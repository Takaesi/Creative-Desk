import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Copy, Download, Rocket, Trophy, Minus, ThumbsDown, Flame, Archive, ArchiveRestore, Sparkles, Pencil, Check, X,
  GitBranch, History, Wallet, Tag, MapPin,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDicts } from '../dicts.jsx';
import { fmtDate, fmtMoney, fmtNum, fmtPct1, VERDICT_LABEL } from '../utils.js';
import { Avatar, Empty, useToast } from '../components/ui.jsx';
import { CreativePreview, CreativeStatusBadge, CreativeMini } from '../components/creative.jsx';
import { HistoryList } from '../components/TaskModal.jsx';
import Results from '../components/Results.jsx';
import ReviewViewer from '../components/Review.jsx';
import { useNewTask } from '../newTask.jsx';

const ACTIONS = [
  { a: 'in_test', label: 'Запущен в тест', icon: Rocket, cls: 'btn-primary' },
  { a: 'winner', label: 'Победитель', icon: Trophy, cls: 'btn-success' },
  { a: 'average', label: 'Средний', icon: Minus, cls: 'btn-ghost' },
  { a: 'loser', label: 'Не зашёл', icon: ThumbsDown, cls: 'btn-ghost' },
  { a: 'burned', label: 'Выгорел', icon: Flame, cls: 'btn-warn' },
];

export default function CreativePage() {
  const { creativeId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { openVariations } = useNewTask();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(() => api.get(`/creatives/${creativeId}`).then(setD).catch((e) => setError(e.message)), [creativeId]);
  useEffect(() => { setD(null); setError(''); load(); }, [load]);
  // «Внести» из очереди ведёт на #results — прокручиваем к блоку результатов
  useEffect(() => {
    if (d && window.location.hash === '#results') document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [d]);

  // ← / → — предыдущая / следующая версия
  useEffect(() => {
    if (!d) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = d.versions.findIndex((v) => v.id === d.creative.id);
      const next = e.key === 'ArrowLeft' ? d.versions[idx - 1] : e.key === 'ArrowRight' ? d.versions[idx + 1] : null;
      if (next) navigate(`/library/${next.id}`, { replace: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d, navigate]);

  if (error) return <div className="page"><Empty title="Креатив не найден" text={error} /></div>;
  if (!d) return <div className="page"><div className="splash small"><div className="spinner" /></div></div>;

  const c = d.creative;
  const A = new Set(d.actions);
  const setStatus = async (to, msg) => {
    try { await api.post(`/creatives/${c.id}/status`, { to }); toast(msg); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(c.code); toast('Код скопирован — вставьте его в название объявления'); } catch { toast(c.code); }
  };
  const verdictMismatch = ['winner', 'average', 'loser'].includes(c.status) && c.suggested_verdict && c.suggested_verdict !== c.status;

  return (
    <div className="page creative-page">
      <Link to="/library" className="back-link"><ArrowLeft size={15} /> Библиотека</Link>
      <div className="cp-grid">
        <div className="cp-left">
          <div className="cp-preview"><CreativePreview c={c} full /></div>
          {d.versions.length > 1 && (
            <div className="versions" role="tablist" aria-label="Версии креатива">
              {d.versions.map((v) => (
                <button key={v.id} role="tab" aria-selected={v.id === c.id} className={v.id === c.id ? 'on' : ''} onClick={() => navigate(`/library/${v.id}`, { replace: true })} title={`${v.code} · ${v.status}`}>
                  v{v.version}
                </button>
              ))}
              <span className="muted small">← → переключают версии</span>
            </div>
          )}
        </div>

        <div className="cp-right">
          <section className="panel">
            <div className="cp-head">
              <button className="code-btn" onClick={copyCode} title="Скопировать код для названия объявления"><Copy size={14} /> {c.code}</button>
              <CreativeStatusBadge s={c.status} />
              {c.task_iteration > 1 && <span className="badge badge-iter">итерация {c.task_iteration}</span>}
              {verdictMismatch && <span className="badge badge-hint" title="Предложение системы по метрикам">по данным — {VERDICT_LABEL[c.suggested_verdict].toLowerCase()}</span>}
            </div>
            <EditableTitle c={c} canEdit={A.has('edit')} onSaved={load} />
            <div className="cp-actions">
              {ACTIONS.filter((x) => A.has(x.a)).map((x) => (
                <button key={x.a} className={`btn btn-sm ${x.cls}`} onClick={() => setStatus(x.a, x.a === 'in_test' ? 'Креатив запущен в тест' : `Статус: ${x.label}`)}>
                  <x.icon size={14} /> {x.label}
                </button>
              ))}
              {A.has('variations') && (
                <button className={`btn btn-sm ${c.status === 'burned' ? 'btn-primary' : 'btn-soft'}`} onClick={() => openVariations(c.id)}>
                  <Sparkles size={14} /> Сделать вариации
                </button>
              )}
              <span className="spacer" />
              {A.has('archive') && <button className="btn btn-sm btn-ghost" onClick={() => setStatus('archived', 'Отправлен в архив')} title="В архив"><Archive size={14} /> В архив</button>}
              {A.has('restore') && <button className="btn btn-sm btn-ghost" onClick={() => setStatus('restore', 'Возвращён из архива')}><ArchiveRestore size={14} /> Вернуть из архива</button>}
              <button className="btn btn-sm btn-ghost" onClick={() => setReviewing(true)}><MapPin size={14} /> {c.task_status === 'review' && c.status === 'draft' && A.has('edit') ? 'Ревью' : 'Замечания'}</button>
              {c.file_id && <a className="btn btn-sm btn-ghost" href={`/api/files/${c.file_id}?download=1`}><Download size={14} /> Скачать</a>}
            </div>
          </section>

          <section className="panel">
            <div className="kv-grid kv-3">
              <KV k="Оффер" v={c.offer_name || '—'} />
              <KV k="GEO" v={c.geo} />
              <KV k="Тип" v={c.creative_type} />
              <KV k="Подход" v={<ApproachSelect c={c} canEdit={A.has('edit')} onSaved={load} />} />
              <KV k="Автор" v={<Person name={c.author_name} color={c.author_color} />} />
              <KV k="Байер" v={<Person name={c.buyer_name} color={c.buyer_color} />} />
              <KV k="Задача" v={<Link to={`/board/${c.task_id}`}>#{c.task_id} {d.task.title}</Link>} />
              <KV k="Версия" v={`v${c.version} · слот ${c.slot}`} />
              <KV k="Создан" v={fmtDate(c.created_at)} />
              <KV k="Принят" v={fmtDate(c.accepted_at)} />
              <KV k="Запущен" v={fmtDate(c.launched_at)} />
              <KV k="Вердикт" v={fmtDate(c.verdict_at)} />
            </div>
            <TagsEditor c={c} canEdit={A.has('edit')} onSaved={load} />
          </section>

          <Results d={d} onChanged={load} />
          {d.cost && <CostPanel cost={d.cost} summary={d.metrics_summary} user={user} />}
          <FamilyPanel d={d} />

          <section className="panel">
            <div className="panel-head"><h4><History size={15} /> История креатива</h4></div>
            {d.history.length ? <HistoryList items={d.history} /> : <p className="muted small">Пока нет событий</p>}
          </section>
        </div>
      </div>
      {reviewing && <ReviewViewer creativeId={c.id} onClose={() => { setReviewing(false); load(); }} />}
    </div>
  );
}

const KV = ({ k, v }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;
const Person = ({ name, color }) => <span className="person"><Avatar name={name} color={color} size={20} />{name}</span>;

function EditableTitle({ c, canEdit, onSaved }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(c.title);
  useEffect(() => setV(c.title), [c.title]);
  const save = async () => {
    try { await api.patch(`/creatives/${c.id}`, { title: v }); setEditing(false); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  if (editing) {
    return (
      <div className="cp-title-edit">
        <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
        <button className="icon-btn" onClick={save} aria-label="Сохранить название"><Check size={16} /></button>
        <button className="icon-btn" onClick={() => setEditing(false)} aria-label="Отмена"><X size={16} /></button>
      </div>
    );
  }
  return (
    <h2 className="cp-title">
      {c.title}
      {canEdit && <button className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label="Переименовать"><Pencil size={13} /></button>}
    </h2>
  );
}

function ApproachSelect({ c, canEdit, onSaved }) {
  const { dicts } = useDicts();
  const toast = useToast();
  if (!canEdit || !dicts) return c.approach_name || '—';
  return (
    <select className="input input-sm" value={c.approach_id || ''} onChange={async (e) => {
      try { await api.patch(`/creatives/${c.id}`, { approach_id: e.target.value || null }); onSaved(); } catch (err) { toast(err.message, 'error'); }
    }} aria-label="Подход">
      <option value="">—</option>
      {dicts.approaches.filter((a) => a.is_active || a.id === c.approach_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}

function TagsEditor({ c, canEdit, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState('');
  const save = async (tags) => {
    try { await api.patch(`/creatives/${c.id}`, { tags }); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="tags-row">
      <Tag size={14} className="muted" />
      {c.tags.map((t) => (
        <span key={t} className="tag-chip">#{t}{canEdit && <button onClick={() => save(c.tags.filter((x) => x !== t))} aria-label={`Удалить тег ${t}`}><X size={11} /></button>}</span>
      ))}
      {c.tags.length === 0 && !canEdit && <span className="muted small">без тегов</span>}
      {canEdit && (
        <input className="tag-input" placeholder="+ тег" value={v} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && v.trim()) { e.preventDefault(); save([...c.tags, v.trim()]); setV(''); } }} />
      )}
    </div>
  );
}

export function CostPanel({ cost, summary, compact = false }) {
  const profit = summary?.profit;
  return (
    <section className="panel">
      <div className="panel-head"><h4><Wallet size={15} /> Себестоимость</h4></div>
      {cost.rate_missing && <p className="form-error small">У исполнителя не задана ставка — труд посчитан как 0. Задайте ставку в настройках.</p>}
      <div className="cost-line">
        <span>Труд <b>{fmtNum(cost.hours, 1)} ч</b>{cost.rate ? <> × {fmtMoney(cost.rate)}</> : ''} = <b>{fmtMoney(cost.labor)}</b></span>
        <span>AI <b>{fmtMoney(cost.ai)}</b></span>
        <span>Итого <b>{fmtMoney(cost.total)}</b></span>
        {!compact && <span>На креатив <b>{fmtMoney(cost.per_creative)}</b></span>}
        <span className="muted">из них правки {fmtMoney(cost.revisions)}</span>
      </div>
      {!compact && summary && profit != null && cost.per_creative > 0 && (
        <p className={`payback ${profit >= 0 ? 'pos' : 'neg'}`}>
          Окупаемость креатива: профит {fmtMoney(profit)} = {fmtNum(profit / cost.per_creative, 1)}× его стоимости
        </p>
      )}
    </section>
  );
}

function FamilyPanel({ d }) {
  const { parent, children, tasks } = d.family;
  if (!parent && !children.length && !tasks.length) return null;
  const myRoi = d.metrics_summary?.roi ?? null;
  return (
    <section className="panel">
      <div className="panel-head"><h4><GitBranch size={15} /> Семейство</h4></div>
      {parent && (
        <>
          <p className="muted small">Родитель — от него сделан этот креатив:</p>
          <div className="cr-mini-row"><CreativeMini c={parent} /></div>
        </>
      )}
      {children.length > 0 && (
        <>
          <p className="muted small">Вариации ({children.length}) — стрелка показывает, лучше ли ROI, чем у этого креатива{myRoi == null ? ' (у него пока нет ROI)' : ` (${fmtPct1(myRoi)})`}:</p>
          <div className="cr-mini-row">{children.map((ch) => <CreativeMini key={ch.id} c={ch} parentRoi={myRoi} />)}</div>
        </>
      )}
      {tasks.length > 0 && (
        <p className="small mt">Задачи на вариации: {tasks.map((t, i) => <span key={t.id}>{i > 0 && ', '}<Link to={`/board/${t.id}`}>#{t.id}</Link></span>)}</p>
      )}
    </section>
  );
}
