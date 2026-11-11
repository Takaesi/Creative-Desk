import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Check, X, Tag, Lightbulb, Bot, Users, SlidersHorizontal, FileText } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useDicts } from '../dicts.jsx';
import { ROLE, fmtNum } from '../utils.js';
import { Avatar, Empty, useToast } from '../components/ui.jsx';
import Templates from '../components/Templates.jsx';

const TABS = [
  { k: 'offers', label: 'Офферы', icon: Tag, roles: ['lead'] },
  { k: 'approaches', label: 'Подходы', icon: Lightbulb, roles: ['lead'] },
  { k: 'ai', label: 'AI-сервисы', icon: Bot, roles: ['lead'] },
  { k: 'team', label: 'Команда', icon: Users, roles: ['lead'] },
  { k: 'thresholds', label: 'Пороги', icon: SlidersHorizontal, roles: ['lead'] },
  { k: 'templates', label: 'Шаблоны ТЗ', icon: FileText, roles: ['lead', 'buyer'] },
];

export default function Settings() {
  const { user } = useAuth();
  const tabs = TABS.filter((t) => t.roles.includes(user.role));
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.k === params.get('tab'))?.k || tabs[0]?.k;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Настройки</h1>
          <p className="muted">{user.role === 'lead' ? 'Справочники, команда и пороги, на которых строится аналитика.' : 'Ваши шаблоны ТЗ.'}</p>
        </div>
      </header>
      <div className="tabs tabs-page">
        {tabs.map((t) => (
          <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setParams({ tab: t.k }, { replace: true })}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'offers' && <DictTable kind="offers" title="оффер" extra={{ key: 'vertical', label: 'Вертикаль', placeholder: 'нутра, гемблинг…' }} />}
      {tab === 'approaches' && <DictTable kind="approaches" title="подход" extra={{ key: 'description', label: 'Описание', placeholder: 'В чём суть подхода' }} />}
      {tab === 'ai' && <AiServices />}
      {tab === 'team' && <Team />}
      {tab === 'thresholds' && <Thresholds />}
      {tab === 'templates' && <Templates />}
    </div>
  );
}

/** Ячейка, которая редактируется по клику. Enter — сохранить, Esc — отменить. */
export function EditCell({ value, onSave, type = 'text', placeholder = '', suffix = '', min, step, display }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? '');
  useEffect(() => { if (!editing) setV(value ?? ''); }, [value, editing]);
  const save = async () => {
    if (String(v) === String(value ?? '')) return setEditing(false);
    const ok = await onSave(type === 'number' && v !== '' ? Number(v) : v);
    if (ok !== false) setEditing(false);
  };
  if (!editing) {
    return (
      <button type="button" className="edit-cell" onClick={() => setEditing(true)} title="Нажмите, чтобы изменить">
        {display ?? (value === null || value === undefined || value === '' ? <span className="muted">{placeholder || '—'}</span> : <>{type === 'number' ? fmtNum(value, 2) : value}{suffix}</>)}
      </button>
    );
  }
  return (
    <span className="edit-cell-form">
      <input
        className="input input-sm" autoFocus type={type} value={v} min={min} step={step} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
      />
      <button type="button" className="icon-btn icon-btn-sm" onClick={save} aria-label="Сохранить"><Check size={14} /></button>
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(false)} aria-label="Отмена"><X size={14} /></button>
    </span>
  );
}

function ActiveToggle({ on, onChange }) {
  return (
    <label className={`switch ${on ? 'on' : ''}`} title={on ? 'Активен — показывается в формах' : 'Неактивен — скрыт из форм, остаётся в старых задачах'}>
      <input type="checkbox" checked={!!on} onChange={(e) => onChange(e.target.checked)} />
      <i /> <span>{on ? 'активен' : 'скрыт'}</span>
    </label>
  );
}

function useSave() {
  const toast = useToast();
  const { reload } = useDicts();
  return async (fn, msg = 'Сохранено') => {
    try { await fn(); toast(msg); reload(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };
}

function DictTable({ kind, title, extra }) {
  const { dicts } = useDicts();
  const save = useSave();
  const [name, setName] = useState('');
  const [ext, setExt] = useState('');
  if (!dicts) return <div className="splash small"><div className="spinner" /></div>;
  const rows = dicts[kind];
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await save(() => api.post(`/${kind}`, { name, [extra.key]: ext }), `Добавлен ${title}`)) { setName(''); setExt(''); }
  };
  return (
    <section className="panel">
      <form className="inline-add" onSubmit={add}>
        <input className="input input-sm" placeholder={`Новый ${title}`} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input input-sm" placeholder={extra.placeholder} value={ext} onChange={(e) => setExt(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!name.trim()}><Plus size={14} /> Добавить</button>
      </form>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Название</th><th>{extra.label}</th><th className="num">Задач</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
                <td><EditCell value={r.name} onSave={(v) => save(() => api.patch(`/${kind}/${r.id}`, { name: v }))} /></td>
                <td><EditCell value={r[extra.key]} placeholder={extra.placeholder} onSave={(v) => save(() => api.patch(`/${kind}/${r.id}`, { [extra.key]: v }))} /></td>
                <td className="num">{r.task_count}</td>
                <td><ActiveToggle on={r.is_active} onChange={(on) => save(() => api.patch(`/${kind}/${r.id}`, { is_active: on }), on ? 'Включён' : 'Скрыт из форм')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <Empty title="Пока пусто" />}
      <p className="muted small mt">Удалять записи нельзя, чтобы не потерять разметку старых задач и аналитику — неактуальные просто скройте.</p>
    </section>
  );
}

