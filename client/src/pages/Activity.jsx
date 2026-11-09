import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../api.js';
import { ACTION_LABEL } from '../utils.js';
import { HistoryList } from '../components/TaskModal.jsx';
import { Empty } from '../components/ui.jsx';

export default function Activity() {
  const [items, setItems] = useState(null);
  const [action, setAction] = useState('');
  useEffect(() => {
    const load = () => api.get('/activity?limit=300').then(setItems).catch(() => setItems([]));
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);
  const shown = (items || []).filter((h) => !action || h.action === action);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>История действий</h1>
          <p className="muted">Журнал всех событий: создание, смена статусов, правки, расходы, изменения полей.</p>
        </div>
        <select className="input input-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Все события</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </header>
      <div className="panel">
        {items === null ? <div className="splash small"><div className="spinner" /></div>
          : shown.length === 0 ? <Empty icon={History} title="Событий нет" />
          : <HistoryList items={shown} showTask />}
      </div>
    </div>
  );
}
