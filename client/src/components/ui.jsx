import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { initials, PRIORITY, STATUS } from '../utils.js';

export function Avatar({ name, color, size = 28, title }) {
  if (!name) return <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Не назначен">?</span>;
  return (
    <span className="avatar" title={title || name} style={{ width: size, height: size, background: color || '#6366f1', fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

export const PriorityBadge = ({ p }) => <span className={`badge ${PRIORITY[p]?.cls}`}>{PRIORITY[p]?.label}</span>;

export const StatusBadge = ({ s }) => (
  <span className="badge status-badge" style={{ '--c': STATUS[s]?.color }}>
    <i className="dot" />{STATUS[s]?.short}
  </span>
);

export function Modal({ open, onClose, title, children, width = 560, footer, className = '' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, required, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{required && <b className="req">*</b>}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ icon: Icon, title, text }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} />}
      <b>{title}</b>
      {text && <span>{text}</span>}
    </div>
  );
}

// ---- toasts ----
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
