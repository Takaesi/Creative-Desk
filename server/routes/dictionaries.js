// F1. Справочники (офферы, подходы, AI-сервисы), настройки-пороги, параметры пользователей.
import { Router } from 'express';
import { db, nowIso, logHistory, getSettings, SETTINGS_SCHEMA } from '../db.js';
import { CREATIVE_TYPES, GEOS, PRIORITIES, TYPE_UNITS } from '../domain.js';
import { HttpError, wrap, auth, requireRole, num } from '../http.js';
import { setDefaultNorm } from '../plans.js';

const router = Router();

export function findOffer(id) {
  return id == null ? null : db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
}
export function findApproach(id) {
  return id == null ? null : db.prepare('SELECT * FROM approaches WHERE id = ?').get(id);
}

const cleanName = (v, label = 'Название') => {
  const s = String(v ?? '').trim().slice(0, 120);
  if (!s) throw new HttpError(400, `Укажите «${label}»`);
  return s;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/** UNIQUE-конфликт → понятная 409 вместо 500. */
function uniqueGuard(fn, msg) {
  try { return fn(); } catch (e) {
    if (String(e.code).startsWith('SQLITE_CONSTRAINT_UNIQUE')) throw new HttpError(409, msg);
    throw e;
  }
}

function logDict(user, entity, id, name, details) {
  logHistory({ userId: user.id, action: 'dictionary_changed', taskTitle: null, details: { entity, id, name, ...details } });
}

router.get('/dictionaries', auth, wrap((req, res) => {
  const canSeePrices = req.user.role === 'lead' || req.user.role === 'buyer';
  const services = db.prepare('SELECT * FROM ai_services ORDER BY is_active DESC, name').all()
    .map((s) => (canSeePrices ? s : { id: s.id, name: s.name, is_active: s.is_active }));
  res.json({
    offers: db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM tasks t WHERE t.offer_id = o.id) AS task_count
      FROM offers o ORDER BY o.is_active DESC, o.name`).all(),
    approaches: db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM tasks t WHERE t.approach_id = a.id) AS task_count
      FROM approaches a ORDER BY a.is_active DESC, a.name`).all(),
    aiServices: services,
    creativeTypes: CREATIVE_TYPES,
    geos: GEOS,
    priorities: PRIORITIES,
    typeUnits: TYPE_UNITS,
    settings: getSettings(),
  });
}));

// ---------- офферы ----------
router.post('/offers', auth, requireRole('lead'), wrap((req, res) => {
  const name = cleanName(req.body?.name);
  const vertical = String(req.body?.vertical ?? '').trim().slice(0, 60);
  const id = db.transaction(() => {
    const r = uniqueGuard(() => db.prepare('INSERT INTO offers (name, vertical, created_at) VALUES (?,?,?)').run(name, vertical, nowIso()), 'Такой оффер уже есть');
    logDict(req.user, 'offer', r.lastInsertRowid, name, { op: 'created' });
    return r.lastInsertRowid;
  })();
  res.status(201).json(findOffer(id));
}));

router.patch('/offers/:id', auth, requireRole('lead'), wrap((req, res) => {
  const o = findOffer(req.params.id);
  if (!o) throw new HttpError(404, 'Оффер не найден');
  const set = {};
  if (req.body.name !== undefined) set.name = cleanName(req.body.name);
  if (req.body.vertical !== undefined) set.vertical = String(req.body.vertical).trim().slice(0, 60);
  if (req.body.is_active !== undefined) set.is_active = bool(req.body.is_active);
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => o[k] !== v).map(([k, v]) => [k, { from: o[k], to: v }]));
  if (Object.keys(changes).length) {
    db.transaction(() => {
      const cols = Object.keys(changes);
      uniqueGuard(() => db.prepare(`UPDATE offers SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...set, id: o.id }), 'Такой оффер уже есть');
      // текстовое поле задач — для совместимости, источник истины offer_id
      if (changes.name) db.prepare('UPDATE tasks SET offer = ? WHERE offer_id = ?').run(set.name, o.id);
      logDict(req.user, 'offer', o.id, set.name || o.name, { op: 'updated', changes });
    })();
  }
  res.json(findOffer(o.id));
}));

// ---------- подходы ----------
router.post('/approaches', auth, requireRole('lead'), wrap((req, res) => {
  const name = cleanName(req.body?.name);
  const description = String(req.body?.description ?? '').trim().slice(0, 500);
  const id = db.transaction(() => {
    const r = uniqueGuard(() => db.prepare('INSERT INTO approaches (name, description, created_at) VALUES (?,?,?)').run(name, description, nowIso()), 'Такой подход уже есть');
    logDict(req.user, 'approach', r.lastInsertRowid, name, { op: 'created' });
    return r.lastInsertRowid;
  })();
  res.status(201).json(findApproach(id));
}));

router.patch('/approaches/:id', auth, requireRole('lead'), wrap((req, res) => {
  const a = findApproach(req.params.id);
  if (!a) throw new HttpError(404, 'Подход не найден');
  const set = {};
  if (req.body.name !== undefined) set.name = cleanName(req.body.name);
  if (req.body.description !== undefined) set.description = String(req.body.description).trim().slice(0, 500);
  if (req.body.is_active !== undefined) set.is_active = bool(req.body.is_active);
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => a[k] !== v).map(([k, v]) => [k, { from: a[k], to: v }]));
  if (Object.keys(changes).length) {
    db.transaction(() => {
      const cols = Object.keys(changes);
      uniqueGuard(() => db.prepare(`UPDATE approaches SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...set, id: a.id }), 'Такой подход уже есть');
      logDict(req.user, 'approach', a.id, set.name || a.name, { op: 'updated', changes });
    })();
  }
  res.json(findApproach(a.id));
}));

