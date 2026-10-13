// Writes maps/fixtures/stress.json: the five-town Hearthlands' exact land,
// lakes, docks, roads and waystones (SPEC §1.2–1.4), dressed at Hearthvale's
// density with today's models, for the perf census (npm run perf:census) and
// the budget estimator's test. About 3,500 blocking props, 410 nodes, 60 camps
// (240 monsters), 45 buildings, 12 waystones and 6 skyline cards.
//
//   node scripts/gen-stress-map.mjs
//
// Every new town gets a copy of Hearthvale's town (buildings, plaza, props,
// nodes, paths and zones; not its lake, dock, gate, crypt or camps), moved to
// its centre. Trees and rocks line the roads and fill each town's outskirts,
// and camps of 4 monsters sit in the outskirts and along the roads. Seeded,
// so the file is the same every time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatMap, mulberry32 } from '../shared/world.js';
import { serverMapProblems } from '../server/map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'maps', 'fixtures', 'stress.json');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', 'world.json'), 'utf8'));
const rng = mulberry32(2026);
const r2 = (v) => Math.round(v * 100) / 100;

// ── Land (79 circles, §1.4) ──────────────────────────────────────────────
const lands = [
  { id: 'island', x: 0, z: 0, r: 96 },
  { id: 'land_amberfold', x: -540, z: -60, r: 120 },
  { id: 'land_rimeholt', x: -520, z: -660, r: 115 },
  { id: 'land_sandmere', x: 560, z: -560, r: 120 },
  { id: 'land_starfall', x: 40, z: -1140, r: 118 },
  { id: 'land_fourways', x: 0, z: -640, r: 70 },
  { id: 'land_hollowmere', x: 0, z: -380, r: 52 },
];
const chain = (id, r, pts) => pts.forEach(([x, z], i) => lands.push({ id: `${id}_${i}`, x, z, r }));
chain('westmarch', 55, [[-92, -4], [-150, -12], [-190, -2], [-230, 8], [-270, -4], [-310, -16], [-350, -28], [-390, -40], [-430, -46]]);
chain('thornback', 55, [[-527, -185], [-515, -240], [-492, -280], [-470, -320], [-505, -360], [-540, -400], [-520, -435], [-500, -470], [-520, -505], [-540, -540]]);
chain('midmarch_w', 55, [[-400, -650], [-350, -640], [-305, -665], [-260, -690], [-215, -670], [-170, -650], [-125, -657], [-80, -665]]);
chain('midmarch_e', 55, [[67, -625], [100, -610], [150, -625], [200, -640], [250, -620], [300, -600], [350, -595], [400, -590], [445, -581]]);
chain('skystair', 55, [[35, -730], [10, -775], [-15, -820], [13, -860], [40, -900], [25, -940], [10, -980], [25, -1025]]);
chain('causeway', 42, [[28, -92], [27, -131], [25, -170], [15, -210], [5, -250], [3, -290], [0, -330], [0, -430], [-5, -475], [-10, -520], [-5, -563]]);
const pockets = [
  ['pk_hollowlog', -330, 60, 34], ['pk_tarn', -440, -468, 34], ['pk_moorbrute', -150, -735, 34], ['pk_cairn', 105, -700, 32],
  ['pk_saltmarsh', 262, -555, 34], ['pk_saltglass', 318, -655, 34], ['pk_raider', 380, -680, 34], ['pk_firstshard', 74, -792, 30],
  ['pk_vista_sky', -44, -882, 32], ['pk_shardwisp', 62, -955, 28], ['pk_meltwater', -60, -952, 34], ['pk_reedbank', -22, -178, 30],
];
for (const [id, x, z, r] of pockets) lands.push({ id, x, z, r });
for (const [id, x, z, r] of [['isl_smugglers', -240, 85, 16], ['isl_frozenfalls', -625, -520, 16], ['isl_ninefold', -215, -760, 15], ['isl_eyrie', 112, -990, 30], ['isl_starfallen', -98, -1018, 28]]) lands.push({ id, x, z, r });
if (lands.length !== 79) throw new Error(`expected 79 lands, got ${lands.length}`);

