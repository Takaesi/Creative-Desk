import { createContext, useCallback, useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useToast } from './components/ui.jsx';
import TaskForm from './components/TaskForm.jsx';

// Форма нового ТЗ доступна из любого места: кнопка в меню, «Сделать вариации», «Дублировать», «Моя очередь».
const Ctx = createContext({ openNew: () => {}, openVariations: () => {} });

export function NewTaskProvider({ children }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(null); // { initial, title, parent, onCreated }

  const openNew = useCallback((initial = null, opts = {}) => setForm({ initial, ...opts }), []);
  const openVariations = useCallback(async (creativeId, onCreated) => {
    try {
      const draft = await api.get(`/creatives/${creativeId}/variation-draft`);
      setForm({ initial: draft.fields, parent: draft.parent, title: `Вариации ${draft.parent.code}`, onCreated });
    } catch (e) { toast(e.message, 'error'); }
  }, [toast]);

  const saved = (task) => {
    const cb = form?.onCreated;
    setForm(null);
    toast('Задача создана');
    window.dispatchEvent(new Event('tasks:changed'));
    if (cb) cb(task); else navigate(`/board/${task.id}`);
  };

  return (
    <Ctx.Provider value={{ openNew, openVariations }}>
      {children}
      {form && <TaskForm key={JSON.stringify(form.initial || {})} initial={form.initial} parent={form.parent} title={form.title} onClose={() => setForm(null)} onSaved={saved} />}
    </Ctx.Provider>
  );
}

export const useNewTask = () => useContext(Ctx);
