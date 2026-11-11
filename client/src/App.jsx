import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { KanbanSquare, BarChart3, History, LogOut, Sparkles, Settings as SettingsIcon, Images, Plus, ListTodo } from 'lucide-react';
import { NewTaskProvider, useNewTask } from './newTask.jsx';
import Library from './pages/Library.jsx';
import CreativePage from './pages/CreativePage.jsx';
import { DictProvider } from './dicts.jsx';
import Settings from './pages/Settings.jsx';
import { useAuth } from './auth.jsx';
import { ROLE } from './utils.js';
import { Avatar, ToastProvider } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import Analytics from './pages/Analytics.jsx';
import Activity from './pages/Activity.jsx';

export default function App() {
  const { user, logout } = useAuth();
  if (user === undefined) return <div className="splash"><div className="spinner" /></div>;
  if (!user) return <Login />;

  const isLead = user.role === 'lead';
  return (
    <DictProvider>
    <ToastProvider>
    <NewTaskProvider>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-logo"><Sparkles size={18} /></span>
            <div>
              <b>Creative Desk</b>
              <small>креативный отдел</small>
            </div>
          </div>
          {user.role !== 'creative' && <NewTaskButton />}
          <nav>
            <NavLink to="/board"><KanbanSquare size={18} /><span>Доска задач</span></NavLink>
            <NavLink to="/library"><Images size={18} /><span>Библиотека</span></NavLink>
            {isLead && <NavLink to="/analytics"><BarChart3 size={18} /><span>Аналитика</span></NavLink>}
            <NavLink to="/activity"><History size={18} /><span>История действий</span></NavLink>
            {user.role !== 'creative' && <NavLink to="/settings"><SettingsIcon size={18} /><span>Настройки</span></NavLink>}
          </nav>
          <div className="me">
            <Avatar name={user.name} color={user.color} size={34} />
            <div className="me-info">
              <b>{user.name}</b>
              <small>{ROLE[user.role]}</small>
            </div>
            <button className="icon-btn" onClick={logout} title="Выйти"><LogOut size={17} /></button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/board" element={<Board />} />
            <Route path="/board/:taskId" element={<Board />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:creativeId" element={<CreativePage />} />
            {isLead && <Route path="/analytics" element={<Analytics />} />}
            <Route path="/activity" element={<Activity />} />
            {user.role !== 'creative' && <Route path="/settings" element={<Settings />} />}
            <Route path="*" element={<Navigate to={isLead ? '/analytics' : '/board'} replace />} />
          </Routes>
        </main>
      </div>
    </NewTaskProvider>
    </ToastProvider>
    </DictProvider>
  );
}

function NewTaskButton() {
  const { openNew } = useNewTask();
  return <button className="btn btn-primary new-task-btn" onClick={() => openNew()} title="Новое ТЗ (N)"><Plus size={16} /><span>Новое ТЗ</span></button>;
}
