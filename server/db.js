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
  first_submitted_at TEXT,
  submitted_at   TEXT,
  revision_started_at TEXT,
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

// Миграции для БД, созданных ранее
const colsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
/** Идемпотентно добавляет колонку. Возвращает true, если колонка была добавлена. */
function addColumn(table, col, ddl) {
  if (colsOf(table).includes(col)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  return true;
}

if (addColumn('tasks', 'first_submitted_at', 'TEXT')) {
  db.exec("UPDATE tasks SET first_submitted_at = (SELECT MIN(created_at) FROM submissions s WHERE s.task_id = tasks.id)");
}
addColumn('tasks', 'revision_started_at', 'TEXT');

// ---------- v2: справочники, креативы, метрики, шаблоны ----------
db.exec(`
CREATE TABLE IF NOT EXISTS offers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  vertical   TEXT NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approaches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_services (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  credit_price_rub REAL NOT NULL DEFAULT 0 CHECK (credit_price_rub >= 0),
  is_active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brief_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_shared       INTEGER NOT NULL DEFAULT 0,
  offer_id        INTEGER REFERENCES offers(id),
  approach_id     INTEGER REFERENCES approaches(id),
  geo             TEXT,
  creative_type   TEXT,
  quantity        INTEGER,
  language        TEXT,
  format          TEXT,
  hook            TEXT,
  description     TEXT NOT NULL DEFAULT '',
  references_text TEXT NOT NULL DEFAULT '',
  priority        TEXT,
  deadline_hours  INTEGER,
  use_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creatives (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id            INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submission_id      INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  file_id            INTEGER REFERENCES files(id) ON DELETE SET NULL,
  link               TEXT,
  title              TEXT NOT NULL,
  slot               INTEGER NOT NULL,
  version            INTEGER NOT NULL,
  author_id          INTEGER NOT NULL REFERENCES users(id),
  buyer_id           INTEGER NOT NULL REFERENCES users(id),
  offer_id           INTEGER REFERENCES offers(id),
  approach_id        INTEGER REFERENCES approaches(id),
  geo                TEXT NOT NULL,
  creative_type      TEXT NOT NULL,
  parent_creative_id INTEGER REFERENCES creatives(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','superseded','accepted','in_test','winner','average','loser','burned','archived')),
  suggested_verdict  TEXT CHECK (suggested_verdict IN ('winner','average','loser')),
  burnout_detected_at TEXT,
  tags               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  accepted_at        TEXT,
  launched_at        TEXT,
  verdict_at         TEXT,
  updated_at         TEXT NOT NULL,
  CHECK ((file_id IS NOT NULL) OR (link IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_cr_task   ON creatives(task_id);
CREATE INDEX IF NOT EXISTS idx_cr_status ON creatives(status);
CREATE INDEX IF NOT EXISTS idx_cr_buyer  ON creatives(buyer_id);
CREATE INDEX IF NOT EXISTS idx_cr_parent ON creatives(parent_creative_id);

CREATE TABLE IF NOT EXISTS creative_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks      INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  conversions INTEGER NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  spend       REAL    NOT NULL DEFAULT 0 CHECK (spend >= 0),
  revenue     REAL    NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','csv')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (creative_id, date)
);

CREATE TABLE IF NOT EXISTS creative_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  norm       INTEGER NOT NULL CHECK (norm > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, month)
);
`);

addColumn('users', 'hourly_rate_rub', 'REAL NOT NULL DEFAULT 0');
addColumn('users', 'capacity_units', 'INTEGER NOT NULL DEFAULT 10');
addColumn('users', 'wip_limit', 'INTEGER');
addColumn('users', 'telegram_chat_id', 'TEXT');
addColumn('users', 'monthly_norm', 'INTEGER CHECK (monthly_norm IS NULL OR monthly_norm > 0)');
// с какого месяца действует норма по умолчанию: раньше — только записи creative_plans
addColumn('users', 'monthly_norm_from', 'TEXT');

addColumn('tasks', 'offer_id', 'INTEGER REFERENCES offers(id)');
addColumn('tasks', 'approach_id', 'INTEGER REFERENCES approaches(id)');
addColumn('tasks', 'language', "TEXT NOT NULL DEFAULT ''");
addColumn('tasks', 'format', "TEXT NOT NULL DEFAULT ''");
addColumn('tasks', 'hook', "TEXT NOT NULL DEFAULT ''");
addColumn('tasks', 'estimate_units', 'INTEGER NOT NULL DEFAULT 1 CHECK (estimate_units > 0)');
addColumn('tasks', 'brief_score', 'INTEGER');
addColumn('tasks', 'template_id', 'INTEGER REFERENCES brief_templates(id) ON DELETE SET NULL');
addColumn('tasks', 'parent_creative_id', 'INTEGER REFERENCES creatives(id) ON DELETE SET NULL');
addColumn('tasks', 'iteration', 'INTEGER NOT NULL DEFAULT 1');
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_creative_id)');

