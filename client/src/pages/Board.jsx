import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Coins, MessageSquare, RotateCcw, Paperclip, Clock, ArrowRight, Inbox, RefreshCw } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { STATUS, STATUS_ORDER, PRIORITY, deadlineInfo, fmtNum, relTime } from '../utils.js';
import { Avatar, PriorityBadge, useToast } from '../components/ui.jsx';
import TaskModal from '../components/TaskModal.jsx';
import TaskForm from '../components/TaskForm.jsx';

// Какое действие означает перетаскивание из колонки A в колонку B
const DROP_ACTION = {
  'new>in_progress': 'take',
  'in_progress>new': 'release',
  'in_progress>review': 'submit',
  'revision>review': 'submit',
  'review>done': 'accept',
  'review>revision': 'revision',
};

export default function Board() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { taskId } = useParams();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem('board-filters')) || {}; } catch { return {}; }
  });
  const [creating, setCreating] = useState(false);
  const [intent, setIntent] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const dragTask = useRef(null);

  const f = { q: '', mine: false, priority: '', creative_id: '', buyer_id: '', type: '', ...filters };
  const setF = (patch) => {
    const next = { ...f, ...patch };
    setFilters(next);
    try { localStorage.setItem('board-filters', JSON.stringify({ ...next, q: '' })); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/tasks${qs({ q: f.q, mine: f.mine, priority: f.priority, creative_id: f.creative_id, buyer_id: f.buyer_id, type: f.type })}`);
      setTasks(data);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.q, f.mine, f.priority, f.creative_id, f.buyer_id, f.type]);

  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    api.get('/meta').then(setMeta).catch(() => {});
    api.get('/users').then(setUsers).catch(() => {});
  }, []);

  const columns = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
    tasks.forEach((t) => c[t.status].push(t));
    // в «Готово» показываем последние завершённые сверху
    c.done.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    return c;
  }, [tasks]);

  const open = (id, it = null) => { setIntent(it); navigate(`/board/${id}`); };
  const close = () => { setIntent(null); navigate('/board'); };

  const quick = async (task, action) => {
    try {
      await api.post(`/tasks/${task.id}/${action}`);
      toast(action === 'take' && task.status === 'revision' ? 'Доработка начата — задача остаётся в «Правках»'
        : { take: 'Задача взята в работу', accept: 'Работа принята', release: 'Задача возвращена в «Новые»' }[action]);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const onDrop = (status) => {
    setDragOver(null);
    const task = dragTask.current;
    dragTask.current = null;
    if (!task || task.status === status) return;
    let action = DROP_ACTION[`${task.status}>${status}`];
    if (user.role === 'lead' && task.status === 'new' && status === 'in_progress') action = 'assign';
    if (!action || !task.actions.includes(action)) {
      toast(`Нельзя перенести «${STATUS[task.status].label}» → «${STATUS[status].label}» с вашей ролью`, 'error');
      return;
    }
    if (['take', 'release'].includes(action)) quick(task, action);
    else open(task.id, action); // сдача, приёмка, правки и назначение требуют ввода — открываем карточку
  };

  const creatives = users.filter((u) => u.role === 'creative');
  const buyers = users.filter((u) => u.role === 'buyer');
  const canCreate = user.role === 'buyer' || user.role === 'lead';
  const activeFilters = [f.mine, f.priority, f.creative_id, f.buyer_id, f.type].filter(Boolean).length;

  return (
    <div className="board-page">
      <header className="page-head">
        <div>
          <h1>Доска задач</h1>
          <p className="muted">
            {user.role === 'creative' && 'Берите задачи из «Новых», сдавайте результат и фиксируйте AI-расходы.'}
            {user.role === 'buyer' && 'Ставьте ТЗ креативщикам и принимайте работу на проверке.'}
            {user.role === 'lead' && 'Полный контроль: назначение исполнителей, приёмка, редактирование.'}
          </p>
        </div>
        <div className="head-actions">
          <button className="icon-btn" onClick={load} title="Обновить"><RefreshCw size={17} /></button>
          {canCreate && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Новая задача</button>}
        </div>
      </header>

      <div className="filters">
        <div className="search">
          <Search size={16} />
          <input placeholder="Поиск: оффер, GEO, описание, #id" value={f.q} onChange={(e) => setF({ q: e.target.value })} />
        </div>
        <label className={`chip ${f.mine ? 'chip-on' : ''}`}>
          <input type="checkbox" checked={!!f.mine} onChange={(e) => setF({ mine: e.target.checked })} />
          Только мои
        </label>
        <select className="input input-sm" value={f.priority} onChange={(e) => setF({ priority: e.target.value })}>
          <option value="">Любой приоритет</option>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input input-sm" value={f.type} onChange={(e) => setF({ type: e.target.value })}>
          <option value="">Все типы</option>
          {meta?.creativeTypes.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="input input-sm" value={f.creative_id} onChange={(e) => setF({ creative_id: e.target.value })}>
          <option value="">Все креативщики</option>
          {creatives.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input input-sm" value={f.buyer_id} onChange={(e) => setF({ buyer_id: e.target.value })}>
          <option value="">Все байеры</option>
          {buyers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {activeFilters > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setF({ mine: false, priority: '', creative_id: '', buyer_id: '', type: '' })}>Сбросить ({activeFilters})</button>}
      </div>

      <div className="kanban">
        {STATUS_ORDER.map((s) => (
          <section
            key={s}
            className={`column ${dragOver === s ? 'column-over' : ''}`}
            style={{ '--c': STATUS[s].color }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(s); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); }}
            onDrop={() => onDrop(s)}
          >
            <div className="column-head">
              <i className="dot" />
              <b>{STATUS[s].label}</b>
              <span className="count">{columns[s].length}</span>
            </div>
            <div className="column-body">
              {loading && <div className="card skeleton" />}
              {!loading && columns[s].length === 0 && (
                <div className="column-empty"><Inbox size={18} /> Пусто</div>
              )}
              {columns[s].map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  user={user}
                  onOpen={() => open(t.id)}
                  onQuick={(a) => quick(t, a)}
                  onIntent={(a) => open(t.id, a)}
                  onDragStart={() => { dragTask.current = t; }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {creating && meta && (
        <TaskForm meta={meta} onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); toast('Задача создана'); load(); open(t.id); }} />
      )}
      {taskId && (
        <TaskModal
          key={taskId}
          id={taskId}
          meta={meta}
          users={users}
          intent={intent}
          onClose={close}
          onChanged={load}
        />
      )}
    </div>
  );
}

function TaskCard({ task: t, user, onOpen, onQuick, onIntent, onDragStart }) {
  const dl = deadlineInfo(t);
  const primary =
    t.actions.includes('take') ? { a: 'take', label: t.status === 'revision' ? 'Начать правки' : 'Взять в работу', quick: true } :
    t.actions.includes('submit') ? { a: 'submit', label: 'Сдать работу' } :
    t.actions.includes('accept') ? { a: 'accept', label: 'Проверить' } : null;

  return (
    <article
      className={`card ${t.overdue && t.status !== 'done' ? 'card-overdue' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="card-top">
        <span className="card-id">#{t.id}</span>
        <PriorityBadge p={t.priority} />
        {t.revision_count > 0 && <span className="badge badge-rev" title="Раундов правок"><RotateCcw size={11} /> {t.revision_count}</span>}
      </div>
      {t.status === 'revision' && (
        <div className={`rev-state ${t.revision_started_at ? 'rev-working' : ''}`}>
          {t.revision_started_at ? <>Доработка идёт · {relTime(t.revision_started_at)}</> : 'Ждёт, когда креативщик возьмёт правки'}
        </div>
      )}
      <h4 className="card-title">{t.title}</h4>
      <div className="card-meta">
        <span className="tag">{t.creative_type} ×{t.quantity}</span>
        <span className="tag">{t.geo}</span>
      </div>
      {dl && (
        <div className={`card-deadline ${dl.cls}`}>
          <Clock size={13} /> {dl.text}
        </div>
      )}
      <div className="card-foot">
        <div className="card-people">
          <Avatar name={t.buyer_name} color={t.buyer_color} size={22} title={`Байер: ${t.buyer_name}`} />
          <ArrowRight size={12} className="muted" />
          <Avatar name={t.creative_name} color={t.creative_color} size={22} title={t.creative_name ? `Исполнитель: ${t.creative_name}` : 'Не назначен'} />
        </div>
        <div className="card-stats">
          {t.ref_count > 0 && <span title="Файлы-референсы"><Paperclip size={12} />{t.ref_count}</span>}
          {t.comment_count > 0 && <span title="Комментарии"><MessageSquare size={12} />{t.comment_count}</span>}
          {t.credits_total > 0 && <span title="AI-кредиты"><Coins size={12} />{fmtNum(t.credits_total)}</span>}
        </div>
      </div>
      {primary && t.status !== 'done' && (
        <button
          className="btn btn-sm btn-soft card-action"
          onClick={(e) => { e.stopPropagation(); primary.quick ? onQuick(primary.a) : onIntent(primary.a); }}
        >
          {primary.label}
        </button>
      )}
      {t.status === 'done' && <div className="card-done muted">завершена {relTime(t.completed_at)}</div>}
      {user.role === 'lead' && t.status === 'new' && t.actions.includes('assign') && (
        <button className="btn btn-sm btn-ghost card-action" onClick={(e) => { e.stopPropagation(); onIntent('assign'); }}>Назначить исполнителя</button>
      )}
    </article>
  );
}
