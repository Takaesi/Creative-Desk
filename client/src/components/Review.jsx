// F7. Ревью с пинами: замечание прямо на точке картинки или кадре видео, общие замечания — для ссылок.
// Координаты пина — доли 0..1 от показанного изображения, поэтому он стоит на месте при любом размере экрана.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play, Pause, MessageSquarePlus, Check, RotateCcw, Trash2, Link2, FileText, MapPin } from 'lucide-react';
import { api } from '../api.js';
import { fmtDate } from '../utils.js';
import { useToast } from './ui.jsx';

export const fmtTime = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const NEAR_SEC = 0.6; // пин видео виден на кадре в окне ±0,6 с от своего времени

export default function ReviewViewer({ creativeId, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [selected, setSelected] = useState(null); // id замечания (или 'p<id>' — прошлой версии)
  const [pending, setPending] = useState(null); // { x?, y?, time_sec? } — новое замечание
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.get(`/creatives/${creativeId}/annotations`).then(setD).catch((e) => setError(e.message)), [creativeId]);
  useEffect(() => { load(); }, [load]);

  // Esc закрывает только просмотрщик (или отменяет новое замечание), а не модалку задачи под ним
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (pending) { setPending(null); setText(''); } else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, onClose]);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const changed = () => { load(); onChanged?.(); };
  const call = async (fn, msg) => { try { await fn(); if (msg) toast(msg); changed(); return true; } catch (e) { toast(e.message, 'error'); return false; } };

  const save = async () => {
    if (!text.trim()) return;
    const ok = await call(() => api.post(`/creatives/${creativeId}/annotations`, { ...pending, text }), 'Замечание добавлено');
    if (ok) { setPending(null); setText(''); }
  };

  if (error) return <Shell onClose={onClose} title="Замечания"><p className="form-error">{error}</p></Shell>;
  if (!d) return <Shell onClose={onClose} title="Замечания"><div className="splash small"><div className="spinner" /></div></Shell>;

  const c = d.creative;
  const kind = c.preview_kind;
  const pins = d.items.map((a, i) => ({ ...a, n: i + 1 }));
  const prev = (d.previous?.items || []).map((a, i) => ({ ...a, n: i + 1, prev: true, key: `p${a.id}` }));
  const canPoint = d.can.create && ['image', 'video'].includes(kind);
  const openCount = pins.filter((a) => a.status === 'open').length;
  const startPin = (p) => { if (!d.can.create) return; setPending(p); setSelected(null); setText(''); };
  const select = (a) => setSelected(a.prev ? a.key : a.id);
  const isSel = (a) => (a.prev ? selected === a.key : selected === a.id);

  return (
    <Shell onClose={onClose} title={<><span className="card-id">{c.code}</span> {c.title} <span className="muted small">· v{c.version}</span></>}>
      <div className="rv-layout">
        <div className="rv-stage">
          {kind === 'image' && (
            <ImageStage src={c.preview_url} alt={c.title} pins={pins} prev={prev} pending={pending} canPin={canPoint}
              onPin={startPin} isSel={isSel} onSelect={select} />
          )}
          {kind === 'video' && (
            <VideoStage src={c.preview_url} pins={pins} prev={prev} pending={pending} canPin={canPoint}
              onPin={startPin} isSel={isSel} onSelect={select} selectedPin={[...pins, ...prev].find(isSel)} />
          )}
          {!['image', 'video'].includes(kind) && (
            <div className="rv-link">
              {kind === 'link' ? <Link2 size={36} /> : <FileText size={36} />}
              {c.link ? <a href={c.link} target="_blank" rel="noreferrer">{c.domain || c.link}</a> : <a href={`${c.preview_url}?download=1`}>{c.file_name}</a>}
              <p className="muted small">К ссылке и файлу — только общие замечания, без точки на кадре.</p>
            </div>
          )}
          {canPoint && !pending && <p className="rv-hint muted small">{kind === 'video' ? 'Поставьте видео на паузу и кликните по кадру — замечание привяжется к точке и секунде.' : 'Кликните по месту на картинке, чтобы оставить замечание к нему.'}</p>}
        </div>

        <aside className="rv-side">
          <div className="rv-side-head">
            <b>Замечания</b>
            <span className={`count ${openCount ? 'count-on' : ''}`} title="Открытых">{openCount}</span>
            <span className="muted small">из {pins.length}</span>
            {d.can.create && (
              <button className="btn btn-sm btn-soft rv-general" onClick={() => startPin({})}><MessageSquarePlus size={14} /> Общее замечание</button>
            )}
          </div>
          {!d.can.create && d.task.status === 'review' && d.can.owner && !d.current && <p className="muted small">Это не актуальная версия — замечания ставятся на последнюю.</p>}

          {pending && (
            <div className="rv-new">
              <label className="field-label">
                Замечание №{pins.length + 1}
                {pending.time_sec != null && <> · {fmtTime(pending.time_sec)}</>}
                {pending.x == null && <> · общее</>}
              </label>
              <textarea className="input" rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Что поправить в этом месте"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
              <div className="rv-new-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => { setPending(null); setText(''); }}>Отмена</button>
                <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={save}>Добавить</button>
              </div>
            </div>
          )}

          {pins.length === 0 && !pending && <p className="muted small">{d.can.create ? 'Замечаний пока нет.' : 'Замечаний к этой версии нет.'}</p>}
          <ol className="rv-list">
            {pins.map((a) => (
              <AnnItem key={a.id} a={a} sel={isSel(a)} onSelect={() => select(a)} can={d.can}
                onResolve={() => call(() => api.patch(`/annotations/${a.id}`, { status: 'resolved' }), 'Отмечено как исправленное')}
                onReopen={() => call(() => api.patch(`/annotations/${a.id}`, { status: 'open' }), 'Замечание снова открыто')}
                onDelete={() => confirm('Удалить замечание?') && call(() => api.del(`/annotations/${a.id}`), 'Замечание удалено')} />
            ))}
          </ol>

          {prev.length > 0 && (
            <>
              <div className="rv-prev-head">К прошлой версии · {d.previous.creative.code} v{d.previous.creative.version}</div>
              <p className="muted small">Сверьтесь, всё ли исправлено: эти пины показаны на картинке полупрозрачными.</p>
              <ol className="rv-list rv-list-prev">
                {prev.map((a) => <AnnItem key={a.key} a={a} sel={isSel(a)} onSelect={() => select(a)} can={{}} />)}
              </ol>
            </>
          )}
        </aside>
      </div>
    </Shell>
  );
}

