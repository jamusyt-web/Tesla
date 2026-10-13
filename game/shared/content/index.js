// Content packs. Each new town brings its items, gathering nodes, monsters,
// recipes, dungeon kinds and chest tables in its own file here (for example
// content/amberfold.js), shaped like:
//   export default { id, items: {}, nodes: {}, monsters: {}, recipes: [], dungeons: {}, chests: {} }
// The base tables (items.js, nodes.js, monsters.js, recipes.js, dungeon.js)
// merge CONTENT in when they load, so the rest of the game sees one table.
// Packs are plain data: they must not import those tables themselves.

const PACKS = []; // none yet: Hearthvale's content lives in the base tables

function collect(packs) {
  const out = { items: {}, nodes: {}, monsters: {}, recipes: [], dungeons: {}, chests: {} };
  for (const p of packs) {
    for (const k of ['items', 'nodes', 'monsters', 'dungeons', 'chests']) mergeInto(out[k], p[k] ?? {}, `${p.id} ${k}`);
    out.recipes.push(...(p.recipes ?? []));
  }
  return out;
}

// Add every entry of `extra` to `table`; an id that's already there is a mistake.
export function mergeInto(table, extra, what = 'content') {
  for (const [id, v] of Object.entries(extra)) {
    if (id in table) throw new Error(`${what}: "${id}" is defined twice.`);
    table[id] = v;
  }
  return table;
}

export const CONTENT = collect(PACKS);
