// Общие HTTP-хелперы: ошибки, авторизация, загрузка файлов.
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const wrap = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, position: u.position, color: u.color });

export function auth(req, _res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = bearer || parseCookies(req.headers.cookie).sid;
  if (!token) return next(new HttpError(401, 'Требуется вход'));
  const user = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!user) return next(new HttpError(401, 'Сессия истекла'));
  req.user = user;
  req.token = token;
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Недостаточно прав'));

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

/** CSV и прочие небольшие файлы, которые разбираются в памяти. */
export const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

// multer отдаёт имя файла в latin1 — возвращаем нормальный UTF-8 для кириллицы
export const fixName = (name) => Buffer.from(name, 'latin1').toString('utf8');

/** Разбор целого/числа из тела запроса с понятной ошибкой. */
export function num(v, { label, min = -Infinity, max = Infinity, int = false, nullable = false } = {}) {
  if (v === null || v === undefined || v === '') {
    if (nullable) return null;
    throw new HttpError(400, `Укажите «${label}»`);
  }
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < min || n > max) {
    throw new HttpError(400, `«${label}»: ${int ? 'целое ' : ''}число${Number.isFinite(min) ? ` от ${min}` : ''}${Number.isFinite(max) ? ` до ${max}` : ''}`);
  }
  return n;
}

export const idOrNull = (v) => (v === null || v === undefined || v === '' || v === 'null' ? null : Number(v));
