// Two towns for tests: the fixture map maps/fixtures/twotown.json (Hearthvale
// plus Testvale at (400, 0); made by scripts/world/twotown.mjs) and the
// Testvale content pack (shared/content/testvale.js), installed into the
// live tables for a test and taken out again afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TESTVALE from '../../shared/content/testvale.js';
import { CONTENT } from '../../shared/content/index.js';
import { ITEMS } from '../../shared/items.js';
import { RECIPES, RECIPE_BY_ID } from '../../shared/recipes.js';
import { DUNGEONS, CHESTS } from '../../shared/dungeon.js';
import { FISH_TABLES } from '../../shared/fishing.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'maps', 'fixtures', 'twotown.json');
export const TV = { x: 400, z: 0 };

// The fixture map. Without `cave`, the cave's door is left out (it needs the pack).
export function twoTownMap({ cave = false } = {}) {
  const m = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (!cave) m.entrances = m.entrances.filter((e) => e.kind !== 'testvale_cave');
  return m;
}

// Put Testvale's content into the game's tables (and take it out again).
const TABLES = () => [[ITEMS, TESTVALE.items], [DUNGEONS, TESTVALE.dungeons], [CHESTS, TESTVALE.chests], [FISH_TABLES, TESTVALE.fishTables]];
export function installTestvale() {
  for (const [table, add] of TABLES()) Object.assign(table, add);
  for (const r of TESTVALE.recipes) if (!RECIPE_BY_ID[r.id]) (RECIPES.push(r), (RECIPE_BY_ID[r.id] = r));
  for (const k of ['trade', 'supplies', 'customers']) CONTENT[k].testvale = TESTVALE[k];
}
export function uninstallTestvale() {
  for (const [table, add] of TABLES()) for (const id of Object.keys(add)) delete table[id];
  for (const r of TESTVALE.recipes) {
    delete RECIPE_BY_ID[r.id];
    const i = RECIPES.indexOf(r);
    if (i >= 0) RECIPES.splice(i, 1);
  }
  for (const k of ['trade', 'supplies', 'customers']) delete CONTENT[k].testvale;
}