const lakes = [
  ['mirror_lake', 26, 46, 14, 6.5, 'water'], ['mill_pond', -575, -95, 12, 6, 'water'], ['rimeglass_tarn', -470, -700, 16, 7, 'ice'],
  ['sandmere_oasis', 525, -605, 12, 5, 'water'], ['crater_lake', 40, -1190, 22, 10, 'water'], ['hollowmere_lake', 0, -380, 55, 30, 'water'],
  ['saltpools', -205, 38, 9, 0, 'water'], ['thornback_tarn', -446, -472, 12, 5, 'ice'], ['peat_pool', -125, -706, 10, 0, 'water'],
  ['saltmarsh_pool', 262, -552, 10, 0, 'water'], ['meltwater_pool', -62, -958, 10, 4, 'ice'], ['reedbank', -24, -184, 8, 0, 'water'],
].map(([id, x, z, r, deep, kind]) => ({ id, x, z, r, deep, kind }));

const roads = [
  ['westmarch', [[-92, -4], [-150, -12], [-230, 8], [-310, -16], [-390, -40], [-470, -52]]],
  ['thornback', [[-540, -130], [-515, -240], [-470, -320], [-540, -400], [-500, -470], [-540, -540], [-522, -590]]],
  ['midmarch_w', [[-450, -660], [-350, -640], [-260, -690], [-170, -650], [-80, -665], [-34, -642]]],
  ['midmarch_e', [[34, -640], [100, -610], [200, -640], [300, -600], [400, -590], [490, -572]]],
  ['skystair', [[0, -674], [35, -730], [-15, -820], [40, -900], [10, -980], [40, -1070]]],
  ['causeway', [[28, -92], [25, -170], [5, -250], [0, -330], [0, -430], [-10, -520], [0, -606]]],
].map(([id, pts]) => ({ id: `road_${id}`, pts, w: 3 }));

const stones = [
  ['stone_square', 'Hearthvale Square', 6.2, 5.2, -1.76], ['stone_wildwatch', 'Wildwatch', 3, -40.5, 3.14], ['stone_westmarch', 'Westmarch Stones', -305, -4],
  ['stone_amberfold', 'Amberfold Green', -534, -55], ['stone_thornpass', 'Thornpass Lodge', -505, -432], ['stone_rimeholt', 'Rimeholt Gate', -514, -655],
  ['stone_fourways', 'Fourways', 6, -635], ['stone_saltmarsh', 'Saltmarsh Camp', 250, -612], ['stone_sandmere', 'Sandmere Well', 566, -555],
  ['stone_skystair', 'Skystair Camp', 14, -860], ['stone_starfall', 'Starfall Terrace', 46, -1135], ['stone_bridgehead', 'Hollowmere Bridgehead', 18, -300],
].map(([id, name, x, z, rot = 0]) => ({ id, name, x, z, rot }));

const regions = [
  ['hearthvale', 'Hearthvale', 'town', 1, 'meadow', 0, 0, 96], ['westmarch', 'The Westmarch', 'wild', 2, 'autumn', -285, -20, 200],
  ['amberfold', 'Amberfold', 'town', 2, 'autumn', -540, -60, 70], ['amberwood', 'Amberwood', 'wild', 2, 'autumn', -540, -80, 150],
  ['thornback', 'Thornback Pass', 'wild', 3, 'alpine', -515, -360, 230], ['rimeholt', 'Rimeholt', 'town', 3, 'alpine', -520, -660, 70],
  ['rimefells', 'Rimeholt Fells', 'wild', 3, 'alpine', -520, -680, 140], ['midmarch_w', 'The Midmarch (west)', 'wild', 3, 'heath', -230, -665, 215],
  ['fourways', 'Fourways', 'outpost', 3, 'heath', 0, -640, 34], ['midmarch_e', 'The Midmarch (east)', 'wild', 4, 'heath', 255, -625, 230],
  ['sandmere', 'Sandmere', 'town', 4, 'desert', 560, -560, 70], ['dunesea', 'The Dunesea', 'wild', 4, 'desert', 590, -580, 140],
  ['skystair', 'Skystair Rise', 'wild', 5, 'crystal', 20, -890, 200], ['starfall', 'Starfall', 'town', 5, 'crystal', 40, -1140, 70],
  ['craterrim', 'The Crater Rim', 'wild', 5, 'crystal', 40, -1150, 130], ['hollowmere', 'Hollowmere', 'wild', 2, 'heath', 5, -350, 265],
].map(([id, name, kind, tier, biome, x, z, r]) => ({ id, name, kind, tier, biome, x, z, r }));

