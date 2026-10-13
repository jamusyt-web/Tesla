// The server owner's reports (SPEC §6.5, §5.8): the Economy tab (gold in
// and out by reason, gold per hour played, prices per town, how full the
// merchants are, alarms with a suggested knob) and the Engagement tab. The
// owner turns the knobs (owner.econ.set); nothing changes on its own.
import { REGIONS } from '../shared/world.js';
import { tradeOf, setOverrides, overrides } from '../shared/economy.js';
import { today, DAY_MS } from './telemetry.js';
import { engageReport } from './engage.js';
import { fail } from './db.js';
import { register } from './rpc.js';

// Gold that only moves between heroes (escrow, sales, refunds): neither
// new gold nor gold leaving the game.
export const TRANSFERS = new Set(['marketRefund', 'jobRefund', 'shopTill', 'shopBuy', 'marketSale', 'marketEscrow', 'jobPay', 'jobEscrow', 'other', 'test']);

// Each town's price basket: three staples, a bar, a plank and a food.
export const BASKET = { hearthvale: ['oak_log', 'copper_ore', 'mint_leaf', 'copper_bar', 'oak_plank', 'grilled_fish'] };
const towns = () => REGIONS.filter((r) => r.kind === 'town').map((r) => r.id);

// Volume-weighted price of an item in a town between two times.
const vwap = (db, town, item, from, to) => db.prepare('SELECT SUM(price * qty) AS v, SUM(qty) AS q FROM market_trades WHERE town = ? AND item = ? AND ts >= ? AND ts < ?').get(town, item, from, to);

export function econReport(db, days = 7, now = Date.now()) {
  const from = today(now) - days + 1;
  const flows = db.prepare('SELECT reason, SUM(amount) AS amount, SUM(n) AS n FROM gold_flow WHERE day >= ? GROUP BY reason ORDER BY amount DESC').all(from);
  const own = flows.filter((f) => !TRANSFERS.has(f.reason));
  const faucet = own.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
  const sink = -own.filter((f) => f.amount < 0).reduce((a, f) => a + f.amount, 0);
  const minutes = db.prepare('SELECT SUM(minutes) AS m FROM engage_day WHERE day >= ?').get(from)?.m ?? 0;
  // Prices: this week against last week, per town, over its basket.
  const cpi = towns().map((town) => {
    const basket = BASKET[town] ?? BASKET.hearthvale;
    const ratios = [];
    for (const item of basket) {
      const a = vwap(db, town, item, now - 14 * DAY_MS, now - 7 * DAY_MS);
      const b = vwap(db, town, item, now - 7 * DAY_MS, now);
      if (a?.q && b?.q) ratios.push(b.v / b.q / (a.v / a.q));
    }
    return { town, items: ratios.length, change: ratios.length ? Math.round((ratios.reduce((x, y) => x + y, 0) / ratios.length - 1) * 1000) / 10 : null };
  });
  // Merchant pools: how much of each town's floor is left, on average.
  const pools = towns().map((town) => {
    const r = db.prepare('SELECT AVG(floor_left) AS f, AVG(prem_fill) AS p, COUNT(*) AS n FROM merchant_pool WHERE town = ?').get(town);
    return { town, items: r?.n ?? 0, floorLeft: r?.n ? Math.round((100 * r.f) / tradeOf(town).floorPool) : 100, premium: r?.n ? Math.round(100 * r.p) : 100 };
  });
  const ratio = sink ? Math.round((100 * faucet) / sink) / 100 : null;
  const alarms = [];
  if (ratio != null && ratio > 1.5) alarms.push({ text: `More gold is coming in than going out (×${ratio} over ${days} days).`, knob: 'trade.hearthvale.floorPool', suggest: Math.round(tradeOf('hearthvale').floorPool * 0.8), why: 'A smaller merchant floor pool pays out less each day.' });
  for (const c of cpi) if (c.change != null && c.change > 3) alarms.push({ text: `Prices in ${c.town} rose ${c.change}% this week.`, knob: 'supply.markup', suggest: 1.25, why: 'Cheaper supplier stalls cap what staples can cost.' });
  return { days, flows: flows.map((f) => ({ ...f, transfer: TRANSFERS.has(f.reason) })), faucet, sink, ratio, goldPerHour: minutes ? Math.round((faucet * 60) / minutes) : null, minutes, cpi, pools, alarms, overrides: overrides() };
}

// Set (or clear, with value null) one of the owner's knobs.
export function setKnob(g, key, value) {
  key = String(key ?? '');
  if (!/^[a-z0-9_.]{3,60}$/i.test(key)) fail('That is not a knob.');
  const next = { ...overrides() };
  if (value === null || value === '' || value === undefined) delete next[key];
  else {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 1e6) fail('Give a number.');
    next[key] = v;
  }
  g.db.prepare("INSERT INTO meta (key, value) VALUES ('econ_overrides', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  setOverrides(next);
  const msg = JSON.stringify({ t: 'econ', overrides: next });
  for (const c of g.online.values()) c.sendRaw(msg);
  return { overrides: next };
}

const admin = (g, c) => {
  if (!g.auth.isAdmin(c.hero.id)) fail('Only server owners can do that.');
};
const days = (a) => Math.max(1, Math.min(60, Number(a?.days) || 7));
register('owner.econ', (g, c, a) => (admin(g, c), econReport(g.db, days(a))), { inRun: true });
register('owner.econ.set', (g, c, a) => (admin(g, c), setKnob(g, a.key, a.value)), { inRun: true });
register('owner.engage', (g, c, a) => (admin(g, c), engageReport(g.db, days(a))), { inRun: true });