// портал в body: у .modal-backdrop есть backdrop-filter, и fixed-элемент внутри неё позиционировался бы от модалки, а не от окна
function Shell({ title, onClose, children }) {
  return createPortal(
    <div className="rv-backdrop" role="dialog" aria-modal="true" aria-label="Ревью креатива">
      <div className="rv-head">
        <h3>{title}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть ревью"><X size={20} /></button>
      </div>
      <div className="rv-body">{children}</div>
    </div>,
    document.body,
  );
}

function AnnItem({ a, sel, onSelect, can, onResolve, onReopen, onDelete }) {
  const done = a.status === 'resolved';
  return (
    <li className={`rv-item ${sel ? 'sel' : ''} ${done ? 'done' : ''} ${a.prev ? 'prev' : ''}`} data-ann={a.prev ? `p${a.n}` : a.n}>
      <button className="rv-item-main" onClick={onSelect}>
        <span className={`pin-num ${a.x == null ? 'pin-general' : ''}`}>{a.x == null ? <MessageSquarePlus size={11} /> : a.n}</span>
        <span className="rv-item-text">
          <span>{a.text}</span>
          <small className="muted">
            {a.author_name} · {fmtDate(a.created_at)}
            {a.time_sec != null && <> · <b className="rv-time">{fmtTime(a.time_sec)}</b></>}
            {a.prev && ' · к прошлой версии'}
          </small>
        </span>
        <span className={`badge ${done ? 'rv-ok' : 'rv-open'}`}>{done ? 'исправлено' : 'открыто'}</span>
      </button>
      {!a.prev && (
        <span className="rv-item-actions">
          {!done && can.resolve && <button className="btn btn-xs btn-success" onClick={onResolve}><Check size={12} /> Исправлено</button>}
          {done && can.reopen && <button className="btn btn-xs btn-ghost" onClick={onReopen}><RotateCcw size={12} /> Вернуть</button>}
          {a.can_delete && <button className="icon-btn icon-btn-sm" onClick={onDelete} aria-label="Удалить замечание"><Trash2 size={13} /></button>}
        </span>
      )}
    </li>
  );
}

/** Доли 0..1 от прямоугольника показанного медиа. */
function fracOf(e, el) {
  const r = el.getBoundingClientRect();
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return { x: Math.round(clamp((e.clientX - r.left) / r.width) * 10000) / 10000, y: Math.round(clamp((e.clientY - r.top) / r.height) * 10000) / 10000 };
}

