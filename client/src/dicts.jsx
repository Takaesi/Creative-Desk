import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Справочники (офферы, подходы, AI-сервисы, пороги) — один запрос на всё приложение.
const DictCtx = createContext({ dicts: null, reload: () => {} });

export function DictProvider({ children }) {
  const [dicts, setDicts] = useState(null);
  const reload = useCallback(() => api.get('/dictionaries').then(setDicts).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return <DictCtx.Provider value={{ dicts, reload }}>{children}</DictCtx.Provider>;
}

export const useDicts = () => useContext(DictCtx);
