// План и норма креативщиков. Нормы меняет только руководитель; креативщик видит только свой план; байер планов не видит.
import { Router } from 'express';
import { db, nowIso, logHistory } from '../db.js';
import { HttpError, wrap, auth, requireRole, num } from '../http.js';
import { isMonth, moscowMonth, shiftMonth, planFor, normFor, factFor, planPace } from '../plans.js';

const router = Router();

const creativeUser = (id) => {
  const u = db.prepare("SELECT id, name, color, position, monthly_norm FROM users WHERE id = ? AND role = 'creative'").get(id);
  if (!u) throw new HttpError(404, 'Креативщик не найден');
  return u;
};

function row(u, month, now) {
  const n = normFor(u.id, month);
  const fact = factFor(u.id, month);
  return {
    user: { id: u.id, name: u.name, color: u.color, position: u.position },
    month, monthly_norm: u.monthly_norm, norm_source: n?.source || null,
    plan: n ? { ...planPace({ norm: n.norm, fact, month, now }), source: n.source } : null,
    fact,
  };
}

/** GET /api/plans?month=YYYY-MM — lead: все креативщики, creative: только свой. */
router.get('/plans', auth, requireRole('lead', 'creative'), wrap((req, res) => {
  const now = Date.now();
  const month = req.query.month || moscowMonth(now);
  if (!isMonth(month)) throw new HttpError(400, 'Месяц — в формате YYYY-MM');
  const users = req.user.role === 'lead'
    ? db.prepare("SELECT id, name, color, position, monthly_norm FROM users WHERE role = 'creative' ORDER BY name").all()
    : [creativeUser(req.user.id)];
  res.json({ month, current: moscowMonth(now), items: users.map((u) => row(u, month, now)) });
}));

/** GET /api/plans/report?from=YYYY-MM&to=YYYY-MM — план/факт по месяцам для аналитики (lead). */
router.get('/plans/report', auth, requireRole('lead'), wrap((req, res) => {
  const now = Date.now();
  const to = req.query.to || moscowMonth(now);
  const from = req.query.from || shiftMonth(to, -2);
  if (!isMonth(from) || !isMonth(to) || from > to) throw new HttpError(400, 'Период — месяцы YYYY-MM, «с» не позже «по»');
  const months = [];
  for (let m = from; m <= to && months.length < 24; m = shiftMonth(m, 1)) months.push(m);
  const users = db.prepare("SELECT id, name, color, position, monthly_norm FROM users WHERE role = 'creative' ORDER BY name").all();
  res.json({
    months,
    rows: users.map((u) => {
      const cells = months.map((m) => { const r = row(u, m, now); return { month: m, norm: r.plan?.norm ?? null, fact: r.fact, pct: r.plan?.pct ?? null, status: r.plan?.status ?? null }; });
      const norm = cells.reduce((s, c) => s + (c.norm || 0), 0);
      const fact = cells.reduce((s, c) => s + c.fact, 0);
      return { user: { id: u.id, name: u.name, color: u.color }, cells, total: { norm: norm || null, fact, pct: norm ? (fact / norm) * 100 : null } };
    }),
  });
}));

/** PUT /api/plans/:userId/:month {norm} — норма на конкретный месяц; norm: null — убрать, вернуться к норме по умолчанию. */
router.put('/plans/:userId/:month', auth, requireRole('lead'), wrap((req, res) => {
  const u = creativeUser(req.params.userId);
  const { month } = req.params;
  if (!isMonth(month)) throw new HttpError(400, 'Месяц — в формате YYYY-MM');
  if (month < moscowMonth()) throw new HttpError(400, 'План прошлых месяцев не меняется — он нужен для истории план/факт');
  const norm = num(req.body?.norm, { label: 'Норма', min: 1, max: 10000, int: true, nullable: true });
  const prev = db.prepare('SELECT norm FROM creative_plans WHERE user_id = ? AND month = ?').get(u.id, month);
  const at = nowIso();
  db.transaction(() => {
    if (norm == null) db.prepare('DELETE FROM creative_plans WHERE user_id = ? AND month = ?').run(u.id, month);
    else {
      db.prepare(`INSERT INTO creative_plans (user_id, month, norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, month) DO UPDATE SET norm = excluded.norm, updated_at = excluded.updated_at`).run(u.id, month, norm, at, at);
    }
    logHistory({ userId: req.user.id, action: 'plan_changed', at, details: { user: u.name, user_id: u.id, month, from: prev?.norm ?? null, to: norm } });
  })();
  res.json(row(u, month, Date.now()));
}));

export default router;
