import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Link2, FileText, Flame, ArrowUp, ArrowDown } from 'lucide-react';
import { CREATIVE_STATUS, fmtPct1, fmtMoney } from '../utils.js';
import { Avatar } from './ui.jsx';

export const CreativeStatusBadge = ({ s }) => (
  <span className="badge status-badge" style={{ '--c': CREATIVE_STATUS[s]?.color }}>
    <i className="dot" />{CREATIVE_STATUS[s]?.label || s}
  </span>
);

/** Превью креатива: картинка, видео (проигрывается при наведении) или ссылка. */
export function CreativePreview({ c, full = false, hoverPlay = true }) {
  const ref = useRef(null);
  if (c.preview_kind === 'image') return <img className="cr-media" src={c.preview_url} alt={c.title} loading="lazy" />;
  if (c.preview_kind === 'video') {
    return full
      ? <video className="cr-media" src={c.preview_url} controls preload="metadata" />
      : (
        <video
          ref={ref} className="cr-media" src={c.preview_url} muted preload="metadata" playsInline loop
          onMouseEnter={() => hoverPlay && ref.current?.play().catch(() => {})}
          onMouseLeave={() => { if (ref.current) { ref.current.pause(); ref.current.currentTime = 0; } }}
        />
      );
  }
  if (c.preview_kind === 'link') {
    return (
      <div className="cr-media cr-link">
        <Link2 size={full ? 36 : 24} />
        <span>{c.domain}</span>
        {full && <a className="btn btn-soft btn-sm" href={c.link} target="_blank" rel="noreferrer">Открыть ссылку</a>}
      </div>
    );
  }
  return <div className="cr-media cr-link"><FileText size={full ? 36 : 24} /><span>{c.file_name}</span></div>;
}

export function CreativeCard({ c, children }) {
  const m = c.metrics_summary;
  return (
    <article className="cr-card">
      <Link to={`/library/${c.id}`} className="cr-card-link">
        <div className="cr-thumb">
          <CreativePreview c={c} />
          {c.burnout && <span className="cr-flame" title="Сигнал выгорания: CTR падает"><Flame size={16} /></span>}
          {c.task_iteration > 1 && <span className="cr-iter" title="Вариация">итер. {c.task_iteration}</span>}
        </div>
        <div className="cr-body">
          <div className="cr-top">
            <span className="card-id">{c.code}</span>
            <CreativeStatusBadge s={c.status} />
          </div>
          <b className="cr-title" title={c.title}>{c.title}</b>
          <div className="card-meta">
            {c.offer_name && <span className="tag">{c.offer_name}</span>}
            <span className="tag">{c.geo}</span>
            <span className="tag">{c.creative_type}</span>
          </div>
          {m ? (
            <div className="cr-metrics">
              <div><small>ROI</small><b className={m.roi == null ? '' : m.roi >= 0 ? 'pos' : 'neg'}>{fmtPct1(m.roi)}</b></div>
              <div><small>CTR</small><b>{fmtPct1(m.ctr)}</b></div>
            </div>
          ) : <div className="cr-metrics cr-metrics-empty muted small">нет результатов</div>}
          <div className="cr-foot">
            <Avatar name={c.author_name} color={c.author_color} size={20} title={`Автор: ${c.author_name}`} />
            <span className="muted small">{c.author_name}</span>
          </div>
        </div>
      </Link>
      {children}
    </article>
  );
}

/** Мини-карточка для «Семейства»: превью, вердикт, ROI и сравнение с родителем. */
export function CreativeMini({ c, parentRoi }) {
  const roi = c.metrics_summary?.roi;
  const cmp = parentRoi != null && roi != null ? (roi > parentRoi ? 'up' : roi < parentRoi ? 'down' : null) : null;
  return (
    <Link to={`/library/${c.id}`} className="cr-mini">
      <div className="cr-mini-thumb"><CreativePreview c={c} hoverPlay={false} /></div>
      <div className="cr-mini-body">
        <span className="card-id">{c.code}</span>
        <CreativeStatusBadge s={c.status} />
        <span className="cr-mini-roi">
          ROI {fmtPct1(roi)}
          {cmp === 'up' && <ArrowUp size={14} className="pos" aria-label="выше родителя" />}
          {cmp === 'down' && <ArrowDown size={14} className="neg" aria-label="ниже родителя" />}
        </span>
      </div>
    </Link>
  );
}

/** «Исходный креатив» для задачи-вариации: превью, ROI, CTR, ссылка в библиотеку. */
export function ParentCreative({ c, className = '' }) {
  const m = c.metrics_summary;
  return (
    <div className={`parent-cr ${className}`}>
      <div className="parent-cr-thumb"><CreativePreview c={c} hoverPlay={false} /></div>
      <div className="parent-cr-body">
        <small className="muted">Исходный креатив · прикреплён как референс</small>
        <div className="cr-top"><Link to={`/library/${c.id}`} className="card-id">{c.code}</Link><CreativeStatusBadge s={c.status} /></div>
        <b className="cr-title">{c.title}</b>
        {m ? <span className="small">ROI <b>{fmtPct1(m.roi)}</b> · CTR <b>{fmtPct1(m.ctr)}</b> · расход {fmtMoney(m.spend)}</span> : <span className="muted small">результатов нет</span>}
      </div>
    </div>
  );
}
