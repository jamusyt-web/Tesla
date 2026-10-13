// Put a content pack into the live tables after they've loaded (and take it
// out again). The game's own packs merge at import time (content/index.js);
// this is for packs chosen when the server starts (HV_PACKS=testvale) and
// for tests.
import { CONTENT } from './index.js';
import { ITEMS } from '../items.js';
import { RECIPES, RECIPE_BY_ID } from '../recipes.js';
import { DUNGEONS, CHESTS } from '../dungeon.js';
import { FISH, FISH_TABLES } from '../fishing.js';
import { MONSTERS } from '../monsters.js';
import { NODE_TYPES } from '../nodes.js';

const tables = (p) => [[ITEMS, p.items], [DUNGEONS, p.dungeons], [CHESTS, p.chests], [FISH, p.fish], [FISH_TABLES, p.fishTables], [MONSTERS, p.monsters], [NODE_TYPES, p.nodes]];

export function installPack(p) {
  for (const [table, add] of tables(p)) Object.assign(table, add ?? {});
  for (const r of p.recipes ?? []) if (!RECIPE_BY_ID[r.id]) (RECIPES.push(r), (RECIPE_BY_ID[r.id] = r));
  for (const k of ['trade', 'supplies', 'customers']) if (p[k]) CONTENT[k][p.id] = p[k];
}
export function uninstallPack(p) {
  for (const [table, add] of tables(p)) for (const id of Object.keys(add ?? {})) delete table[id];
  for (const r of p.recipes ?? []) {
    delete RECIPE_BY_ID[r.id];
    const i = RECIPES.indexOf(r);
    if (i >= 0) RECIPES.splice(i, 1);
  }
  for (const k of ['trade', 'supplies', 'customers']) delete CONTENT[k][p.id];
}
