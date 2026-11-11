import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Images, Upload, Copy, X } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDicts } from '../dicts.jsx';
import { CREATIVE_STATUS, LIBRARY_STATUSES, fmtPct1, PLURAL } from '../utils.js';
import { Empty, useToast } from '../components/ui.jsx';
import { CreativeCard } from '../components/creative.jsx';
import ImportDialog from '../components/ImportDialog.jsx';
import { useNewTask } from '../newTask.jsx';

const FILTER_KEYS = ['q', 'offer_id', 'geo', 'type', 'approach_id', 'author_id', 'buyer_id', 'status', 'from', 'to', 'sort', 'all', 'burnout', 'parent_id'];
const SORTS = [{ k: 'new', label: 'Новые' }, { k: 'roi', label: 'ROI ↓' }, { k: 'spend', label: 'Расход ↓' }, { k: 'ctr', label: 'CTR ↓' }];
const PAGE = 60;

export default function Library() {
  const { user } = useAuth();
  const { dicts } = useDicts();
  const toast = useToast();
  const navigate = useNavigate();
  const { openVariations } = useNewTask();
  const [params, setParams] = useSearchParams();
  const f = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || ''])), [params]);
  const [q, setQ] = useState(f.q);
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState([]);
  const [users, setUsers] = useState([]);
  const [importing, setImporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { api.get('/users').then(setUsers).catch(() => {}); }, []);
  useEffect(() => { setQ(f.q); }, [f.q]);

  const setF = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  // поиск — с задержкой, чтобы не дёргать сервер на каждую букву
  useEffect(() => {
    if (q === f.q) return undefined;
    const t = setTimeout(() => setF({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useMemo(() => qs({ ...f, limit: PAGE }), [f]);
  useEffect(() => {
    let alive = true;
    setExtra([]);
    api.get(`/creatives${query}`).then((d) => alive && setData(d)).catch((e) => { toast(e.message, 'error'); setData({ items: [], total: 0, summary: {} }); });
    return () => { alive = false; };
  }, [query, reloadKey, toast]);

  const loadMore = async () => {
    const d = await api.get(`/creatives${qs({ ...f, limit: PAGE, offset: data.items.length + extra.length })}`);
    setExtra((x) => [...x, ...d.items]);
  };

  const statuses = f.status ? f.status.split(',') : [];
  const toggleStatus = (s) => setF({ status: (statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]).join(',') });
  const shownStatuses = f.all ? LIBRARY_STATUSES : LIBRARY_STATUSES.filter((s) => !['draft', 'superseded', 'archived'].includes(s));
  const creatives = users.filter((u) => u.role === 'creative');
  const buyers = users.filter((u) => u.role !== 'creative');
  const active = FILTER_KEYS.filter((k) => !['sort', 'q'].includes(k) && f[k]).length;
  const items = data ? [...data.items, ...extra] : [];
  const s = data?.summary;
  const canImport = user.role === 'buyer' || user.role === 'lead';

  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Ссылка с фильтрами скопирована'); } catch { toast('Не удалось скопировать', 'error'); }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Библиотека креативов</h1>
          <p className="muted">Все креативы команды с результатами тестов. Фильтры сохраняются в ссылке — ею можно поделиться.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={share} title="Скопировать ссылку с фильтрами"><Copy size={15} /> Ссылка</button>
          {canImport && <button className="btn btn-primary" onClick={() => setImporting(true)}><Upload size={15} /> Импорт результатов</button>}
        </div>
      </header>

      <div className="filters">
        <div className="search">
          <Search size={16} />
          <input placeholder="Код CD-142, название, тег" value={q} onChange={(e) => setQ(e.target.value)} data-hotkey-search />
        </div>
        <select className="input input-sm" value={f.offer_id} onChange={(e) => setF({ offer_id: e.target.value })} aria-label="Оффер">
          <option value="">Все офферы</option>
          {dicts?.offers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.is_active ? '' : ' (скрыт)'}</option>)}
        </select>
        <input className="input input-sm input-geo" list="lib-geos" placeholder="GEO" value={f.geo} onChange={(e) => setF({ geo: e.target.value.toUpperCase() })} aria-label="GEO" />
        <datalist id="lib-geos">{dicts?.geos.map((g) => <option key={g} value={g} />)}</datalist>
        <select className="input input-sm" value={f.type} onChange={(e) => setF({ type: e.target.value })} aria-label="Тип">
          <option value="">Все типы</option>
          {dicts?.creativeTypes.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="input input-sm" value={f.approach_id} onChange={(e) => setF({ approach_id: e.target.value })} aria-label="Подход">
          <option value="">Все подходы</option>
          {dicts?.approaches.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input input-sm" value={f.author_id} onChange={(e) => setF({ author_id: e.target.value })} aria-label="Автор">
          <option value="">Все авторы</option>
          {creatives.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input input-sm" value={f.buyer_id} onChange={(e) => setF({ buyer_id: e.target.value })} aria-label="Байер">
          <option value="">Все байеры</option>
          {buyers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" className="input input-sm" value={f.from} onChange={(e) => setF({ from: e.target.value })} aria-label="Создан с" />
        <input type="date" className="input input-sm" value={f.to} onChange={(e) => setF({ to: e.target.value })} aria-label="Создан по" />
      </div>
      <div className="filters filters-2">
        <div className="status-chips">
          {shownStatuses.map((st) => (
            <button key={st} className={`chip chip-status ${statuses.includes(st) ? 'chip-on' : ''}`} style={{ '--c': CREATIVE_STATUS[st].color }} onClick={() => toggleStatus(st)}>
              <i className="dot" />{CREATIVE_STATUS[st].label}
            </button>
          ))}
        </div>
        <label className={`switch ${f.all ? 'on' : ''}`}>
          <input type="checkbox" checked={!!f.all} onChange={(e) => setF({ all: e.target.checked ? '1' : '', status: '' })} /><i /> <span>Показать черновики и архив</span>
        </label>
        {f.burnout && <button className="chip chip-on" onClick={() => setF({ burnout: '' })}>Только выгорающие <X size={12} /></button>}
        {f.parent_id && <button className="chip chip-on" onClick={() => setF({ parent_id: '' })}>Вариации CD-{f.parent_id} <X size={12} /></button>}
        <span className="spacer" />
        <div className="segmented">
          {SORTS.map((x) => <button key={x.k} className={(f.sort || 'new') === x.k ? 'on' : ''} onClick={() => setF({ sort: x.k === 'new' ? '' : x.k })}>{x.label}</button>)}
        </div>
        {active > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setParams(f.sort ? { sort: f.sort } : {}, { replace: true })}>Сбросить ({active})</button>}
      </div>

      {s && (
        <p className="lib-summary">
          Найдено <b>{s.total}</b> · в тесте <b>{s.in_test}</b> · {PLURAL(s.winners, 'победитель', 'победителя', 'победителей')} <b>{s.winners}</b>
          {s.total > 0 && <> ({fmtPct1(s.winner_pct)})</>} · средний ROI <b>{fmtPct1(s.avg_roi)}</b>
        </p>
      )}

      {data === null && <div className="splash small"><div className="spinner" /></div>}
      {data && items.length === 0 && <Empty icon={Images} title="Ничего не найдено" text="Измените фильтры или включите черновики и архив" />}
      <div className="cr-grid">
        {items.map((c) => (
          <CreativeCard key={c.id} c={c}>
            {['winner', 'average', 'burned'].includes(c.status) && (user.role === 'lead' || c.buyer_id === user.id) && (
              <button className={`btn btn-sm ${c.status === 'burned' ? 'btn-primary' : 'btn-soft'} cr-card-action`} onClick={() => openVariations(c.id, (t) => navigate(`/board/${t.id}`))}>
                Сделать вариации
              </button>
            )}
          </CreativeCard>
        ))}
      </div>
      {data && items.length < data.total && (
        <div className="load-more"><button className="btn btn-ghost" onClick={loadMore}>Показать ещё ({data.total - items.length})</button></div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); setReloadKey((k) => k + 1); }} />}
    </div>
  );
}