// ---------- AI-сервисы ----------
router.post('/ai-services', auth, requireRole('lead'), wrap((req, res) => {
  const name = cleanName(req.body?.name);
  const price = num(req.body?.credit_price_rub ?? 0, { label: 'Цена кредита', min: 0, max: 1e6 });
  const id = db.transaction(() => {
    const r = uniqueGuard(() => db.prepare('INSERT INTO ai_services (name, credit_price_rub) VALUES (?,?)').run(name, price), 'Такой сервис уже есть');
    logDict(req.user, 'ai_service', r.lastInsertRowid, name, { op: 'created', price });
    return r.lastInsertRowid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM ai_services WHERE id = ?').get(id));
}));

router.patch('/ai-services/:id', auth, requireRole('lead'), wrap((req, res) => {
  const s = db.prepare('SELECT * FROM ai_services WHERE id = ?').get(req.params.id);
  if (!s) throw new HttpError(404, 'Сервис не найден');
  const set = {};
  if (req.body.name !== undefined) set.name = cleanName(req.body.name);
  if (req.body.credit_price_rub !== undefined) set.credit_price_rub = num(req.body.credit_price_rub, { label: 'Цена кредита', min: 0, max: 1e6 });
  if (req.body.is_active !== undefined) set.is_active = bool(req.body.is_active);
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => s[k] !== v).map(([k, v]) => [k, { from: s[k], to: v }]));
  if (Object.keys(changes).length) {
    db.transaction(() => {
      const cols = Object.keys(changes);
      uniqueGuard(() => db.prepare(`UPDATE ai_services SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...set, id: s.id }), 'Такой сервис уже есть');
      // расходы сопоставляются с ценой по названию — переименовываем и их
      if (changes.name) db.prepare('UPDATE ai_expenses SET service = ? WHERE service = ?').run(set.name, s.name);
      logDict(req.user, 'ai_service', s.id, set.name || s.name, { op: 'updated', changes });
    })();
  }
  res.json(db.prepare('SELECT * FROM ai_services WHERE id = ?').get(s.id));
}));

// ---------- пользователи: ставка, мощность, WIP ----------
router.patch('/users/:id', auth, requireRole('lead'), wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const set = {};
  if (req.body.hourly_rate_rub !== undefined) set.hourly_rate_rub = num(req.body.hourly_rate_rub, { label: 'Ставка', min: 0, max: 1e6 });
  if (req.body.capacity_units !== undefined) set.capacity_units = num(req.body.capacity_units, { label: 'Мощность', min: 1, max: 1000, int: true });
  if (req.body.wip_limit !== undefined) set.wip_limit = num(req.body.wip_limit, { label: 'WIP-лимит', min: 1, max: 50, int: true, nullable: true });
  // норма по умолчанию — отдельной записью plan_changed (её видят только руководитель и сам креативщик)
  if (req.body.monthly_norm !== undefined) {
    if (u.role !== 'creative') throw new HttpError(400, 'Норма задаётся только креативщику');
    const norm = num(req.body.monthly_norm, { label: 'Норма в месяц', min: 1, max: 10000, int: true, nullable: true });
    if (norm !== u.monthly_norm) {
      db.transaction(() => {
        setDefaultNorm(u.id, norm);
        logHistory({ userId: req.user.id, action: 'plan_changed', details: { user: u.name, user_id: u.id, month: null, from: u.monthly_norm, to: norm } });
      })();
    }
  }
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => u[k] !== v).map(([k, v]) => [k, { from: u[k], to: v }]));
  if (Object.keys(changes).length) {
    db.transaction(() => {
      const cols = Object.keys(changes);
      db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...set, id: u.id });
      logDict(req.user, 'user', u.id, u.name, { op: 'updated', changes });
    })();
  }
  res.json({ ok: true });
}));

// ---------- пороги ----------
router.patch('/settings', auth, requireRole('lead'), wrap((req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(400, 'Нет изменений');
  const clean = {};
  for (const k of keys) {
    const s = SETTINGS_SCHEMA[k];
    if (!s) throw new HttpError(400, `Неизвестная настройка: ${k}`);
    if (s.type === 'str') {
      const v = String(body[k] ?? '').trim();
      if (!v || v.length > s.max) throw new HttpError(400, `Некорректное значение для ${k}`);
      clean[k] = v;
    } else {
      const raw = body[k];
      const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(',', '.')) : NaN);
      if (!Number.isFinite(n) || n < s.min || n > s.max || (s.type === 'int' && !Number.isInteger(n))) {
        throw new HttpError(400, `Некорректное значение для ${k}: нужно ${s.type === 'int' ? 'целое ' : ''}число от ${s.min} до ${s.max}`);
      }
      clean[k] = String(n);
    }
  }
  const before = getSettings();
  db.transaction(() => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    Object.entries(clean).forEach(([k, v]) => up.run(k, v));
    const changes = Object.fromEntries(Object.entries(clean).filter(([k, v]) => String(before[k]) !== v).map(([k, v]) => [k, { from: before[k], to: v }]));
    if (Object.keys(changes).length) logDict(req.user, 'settings', null, 'Пороги', { op: 'updated', changes });
  })();
  res.json(getSettings());
}));

export default router;
