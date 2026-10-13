// Writes maps/fixtures/twotown.json: the shipped map plus "Testvale", a
// 70 m test town at (400, 0) on its own island, stamped with the standard
// town kit, with an islet reached by a passage, a fishing lake, and the
// door of its cave dungeon (shared/content/testvale.js). Tests use it to
// exercise every system on two towns.
//   node scripts/world/twotown.mjs
import fs from 'node:fs';
import path from 'node:path';
import { stampTownKit, merge, check, SHIPPED } from './lib.mjs';
import { applyPatches } from '../../shared/mapkit.js';
import { formatMap, upgradeMap } from '../../shared/world.js';

const X = 400;
const Z = 0;
const add = merge(stampTownKit('testvale', X, Z, { name: 'Testvale', tier: 2, sig: 'smokehouse' }), {
  lands: [{ id: 'testvale_land', x: X, z: Z, r: 90 }, { id: 'testvale_islet', x: X, z: Z - 125, r: 14 }],
  lakes: [{ id: 'testvale_lake', x: X + 40, z: Z + 40, r: 14, deep: 6, fish: 'testvale' }],
  nodes: [
    { id: 'tv_spot', type: 'fish_spot', x: X + 40, z: Z + 25, rot: 0, s: 1 },
    ...[['tree_oak', -40, 30], ['tree_oak', -46, 22], ['tree_birch', -52, 34], ['rock_stone', 38, -30], ['rock_copper', 44, -36], ['herb_mint', -30, -40], ['herb_mint', -24, -46]].map(([type, dx, dz], i) => ({ id: `tv_n${i}`, type, x: X + dx, z: Z + dz, rot: 0, s: 1 })),
  ],
  passages: [{ id: 'pass_tv', name: 'Smugglers’ Squeeze', kind: 'squeeze', x: X, z: Z - 80, tx: X, tz: Z - 120, req: { skill: 'mining', lvl: 10 }, kit: 'tv_lantern' }],
  entrances: [{ id: 'door_tv_cave', kind: 'testvale_cave', x: X - 30, z: Z + 30, rot: 0 }],
});
const base = upgradeMap(JSON.parse(fs.readFileSync(SHIPPED, 'utf8')));
// (The cave door needs the Testvale pack, so the full check skips it.)
check({ ...add, entrances: [] }, { id: '900_twotown' });
const { map } = applyPatches(base, [{ id: '900_twotown', add }]);
delete map.patches;
const file = path.resolve('maps/fixtures/twotown.json');
fs.writeFileSync(file, formatMap({ ...map, name: 'Two towns (test fixture)' }));
console.log(`${file}: Hearthvale and Testvale`);