addColumn('submissions', 'hours_spent', 'REAL NOT NULL DEFAULT 0 CHECK (hours_spent >= 0)');
addColumn('history', 'creative_id', 'INTEGER REFERENCES creatives(id) ON DELETE SET NULL');
db.exec('CREATE INDEX IF NOT EXISTS idx_hist_creative ON history(creative_id)');

export const nowIso = () => new Date().toISOString();

// Пороговые настройки. Тип нужен для валидации PATCH /api/settings.
export const SETTINGS_SCHEMA = {
  wip_limit_default: { def: '3', type: 'int', min: 1, max: 50 },
  verdict_min_spend: { def: '50', type: 'num', min: 0, max: 1e9 },
  verdict_winner_roi: { def: '30', type: 'num', min: -100, max: 10000 },
  verdict_loser_roi: { def: '0', type: 'num', min: -100, max: 10000 },
  burnout_drop_pct: { def: '30', type: 'num', min: 1, max: 99 },
  burnout_min_days: { def: '5', type: 'int', min: 3, max: 60 },
  no_results_reminder_days: { def: '3', type: 'int', min: 1, max: 60 },
  currency: { def: '₽', type: 'str', max: 5 },
};

/** Данные из старых версий: офферы → справочник, AI-сервисы → таблица, настройки по умолчанию. */
function migrateDictionaries(aiServiceNames) {
  const at = nowIso();
  db.transaction(() => {
    const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(SETTINGS_SCHEMA)) insSetting.run(k, v.def);

    db.prepare(`INSERT OR IGNORE INTO offers (name, created_at) SELECT DISTINCT TRIM(offer), ? FROM tasks WHERE TRIM(offer) <> ''`).run(at);
    db.exec('UPDATE tasks SET offer_id = (SELECT o.id FROM offers o WHERE o.name = TRIM(tasks.offer)) WHERE offer_id IS NULL');

    // Константы — только при первом запуске (иначе переименованный сервис вернулся бы под старым именем)
    if (db.prepare('SELECT COUNT(*) c FROM ai_services').get().c === 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO ai_services (name) VALUES (?)');
      aiServiceNames.forEach((n) => ins.run(n));
    }
    db.exec(`INSERT OR IGNORE INTO ai_services (name) SELECT DISTINCT service FROM ai_expenses`);
  })();
}

export function getSettings() {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const out = {};
  for (const [k, s] of Object.entries(SETTINGS_SCHEMA)) {
    const raw = rows[k] ?? s.def;
    out[k] = s.type === 'str' ? raw : Number(raw);
  }
  return out;
}

export function runDbMigrations(aiServiceNames) {
  migrateDictionaries(aiServiceNames);
}

export function logHistory({ taskId, taskTitle, userId, action, from = null, to = null, details = null, at = nowIso(), creativeId = null }) {
  db.prepare(
    `INSERT INTO history (task_id, task_title, user_id, action, from_status, to_status, details, created_at, creative_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(taskId ?? null, taskTitle ?? null, userId ?? null, action, from, to, details ? JSON.stringify(details) : null, at, creativeId);
}
