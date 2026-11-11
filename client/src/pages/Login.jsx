import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, LogIn, KanbanSquare, Timer, Coins, BarChart3 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar } from '../components/ui.jsx';
import { ROLE } from '../utils.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState([]);

  useEffect(() => { api.get('/demo-users').then(setDemo).catch(() => {}); }, []);

  const submit = async (e, creds) => {
    e?.preventDefault();
    setBusy(true); setError('');
    // стартовая страница для всех ролей — «Моя очередь»
    try { await login(creds?.email ?? email, creds?.password ?? password); navigate('/queue', { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-hero">
        <div className="brand brand-lg">
          <span className="brand-logo"><Sparkles size={22} /></span>
          <b>Creative Desk</b>
        </div>
        <h1>Задачи между байерами и креативщиками — в одном месте</h1>
        <ul className="login-features">
          <li><KanbanSquare size={18} /> Kanban: Новые → В работе → На проверке → Правки → Готово</li>
          <li><Timer size={18} /> Автоматический учёт времени на каждом этапе</li>
          <li><Coins size={18} /> Расходы AI-кредитов по задачам, сервисам и людям</li>
          <li><BarChart3 size={18} /> Аналитика загрузки, сроков и просрочек</li>
        </ul>
      </div>
      <div className="login-card">
        <h2>Вход</h2>
        <form onSubmit={submit}>
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <input className="input" type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}><LogIn size={16} /> Войти</button>
        </form>
        {demo.length > 0 && (
          <>
            <div className="divider"><span>Демо-доступ · пароль <code>demo123</code></span></div>
            <div className="demo-users">
              {demo.map((u) => (
                <button key={u.id} className="demo-user" disabled={busy} onClick={() => submit(null, { email: u.email, password: 'demo123' })}>
                  <Avatar name={u.name} color={u.color} size={32} />
                  <span>
                    <b>{u.name}</b>
                    <small>{ROLE[u.role]} · {u.position}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
