import { useEffect, useState } from 'react';
import { FileText, Trash2, Users, User } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PRIORITY } from '../utils.js';
import { Empty, useToast } from './ui.jsx';
import { EditCell } from '../pages/Settings.jsx';
import { useNewTask } from '../newTask.jsx';

/** Вкладка «Шаблоны ТЗ»: байер — свои и общие, руководитель — все. */
export default function Templates() {
  const { user } = useAuth();
  const toast = useToast();
  const { openNew } = useNewTask();
  const [list, setList] = useState(null);
  const load = () => api.get('/templates').then(setList).catch((e) => { toast(e.message, 'error'); setList([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (t, body, msg = 'Сохранено') => {
    try { await api.patch(`/templates/${t.id}`, body); toast(msg); load(); return true; } catch (e) { toast(e.message, 'error'); return false; }
  };
  const del = async (t) => {
    if (!confirm(`Удалить шаблон «${t.name}»?`)) return;
    try { await api.del(`/templates/${t.id}`); toast('Шаблон удалён'); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const use = async (t) => {
    try { openNew(await api.post(`/templates/${t.id}/use`)); } catch (e) { toast(e.message, 'error'); }
  };

  if (!list) return <div className="splash small"><div className="spinner" /></div>;
  return (
    <section className="panel">
      {list.length === 0 ? (
        <Empty icon={FileText} title="Шаблонов пока нет" text="Заполните форму нового ТЗ и нажмите «Сохранить как шаблон» внизу формы." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Название</th><th>Что внутри</th><th>Доступ</th><th className="num">Использований</th><th /></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.can_edit ? <EditCell value={t.name} onSave={(v) => patch(t, { name: v })} /> : <b>{t.name}</b>}</td>
                  <td className="small">
                    {[t.creative_type && `${t.creative_type}${t.quantity ? ` ×${t.quantity}` : ''}`, t.offer_name, t.approach_name, t.geo, t.format,
                      t.priority && PRIORITY[t.priority]?.label, t.deadline_hours && `срок ${t.deadline_hours} ч`].filter(Boolean).join(' · ') || <span className="muted">—</span>}
                  </td>
                  <td>
                    {user.role === 'lead' ? (
                      <label className={`switch ${t.is_shared ? 'on' : ''}`}>
                        <input type="checkbox" checked={!!t.is_shared} onChange={(e) => patch(t, { is_shared: e.target.checked }, e.target.checked ? 'Шаблон стал общим' : 'Шаблон снова личный')} />
                        <i /> <span>{t.is_shared ? 'общий' : `личный · ${t.owner_name}`}</span>
                      </label>
                    ) : (
                      <span className="muted small">{t.is_shared ? <><Users size={13} /> общий</> : <><User size={13} /> личный</>}</span>
                    )}
                  </td>
                  <td className="num">{t.use_count}</td>
                  <td className="row-actions">
                    <button className="btn btn-soft btn-sm" onClick={() => use(t)}>Создать ТЗ</button>
                    {t.can_edit && <button className="icon-btn icon-btn-sm" onClick={() => del(t)} aria-label="Удалить шаблон"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
