// Gold per focused hour in Amberfold (SPEC §6.4): selling what you gather
// to the town merchant at its rates, filling orders, and kill gold, set
// against what Amberfold's gear costs to make. Prints a small table.
//   node scripts/sim/gold.mjs
import { fileURLToPath } from 'node:url';
import { ITEMS } from '../../shared/items.js';
import { NODE_TYPES } from '../../shared/nodes.js';
import { MONSTERS } from '../../shared/monsters.js';
import { RECIPE_BY_ID } from '../../shared/recipes.js';
import { tradeOf, tagGroup } from '../../shared/economy.js';
import { ordersOf, orderOf } from '../../shared/orders.js';

const ACTIONS_PER_HOUR = 240; // nodes worked (SPEC §4.8)
const FIGHTS_PER_HOUR = 40;
// One node's goods per action, sold at the merchant's floor (the worst case).
export function gatherGoldPerHour(type, town = 'amberfold') {
  const t = NODE_TYPES[type];
  const d = t.drops[0];
  const per = (d.min + d.max) / 2;
  const T = tradeOf(town);
  const rate = Math.min(T.base, T.rate[tagGroup(d.id)]);
  // The merchant's floor pool (gold per item per 8 h) caps it; past that he pays 25%.
  const v = ACTIONS_PER_HOUR * per * ITEMS[d.id].value;
  const atFloor = Math.min(v * rate, T.floorPool);
  return Math.round(atFloor + (v - atFloor / rate) * 0.25);
}
export const killGoldPerHour = (id) => Math.round(FIGHTS_PER_HOUR * (MONSTERS[id].gold[0] + MONSTERS[id].gold[1]) / 2);
// The raw goods' value in a crafted item, at their base values.
export function inputsValue(id) {
  const r = RECIPE_BY_ID[id];
  return Object.entries(r.in).reduce((a, [i, n]) => a + n * (RECIPE_BY_ID[i] && !NODE_TYPES[i] ? inputsValue(i) : ITEMS[i].value), 0);
}
export const orderPay = (town = 'amberfold') => ordersOf(town).map((t) => ({ key: t.key, ...orderOf(t) }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const n of ['tree_maple', 'rock_coal', 'herb_hearthcap']) console.log(`${n.padEnd(16)} ${gatherGoldPerHour(n)} g in the first hour selling raw to the merchant`);
  for (const m of ['mossback_hog', 'russet_stag', 'bramble_bear']) console.log(`${m.padEnd(16)} ${killGoldPerHour(m)} g/h in kill gold`);
  for (const g of ['steel_saber', 'steel_brigandine', 'amber_pendant', 'axe_steel']) console.log(`${g.padEnd(16)} inputs worth ${inputsValue(g)} g, sells at ${ITEMS[g].value} g`);
  for (const o of orderPay()) console.log(`order ${o.key.padEnd(12)} ${String(o.qty).padStart(3)} × → ${o.pay} g, ${o.rep} rep`);
}
