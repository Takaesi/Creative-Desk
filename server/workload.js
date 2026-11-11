// Загрузка креативщиков: WIP (число задач в работе) и units (трудоёмкость).
import { db, getSettings } from './db.js';

const ACTIVE_WIP = "(status = 'in_progress' OR (status = 'revision' AND revision_started_at IS NOT NULL))";

/** Сколько задач креативщик держит в работе и его WIP-лимит. Правки без начатой доработки не считаются. */
export function wipInfo(userId) {
  const u = db.prepare('SELECT wip_limit FROM users WHERE id = ?').get(userId);
  const count = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE creative_id = ? AND ${ACTIVE_WIP}`).get(userId).c;
  const limit = u?.wip_limit ?? getSettings().wip_limit_default;
  return { count, limit, reached: count >= limit };
}

/** Загрузка каждого креативщика: сумма units задач в работе и на правках / мощность. */
export function teamLoad() {
  const def = getSettings().wip_limit_default;
  return db.prepare(`SELECT u.id, u.name, u.color, u.position, u.capacity_units, u.wip_limit,
      COALESCE((SELECT SUM(estimate_units) FROM tasks t WHERE t.creative_id = u.id AND t.status IN ('in_progress','revision')), 0) AS load_units,
      (SELECT COUNT(*) FROM tasks t WHERE t.creative_id = u.id AND (t.status = 'in_progress' OR (t.status = 'revision' AND t.revision_started_at IS NOT NULL))) AS wip_count
    FROM users u WHERE u.role = 'creative' ORDER BY u.name`).all()
    .map((u) => ({ ...u, wip_limit: u.wip_limit ?? def, load_pct: u.capacity_units ? (u.load_units / u.capacity_units) * 100 : 0 }));
}