// ── Hearthvale's town, copied to each new town ───────────────────────────
const TOWNS = [['amberfold', -540, -60], ['rimeholt', -520, -660], ['sandmere', 560, -560], ['starfall', 40, -1140]];
const inLake = (x, z, pad = 3) => lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + pad);
const nearMirror = (e) => Math.hypot(e.x - 26, e.z - 46) < 24 || base.docks.some((d) => Math.abs(e.x - d.x) < d.w / 2 + 3 && Math.abs(e.z - d.z) < d.d / 2 + 3);
const out = {
  format: 2, name: 'Stress (the Hearthlands, dressed)', rev: 100000, spawn: base.spawn, lands, regions, lakes, stones,
  buildings: [...base.buildings], gates: [...base.gates, { id: 'gate_west', label: 'West Gate', icon: '⚔️', glyph: 'swords', x: -92, z: -4, rot: Math.PI / 2, width: 7, scale: 4.5 }, { id: 'gate_north', label: 'North Gate', icon: '⚔️', glyph: 'swords', x: 28, z: -92, width: 7, scale: 4.5 }],
  plazas: [...base.plazas], fountains: [...base.fountains],
  docks: [...base.docks, { id: 'dock_hm_s', x: 0, z: -350, w: 4, d: 44, style: 'bridge' }, { id: 'dock_hm_n', x: 0, z: -410, w: 4, d: 44, style: 'bridge' }],
  zones: [...base.zones, ...[['thornback_low', 'forest', 'Redfall Woods', 'autumn', -505, -260, 110, '#6f5a35'], ['saltflats', 'meadow', 'The Saltflats', 'desert', 420, -600, 80, '#d9c7a0'], ['skystair_low', 'meadow', 'Heather Steps', 'heath', 15, -760, 80, '#7a6a5e'], ['crater_glade', 'garden', 'Lantern Glade', 'crystal', 90, -1120, 25, '#4a4660']].map(([id, kind, label, biome, x, z, r, ground]) => ({ id, kind, label, biome, x, z, r, ground }))],
  paths: [...base.paths, ...roads], nodes: [...base.nodes], spawns: [...base.spawns], entrances: [...(base.entrances ?? [])], props: [...base.props],
  skyline: [['sky_elder_oak', 'tree', -610, -30, 28, 'tree_oak'], ['sky_great_mill', 'mill', -505, -95, 18, 'tent'], ['sky_rime_beacon', 'tower', -575, -610, 26, 'lamp_post'], ['sky_waystation', 'tower', 10, -650, 20, 'lamp_post'], ['sky_colossus', 'statue', 640, -610, 22, 'rock_stone'], ['sky_starfallen', 'crystal', 40, -1190, 34, 'tree_pine']].map(([id, kind, x, z, h, card]) => ({ id, kind, x, z, h, card })),
};
for (const [town, tx, tz] of TOWNS) {
  const move = (e) => ({ ...e, id: `${town}_${e.id}`, x: r2(e.x + tx), z: r2(e.z + tz) });
  const keep = (e) => !nearMirror(e) && !inLake(e.x + tx, e.z + tz);
  out.buildings.push(...base.buildings.map((b) => ({ ...move(b), ...(b.deco ? {} : { recipe: b.id }) })));
  out.plazas.push(...base.plazas.map(move));
  out.fountains.push(...base.fountains.map(move));
  out.zones.push(...base.zones.map(move));
  out.nodes.push(...base.nodes.filter((n) => n.type !== 'fish_spot' && keep(n)).slice(0, 70).map(move));
  out.props.push(...base.props.filter(keep).map(move));
  out.paths.push(...base.paths.map((p) => ({ ...p, id: `${town}_${p.id}`, pts: p.pts.map(([x, z]) => [r2(x + tx), r2(z + tz)]) })));
}
// Fishing spots: 3 just inside every lake but Hearthvale's.
for (const l of lakes.slice(1))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    out.nodes.push({ id: `fish_${l.id}_${i}`, type: 'fish_spot', x: r2(l.x + Math.cos(a) * (l.r - 2)), z: r2(l.z + Math.sin(a) * (l.r - 2)), rot: 0, s: 1 });
  }

