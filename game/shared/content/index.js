// Content packs. Each new town brings its items, gathering nodes, monsters,
// recipes, dungeon kinds and chest tables in its own file here (for example
// content/amberfold/), shaped like:
//   export default { id, items: {}, nodes: {}, monsters: {}, recipes: [], dungeons: {}, chests: {},
//                    sets: {}, fish: {}, fishTables: {}, quests: [], orders: [], trade?, supplies?, customers? }
// (trade, supplies and customers: that town's economy, shared/economy.js and shop.js)
// The base tables (items.js, nodes.js, monsters.js, recipes.js, dungeon.js)
// merge CONTENT in when they load, so the rest of the game sees one table.
// Packs are plain data: they must not import those tables themselves.

import amberfold from './amberfold/index.js';

// In the fixed load order (SPEC §4.1). Hearthvale's content lives in the base tables.
const PACKS = [amberfold];

function collect(packs) {
  const out = { items: {}, nodes: {}, monsters: {}, recipes: [], dungeons: {}, chests: {}, sets: {}, fish: {}, fishTables: {}, quests: [], trade: {}, supplies: {}, customers: {}, orders: {} };
  for (const p of packs) {
    for (const k of ['items', 'nodes', 'monsters', 'dungeons', 'chests', 'sets', 'fish', 'fishTables']) mergeInto(out[k], p[k] ?? {}, `${p.id} ${k}`);
    out.recipes.push(...(p.recipes ?? []));
    out.quests.push(...(p.quests ?? []));
    // A town's merchant rates, supplier stock, shop customers and order templates, by town id.
    for (const k of ['trade', 'supplies', 'customers', 'orders']) if (p[k]) out[k][p.id] = p[k];
  }
  return out;
}
export const PACK_IDS = PACKS.map((p) => p.id);

// Add every entry of `extra` to `table`; an id that's already there is a mistake.
export function mergeInto(table, extra, what = 'content') {
  for (const [id, v] of Object.entries(extra)) {
    if (id in table) throw new Error(`${what}: "${id}" is defined twice.`);
    table[id] = v;
  }
  return table;
}

export const CONTENT = collect(PACKS);
