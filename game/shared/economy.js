// The economy's rules, shared by the server and the client's price hints:
// fees, each town's merchant (a standing bid in every book, SPEC §6.2), the
// supplier stalls, and the owner's knobs (overrides of these defaults).
import { ITEMS } from './items.js';
import { CONTENT } from './content/index.js';

export const MARKET_TAX = 0.04; // paid by the seller on every market fill — the economy's main gold sink
export const MARKET_TAX_PM = 40; // the same, per mille (used with the fractional fee carry)
export const NPC_LEVY_PM = 80; // guild levy on shop sales to NPC customers

// ── The owner's knobs ────────────────────────────────────────────────
// knob(key, def) is the owner's override for key (set from the Town Hall's
// Economy tab, stored in meta.econ_overrides), else the default. Keys look
// like 'trade.amberfold.rate.wood' or 'supply.markup'.
let OVERRIDES = {};
export const setOverrides = (o) => (OVERRIDES = { ...(o ?? {}) });
export const overrides = () => OVERRIDES;
export const knob = (key, def) => (Object.prototype.hasOwnProperty.call(OVERRIDES, key) && Number.isFinite(OVERRIDES[key]) ? OVERRIDES[key] : def);

// ── What the merchants want ─────────────────────────────────────────
// Items group by tag for the merchants' appetite. Trophies and letters
// can't be sold.
export const TAG_GROUP = {
  wood: 'wood', plank: 'wood',
  ore: 'ore', bar: 'ore',
  herb: 'herb',
  fish: 'fish',
  food: 'food', potion: 'food',
  hide: 'hide', monster: 'hide',
  gem: 'gem', reagent: 'gem',
  tool: 'gear', gear: 'gear', kit: 'gear', charm: 'gear',
};
export const GROUPS = ['wood', 'ore', 'herb', 'fish', 'food', 'hide', 'gem', 'gear'];
export const tagGroup = (item) => TAG_GROUP[ITEMS[item]?.tag] ?? null;

// Per town: the floor rate every sale gets while the floor pool lasts, the
// pool (gold per item per 8 h), and per group the rate a fresh merchant
// pays (above the floor, the premium drains with each unit sold).
// Hearthvale pays at least 0.60 on everything, as it always has.
const R = (wood, ore, herb, fish, food, hide, gem, gear) => ({ wood, ore, herb, fish, food, hide, gem, gear });
export const TRADE = {
  hearthvale: { base: 0.6, floorPool: 3000, rate: R(0.6, 0.85, 0.7, 0.6, 0.8, 0.8, 0.75, 0.6) },
  amberfold: { base: 0.55, floorPool: 2000, rate: R(0.45, 0.9, 0.5, 0.85, 0.8, 0.6, 0.7, 0.55) },
  rimeholt: { base: 0.55, floorPool: 2000, rate: R(0.9, 0.45, 0.8, 0.5, 0.9, 0.85, 0.7, 0.55) },
  sandmere: { base: 0.5, floorPool: 2000, rate: R(0.9, 0.55, 0.9, 0.9, 0.7, 0.55, 0.45, 0.5) },
  starfall: { base: 0.5, floorPool: 2000, rate: R(0.85, 0.5, 0.7, 0.7, 0.95, 0.55, 0.6, 0.5) },
};
export const MERCHANT_REFILL_MS = 8 * 3600_000; // pools refill fully over 8 h
export const FULL_RATE = 0.25; // what a merchant whose floor pool is spent still pays

// A town's trade table with the owner's overrides (towns from content packs
// bring their own; any other town trades like Hearthvale).
export function tradeOf(town) {
  const T = TRADE[town] ?? CONTENT.trade?.[town] ?? TRADE.hearthvale;
  const k = (key, def) => knob(`trade.${town}.${key}`, def);
  return { base: k('base', T.base), floorPool: k('floorPool', T.floorPool), rate: Object.fromEntries(GROUPS.map((g) => [g, k(`rate.${g}`, T.rate[g])])) };
}

// Premium pools are sized like the shops' NPC demand: about 2,400 g of each
// item per 8 h, between 12 and 400 units.
export const DEMAND_POOL_GOLD = 2400;
export const DEMAND_CAP_MIN = 12;
export const DEMAND_CAP_MAX = 400;
export const demandCap = (v) => Math.max(DEMAND_CAP_MIN, Math.min(DEMAND_CAP_MAX, Math.round(DEMAND_POOL_GOLD / v)));

// A merchant pool now: { floorLeft, premFill }, refilled since it was last
// stored (row = { floor_left, prem_fill, at }; no row is a full pool).
// mul speeds the premium refill (×2 for the Market Day host).
export function poolNow(row, town, now = Date.now(), mul = 1) {
  const T = tradeOf(town);
  if (!row) return { floorLeft: T.floorPool, premFill: 1 };
  const f = Math.max(0, now - row.at) / MERCHANT_REFILL_MS;
  return { floorLeft: Math.min(T.floorPool, row.floor_left + T.floorPool * f), premFill: Math.min(1, row.prem_fill + f * mul) };
}

// v × rate, rounded down, worked in per mille so float error never costs a coin.
const times = (v, rate) => Math.floor((v * Math.round(rate * 1e6)) / 1e6 + 1e-9);

// What the merchant in `town` pays for one `item` with its pool in this state.
export function unitBid(town, item, pool) {
  const g = tagGroup(item);
  if (!g) return 0;
  const v = ITEMS[item].value;
  const T = tradeOf(town);
  const rate = T.rate[g];
  if (pool.floorLeft <= 0) return Math.max(1, times(v, FULL_RATE)); // full: sell elsewhere
  if (rate <= T.base) return Math.max(1, times(v, rate)); // a glut pays flat, with no premium
  return Math.max(1, times(v, T.base + (rate - T.base) * pool.premFill));
}

// Selling qty units, one at a time: { total, unit (the first unit's price),
// pool (after), glut (pays no premium here), full (the floor pool ran out) }.
export function merchantSale(town, item, qty, pool0) {
  const pool = { ...pool0 };
  const g = tagGroup(item);
  const T = tradeOf(town);
  const v = ITEMS[item]?.value ?? 0;
  const rate = g ? T.rate[g] : 0;
  const cap = demandCap(Math.max(1, v));
  let total = 0;
  let unit = null;
  let full = false;
  for (let k = 0; k < qty; k++) {
    const u = unitBid(town, item, pool);
    unit ??= u;
    total += u;
    if (pool.floorLeft <= 0) {
      full = true;
      continue;
    }
    pool.floorLeft -= v * Math.min(T.base, rate);
    if (rate > T.base) pool.premFill = Math.max(0, pool.premFill - 1 / cap);
  }
  return { total, unit: unit ?? unitBid(town, item, pool), pool, glut: !!g && rate <= T.base, full: full || pool.floorLeft <= 0 };
}

// ── Supplier stalls ─────────────────────────────────────────────────
// Each town's stall sells a few local staples, its healing food and Hearth
// Charms at 1.35× value, at most 150 of each a day. The best merchant bid
// anywhere is 0.95×, so buying here never pays to sell back.
export const SUPPLIES = {
  hearthvale: ['oak_log', 'copper_ore', 'mint_leaf', 'grilled_fish', 'hearth_charm'],
};
export const suppliesOf = (town) => SUPPLIES[town] ?? CONTENT.supplies?.[town] ?? SUPPLIES.hearthvale;
export const supplyAsk = (item) => Math.ceil(ITEMS[item].value * knob('supply.markup', 1.35) - 1e-9);
export const supplyDaily = () => knob('supply.daily', 150);
