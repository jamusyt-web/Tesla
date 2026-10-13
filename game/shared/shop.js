// Player shops: the rules both server and client use (pricing hints, the
// NPC customer model, the interior room layout). Imports shared code only.
import { ITEMS } from './items.js';
import { NavGrid } from './world.js';
import { MARKET_TAX_PM, NPC_LEVY_PM, DEMAND_POOL_GOLD, DEMAND_CAP_MIN, DEMAND_CAP_MAX, demandCap } from './economy.js';
import { CONTENT } from './content/index.js';

export { demandCap };

export const SHOP = {
  SLOTS: 8,
  SLOT_MAX_QTY: 999,
  MAX_PRICE: 1_000_000,
  SIM_STEP_MS: 10_000, // live simulation tick
  SIM_CHUNK_MS: 60_000, // catch-up granularity
  SIM_MAX_SPAN_MS: 30 * 60_000, // longest server downtime we catch up on
  FOOTFALL_BASE: 20, // NPC customers per hour with one item on display…
  FOOTFALL_PER_ITEM: 4, // …plus this per extra distinct item
  PRESENCE: { inside: 1.25, online: 1.0, offline: 0.8, away: 0 },
  ACTIVE_MS: 10 * 60_000, // input within this counts as "here"
  AWAY_MS: 12 * 3600_000, // no input for this long: NPC shoppers stop coming
  APPETITE_MID: 1.15,
  APPETITE_K: 9,
  APPETITE_CUTOFF: 1.6,
  PRICE_CEIL: 1.5, // NPCs never pay more than 1.5× an item's value
  DEMAND_MIN: 0.7,
  DEMAND_MAX: 1.2,
  DEMAND_POOL_GOLD, // each item's town-wide NPC demand is worth about this much…
  DEMAND_CAP_MIN,
  DEMAND_CAP_MAX,
  DEMAND_REFILL_MS: 8 * 3600_000, // …and refills over 8 hours
  BUY_QTY_GOLD: 40,
  BUY_QTY_MAX: 5,
  P2P_FEE_PM: MARKET_TAX_PM, // same 4% as the market, so shops are no tax dodge
  NPC_FEE_PM: NPC_LEVY_PM,
  ROOM_CAP: 10, // visitors (the owner always gets in)
  ENTER_COOLDOWN_MS: 1200,
  VISITOR_IDLE_MS: 5 * 60_000,
  LEDGER_KEEP: 500,
  LEDGER_PAGE: 50,
  NAME_MAX: 24,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The townsfolk who shop. cats: interest per item category; likes: favourites (×3).
// v: which villager model they use (variant 4 is the shopkeeper).
const C = (name, face, v, [resource, material, consumable, tool, gear], likes = []) => ({ name, face, v, cats: { resource, material, consumable, tool, gear }, likes: new Set(likes) });
export const CUSTOMERS = [
  C('Farmer Bram', '👨‍🌾', 1, [3, 2, 1, 2, 0], ['oak_log', 'birch_log', 'mint_leaf']),
  C('Witch Hazel', '🧙‍♀️', 2, [2, 0.5, 3, 0, 0.5], ['mint_leaf', 'sunpetal', 'moonbloom', 'slime_gel']),
  C('Sir Gareth', '🤴', 3, [0, 1, 2, 0.5, 3], ['sword_wood', 'sword_copper', 'sword_iron', 'sword_gold', 'armor_leather', 'armor_iron']),
  C('Little Pip', '🧒', 0, [2, 0.5, 2, 1, 0.5], ['golden_acorn', 'golden_koi']),
  C('Merchant Ola', '🧕', 5, [1.5, 2.5, 1.5, 1.5, 1.5]),
  C('Old Tom', '👴', 7, [1, 2, 0.5, 3, 0.5], ['axe_wood', 'axe_copper', 'axe_iron', 'axe_gold', 'pick_wood', 'pick_copper', 'pick_iron', 'pick_gold']),
  C('Bard Lyra', '🧝‍♀️', 0, [1, 0.5, 2, 0, 1], ['amulet_sapphire', 'sapphire']),
  C('Chef Basil', '👨‍🍳', 1, [3, 0, 2, 0.5, 0], ['minnow', 'perch', 'trout', 'pike', 'golden_koi', 'lake_king']),
  C('Ranger Fen', '🧝', 6, [1, 1, 2, 2, 2], ['rod_basic', 'rod_fine', 'rod_master', 'leather']),
  C('Granny Moss', '👵', 2, [2, 1, 3, 0, 0], ['moonbloom']),
];

// Who shops in each town: Hearthvale's townsfolk above; a new town's come
// from its content pack ({ name, face, v, cats, likes: [ids] }).
const custCache = new Map();
export function customersOf(town = 'hearthvale') {
  const list = town === 'hearthvale' ? null : CONTENT.customers?.[town];
  if (!list) return CUSTOMERS;
  if (!custCache.has(town)) custCache.set(town, list.map((c) => ({ ...c, likes: new Set(c.likes ?? []) })));
  return custCache.get(town);
}

// ── The NPC demand model ─────────────────────────────────────────────
// Customers per hour for a shop showing nItems distinct items.
export const footfall = (nItems, pres) =>
  nItems <= 0 ? 0 : (SHOP.FOOTFALL_BASE + SHOP.FOOTFALL_PER_ITEM * (Math.min(nItems, SHOP.SLOTS) - 1)) * SHOP.PRESENCE[pres];

// Town-wide demand for each item is a pool that NPC purchases drain and that
// refills over 8 h, so NPC buying can never become an unlimited gold tap.
export const fillNow = (row, now) => (row ? Math.min(1, row.fill + Math.max(0, now - row.at) / SHOP.DEMAND_REFILL_MS) : 1);
export const demandFactor = (fill) => SHOP.DEMAND_MIN + (SHOP.DEMAND_MAX - SHOP.DEMAND_MIN) * fill;
// What townsfolk think an item is worth right now (more when it's scarce).
export const refPrice = (item, fill) => ITEMS[item].value * demandFactor(fill);
export const npcCeil = (item) => Math.floor(SHOP.PRICE_CEIL * ITEMS[item].value);
export const appetite = (r) => (r >= SHOP.APPETITE_CUTOFF ? 0 : 1 / (1 + Math.exp(SHOP.APPETITE_K * (r - SHOP.APPETITE_MID))));
export const npcBuyChance = (item, price, fill) => (price > npcCeil(item) ? 0 : appetite(price / refPrice(item, fill)));
export const buyQtyMax = (v) => clamp(Math.round(SHOP.BUY_QTY_GOLD / v), 1, SHOP.BUY_QTY_MAX);
export const demandLabel = (fill) => (fill >= 0.75 ? 'High' : fill >= 0.35 ? 'Steady' : 'Saturated');

export function poisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// How much a customer wants each item on display (0 = not interested).
const wantOf = (cust, item, fill) => (cust.cats[ITEMS[item].cat] || 0) * (cust.likes.has(item) ? 3 : 1) * fill;

// A customer walks to the cheapest display of the item they want most (weighted pick).
export function pickDisplay(cust, slots, fillOf, rng) {
  const best = new Map();
  for (const s of slots) {
    const b = best.get(s.item);
    if (!b || s.price < b.price) best.set(s.item, s);
  }
  const opts = [];
  let sum = 0;
  for (const [item, row] of best) {
    const w = wantOf(cust, item, fillOf(item));
    if (w > 0) {
      opts.push([row, w]);
      sum += w;
    }
  }
  if (!sum) return null; // browses and leaves
  let x = rng() * sum;
  for (const [row, w] of opts) if ((x -= w) < 0) return row;
  return opts[opts.length - 1][0];
}

// Expected sales for the owner's price sheet (a shop in `town`): per display {chance, perHour, sellOutHours, ref, ceil, demand}.
export function estimate(slots, fillOf, pres = 'offline', town = 'hearthvale') {
  const custs = customersOf(town);
  const cheapest = new Map();
  for (const s of slots) if (!cheapest.has(s.item) || s.price < cheapest.get(s.item).price) cheapest.set(s.item, s);
  const F = footfall(cheapest.size, pres);
  const out = {};
  for (const s of slots) {
    const fill = fillOf(s.item);
    const chance = npcBuyChance(s.item, s.price, fill);
    let share = 0;
    if (cheapest.get(s.item) === s)
      for (const c of custs) {
        let total = 0;
        for (const it of cheapest.keys()) total += wantOf(c, it, fillOf(it));
        if (total > 0) share += wantOf(c, s.item, fill) / total / custs.length;
      }
    const perHour = F * share * chance * Math.min(s.qty, (1 + buyQtyMax(ITEMS[s.item].value)) / 2);
    out[s.slot] = { chance, perHour, sellOutHours: perHour > 0 ? s.qty / perHour : Infinity, ref: refPrice(s.item, fill), ceil: npcCeil(s.item), demand: demandLabel(fill), shadowed: cheapest.get(s.item) !== s };
  }
  return out;
}

// ── The shop interior (same for every shop) ──────────────────────────
// Origin = room centre; back wall at z = −4.5, the door in the front wall at z = +4.5.
// Fixtures are axis-aligned boxes (w × d); `stand` is where you stand to use one.
export const ROOM = {
  w: 12,
  d: 9,
  wallH: 3.4,
  speed: 3.6,
  r: 0.35,
  bounds: { x0: -5.6, x1: 5.6, z0: -4.15, z1: 4.2 },
  door: { x: 0, z: 4.5, w: 1.6 },
  mat: { x: 0, z: 4.0 },
  spawn: { x: 0, z: 3.5, rot: Math.PI },
  npcDoor: { x: 0, z: 5.2 },
  counter: { x: 4.3, z: 0.5, w: 0.8, d: 3.0 },
  till: { x: 4.3, z: 0.0 },
  clerk: { x: 5.3, z: 0.5, rot: -Math.PI / 2 },
  pay: { x: 3.0, z: 0.5 },
  fixtures: [
    { slot: 0, kind: 'shelf', x: -3.5, z: -4.2, rot: 0, w: 2.0, d: 0.6, stand: [-3.5, -3.0] },
    { slot: 1, kind: 'shelf', x: 0.0, z: -4.2, rot: 0, w: 2.0, d: 0.6, stand: [0.0, -3.0] },
    { slot: 2, kind: 'shelf', x: 3.5, z: -4.2, rot: 0, w: 2.0, d: 0.6, stand: [3.5, -3.0] },
    { slot: 3, kind: 'rack', x: -5.75, z: -1.5, rot: Math.PI / 2, w: 0.5, d: 1.8, stand: [-4.5, -1.5] },
    { slot: 4, kind: 'bin', x: -5.25, z: 1.5, rot: Math.PI / 2, w: 1.0, d: 1.0, stand: [-3.5, 1.5] },
    { slot: 5, kind: 'table', x: -2.0, z: 0.0, rot: 0, w: 1.4, d: 1.0, stand: [-2.0, 1.5] },
    { slot: 6, kind: 'table', x: 1.5, z: 0.0, rot: 0, w: 1.4, d: 1.0, stand: [1.5, 1.5] },
    { slot: 7, kind: 'pedestal', x: -3.0, z: 3.0, rot: 0, w: 0.7, d: 0.7, stand: [-1.5, 3.0] },
  ],
  decor: [{ x: 4.8, z: 3.6, r: 0.4 }],
};

export const roomColliders = () => ({ rects: [...ROOM.fixtures, ROOM.counter], circles: ROOM.decor });
export function roomWalkable(x, z, col) {
  const b = ROOM.bounds;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
  const r = ROOM.r;
  for (const q of col.rects) if (Math.abs(x - q.x) < q.w / 2 + r && Math.abs(z - q.z) < q.d / 2 + r) return false;
  for (const c of col.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return false;
  return true;
}
let nav = null;
export const roomNav = () => (nav ??= new NavGrid(roomColliders(), { half: 6.75, cell: 0.5, walkable: roomWalkable }));
