import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUp, ArrowDown, Clock, MessageSquare, RefreshCw, AlertTriangle, MapPin } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { deadlineInfo, fmtDuration, fmtMoney, fmtNum, fmtPct1, ROLE } from '../utils.js';
import { Avatar, StatusBadge, useToast } from '../components/ui.jsx';

export default function Queue() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const full = params.get('full') === '1';
  const [data, setData] = useState(null);

  const load = useCallback(() => api.get(`/queue${full ? '?full=1' : ''}`).then(setData).catch((e) => toast(e.message, 'error')), [toast, full]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { window.addEventListener('tasks:changed', load); return () => window.removeEventListener('tasks:changed', load); }, [load]);

  const act = async (fn, msg) => {
    try { await fn(); toast(msg); load(); window.dispatchEvent(new Event('tasks:changed')); } catch (e) { toast(e.message, 'error'); }
  };

  const [summary, ...rest] = data?.blocks || [];
  return (
    <div className="page queue-page">
      <header className="page-head q-page-head">
        <div>
          <h1>Моя очередь</h1>
          <p className="muted">{ROLE[user.role]} · {user.name}</p>
        </div>
        <button className="icon-btn" onClick={load} title="Обновить" aria-label="Обновить"><RefreshCw size={17} /></button>
      </header>
      {!data && <div className="splash small"><div className="spinner" /></div>}
      {data && (
        <div className="queue-grid">
          <Summary b={summary} />
          {rest.map((b) => <Block key={b.key} b={b} act={act} full={full} />)}
        </div>
      )}
    </div>
  );
}

// ---------- сводка ----------
function fmtTile(t, v) {
  if (v == null) return '—';
  if (t.fmt === 'pct') return fmtPct1(v);
  if (t.fmt === 'rub') return fmtMoney(v);
  return fmtNum(v);
}

export const PACE = {
  ahead: { label: 'опережает', cls: 'pos' },
  on_track: { label: 'в графике', cls: 'pace-ok' },
  behind: { label: 'отстаёт', cls: 'neg' },
};

/** «отстаёте на 3» / «в графике» / «опережаете на 2» — подпись к плану креативщика. */
export function paceText(plan, you = false) {
  if (plan.status === 'behind') return `${you ? 'отстаёте' : 'отстаёт'} на ${plan.behind_by}`;
  if (plan.status === 'ahead' && plan.ahead_by > 0) return `${you ? 'опережаете' : 'опережает'} на ${plan.ahead_by}`;
  return 'в графике';
}