function AiServices() {
  const { dicts } = useDicts();
  const save = useSave();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  if (!dicts) return <div className="splash small"><div className="spinner" /></div>;
  const add = async (e) => {
    e.preventDefault();
    if (await save(() => api.post('/ai-services', { name, credit_price_rub: price || 0 }), 'Сервис добавлен')) { setName(''); setPrice(''); }
  };
  return (
    <section className="panel">
      <form className="inline-add" onSubmit={add}>
        <input className="input input-sm" placeholder="Новый сервис" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input input-sm" type="number" min="0" step="any" placeholder="Цена кредита, ₽" value={price} onChange={(e) => setPrice(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!name.trim()}><Plus size={14} /> Добавить</button>
      </form>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Сервис</th><th>Цена кредита</th><th>Статус</th></tr></thead>
          <tbody>
            {dicts.aiServices.map((s) => (
              <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                <td><EditCell value={s.name} onSave={(v) => save(() => api.patch(`/ai-services/${s.id}`, { name: v }))} /></td>
                <td><EditCell type="number" min={0} step="any" value={s.credit_price_rub} suffix=" ₽" onSave={(v) => save(() => api.patch(`/ai-services/${s.id}`, { credit_price_rub: v }), 'Цена обновлена — себестоимость пересчитана')} /></td>
                <td><ActiveToggle on={s.is_active} onChange={(on) => save(() => api.patch(`/ai-services/${s.id}`, { is_active: on }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small mt">Цена × кредиты из AI-расходов = AI-часть себестоимости креатива.</p>
    </section>
  );
}

function Team() {
  const { dicts } = useDicts();
  const save = useSave();
  const [users, setUsers] = useState(null);
  const load = () => api.get('/users').then(setUsers).catch(() => setUsers([]));
  useEffect(() => { load(); }, []);
  if (!users || !dicts) return <div className="splash small"><div className="spinner" /></div>;
  const upd = (u, patch) => save(async () => { await api.patch(`/users/${u.id}`, patch); load(); });
  const def = dicts.settings.wip_limit_default;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Сотрудник</th><th>Роль</th><th>Ставка</th><th>Мощность</th><th>WIP-лимит</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><span className="person"><Avatar name={u.name} color={u.color} size={26} /><span><b>{u.name}</b><small className="muted">{u.position}</small></span></span></td>
                <td>{ROLE[u.role]}</td>
                <td>{u.role === 'creative' ? <EditCell type="number" min={0} step={50} value={u.hourly_rate_rub} suffix=" ₽/ч" onSave={(v) => upd(u, { hourly_rate_rub: v === '' ? 0 : v })} /> : <span className="muted">—</span>}</td>
                <td>{u.role === 'creative' ? <EditCell type="number" min={1} step={1} value={u.capacity_units} suffix=" units" onSave={(v) => upd(u, { capacity_units: v })} /> : <span className="muted">—</span>}</td>
                <td>{u.role === 'creative' ? <EditCell type="number" min={1} step={1} value={u.wip_limit} placeholder={`по умолчанию (${def})`} onSave={(v) => upd(u, { wip_limit: v === '' ? null : v })} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small mt">Ставка — для себестоимости креатива. Мощность — сколько единиц трудоёмкости человек держит одновременно. WIP-лимит — максимум задач в работе.</p>
    </section>
  );
}

const THRESHOLDS = [
  { k: 'verdict_winner_roi', pre: 'Креатив считается победителем, если ROI ≥', post: '%' },
  { k: 'verdict_loser_roi', pre: 'Креатив «не зашёл», если ROI ниже', post: '%' },
  { k: 'verdict_min_spend', pre: 'Предлагать вердикт, когда суммарный расход достиг', post: 'cur' },
  { k: 'burnout_drop_pct', pre: 'Сигнал выгорания, если CTR упал от пика на', post: '%' },
  { k: 'burnout_min_days', pre: 'Анализировать выгорание, если дней с данными не меньше', post: 'дн.' },
  { k: 'no_results_reminder_days', pre: 'Напоминать внести результаты через', post: 'дн. после приёмки' },
  { k: 'wip_limit_default', pre: 'WIP-лимит по умолчанию:', post: 'задачи в работе' },
  { k: 'currency', pre: 'Валюта расхода и дохода в метриках:', post: '', text: true },
];

function Thresholds() {
  const { dicts } = useDicts();
  const save = useSave();
  const [v, setV] = useState(null);
  useEffect(() => { if (dicts) setV({ ...dicts.settings }); }, [dicts]);
  if (!v) return <div className="splash small"><div className="spinner" /></div>;
  const submit = (e) => { e.preventDefault(); save(() => api.patch('/settings', v), 'Пороги сохранены'); };
  return (
    <form className="panel thresholds" onSubmit={submit}>
      {THRESHOLDS.map((t) => (
        <label key={t.k} className="threshold">
          <span>{t.pre}</span>
          <input className="input input-sm" type={t.text ? 'text' : 'number'} step="any" value={v[t.k]} onChange={(e) => setV({ ...v, [t.k]: e.target.value })} />
          <span className="muted">{t.post === 'cur' ? v.currency : t.post}</span>
        </label>
      ))}
      <div><button className="btn btn-primary">Сохранить</button></div>
    </form>
  );
}
