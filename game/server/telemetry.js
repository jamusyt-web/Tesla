// The economy's books (SPEC §6.5): every gold amount that enters or leaves a
// hero's purse, labelled with why, and the items that enter the game
// (gathered, dropped, crafted, sold to the merchant…), summed per day. Written
// in the same transaction as the change they record, so a rolled-back trade
// leaves no trace here either. Also the phones' performance reports (§9.4).

export const DAY_MS = 86_400_000;
export const today = (now = Date.now()) => Math.floor(now / DAY_MS);

const stmts = new WeakMap(); // db → its prepared statements
function q(db) {
  let s = stmts.get(db);
  if (!s) {
    s = {
      gold: db.prepare('INSERT INTO gold_flow (day, town, reason, amount, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, town, reason) DO UPDATE SET amount = amount + excluded.amount, n = n + 1'),
      item: db.prepare('INSERT INTO item_flow (day, item, kind, qty) VALUES (?, ?, ?, ?) ON CONFLICT (day, item, kind) DO UPDATE SET qty = qty + excluded.qty'),
      perf: db.prepare('INSERT INTO perf_samples (day, device, region, fps_p50, fps_p5, draws_p95, tris_p95, load_ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    };
    stmts.set(db, s);
  }
  return s;
}

// amount > 0 is gold into a purse, < 0 gold out of one; reason is a short
// label such as 'loot', 'npcSell', 'travel', 'marketEscrow'.
export function goldFlow(db, reason, amount, town = 'hearthvale') {
  if (!db || !amount) return;
  q(db).gold.run(today(), town, reason, amount);
}

// kind: 'gather', 'fish', 'loot', 'chest', 'craft', 'npcSell'…
export function itemFlow(db, item, kind, qty) {
  if (!db || !qty) return;
  q(db).item.run(today(), item, kind, qty);
}

// One phone's last minute: { device, region, fps50, fps5, draws95, tris95, loadMs }.
export function perfSample(db, s, now = Date.now()) {
  q(db).perf.run(today(now), s.device, s.region, s.fps50, s.fps5, s.draws95, s.tris95, s.loadMs, now);
}

// The owner's Performance view: the last `days` days per device and region.
export function perfReport(db, days = 7, now = Date.now()) {
  return db
    .prepare(
      `SELECT device, region, COUNT(*) AS n, ROUND(AVG(fps_p50), 1) AS fps50, ROUND(MIN(fps_p5), 1) AS fps5min, ROUND(AVG(fps_p5), 1) AS fps5,
        MAX(draws_p95) AS draws95, MAX(tris_p95) AS tris95, ROUND(AVG(load_ms)) AS loadMs
       FROM perf_samples WHERE day >= ? GROUP BY device, region ORDER BY n DESC LIMIT 50`,
    )
    .all(today(now) - days + 1);
}
