// Helpers for the scripts that build new parts of the world as map patches
// (maps/patches/NNN_name.json, SPEC §11.2). A script stamps towns and
// outposts, adds roads, nodes and camps, checks the result against the
// shipped map, and writes the patch:
//
//   import { stampTownKit, merge, writePatch, check } from './lib.mjs';
//   const add = merge(stampTownKit('amberfold', -540, -60, { tier: 2, biome: 'autumn' }), { lands: [...] });
//   check(add);                       // throws on map problems, prints the lints
//   writePatch('020_amberfold', add);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampTownKit, stampOutpost, applyPatches, mapLints, landReach, MAP_LISTS } from '../../shared/mapkit.js';
import { mapProblems, upgradeMap } from '../../shared/world.js';

export { stampTownKit, stampOutpost, applyPatches, mapLints, landReach };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PATCH_DIR = path.join(ROOT, 'maps', 'patches');
export const SHIPPED = path.join(ROOT, 'maps', 'world.json');

// Join several { list: [entries] } bundles into one.
export function merge(...parts) {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) (out[k] ??= []).push(...v);
  return out;
}

// The shipped map with this patch (and every earlier one) applied: throws if
// it has problems; returns { map, report, lints }.
export function check(add, { id = 'check', base = JSON.parse(fs.readFileSync(SHIPPED, 'utf8')) } = {}) {
  const earlier = fs.existsSync(PATCH_DIR)
    ? fs.readdirSync(PATCH_DIR).filter((f) => /^\d{3}_[\w-]+\.json$/.test(f) && f.replace(/\.json$/, '') < id).sort().map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(PATCH_DIR, f), 'utf8')) }))
    : [];
  const { map, report } = applyPatches(upgradeMap(base), [...earlier, { id, add }]);
  const bad = mapProblems(map);
  if (bad.length) throw new Error(`Map problems:\n- ${bad.join('\n- ')}`);
  const lints = mapLints(map);
  for (const l of lints) console.log(`lint (${l.kind}): ${l.text}`);
  return { map, report, lints };
}

// Write maps/patches/<id>.json, its lists in the map's order.
export function writePatch(id, add) {
  const ordered = Object.fromEntries(MAP_LISTS.filter((k) => add[k]?.length).map((k) => [k, add[k]]));
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  const lines = ['{', '  "add": {'];
  const keys = Object.keys(ordered);
  keys.forEach((k, i) => {
    lines.push(`    ${JSON.stringify(k)}: [`);
    ordered[k].forEach((e, j) => lines.push(`      ${JSON.stringify(e)}${j < ordered[k].length - 1 ? ',' : ''}`));
    lines.push(`    ]${i < keys.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}');
  const file = path.join(PATCH_DIR, `${id}.json`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
