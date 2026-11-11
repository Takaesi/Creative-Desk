import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // общий с сервером модуль (оценка ТЗ, трудоёмкость) — одна реализация на обе стороны
  resolve: { alias: { '@shared': path.resolve(here, '../shared') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' }, fs: { allow: ['..'] } },
});
