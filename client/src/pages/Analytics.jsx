import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, Activity as ActivityIcon, CheckCircle2, AlertTriangle, Timer, Hourglass, RotateCcw, Coins, Users, Clock } from 'lucide-react';
import { api, qs } from '../api.js';
import { STATUS, STATUS_ORDER, fmtDuration, fmtNum, fmtPct, fmtDay } from '../utils.js';
import { Avatar, StatusBadge, Empty } from '../components/ui.jsx';

const PRESETS = [
  { k: '7', label: '7 дней' },
  { k: '14', label: '14 дней' },
  { k: '30', label: '30 дней' },
  { k: 'all', label: 'Всё время' },
];
const dayIso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Analytics() {
  const [preset, setPreset] = useState('30');
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [tip, setTip] = useState(null);

  const period = useMemo(() => {
    if (preset === 'custom') return range;
    if (preset === 'all') return { from: '', to: '' };
    const to = new Date();
    return { from: dayIso(new Date(to.getTime() - (Number(preset) - 1) * 86400000)), to: dayIso(to) };
  }, [preset, range]);

  useEffect(() => {
    setData(null);
    api.get(`/analytics${qs(period)}`).then(setData).catch(() => setData(false));
  }, [period]);

  const showTip = (e, content) => setTip({ x: e.clientX, y: e.clientY, content });
  const hideTip = () => setTip(null);

  return (
    <div className="page analytics viz-root">
      <header className="page-head">
        <div>
          <h1>Аналитика отдела</h1>
          <p className="muted">Задачи учитываются по дате создания, AI-расходы — по дате списания.</p>
        </div>
        <div className="period">
          <div className="segmented">
            {PRESETS.map((p) => <button key={p.k} className={preset === p.k ? 'on' : ''} onClick={() => setPreset(p.k)}>{p.label}</button>)}
          </div>
          <input type="date" className="input input-sm" value={period.from} onChange={(e) => { setPreset('custom'); setRange({ ...period, from: e.target.value }); }} />
          <span className="muted">—</span>
          <input type="date" className="input input-sm" value={period.to} onChange={(e) => { setPreset('custom'); setRange({ ...period, to: e.target.value }); }} />
        </div>
      </header>

      {data === null && <div className="splash small"><div className="spinner" /></div>}
      {data === false && <Empty icon={AlertTriangle} title="Не удалось загрузить аналитику" />}
      {data && data.kpi.total === 0 && <Empty icon={ListChecks} title="За период задач нет" text="Выберите другой период" />}
      {data && data.kpi.total > 0 && (
        <>
          <div className="kpis">
            <Kpi icon={ListChecks} label="Задач за период" value={data.kpi.total} sub={`${data.kpi.active} активных · ${data.kpi.done} готово`} />
            <Kpi icon={Timer} label="Среднее время выполнения" value={fmtDuration(data.kpi.avgLeadTime)} sub={`от постановки до приёмки`} />
            <Kpi icon={ActivityIcon} label="Среднее в работе" value={fmtDuration(data.kpi.avgCycleTime)} sub="от взятия до приёмки" />
            <Kpi icon={Hourglass} label="Ожидание взятия" value={fmtDuration(data.kpi.avgWaitToTake)} sub="в среднем в «Новых»" />
            <Kpi icon={AlertTriangle} label="Просрочено сейчас" value={data.kpi.overdueActive} tone={data.kpi.overdueActive ? 'bad' : ''} sub={`+ ${data.kpi.doneLate} сданы с опозданием`} />
            <Kpi icon={CheckCircle2} label="Сдано в срок" value={fmtPct(data.kpi.onTimeRate)} sub="доля завершённых задач" />
            <Kpi icon={RotateCcw} label="Задач с правками" value={fmtPct(data.kpi.revisionRate)} sub="среди завершённых" />
            <Kpi icon={Coins} label="AI-кредиты" value={fmtNum(data.kpi.totalCredits)} sub={`≈ ${fmtNum(data.kpi.creditsPerDoneTask)} на готовую задачу`} />
          </div>

          <section className="panel">
            <h3 className="panel-title">Задачи по статусам</h3>
            <div className="status-strip">
              {STATUS_ORDER.filter((s) => data.byStatus[s]).map((s) => (
                <i key={s} style={{ flex: data.byStatus[s], background: STATUS[s].color }}
                  onMouseMove={(e) => showTip(e, <><b>{STATUS[s].label}</b><span>{data.byStatus[s]} задач · {fmtPct(data.byStatus[s] / data.kpi.total)}</span></>)}
                  onMouseLeave={hideTip} />
              ))}
            </div>
            <ul className="legend legend-row">
              {STATUS_ORDER.map((s) => <li key={s}><i style={{ background: STATUS[s].color }} />{STATUS[s].label}<b>{data.byStatus[s]}</b></li>)}
            </ul>
          </section>

          <section className="panel">
            <h3 className="panel-title"><Users size={16} /> Загрузка креативщиков</h3>
            <WorkloadTable rows={data.creatives} showTip={showTip} hideTip={hideTip} />
          </section>

          <div className="grid-2">
            <section className="panel">
              <h3 className="panel-title"><Coins size={16} /> AI-кредиты по сервисам</h3>
              <ServiceBars rows={data.ai.byService} total={data.ai.total} showTip={showTip} hideTip={hideTip} />
              <p className="muted small">Из них на правки: <b>{fmtNum(data.ai.revisionCredits)}</b> ({fmtPct(data.ai.total ? data.ai.revisionCredits / data.ai.total : null)})</p>
            </section>
            <section className="panel">
              <h3 className="panel-title"><Coins size={16} /> Сервисы × исполнители</h3>
              <Heatmap ai={data.ai} showTip={showTip} hideTip={hideTip} />
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <h3 className="panel-title">Поставлено и завершено по дням</h3>
              <DayBars days={data.timeline} keys={[{ k: 'created', label: 'Поставлено', color: 'var(--series-1)' }, { k: 'done', label: 'Завершено', color: 'var(--series-3)' }]} showTip={showTip} hideTip={hideTip} />
            </section>
            <section className="panel">
              <h3 className="panel-title">AI-кредиты по дням</h3>
              <DayBars days={data.timeline} keys={[{ k: 'credits', label: 'Кредиты', color: 'var(--series-1)' }]} showTip={showTip} hideTip={hideTip} />
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <h3 className="panel-title"><AlertTriangle size={16} /> Просрочки · {data.overdueList.length}</h3>
              {data.overdueList.length === 0 ? <p className="muted small">Просрочек нет 🎉</p> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Задача</th><th>Статус</th><th>Исполнитель</th><th className="num">Опоздание</th></tr></thead>
                    <tbody>
                      {data.overdueList.map((t) => (
                        <tr key={t.id}>
                          <td><Link to={`/board/${t.id}`}>#{t.id} {t.title}</Link></td>
                          <td><StatusBadge s={t.status} /></td>
                          <td>{t.creative || <span className="muted">—</span>}</td>
                          <td className="num bad-text">{fmtDuration(t.lateBy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="panel">
              <h3 className="panel-title">Типы креативов</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Тип</th><th className="num">Задач</th><th className="num">Готово</th><th className="num">Ср. время</th></tr></thead>
                  <tbody>
                    {data.byType.map((r) => (
                      <tr key={r.type}><td>{r.type}</td><td className="num">{r.count}</td><td className="num">{r.done}</td><td className="num">{fmtDuration(r.avgLeadTime)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3 className="panel-title mt">Байеры</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Байер</th><th className="num">Поставил</th><th className="num">Активных</th><th className="num">Просрочено</th><th className="num" title="Среднее время задачи на проверке">Ср. проверка</th></tr></thead>
                  <tbody>
                    {data.buyers.map((b) => (
                      <tr key={b.id}>
                        <td><span className="person"><Avatar name={b.name} color={b.color} size={20} />{b.name}</span></td>
                        <td className="num">{b.created}</td><td className="num">{b.active}</td>
                        <td className={`num ${b.overdue ? 'bad-text' : ''}`}>{b.overdue}</td>
                        <td className="num">{fmtDuration(b.avgReviewTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
      {tip && <div className="viz-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.content}</div>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = '' }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="kpi-label"><Icon size={15} />{label}</span>
      <b className="kpi-value">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

const LOAD_PARTS = [
  { k: 'inProgress', label: 'В работе', color: STATUS.in_progress.color },
  { k: 'inReview', label: 'На проверке', color: STATUS.review.color },
  { k: 'inRevision', label: 'Правки', color: STATUS.revision.color },
];

function WorkloadTable({ rows, showTip, hideTip }) {
  const maxActive = Math.max(1, ...rows.map((r) => r.active));
  return (
    <>
      <div className="table-wrap">
        <table className="table workload">
          <thead>
            <tr>
              <th>Креативщик</th>
              <th title="Активные задачи и единицы креативов в них">Загрузка</th>
              <th className="num" title="Завершённые задачи (единиц креативов)">Готово</th>
              <th className="num" title="Задачи с нарушенным дедлайном">Просроч.</th>
              <th className="num" title="Раундов правок">Правки</th>
              <th className="num" title="Среднее время от взятия до приёмки">Ср. цикл</th>
              <th className="num">AI-кр.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><span className="person"><Avatar name={r.name} color={r.color} size={26} /><span><b>{r.name}</b><small className="muted wl-pos">{r.position}</small></span></span></td>
                <td className="load-cell">
                  <div className="load-bar">
                    {LOAD_PARTS.filter((p) => r[p.k]).map((p) => (
                      <i key={p.k} style={{ width: `${(r[p.k] / maxActive) * 100}%`, background: p.color }}
                        onMouseMove={(e) => showTip(e, <><b>{r.name}</b><span>{p.label}: {r[p.k]}</span></>)} onMouseLeave={hideTip} />
                    ))}
                    <span title={`${r.active} задач, ${r.activeUnits} ед. креативов`}>{r.active}<small className="muted"> · {r.activeUnits} ед.</small></span>
                  </div>
                </td>
                <td className="num" title={`${r.doneUnits} ед. креативов`}>{r.done}</td>
                <td className={`num ${r.overdue ? 'bad-text' : ''}`}>{r.overdue}</td>
                <td className="num">{r.revisions}</td>
                <td className="num">{fmtDuration(r.avgCycleTime)}</td>
                <td className="num">{fmtNum(r.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="legend legend-row">
        {LOAD_PARTS.map((p) => <li key={p.k}><i style={{ background: p.color }} />{p.label}</li>)}
      </ul>
    </>
  );
}

function ServiceBars({ rows, total, showTip, hideTip }) {
  if (!rows.length) return <p className="muted small">Расходов нет</p>;
  const max = Math.max(...rows.map((r) => r.credits));
  return (
    <>
      <div className="hbars">
        {rows.map((r) => (
          <div key={r.service} className="hbar"
            onMouseMove={(e) => showTip(e, <><b>{r.service}</b><span>{fmtNum(r.credits)} кредитов · {fmtPct(r.credits / total)}</span><span>основная работа: {fmtNum(r.credits - r.revisionCredits)}</span><span>правки: {fmtNum(r.revisionCredits)}</span><span>записей: {r.entries}</span></>)}
            onMouseLeave={hideTip}>
            <span className="hbar-label">{r.service}</span>
            <span className="hbar-track">
              <i style={{ width: `${((r.credits - r.revisionCredits) / max) * 100}%`, background: 'var(--series-1)' }} />
              {r.revisionCredits > 0 && <i style={{ width: `${(r.revisionCredits / max) * 100}%`, background: 'var(--series-2)' }} />}
            </span>
            <b className="hbar-val">{fmtNum(r.credits)}</b>
          </div>
        ))}
      </div>
      <ul className="legend legend-row">
        <li><i style={{ background: 'var(--series-1)' }} />Основная работа</li>
        <li><i style={{ background: 'var(--series-2)' }} />Правки</li>
      </ul>
    </>
  );
}

function Heatmap({ ai, showTip, hideTip }) {
  if (!ai.byService.length) return <p className="muted small">Расходов нет</p>;
  const max = Math.max(...ai.byService.flatMap((s) => Object.values(s.byUser)));
  const userTotal = (id) => ai.byService.reduce((s, r) => s + (r.byUser[id] || 0), 0);
  return (
    <div className="table-wrap">
      <table className="table heat">
        <thead>
          <tr><th>Сервис</th>{ai.users.map((u) => <th key={u.id} className="num" title={u.name}>{u.name.split(' ')[0]}</th>)}</tr>
        </thead>
        <tbody>
          {ai.byService.map((s) => (
            <tr key={s.service}>
              <td>{s.service}</td>
              {ai.users.map((u) => {
                const v = s.byUser[u.id] || 0;
                const a = v ? 0.12 + (v / max) * 0.78 : 0;
                return (
                  <td key={u.id} className="num heat-cell" style={{ '--a': a }}
                    onMouseMove={(e) => showTip(e, <><b>{s.service} · {u.name}</b><span>{fmtNum(v)} кредитов</span></>)} onMouseLeave={hideTip}>
                    <span className={a > 0.55 ? 'on-dark' : ''}>{v ? fmtNum(v) : '·'}</span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="total-row"><td>Итого</td>{ai.users.map((u) => <td key={u.id} className="num"><b>{fmtNum(userTotal(u.id))}</b></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

/** Вертикальные столбцы по дням; 1–2 серии рядом, одна ось. */
function DayBars({ days, keys, showTip, hideTip }) {
  const max = Math.max(1, ...days.flatMap((d) => keys.map((k) => d[k.k])));
  // на узких экранах подписей по оси X меньше, чтобы они не налезали друг на друга
  const step = Math.ceil(days.length / (window.innerWidth < 700 ? 4 : 10));
  const ticks = [max, Math.round(max / 2), 0];
  return (
    <>
      <div className="daybars">
        <div className="daybars-y">{ticks.map((t, i) => <span key={i}>{fmtNum(t)}</span>)}</div>
        <div className="daybars-plot">
          <div className="gridlines"><i /><i /><i /></div>
          {days.map((d, i) => (
            <div key={d.day} className="daycol"
              onMouseMove={(e) => showTip(e, <><b>{fmtDay(d.day)}</b>{keys.map((k) => <span key={k.k}><i className="sw" style={{ background: k.color }} />{k.label}: {fmtNum(d[k.k])}</span>)}</>)}
              onMouseLeave={hideTip}>
              <div className="daycol-bars">
                {keys.map((k) => <i key={k.k} style={{ height: `${(d[k.k] / max) * 100}%`, background: k.color }} />)}
              </div>
              <span className="daycol-x">{i % step === 0 ? fmtDay(d.day) : ''}</span>
            </div>
          ))}
        </div>
      </div>
      {keys.length > 1 && (
        <ul className="legend legend-row">{keys.map((k) => <li key={k.k}><i style={{ background: k.color }} />{k.label}</li>)}</ul>
      )}
    </>
  );
}
