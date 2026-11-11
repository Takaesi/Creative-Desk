import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flame, ArrowUp, ArrowDown, Clock, MessageSquare, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { deadlineInfo, fmtDuration, fmtMoney, fmtNum, fmtPct1, VERDICT_LABEL, ROLE } from '../utils.js';
import { Avatar, PriorityBadge, StatusBadge, useToast } from '../components/ui.jsx';
import { CreativePreview, CreativeStatusBadge } from '../components/creative.jsx';
import { useNewTask } from '../newTask.jsx';

const SUBTITLE = {
  creative: 'Правки, текущие задачи и что можно взять — по срочности.',
  buyer: 'Проверка работ, результаты тестов и вердикты по вашим креативам.',
  lead: 'Пожары отдела и KPI недели.',
};

export default function Queue() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);

  const load = useCallback(() => api.get('/queue').then(setData).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { window.addEventListener('tasks:changed', load); return () => window.removeEventListener('tasks:changed', load); }, [load]);

  const act = async (fn, msg) => {
    try { await fn(); toast(msg); load(); window.dispatchEvent(new Event('tasks:changed')); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="page queue-page">
      <header className="page-head">
        <div>
          <h1>Моя очередь</h1>
          <p className="muted">{ROLE[user.role]} · {SUBTITLE[user.role]}</p>
        </div>
        <button className="icon-btn" onClick={load} title="Обновить" aria-label="Обновить"><RefreshCw size={17} /></button>
      </header>
      {!data && <div className="splash small"><div className="spinner" /></div>}
      {data && (
        <div className="queue-grid">
          {data.blocks.map((b) => <Block key={b.key} b={b} act={act} />)}
        </div>
      )}
    </div>
  );
}