function Pins({ pins, prev, pending, isSel, onSelect, visible = () => true }) {
  return (
    <>
      {prev.filter((a) => a.x != null && visible(a)).map((a) => (
        <button key={a.key} className={`pin pin-prev ${isSel(a) ? 'sel' : ''}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
          title={`К прошлой версии: ${a.text}`} onClick={(e) => { e.stopPropagation(); onSelect(a); }}>{a.n}</button>
      ))}
      {pins.filter((a) => a.x != null && visible(a)).map((a) => (
        <button key={a.id} className={`pin ${a.status === 'resolved' ? 'pin-done' : ''} ${isSel(a) ? 'sel' : ''}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
          title={a.text} data-pin={a.n} onClick={(e) => { e.stopPropagation(); onSelect(a); }}>{a.n}</button>
      ))}
      {pending?.x != null && <span className="pin pin-new" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}>{pins.length + 1}</span>}
    </>
  );
}

function ImageStage({ src, alt, pins, prev, pending, canPin, onPin, isSel, onSelect }) {
  const img = useRef(null);
  return (
    <div className={`rv-frame ${canPin ? 'can-pin' : ''}`} onClick={(e) => canPin && onPin(fracOf(e, img.current))}>
      <img ref={img} src={src} alt={alt} draggable={false} />
      <Pins pins={pins} prev={prev} pending={pending} isSel={isSel} onSelect={onSelect} />
    </div>
  );
}

/** Свой плеер поверх нативного <video>: пауза, полоса прогресса с засечками пинов, пин по клику на паузе. */
function VideoStage({ src, pins, prev, pending, canPin, onPin, isSel, onSelect, selectedPin }) {
  const v = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const seek = (t) => { const el = v.current; if (!el) return; el.pause(); el.currentTime = Math.max(0, Math.min(t, el.duration || t)); setCur(el.currentTime); };
  // выбор замечания в списке перематывает видео на его секунду
  useEffect(() => { if (selectedPin?.time_sec != null) seek(selectedPin.time_sec); }, [selectedPin?.id, selectedPin?.key]);

  const toggle = () => { const el = v.current; if (el.paused) el.play().catch(() => {}); else el.pause(); };
  const onFrame = (e) => {
    const el = v.current;
    if (!el.paused) { el.pause(); return; }
    if (canPin) onPin({ ...fracOf(e, el), time_sec: Math.round(el.currentTime * 100) / 100 });
    else toggle();
  };
  const timed = [...prev, ...pins].filter((a) => a.time_sec != null);
  return (
    <div className="rv-video">
      <div className={`rv-frame ${canPin && !playing ? 'can-pin' : ''}`} onClick={onFrame}>
        <video ref={v} src={src} preload="metadata" playsInline
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} onDurationChange={(e) => setDur(e.currentTarget.duration || 0)} />
        <Pins pins={pins} prev={prev} pending={pending} isSel={isSel} onSelect={onSelect}
          visible={(a) => isSel(a) || a.time_sec == null || Math.abs(a.time_sec - cur) <= NEAR_SEC} />
      </div>
      <div className="rv-controls">
        <button className="icon-btn" onClick={toggle} aria-label={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <div className="rv-bar" role="slider" aria-label="Перемотка" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(cur)} tabIndex={0}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (dur) seek(((e.clientX - r.left) / r.width) * dur); }}>
          <i className="rv-bar-fill" style={{ width: `${dur ? (cur / dur) * 100 : 0}%` }} />
          {dur > 0 && timed.map((a) => (
            <button key={a.key || a.id} className={`rv-mark ${a.prev ? 'prev' : ''} ${isSel(a) ? 'sel' : ''}`} style={{ left: `${Math.min(100, (a.time_sec / dur) * 100)}%` }}
              title={`${fmtTime(a.time_sec)} — ${a.text}`} aria-label={`Замечание ${a.n} на ${fmtTime(a.time_sec)}`} data-mark={a.prev ? `p${a.n}` : a.n}
              onClick={(e) => { e.stopPropagation(); onSelect(a); seek(a.time_sec); }} />
          ))}
        </div>
        <span className="rv-clock" data-time={cur.toFixed(2)}>{fmtTime(cur)} / {fmtTime(dur)}</span>
      </div>
    </div>
  );
}

/** Кнопка «Ревью» / «Замечания · N» для креатива сдачи. */
export function ReviewButton({ c, review, onOpen }) {
  if (!review && !c.pins_total) return null;
  return (
    <button className={`btn btn-xs ${review ? 'btn-soft' : 'btn-ghost'}`} onClick={() => onOpen(c.id)} title="Пометки на креативе">
      <MapPin size={12} /> {review ? 'Ревью' : 'Замечания'}{c.pins_total ? ` · ${c.pins_open}/${c.pins_total}` : ''}
    </button>
  );
}
