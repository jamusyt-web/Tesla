// Writes maps/patches/030_wildwoods.json: the Deepwood, an old forest north
// of the Westmarch road, made of shifting groves (server/groves.js), with a
// glade waystone, a pool, a view, caches, a ruin, a shrine and two camps;
// and an orchard grove in the Amberwood (the living wilds, L2). Seeded.
//   node scripts/world/wildwoods.mjs
import { mapBefore, placer, growForest, check, writePatch, merge } from './lib.mjs';
import { mulberry32 } from '../../shared/world.js';

const ID = '030_wildwoods';
const rng = mulberry32(3030);
const map = mapBefore(ID);

// ── Land, the region and its two green edges ────────────────────────────
const lands = [[-165, -78, 48], [-215, -95, 52], [-270, -102, 52], [-325, -100, 50], [-378, -92, 46]].map(([x, z, r], i) => ({ id: `land_deepwood_${i}`, x, z, r }));
const regions = [{ id: 'deepwood', name: 'The Deepwood', tier: 2, kind: 'wild', x: -270, z: -105, r: 80, biome: 'deepwood', stone: 'stone_deepwood' }];
const zones = [
  { id: 'dw_east', kind: 'forest', label: 'Oakshade', icon: '🌳', glyph: 'pine', x: -175, z: -85, r: 38, ground: '#4f8240', biome: 'deepwood' },
  { id: 'dw_west', kind: 'forest', label: 'Maple Hollow', icon: '🍁', glyph: 'pine', x: -362, z: -95, r: 36, ground: '#6a6a34', biome: 'deepwood' },
  { id: 'dw_middle', kind: 'forest', label: 'The Old Pines', icon: '🌲', glyph: 'pine', x: -250, z: -112, r: 34, ground: '#4a7a3a' },
];

// ── The glade, the pool, places to find, camps ──────────────────────────
const stones = [{ id: 'stone_deepwood', name: 'Deepwood Glade', x: -275, z: -92, rot: 0.4 }];
const props = [
  { id: 'dw_fire', slot: 'campfire', x: -270, z: -88, rot: 0, r: 0.7 },
  { id: 'dw_logs', slot: 'deco_log', x: -266, z: -91, rot: 1.2, r: 0 },
  { id: 'dw_sign', slot: 'signpost_trail', x: -238, z: -40, rot: 2.6, r: 0 },
];
const lakes = [{ id: 'deepwood_pool', x: -300, z: -128, r: 7, deep: 3 }];
const fishing = [0.4, 2.5, 4.6].map((a, i) => ({ id: `fs_deepwood_${i}`, type: 'fish_spot', x: Math.round((-300 + Math.cos(a) * 5) * 100) / 100, z: Math.round((-128 + Math.sin(a) * 5) * 100) / 100, rot: 0, s: 1 }));
const landmarks = [
  { id: 'vista_old_tor', kind: 'vista', name: 'The Old Tor', x: -238, z: -143, r: 9, look: 0.3 },
  { id: 'cache_woodcutter', kind: 'cache', name: "The Woodcutter's Chest", x: -200, z: -122, r: 6 },
  { id: 'cache_deep_hollow', kind: 'cache', name: 'A Hollow Oak', x: -330, z: -132, r: 6 },
  { id: 'ruin_old_lodge', kind: 'ruin', name: 'The Old Lodge', x: -290, z: -76, r: 8, lore: 'A woodcutters’ lodge, long empty. Carved over the door: “Take one, leave one standing.” The forest still seems to keep to it.' },
  { id: 'shrine_greenman', kind: 'shrine', name: 'The Green Man', x: -352, z: -70, r: 7 },
];
const spawns = [
  { id: 'camp_dw_wolves', monster: 'wolf', x: -195, z: -105, r: 12, count: 4 },
  { id: 'camp_dw_hogs', monster: 'mossback_hog', x: -345, z: -118, r: 10, count: 3 },
];
const paths = [{ id: 'dw_trail', pts: [[-238, -36], [-255, -62], [-275, -88]], w: 1.8 }];

// ── The groves ──────────────────────────────────────────────────────────
const so = { lands, lakes, landmarks, spawns, stones, props, paths };
const P = placer(map, so);
for (const f of fishing) P.take(f);
const nodes = [
  ...fishing,
  ...growForest(P, 'dw_oaks', { cx: -180, cz: -85, r: 32, types: [['tree_oak', 3], ['tree_birch', 2]], spacing: 5.5, slots: 44, rng }),
  ...growForest(P, 'dw_pines', { cx: -245, cz: -112, r: 32, types: [['tree_pine', 3], ['tree_birch', 1]], spacing: 6, slots: 38, rng }),
  ...growForest(P, 'dw_maples', { cx: -352, cz: -96, r: 30, types: [['tree_maple', 3], ['tree_pine', 1]], spacing: 6, slots: 32, rng }),
  ...growForest(P, 'dw_herbs', { cx: -292, cz: -112, r: 20, types: [['herb_mint', 3], ['herb_sun', 2], ['herb_moon', 1]], spacing: 3, slots: 22, rng }),
  ...growForest(P, 'dw_stones', { cx: -213, cz: -66, r: 13, types: [['rock_stone', 2], ['rock_copper', 2], ['rock_iron', 1]], spacing: 4.5, slots: 10, rng }),
  // The Amberwood's orchard, south-east of Amberfold.
  ...growForest(P, 'aw_orchard', { cx: -498, cz: 36, r: 18, types: [['tree_maple', 1]], spacing: 6, slots: 14, rng }),
];

const add = merge({ lands, regions, zones, stones, props, lakes, landmarks, spawns, paths, nodes });
check(add, { id: ID });
const by = {};
for (const n of nodes) if (n.grove) by[n.grove] = (by[n.grove] ?? 0) + 1;
console.log(writePatch(ID, add), JSON.stringify(by));