function Block({ b, act }) {
  if (b.kind === 'stats') return <StatsBlock b={b} />;
  const wide = ['recent_winners'].includes(b.key);
  return (
    <section className={`panel q-block ${wide ? 'q-wide' : ''}`}>
      <div className="q-head">
        <h3>{b.title}</h3>
        <span className={`count ${b.count ? 'count-on' : ''}`}>{b.count}</span>
        {b.link && b.count > b.items.length && <Link to={b.link} className="link-btn q-all">Показать все</Link>}
      </div>
      {b.key === 'available' && b.wip && (
        <p className={`small q-wip ${b.wip.reached ? 'neg' : 'muted'}`}>В работе {b.wip.count} из {b.wip.limit}{b.wip.reached ? ' — лимит достигнут' : ''}</p>
      )}
      {b.items.length === 0 ? <p className="q-empty">{b.empty}</p> : (
        <div className={b.key === 'recent_winners' ? 'q-winners' : 'q-list'}>
          {b.items.map((it) => (
            it.kind === 'task' ? <TaskItem key={`t${it.id}`} t={it} block={b.key} act={act} />
              : it.kind === 'creative' ? (b.key === 'recent_winners' ? <WinnerCard key={`c${it.id}`} c={it} /> : <CreativeItem key={`c${it.id}`} c={it} block={b.key} act={act} />)
                : <PersonItem key={`p${it.id}-${it.issue}`} p={it} />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskItem({ t, block, act }) {
  const navigate = useNavigate();
  const dl = deadlineInfo(t);
  const open = (intent) => navigate(`/board/${t.id}`, { state: intent ? { intent } : undefined });
  const left = t.time_left_pct;
  const barTone = left == null ? '' : left > 50 ? 'ok' : left >= 20 ? 'mid' : 'bad';
  const waitLong = t.waiting_ms > 24 * 3600_000;
  return (
    <div className="q-item">
      <div className="q-item-main">
        <Link to={`/board/${t.id}`} className="q-title"><span className="card-id">#{t.id}</span> {t.title}</Link>
        <div className="q-meta">
          {['my_tasks', 'overdue', 'urgent_unassigned', 'stuck_review'].includes(block) && <StatusBadge s={t.status} />}
          <PriorityBadge p={t.priority} />
          {block === 'available' && <span className="tag">{t.creative_type} ×{t.quantity} · {t.estimate_units} units</span>}
          {dl && !['to_review', 'stuck_review'].includes(block) && <span className={`badge ${dl.cls}`}><Clock size={11} /> {dl.text}</span>}
          {t.waiting_ms != null && <span className={`badge ${waitLong ? 'dl-late' : 'dl-ok'}`}>ждёт {fmtDuration(t.waiting_ms)}</span>}
          {['my_tasks', 'overdue', 'stuck_review', 'to_review'].includes(block) && (
            <span className="q-people">
              {block === 'stuck_review' && <>байер <b>{t.buyer_name}</b></>}
              {block !== 'stuck_review' && (t.creative_name ? <><Avatar name={t.creative_name} color={t.creative_color} size={18} /> {t.creative_name}</> : <span className="muted">без исполнителя</span>)}
            </span>
          )}
        </div>
        {block === 'revisions_waiting' && t.revision_comment && <p className="q-comment"><MessageSquare size={12} /> {t.revision_comment}</p>}
        {left != null && (
          <div className={`q-timebar q-${barTone}`} title={`Осталось ${Math.round(left)} % времени`}><i style={{ width: `${Math.max(2, left)}%` }} /></div>
        )}
      </div>
      <div className="q-actions">
        {block === 'revisions_waiting' && <button className="btn btn-sm btn-primary" onClick={() => act(() => api.post(`/tasks/${t.id}/take`), 'Доработка начата')}>Начать правки</button>}
        {block === 'in_work' && <button className="btn btn-sm btn-primary" onClick={() => open('submit')}>Сдать</button>}
        {block === 'available' && (
          <button className="btn btn-sm btn-soft" disabled={!!t.take_blocked} title={t.take_blocked || 'Взять в работу'}
            onClick={() => act(() => api.post(`/tasks/${t.id}/take`), 'Задача взята в работу')}>Взять</button>
        )}
        {['to_review', 'stuck_review'].includes(block) && (
          <>
            <button className="btn btn-sm btn-ghost" onClick={() => open('accept')}>Открыть</button>
            {t.actions.includes('accept') && (
              <button className="btn btn-sm btn-success" onClick={() => confirm(`Принять работу по #${t.id}?`) && act(() => api.post(`/tasks/${t.id}/accept`), 'Работа принята')}>Принять</button>
            )}
          </>
        )}
        {block === 'urgent_unassigned' && t.actions.includes('assign') && <button className="btn btn-sm btn-soft" onClick={() => open('assign')}>Назначить</button>}
      </div>
    </div>
  );
}

function CreativeItem({ c, block, act }) {
  const { openVariations } = useNewTask();
  const navigate = useNavigate();
  return (
    <div className="q-item">
      <Link to={`/library/${c.id}`} className="q-thumb"><CreativePreview c={c} hoverPlay={false} /></Link>
      <div className="q-item-main">
        <Link to={`/library/${c.id}`} className="q-title"><span className="card-id">{c.code}</span> {c.title}</Link>
        <div className="q-meta">
          <CreativeStatusBadge s={c.status} />
          {c.offer_name && <span className="tag">{c.offer_name} · {c.geo}</span>}
          {block === 'burning' || block === 'team_burning' ? (
            c.burnout && <span className="badge q-burn"><Flame size={11} /> CTR −{fmtNum(c.burnout.drop_pct, 0)} % от пика</span>
          ) : null}
          {block === 'need_results' && <span className="muted small">{c.reason}</span>}
          {block === 'need_verdict' && <span className="small">система предлагает: <b>{VERDICT_LABEL[c.suggested_verdict]}</b> · ROI {fmtPct1(c.metrics_summary?.roi)}</span>}
          {block === 'team_burning' && <span className="muted small">байер {c.buyer_name}</span>}
        </div>
      </div>
      <div className="q-actions">
        {['burning', 'team_burning'].includes(block) && <button className="btn btn-sm btn-primary" onClick={() => openVariations(c.id)}>Сделать вариации</button>}
        {block === 'need_results' && <button className="btn btn-sm btn-soft" onClick={() => navigate(`/library/${c.id}#results`)}>Внести</button>}
        {block === 'need_verdict' && (
          <button className="btn btn-sm btn-success" onClick={() => act(() => api.post(`/creatives/${c.id}/status`, { to: c.suggested_verdict }), `Вердикт: ${VERDICT_LABEL[c.suggested_verdict]}`)}>Подтвердить</button>
        )}
      </div>
    </div>
  );
}

function WinnerCard({ c }) {
  return (
    <Link to={`/library/${c.id}`} className="q-winner">
      <div className="q-winner-thumb"><CreativePreview c={c} hoverPlay={false} /></div>
      <span className="card-id">{c.code}</span>
      <b className="pos">ROI {fmtPct1(c.metrics_summary?.roi)}</b>
    </Link>
  );
}

function PersonItem({ p }) {
  const over = p.issue === 'overload';
  return (
    <div className="q-item">
      <Avatar name={p.name} color={p.color} size={30} />
      <div className="q-item-main">
        <b>{p.name}</b>
        <span className="muted small">{p.position}</span>
      </div>
      <span className={`badge ${over ? 'dl-late' : 'dl-ok'}`}>
        {over ? `перегруз ${fmtNum(p.load_pct, 0)} % · ${p.load_units} из ${p.capacity_units} units` : 'простаивает — нет задач в работе'}
      </span>
    </div>
  );
}

function fmtTile(t, v) {
  if (v == null) return '—';
  if (t.fmt === 'pct') return fmtPct1(v);
  if (t.fmt === 'rub') return fmtMoney(v);
  return fmtNum(v);
}

function StatsBlock({ b }) {
  return (
    <section className="panel q-block q-wide">
      <div className="q-head"><h3>{b.title}</h3></div>
      <div className="q-tiles">
        {b.tiles.map((t) => {
          const diff = t.value != null && t.prev != null ? t.value - t.prev : null;
          const good = diff == null || diff === 0 ? null : (diff > 0) === (t.better === 'up');
          return (
            <div key={t.key} className="q-tile">
              <small>{t.label}</small>
              <b>{fmtTile(t, t.value)}</b>
              {diff != null && diff !== 0 && (
                <span className={`q-trend ${good ? 'pos' : 'neg'}`} title={`Прошлый период: ${fmtTile(t, t.prev)}`}>
                  {diff > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />} было {fmtTile(t, t.prev)}
                </span>
              )}
              {diff === 0 && <span className="q-trend muted">без изменений</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
