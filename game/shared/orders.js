// Town orders and the Big Order (SPEC §5.4): the rules both sides share.
// Each town's board seeds 4 orders a day from hash(town, day): the same for
// everyone, and everyone fills their own copy (server/orders.js keeps them).
import { ITEMS } from './items.js';
import { MONSTERS } from './monsters.js';
import { NODE_TYPES } from './nodes.js';
import { RECIPES } from './recipes.js';
import { CONTENT } from './content/index.js';
import { knob } from './economy.js';
import HEARTHVALE from './content/hearthvale/orders.js';

export const ORDER_TEMPLATES = { hearthvale: HEARTHVALE };
export const ordersOf = (town) => ORDER_TEMPLATES[town] ?? CONTENT.orders?.[town] ?? [];

export const SLOTS = 4; // open orders a hero can hold per town
export const DAILY = 4; // orders a board offers each day
export const LASTS_DAYS = 3; // an order stays open this long
export const QTY_GOLD = [0, 150, 400, 800, 1300, 2000]; // goods value of an order, by tier (about 5 minutes' gathering)
export const PAY = { gather: 1.15, hunt: 1.15, craft: 1.3, import: 1.25, special: 1.5 };
export const REP = { gather: 15, hunt: 15, craft: 20, import: 25, special: 30 };
export const BIG_MULT = 10; // a Big Order wants 10 normal orders' worth
export const BIG_PAY = 1.15; // paid per unit as you give
export const BIG_REP = 25;

// A small stable hash (FNV-1a) for the day's picks.
export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A hunted monster's goods value: three times its average gold.
const mobValue = (m) => 3 * ((MONSTERS[m]?.gold?.[0] ?? 5) + (MONSTERS[m]?.gold?.[1] ?? 5)) / 2;
export const unitValue = (t) => (t.kind === 'hunt' ? mobValue(t.monster) : ITEMS[t.item]?.value ?? 1);

// The full order a template makes: { key, kind, item|monster, qty, pay, rep, xp: { skill, n } }.
export function orderOf(t) {
  if (!t) return null;
  const value = unitValue(t);
  const qty = t.qty ?? Math.max(1, Math.round(QTY_GOLD[t.tier ?? 1] / value));
  const mult = knob('orders.pay', 1) * Math.min(1.5, (PAY[t.kind] ?? 1.15) + (t.kind === 'import' ? 0.05 * (t.legs ?? 1) : 0));
  return { ...t, qty, pay: Math.round(qty * value * mult), rep: REP[t.kind] ?? 15, xp: xpOf(t, qty) };
}

// The xp an order pays on top: half the gathering xp, or the crafting xp.
function xpOf(t, qty) {
  if (t.kind === 'gather') {
    const node = Object.values(NODE_TYPES).find((n) => n.drops?.[0]?.id === t.item);
    if (!node) return null;
    const per = (node.drops[0].min + node.drops[0].max) / 2;
    return { skill: node.skill, n: Math.round((0.5 * qty * node.xp) / Math.max(1, per)) };
  }
  if (t.kind === 'craft') {
    const r = RECIPES.find((x) => x.out === t.item);
    return r ? { skill: 'crafting', n: Math.round((qty * r.xp) / (r.qty || 1)) } : null;
  }
  return null;
}

// The board's 4 for a day: template keys, the same for everyone.
export function seedOrders(town, day) {
  const list = ordersOf(town);
  const out = [];
  let h = hash32(`${town}:${day}`);
  const pool = list.map((t) => t.key);
  while (out.length < Math.min(DAILY, list.length)) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const k = pool.splice(h % pool.length, 1)[0];
    out.push(k);
  }
  return out;
}
export const templateOf = (town, key) => ordersOf(town).find((t) => t.key === key) ?? null;

// Today's Big Order for a town: one of the board's goods (not a hunt, not a
// special), ten times over. { key, item, need, unit }.
export function bigOrderOf(town, day) {
  const goods = ordersOf(town).filter((t) => t.kind === 'gather' || t.kind === 'craft');
  if (!goods.length) return null;
  const t = goods[hash32(`big:${town}:${day}`) % goods.length];
  const o = orderOf(t);
  return { key: t.key, item: t.item, need: o.qty * BIG_MULT, unit: Math.max(1, Math.round(ITEMS[t.item].value * BIG_PAY * knob('orders.pay', 1))) };
}

// The words for an order: "12 Oak Logs" / "Thin out 6 Wolves".
export function orderText(o) {
  if (!o) return '';
  if (o.kind === 'hunt') return `Thin out ${o.qty} ${plural(MONSTERS[o.monster]?.name ?? o.monster, o.qty)}`;
  return `${o.qty}× ${ITEMS[o.item]?.name ?? o.item}`;
}
export const plural = (name, n) => (n === 1 || /s$/.test(name) ? name : /[^aeiou]y$/.test(name) ? name.slice(0, -1) + 'ies' : /(sh|ch|x)$/.test(name) ? name + 'es' : /[lr]f$/.test(name) ? name.slice(0, -1) + 'ves' : name + 's');