// ── Trees and rocks along the roads and in the outskirts; camps ─────────
const landDist = (x, z) => Math.min(...lands.map((l) => Math.hypot(x - l.x, z - l.z) - l.r));
const segs = out.paths.flatMap((p) => p.pts.slice(1).map((b, i) => [p.pts[i], b, p.w]));
const offPath = (x, z, pad) => segs.every(([a, b, w]) => {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)) > w + pad;
});
const clearOf = (x, z) => landDist(x, z) < -3 && !inLake(x, z) && offPath(x, z, 2) && !out.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3);
const KINDS = [['deco_tree_round', 1.0], ['deco_tree_pine', 0.8], ['deco_rock_small', 0.6], ['deco_tree_round', 1.0], ['deco_bush', 0]];
let pid = 0;
const prop = (x, z) => {
  const [slot, r] = KINDS[pid % KINDS.length];
  out.props.push({ id: `sp${pid++}`, slot, x: r2(x), z: r2(z), rot: r2(rng() * 6.28), r, ...(slot.startsWith('deco_tree') ? { s: r2(0.85 + rng() * 0.4) } : {}) });
};
const scatter = (n, pick) => {
  for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    const [x, z] = pick();
    if (!clearOf(x, z)) continue;
    prop(x, z);
    i++;
  }
};
for (const road of roads) {
  const legs = road.pts.slice(1).map((b, i) => [road.pts[i], b]);
  scatter(150, () => {
    const [a, b] = legs[Math.floor(rng() * legs.length)];
    const t = rng();
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const side = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 22);
    return [a[0] + (b[0] - a[0]) * t - ((b[1] - a[1]) / len) * side, a[1] + (b[1] - a[1]) * t + ((b[0] - a[0]) / len) * side];
  });
}
const MONSTERS = ['slime', 'wolf', 'goblin', 'boar', 'crab', 'caterpillar', 'skeleton', 'ghost', 'bear'];
let camps = 0;
const camp = (x, z) => out.spawns.push({ id: `camp${camps}`, monster: MONSTERS[camps++ % MONSTERS.length], x: r2(x), z: r2(z), r: 8, count: 4 });
for (const [, tx, tz] of TOWNS) {
  const ring = (lo, hi) => {
    const a = rng() * Math.PI * 2;
    const d = lo + rng() * (hi - lo);
    return [tx + Math.cos(a) * d, tz + Math.sin(a) * d];
  };
  scatter(560, () => ring(72, 112));
  for (let i = 0, tries = 0; i < 10 && tries < 400; tries++) {
    const [x, z] = ring(78, 108);
    if (clearOf(x, z)) camp(x, z), i++;
  }
}
for (const [, x, z, r] of pockets) scatter(20, () => [x + (rng() - 0.5) * r * 1.6, z + (rng() - 0.5) * r * 1.6]);
for (const road of roads) {
  const m = road.pts[Math.floor(road.pts.length / 2)];
  camp(m[0] + 14, m[1] + 10);
}
for (const [, x, z] of pockets.slice(0, 4)) camp(x, z);

const bad = serverMapProblems(out);
if (bad.length) throw new Error(`stress map problems:\n${bad.join('\n')}`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, formatMap(out));
const blocking = out.props.filter((p) => p.r > 0).length;
console.log(`${path.relative(ROOT, OUT)}: ${lands.length} lands, ${out.props.length} props (${blocking} blocking), ${out.nodes.length} nodes, ${out.spawns.length} camps (${out.spawns.reduce((n, s) => n + s.count, 0)} monsters), ${out.buildings.length} buildings, ${stones.length} stones, ${out.skyline.length} skyline cards`);