function Summary({ b }) {
  return (
    <section className="panel q-block q-wide q-summary" aria-label={b.title}>
      <div className="q-head"><h3>{b.title}</h3></div>
      <div className="q-tiles">
        {b.tiles.map((t) => <Tile key={t.key} t={t} />)}
        {b.alerts.map((t) => (
          <Link key={t.key} to={t.link} className="q-tile q-alert">
            <small><AlertTriangle size={12} /> {t.label}</small>
            <b>{fmtNum(t.value)}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Tile({ t }) {
  const diff = t.prev !== undefined && t.value != null && t.prev != null ? t.value - t.prev : null;
  const good = diff == null || diff === 0 ? null : (diff > 0) === (t.better === 'up');
  const body = (
    <>
      <small>{t.label}</small>
      {t.fmt === 'plan' ? (
        <>
          <b>{t.plan.fact} <span className="q-of">/ {t.plan.norm}</span></b>
          <span className={`q-trend ${PACE[t.plan.status].cls}`}>{paceText(t.plan, true)}</span>
        </>
      ) : (
        <>
          <b>{fmtTile(t, t.value)}</b>
          {diff != null && diff !== 0 && (
            <span className={`q-trend ${good ? 'pos' : 'neg'}`} title={`Прошлая неделя: ${fmtTile(t, t.prev)}`}>
              {diff > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />} было {fmtTile(t, t.prev)}
            </span>
          )}
          {diff === 0 && <span className="q-trend muted">без изменений</span>}
          {t.hint && <span className="q-trend muted">{t.hint}</span>}
        </>
      )}
    </>
  );
  return t.link ? <Link to={t.link} className="q-tile q-tile-link">{body}</Link> : <div className="q-tile">{body}</div>;
}

// ---------- списки ----------
function Block({ b, act, full }) {
  return (
    <section className="panel q-block" aria-label={b.title}>
      <div className="q-head">
        <h3>{b.title}</h3>
        {b.count != null && <span className={`count ${b.count ? 'count-on' : ''}`}>{b.count}</span>}
        {b.link && !full && b.count > b.items.length && <Link to={b.link} className="link-btn q-all">Показать все</Link>}
      </div>
      {b.key === 'available' && b.wip && (
        <p className={`small q-wip ${b.wip.reached ? 'neg' : 'muted'}`}>В работе {b.wip.count} из {b.wip.limit}{b.wip.reached ? ' — лимит достигнут' : ''}</p>
      )}
      {b.items.length === 0 ? <p className="q-empty">{b.empty || 'Пусто'}</p> : (
        <div className="q-list">
          {b.items.map((it) => (
            b.kind === 'load' ? <LoadRow key={it.id} p={it} />
              : it.kind === 'problem' ? <ProblemRow key={`${it.type}${it.id}`} p={it} />
                : <TaskRow key={it.id} t={it} block={b.key} act={act} />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskRow({ t, block, act }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const dl = deadlineInfo(t);
  const open = (intent) => navigate(`/board/${t.id}`, { state: intent ? { intent } : undefined });
  const left = t.time_left_pct;
  const barTone = left == null ? '' : left > 50 ? 'ok' : left >= 20 ? 'mid' : 'bad';
  const waitLong = t.waiting_ms > 24 * 3600_000;
  const revisionWaiting = t.status === 'revision' && !t.revision_started_at;
  return (
    <div className="q-item">
      <div className="q-item-main">
        <Link to={`/board/${t.id}`} className="q-title"><span className="card-id">#{t.id}</span> {t.title}</Link>
        <div className="q-meta">
          {block !== 'to_review' && block !== 'available' && <StatusBadge s={t.status} />}
          {block === 'available' && <span className="tag">{t.creative_type} ×{t.quantity} · {t.estimate_units} units</span>}
          {t.open_pins > 0 && <span className="badge pin-badge" title="Открытые замечания на креативах"><MapPin size={11} /> {t.open_pins}</span>}
          {dl && block !== 'to_review' && <span className={`badge ${dl.cls}`}><Clock size={11} /> {dl.text}</span>}
          {block === 'to_review' && <span className={`badge ${waitLong ? 'dl-late' : 'dl-ok'}`}>ждёт {fmtDuration(t.waiting_ms)}</span>}
          {(block === 'to_review' || (block === 'my_tasks' && user.role !== 'creative')) && (
            <span className="q-people">
              {t.creative_name ? <><Avatar name={t.creative_name} color={t.creative_color} size={16} /> {t.creative_name}</> : <span className="muted">без исполнителя</span>}
            </span>
          )}
        </div>
        {revisionWaiting && t.revision_comment && <p className="q-comment"><MessageSquare size={12} /> {t.revision_comment}</p>}
        {left != null && block !== 'available' && (
          <div className={`q-timebar q-${barTone}`} title={`Осталось ${Math.round(left)} % времени`}><i style={{ width: `${Math.max(2, left)}%` }} /></div>
        )}
      </div>
      <div className="q-actions">
        {block === 'my_tasks' && revisionWaiting && t.actions.includes('take') && (
          <button className="btn btn-sm btn-primary" onClick={() => act(() => api.post(`/tasks/${t.id}/take`), 'Доработка начата')}>Начать правки</button>
        )}
        {block === 'my_tasks' && t.actions.includes('submit') && !revisionWaiting && <button className="btn btn-sm btn-primary" onClick={() => open('submit')}>Сдать</button>}
        {block === 'available' && (
          <button className="btn btn-sm btn-soft" disabled={!!t.take_blocked} title={t.take_blocked || 'Взять в работу'}
            onClick={() => act(() => api.post(`/tasks/${t.id}/take`), 'Задача взята в работу')}>Взять</button>
        )}
        {block === 'to_review' && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => open('accept')}>Открыть</button>
            {t.actions.includes('accept') && (
              <button className="btn btn-sm btn-success" onClick={() => confirm(`Принять работу по #${t.id}?`) && act(() => api.post(`/tasks/${t.id}/accept`), 'Работа принята')}>Принять</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const loadTone = (p) => (p > 100 ? 'bad' : p >= 70 ? 'mid' : 'ok');

function LoadRow({ p }) {
  return (
    <div className="q-load">
      <span className="q-load-name"><Avatar name={p.name} color={p.color} size={22} /> <b>{p.name}</b></span>
      <div className="q-load-bar">
        <div className={`q-timebar q-${loadTone(p.load_pct)}`} title={`${p.load_units} из ${p.capacity_units} units`}><i style={{ width: `${Math.min(100, Math.max(2, p.load_pct))}%` }} /></div>
        <span className="small muted">{fmtNum(p.load_units, 1)} / {p.capacity_units} units · {fmtNum(p.load_pct, 0)} %</span>
      </div>
      <span className={`small ${p.wip_count >= p.wip_limit ? 'neg' : 'muted'}`} title="Задач в работе / WIP-лимит">задач {p.wip_count}/{p.wip_limit}</span>
      <span className="small q-load-plan">
        {p.plan ? <span className={PACE[p.plan.status].cls} title={paceText(p.plan)}>План: {p.plan.fact} / {p.plan.norm} ({fmtNum(p.plan.pct, 0)} %)</span> : <span className="muted">план не задан</span>}
      </span>
    </div>
  );
}

function ProblemRow({ p }) {
  const meta = {
    overdue: () => `просрочена на ${fmtDuration(p.ms)}${p.person ? ` · ${p.person}` : ''}`,
    urgent: () => `до дедлайна ${fmtDuration(p.ms)} · байер ${p.person}`,
    stuck: () => `ждёт ${fmtDuration(p.ms)} · байер ${p.person}`,
    overload: () => `${fmtNum(p.load_units, 1)} из ${p.capacity_units} units · ${fmtNum(p.load_pct, 0)} %`,
    burnout: () => `байер ${p.person}`,
  }[p.type]();
  const body = (
    <>
      <span className={`badge q-ptype q-ptype-${p.type}`}>{p.label}</span>
      <span className="q-title">{p.title}</span>
      <span className="small muted q-pmeta">{meta}</span>
    </>
  );
  return p.link ? <Link to={p.link} className="q-item q-problem">{body}</Link> : <div className="q-item q-problem">{body}</div>;
}
