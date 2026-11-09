import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('buyer','creative','lead')),
  position      TEXT,
  color         TEXT NOT NULL DEFAULT '#6366f1',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  offer          TEXT NOT NULL,
  geo            TEXT NOT NULL,
  creative_type  TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  description    TEXT NOT NULL DEFAULT '',
  references_text TEXT NOT NULL DEFAULT '',
  priority       TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  deadline       TEXT,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','review','revision','done')),
  buyer_id       INTEGER NOT NULL REFERENCES users(id),
  creative_id    INTEGER REFERENCES users(id),
  revision_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  taken_at       TEXT,
  submitted_at   TEXT,
  completed_at   TEXT,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_creative ON tasks(creative_id);
CREATE INDEX IF NOT EXISTS idx_tasks_buyer ON tasks(buyer_id);

-- Сдачи результата (каждая отправка на проверку = отдельный раунд)
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  round       INTEGER NOT NULL,
  creative_id INTEGER NOT NULL REFERENCES users(id),
  comment     TEXT NOT NULL DEFAULT '',
  links       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('reference','result')),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- Расходы AI-кредитов: round = номер раунда (0 — первичная работа, 1..N — правки)
CREATE TABLE IF NOT EXISTS ai_expenses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  service    TEXT NOT NULL,
  credits    REAL NOT NULL CHECK (credits >= 0),
  round      INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exp_task ON ai_expenses(task_id);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','revision')),
  created_at TEXT NOT NULL
);

-- История действий и смены статусов (append-only)
CREATE TABLE IF NOT EXISTS history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  task_title  TEXT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hist_task ON history(task_id);
`);

export const nowIso = () => new Date().toISOString();

export function logHistory({ taskId, taskTitle, userId, action, from = null, to = null, details = null, at = nowIso() }) {
  db.prepare(
    `INSERT INTO history (task_id, task_title, user_id, action, from_status, to_status, details, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(taskId, taskTitle ?? null, userId ?? null, action, from, to, details ? JSON.stringify(details) : null, at);
}
