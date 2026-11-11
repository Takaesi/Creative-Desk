import { useMemo, useState } from 'react';
import { BarChart3, Plus, Pencil, Trash2, Check, X, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useDicts } from '../dicts.jsx';
import { fmtMoney, fmtNum, fmtPct1, fmtDayFull, isoDay, VERDICT_LABEL } from '../utils.js';
import { useToast } from './ui.jsx';

const METRIC_STATUSES = ['accepted', 'in_test', 'winner', 'average', 'loser', 'burned'];
const EMPTY_ROW = { impressions: '', clicks: '', conversions: '', spend: '', revenue: '' };

/** Блок «Результаты» на странице креатива: сводка, графики, таблица по дням, ввод дня, предложение вердикта. */
export default function Results({ d, onChanged }) {
  const { dicts } = useDicts();
  const toast = useToast();
  const c = d.creative;
  const canEdit = d.actions.includes('metrics');
  const cur = dicts?.settings.currency || '₽';
  const s = d.metrics_summary;
  if (!METRIC_STATUSES.includes(c.status) && !d.metrics.length) return null;

  const confirm = async (to) => {
    try { await api.post(`/creatives/${c.id}/status`, { to }); toast(`Вердикт: ${VERDICT_LABEL[to]}`); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <section className="panel" id="results">
      <div className="panel-head"><h4><BarChart3 size={15} /> Результаты</h4></div>
      {c.status === 'in_test' && c.suggested_verdict && <VerdictSuggestion c={c} s={s} cur={cur} onConfirm={confirm} canEdit={d.actions.includes(c.suggested_verdict)} />}
      {s ? (
        <>
          <div className="res-tiles">
            <Tile k="Расход" v={fmtMoney(s.spend, cur)} />
            <Tile k="Доход" v={fmtMoney(s.revenue, cur)} />
            <Tile k="Профит" v={fmtMoney(s.profit, cur)} tone={s.profit >= 0 ? 'pos' : 'neg'} />
            <Tile k="ROI" v={fmtPct1(s.roi)} tone={s.roi == null ? '' : s.roi >= 0 ? 'pos' : 'neg'} />
            <Tile k="CTR" v={fmtPct1(s.ctr)} />
            <Tile k="CR" v={fmtPct1(s.cr)} />
            <Tile k="CPA" v={s.cpa == null ? '—' : fmtMoney(s.cpa, cur)} />
          </div>
          {d.metrics.length > 1 && <DailyCharts rows={d.metrics} />}
        </>
      ) : (
        <p className="muted small">
          {canEdit ? <>Результатов пока нет. Добавьте статистику за день вручную или загрузите CSV из трекера в Библиотеке — код <b>{c.code}</b> в названии объявления сопоставит строки автоматически.</> : 'Результатов пока нет.'}
        </p>
      )}
      {canEdit && <AddDay c={c} rows={d.metrics} onSaved={onChanged} />}
      {d.metrics.length > 0 && <DailyTable c={c} rows={d.metrics} canEdit={canEdit} cur={cur} onChanged={onChanged} />}
    </section>
  );
}

const Tile = ({ k, v, tone = '' }) => <div className="res-tile"><small>{k}</small><b className={tone}>{v}</b></div>;

function VerdictSuggestion({ c, s, cur, onConfirm, canEdit }) {
  const [other, setOther] = useState(false);
  return (
    <div className="verdict-hint">
      <Sparkles size={16} />
      <span>Система предлагает: <b>{VERDICT_LABEL[c.suggested_verdict]}</b> (ROI {fmtPct1(s?.roi)} при расходе {fmtMoney(s?.spend, cur)}).</span>
      {canEdit && (
        <span className="verdict-hint-actions">
          <button className="btn btn-sm btn-success" onClick={() => onConfirm(c.suggested_verdict)}><Check size={14} /> Подтвердить</button>
          {!other && <button className="btn btn-sm btn-ghost" onClick={() => setOther(true)}>Выбрать другой</button>}
          {other && Object.keys(VERDICT_LABEL).filter((v) => v !== c.suggested_verdict).map((v) => (
            <button key={v} className="btn btn-sm btn-ghost" onClick={() => onConfirm(v)}>{VERDICT_LABEL[v]}</button>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Два маленьких графика с общей осью дат (без двух шкал на одном графике): CTR и ROI по дням.
 * Наведение — общая вертикальная линия и подсказка со значениями за день.
 */
function DailyCharts({ rows }) {
  const [hover, setHover] = useState(null);
  const W = 600; const H = 92; const PAD = { l: 44, r: 8, t: 8, b: 4 };
  const n = rows.length;
  const x = (i) => PAD.l + (n === 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const series = [
    { k: 'ctr', label: 'CTR', color: 'var(--series-1)', fmt: fmtPct1 },
    { k: 'roi', label: 'ROI', color: 'var(--series-3)', fmt: fmtPct1, zero: true },
  ];
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div className="res-charts" onMouseLeave={() => setHover(null)}>
      {series.map((sr) => {
        const vals = rows.map((r) => r[sr.k]);
        const finite = vals.filter((v) => v != null);
        let lo = Math.min(...finite); let hi = Math.max(...finite);
        if (sr.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
        if (hi === lo) { hi += 1; lo -= sr.zero ? 1 : 0; }
        const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
        const pts = vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
        return (
          <div key={sr.k} className="res-chart">
            <div className="res-chart-title">{sr.label} по дням</div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={onMove} role="img" aria-label={`${sr.label} по дням`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(hi)} y2={y(hi)} className="res-grid" />
              <line x1={PAD.l} x2={W - PAD.r} y1={y(lo)} y2={y(lo)} className="res-grid" />
              {sr.zero && lo < 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="res-zero" />}
              <text x={PAD.l - 6} y={y(hi) + 4} className="res-axis" textAnchor="end">{fmtNum(hi, 1)}%</text>
              <text x={PAD.l - 6} y={y(lo)} className="res-axis" textAnchor="end">{fmtNum(lo, 1)}%</text>
              <polyline points={pts} fill="none" stroke={sr.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="res-cross" />}
              {hover != null && vals[hover] != null && <circle cx={x(hover)} cy={y(vals[hover])} r="4" fill={sr.color} stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
            </svg>
          </div>
        );
      })}
      <div className="res-xaxis"><span>{fmtDayFull(rows[0].date)}</span><span>{fmtDayFull(rows[n - 1].date)}</span></div>
      <div className="res-tip" aria-live="polite">
        {hover != null
          ? <><b>{fmtDayFull(rows[hover].date)}</b> · CTR {fmtPct1(rows[hover].ctr)} · ROI {fmtPct1(rows[hover].roi)} · показы {fmtNum(rows[hover].impressions)}</>
          : <span className="muted">Наведите на график, чтобы увидеть значения за день</span>}
      </div>
    </div>
  );
}

function rowPayload(v) {
  return { impressions: v.impressions || 0, clicks: v.clicks || 0, conversions: v.conversions || 0, spend: v.spend || 0, revenue: v.revenue || 0 };
}

function AddDay({ c, rows, onSaved }) {
  const toast = useToast();
  const [open, setOpen] = useState(rows.length === 0);
  const [date, setDate] = useState(() => isoDay(new Date(Date.now() - 86400000)));
  const [v, setV] = useState(EMPTY_ROW);
  const exists = rows.some((r) => r.date === date);
  const save = async (e) => {
    e.preventDefault();
    try {
      const r = await api.put(`/creatives/${c.id}/metrics/${date}`, rowPayload(v));
      toast(r.updated ? 'Данные за день обновлены' : 'День добавлен');
      setV(EMPTY_ROW);
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
  };
  if (!open) return <button className="btn btn-soft btn-sm mt" onClick={() => setOpen(true)}><Plus size={14} /> Добавить день</button>;
  return (
    <form className="add-day" onSubmit={save}>
      <label><small>Дата</small><input className="input input-sm" type="date" value={date} max={isoDay()} onChange={(e) => setDate(e.target.value)} /></label>
      {[['impressions', 'Показы'], ['clicks', 'Клики'], ['conversions', 'Конв.'], ['spend', 'Расход'], ['revenue', 'Доход']].map(([k, l]) => (
        <label key={k}><small>{l}</small><input className="input input-sm" type="number" min="0" step={['spend', 'revenue'].includes(k) ? '0.01' : '1'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
      ))}
      <button className="btn btn-primary btn-sm">{exists ? 'Обновить день' : 'Добавить'}</button>
      {exists && <span className="add-day-warn">За {fmtDayFull(date)} данные уже есть — они будут заменены</span>}
    </form>
  );
}

function DailyTable({ c, rows, canEdit, cur, onChanged }) {
  const toast = useToast();
  const [edit, setEdit] = useState(null); // { date, ...values }
  const sorted = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date)), [rows]);
  const save = async () => {
    try { await api.put(`/creatives/${c.id}/metrics/${edit.date}`, rowPayload(edit)); setEdit(null); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };
  const del = async (date) => {
    if (!confirm(`Удалить данные за ${fmtDayFull(date)}?`)) return;
    try { await api.del(`/creatives/${c.id}/metrics/${date}`); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };
  const cell = (k, step = '1') => <input className="input input-sm" type="number" min="0" step={step} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />;
  return (
    <div className="table-wrap mt">
      <table className="table table-compact">
        <thead><tr><th>Дата</th><th className="num">Показы</th><th className="num">Клики</th><th className="num">Конв.</th><th className="num">Расход</th><th className="num">Доход</th><th className="num">CTR</th><th className="num">ROI</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {sorted.map((r) => (edit?.date === r.date ? (
            <tr key={r.date}>
              <td>{fmtDayFull(r.date)}</td>
              <td>{cell('impressions')}</td><td>{cell('clicks')}</td><td>{cell('conversions')}</td><td>{cell('spend', '0.01')}</td><td>{cell('revenue', '0.01')}</td>
              <td /><td />
              <td className="row-actions">
                <button className="icon-btn icon-btn-sm" onClick={save} aria-label="Сохранить"><Check size={14} /></button>
                <button className="icon-btn icon-btn-sm" onClick={() => setEdit(null)} aria-label="Отмена"><X size={14} /></button>
              </td>
            </tr>
          ) : (
            <tr key={r.date}>
              <td>{fmtDayFull(r.date)}{r.source === 'csv' && <small className="muted"> · CSV</small>}</td>
              <td className="num">{fmtNum(r.impressions)}</td>
              <td className="num">{fmtNum(r.clicks)}</td>
              <td className="num">{fmtNum(r.conversions)}</td>
              <td className="num">{fmtMoney(r.spend, cur)}</td>
              <td className="num">{fmtMoney(r.revenue, cur)}</td>
              <td className="num">{fmtPct1(r.ctr)}</td>
              <td className={`num ${r.roi == null ? '' : r.roi >= 0 ? 'pos' : 'neg'}`}>{fmtPct1(r.roi)}</td>
              {canEdit && (
                <td className="row-actions">
                  <button className="icon-btn icon-btn-sm" onClick={() => setEdit({ ...r })} aria-label="Изменить день"><Pencil size={13} /></button>
                  <button className="icon-btn icon-btn-sm" onClick={() => del(r.date)} aria-label="Удалить день"><Trash2 size={13} /></button>
                </td>
              )}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
