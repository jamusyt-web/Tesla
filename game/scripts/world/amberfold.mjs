// Writes maps/patches/020_amberfold.json: the Westmarch road from
// Hearthvale's West Gate, the town of Amberfold and the Amberwood around it
// (SPEC §1.2–1.7, §3, Phase 3 W1b). Seeded, so it writes the same file every
// time.
//   node scripts/world/amberfold.mjs
//
// x is east, z is south (north is −z). Amberfold's square is at (−540, −60);
// the road comes in from the east; the Mill Pond and the Great Mill are to
// the north, the Elder Oak and the Warren's door to the west.
import fs from 'node:fs';
import { stampTownKit, stampOutpost, merge, check, writePatch, SHIPPED } from './lib.mjs';
import { mulberry32 } from '../../shared/world.js';

const T = 'amberfold';
const C = { x: -540, z: -60 };
const rng = mulberry32(2020);
const r2 = (v) => Math.round(v * 100) / 100;
const off = (dx, dz) => [r2(C.x + dx), r2(C.z + dz)];
const base = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
const earlier = JSON.parse(fs.readFileSync(new URL('../../maps/patches/015_hearthvale_gates.json', import.meta.url), 'utf8')).add;

// ── Land ─────────────────────────────────────────────────────────────────
const lands = [
  { id: 'land_amberfold', x: C.x, z: C.z, r: 120 },
  ...[[-92, -4], [-150, -12], [-190, -2], [-230, 8], [-270, -4], [-310, -16], [-350, -28], [-390, -40], [-430, -46]].map(([x, z], i) => ({ id: `land_westmarch_${i}`, x, z, r: 55 })),
  { id: 'pk_hollowlog', x: -330, z: 60, r: 34 },
];

// ── Regions and zones ────────────────────────────────────────────────────
const town = stampTownKit(T, C.x, C.z, { name: 'Amberfold', tier: 2, biome: 'autumn', sig: 'smokehouse' });
// Orange and yellow roofs; the Smokehouse is drawn as one.
const PAL = { amberfold_market: 'roof_yellow', amberfold_workshop: 'roof_orange', amberfold_shop: 'roof_orange', amberfold_townhall: 'roof_yellow' };
for (const b of town.buildings) b.palette = PAL[b.id];
town.buildings.find((b) => b.id === 'amberfold_market').label = 'Amber Market';
for (const p of town.props) if (p.id === 'amberfold_sig') Object.assign(p, { slot: 'proc_smokehouse', r: 1.2 });
town.zones[0].ground = '#b89a6a';
town.stones[0].name = 'Amberfold Green';

const post = stampOutpost('westmarch_stones', -305, -4, { name: 'Westmarch Stones', tier: 2, biome: 'autumn' });
post.stones[0].id = 'stone_westmarch';
post.regions[0].stone = 'stone_westmarch';

const regions = [
  { id: 'westmarch', name: 'The Westmarch', tier: 2, kind: 'wild', x: -285, z: -20, r: 200, biome: 'autumn' },
  { id: 'amberwood', name: 'Amberwood', tier: 2, kind: 'wild', x: -540, z: -80, r: 150, biome: 'autumn', stone: 'stone_amberfold' },
];
const zones = [
  { id: 'amberfold_lake', kind: 'lake', label: 'The Mill Pond', icon: '🎣', glyph: 'rod', x: -575, z: -95, r: 14, ground: '#8a7a4a' },
  { id: 'af_maplewood', kind: 'forest', label: 'The Maplewood', icon: '🍁', glyph: 'pine', x: -628, z: -98, r: 26, ground: '#7a4a2a' },
  { id: 'af_coalpits', kind: 'quarry', label: 'Coal Pits', icon: '⛏️', glyph: 'pick', x: -482, z: -140, r: 20, ground: '#6a5a4a' },
  { id: 'af_redwood', kind: 'forest', label: 'Redleaf Hollow', icon: '🍂', glyph: 'pine', x: -560, z: 28, r: 24, ground: '#7a4a2a' },
  { id: 'af_pumpkins', kind: 'garden', label: 'Pumpkin Patch', icon: '🎃', glyph: 'herbs', x: -497, z: -18, r: 12, ground: '#8a6a32' },
  { id: 'wm_birchwood', kind: 'forest', label: 'Silverbirch Copse', icon: '🌳', glyph: 'pine', x: -430, z: -20, r: 18, ground: '#7a6a3a' },
];

// ── Roads and town paths ────────────────────────────────────────────────
const paths = [
  { id: 'road_westmarch', pts: [[-92, -4], [-150, -12], [-230, 8], [-310, -16], [-390, -40], [-470, -52]], w: 3 },
  { id: 'af_east_way', pts: [[-470, -52], [-505, -52], [-529, -58]], w: 2.2 },
  // The square's spokes (the same layout as Hearthvale's).
  ...[[-11.1, -6], [11.1, -6], [-15, 11.1], [16, 11.1], [-25.6, 4], [-2, 26.1], [-28, -18.1], [30, -18.1], [-36, 0]].map(([dx, dz], i) => ({ id: `af_path${i}`, pts: [off(0, 0), off(dx, dz)], w: 1.7 })),
  { id: 'af_path_shop', pts: [off(-14, 16), off(-26, 36)], w: 1.5 },
  { id: 'af_path_hall', pts: [off(16, 17), off(26, 27)], w: 1.6 },
  { id: 'af_mill_lane', pts: [off(30, -18.1), [-506, -88]], w: 1.8 },
  { id: 'af_pond_lane', pts: [off(-28, -18.1), [-566, -82]], w: 1.6 },
  { id: 'af_oak_way', pts: [off(-36, 0), [-596, -42], [-603, -12]], w: 2.2 },
];

// ── Lakes and fishing spots ─────────────────────────────────────────────
const lakes = [
  { id: 'mill_pond', x: -575, z: -95, r: 12, deep: 6, fish: T },
  { id: 'saltpools', x: -205, z: 38, r: 9, deep: 0, fish: 'road_west' },
];
const spotsAround = (l, n, a0 = 0) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (i / n) * Math.PI * 2;
  return { id: `fs_${l.id}_${i}`, type: 'fish_spot', x: r2(l.x + Math.cos(a) * (l.r - 2)), z: r2(l.z + Math.sin(a) * (l.r - 2)), rot: 0, s: 1 };
});
// The town lake: 6 spots (two of them over deep water, nearer the middle).
const fishing = [
  ...spotsAround(lakes[0], 4, 0.4),
  // Off the end of the pier: deep water.
  { id: 'fs_mill_pond_deep0', type: 'fish_spot', x: -572.5, z: -95, rot: 0, s: 1 },
  { id: 'fs_mill_pond_deep1', type: 'fish_spot', x: -577.5, z: -95, rot: 0, s: 1 },
  ...spotsAround(lakes[1], 3, 1.1),
];

// A little pier into the Mill Pond from the town side.
const docks = [{ id: 'dock_mill_pond', x: -575, z: -86, w: 3, d: 11 }];

// ── Waystones, the Warren's door, the skyline ───────────────────────────
const entrances = [{ id: 'door_thornroot', kind: 'thornroot_warren', x: -612, z: -10, rot: Math.PI / 2 }];
const skyline = [
  { id: 'sky_elder_oak', kind: 'tree', x: -610, z: -30, h: 28, card: 'au_elder_oak' },
  { id: 'sky_great_mill', kind: 'mill', x: -505, z: -98, h: 18, card: 'au_windmill' },
];

// ── Landmarks (§1.5) ─────────────────────────────────────────────────────
const landmarks = [
  // The Westmarch, in road order.
  { id: 'vista_causeway', kind: 'vista', name: 'Causeway Rise', x: -160, z: 14, r: 9, look: 2.6 },
  { id: 'cache_old_cart', kind: 'cache', name: 'The Old Cart', x: -175, z: -40, r: 6 },
  { id: 'ruin_milestone', kind: 'ruin', name: 'The Halfway Milestone', x: -272, z: 12, r: 8, lore: 'Carved deep in the old stone: “Hearthvale 3 leagues · Amberfold 3 leagues. Mind the hogs.” Someone has scratched underneath: “and the bandits.”' },
  { id: 'cache_hollowlog', kind: 'cache', name: 'The Hollow Log', x: -330, z: 52, r: 6 },
  { id: 'shrine_wayfarer', kind: 'shrine', name: "Wayfarer's Shrine", x: -398, z: -26, r: 7 },
  // Amberfold and the Amberwood.
  { id: 'lm_great_mill', kind: 'landmark', name: 'The Great Mill', x: -505, z: -95, r: 14, lore: 'Its sails have turned since before Hearthvale had a name. Every sack of Amberfold flour, and most of its gossip, passes through here.' },
  { id: 'lm_elder_oak', kind: 'landmark', name: 'The Elder Oak', x: -610, z: -30, r: 16, lore: 'The oldest tree anyone knows of. Its roots run down into the Thornroot Warren, and its leaves never quite finish falling.' },
  { id: 'vista_millrace', kind: 'vista', name: 'Millrace Bluff', x: -470, z: -120, r: 9, look: 0.9 },
  { id: 'cache_millers_box', kind: 'cache', name: "The Miller's Box", x: -585, z: -120, r: 6 },
  { id: 'cache_beehive', kind: 'cache', name: 'The Old Beehive', x: -605, z: -128, r: 6 },
  { id: 'shrine_harvest', kind: 'shrine', name: 'The Harvest Shrine', x: -500, z: -10, r: 7 },
  { id: 'curio_lost_scythe', kind: 'curio', name: 'Something in the Long Grass', x: -640, z: -86, r: 6, item: 'lost_scythe' },
  { id: 'ruin_old_granary', kind: 'ruin', name: 'The Old Granary', x: -470, z: 0, r: 8, lore: 'Burnt out long ago, the year the bramble bears came down from the Thornback. The town rebuilt the mill first and the granary never.' },
];

// ── Monster camps (≥ 40 m apart; bosses come two to a camp) ────────────
const spawns = [
  { id: 'camp_mossback', monster: 'mossback_hog', x: -250, z: -30, r: 12, count: 4 },
  { id: 'camp_mossback_e', monster: 'mossback_hog', x: -190, z: 36, r: 12, count: 4 },
  { id: 'camp_hedge_bandit', monster: 'hedge_bandit', x: -360, z: -66, r: 12, count: 4 },
  { id: 'camp_hedge_bandit_n', monster: 'hedge_bandit', x: -300, z: 40, r: 10, count: 3 },
  { id: 'camp_stag_e', monster: 'russet_stag', x: -452, z: -100, r: 14, count: 4 },
  { id: 'camp_stag_s', monster: 'russet_stag', x: -545, z: 30, r: 14, count: 4 },
  { id: 'camp_bear_w', monster: 'bramble_bear', x: -648, z: -50, r: 12, count: 3 },
  { id: 'camp_bear_n', monster: 'bramble_bear', x: -535, z: -162, r: 12, count: 3 },
  { id: 'camp_elder', monster: 'antlered_elder', x: -600, z: -140, r: 10, count: 2 },
];

// ── Props: the mill, the oak, and the town's autumn dressing ────────────
let pn = 0;
const prop = (slot, x, z, extra = {}) => ({ id: `af_p${pn++}`, slot, x: r2(x), z: r2(z), rot: r2(extra.rot ?? rng() * Math.PI * 2), r: extra.r ?? 0, ...(extra.s ? { s: extra.s } : {}) });
const props = [
  prop('au_windmill', -505, -100, { r: 4, rot: 0.6 }),
  prop('au_elder_oak', -616, -34, { r: 2.5, rot: 0.3 }),
  prop('au_stones', -560, 28, { rot: 0 }),
  prop('proc_applecart', -505, -26, { r: 1.2, rot: 0.4 }),
  prop('proc_applecart', ...off(6, -14), { r: 1.2, rot: 2.4 }),
  // Hay and pumpkins round the square and the patch; lamps and benches by the paths.
  ...[[-8, 13], [12, -12], [-22, 6], [22, 6]].map(([dx, dz]) => prop('au_hay', ...off(dx, dz), { r: 0.8 })),
  ...[[-490, -14], [-494, -24], [-503, -14], [-488, -22], [-500, -21]].map(([x, z]) => prop('au_pumpkin', x, z, { s: 1.2 })),
  ...[[-8, -9], [9, 9], [-9, 9], [9, -9]].map(([dx, dz]) => prop('lamp_post', ...off(dx, dz), { r: 0.3, rot: 0 })),
  ...[[-6, 12], [7, -12]].map(([dx, dz], i) => prop('bench_park', ...off(dx, dz), { rot: i ? Math.PI : 0 })),
  prop('signpost_directions', ...off(12, 2), { rot: 1.4 }),
  prop('signpost_trail', -100, 6, { rot: -1.6 }),
  prop('signpost_trail', -462, -58, { rot: 1.6 }),
  prop('au_logs', ...off(-24, -2), { r: 1.2, rot: 1.5 }),
  prop('au_logs', -592, -76, { r: 1.2 }),
  prop('workshop_lumber_pile', ...off(-12, -18)),
  prop('fishing_drying_rack', -562, -88, { rot: 2.2 }),
  prop('boat_rowing', -580, -91, { rot: 1.1 }),
  prop('campfire', -455, -122, { r: 0.6 }),
  prop('tent', -446, -126, { r: 1.5, rot: 2.6 }),
  prop('wilds_goblin_camp', -364, -74, { rot: 0.3 }),
  prop('wilds_goblin_camp', -296, 48, { rot: 1.2 }),
];

// Deco cottages with autumn roofs.
const cottage = (id, dx, dz, face, palette) => ({ id: `af_${id}`, x: r2(C.x + dx), z: r2(C.z + dz), w: 6, d: 5, face, deco: true, palette, color: '#f1e1b6', roof: '#b4553f' });
const buildings = [cottage('cottage1', -30, 4, 'e', 'roof_orange'), cottage('cottage2', -2, 30, 'n', 'roof_yellow'), cottage('cottage3', 2, -32, 's', 'roof_orange'), cottage('cottage4', 32, 22, 'w', 'roof_yellow'), cottage('cottage5', -33, 22, 'e', 'roof_orange')];

// ── Gathering nodes ─────────────────────────────────────────────────────
// Scattered with care: on land, off roads, lakes, buildings and each other.
const allLands = [...base.lands, ...lands];
const segs = [...paths, ...earlier.paths].flatMap((p) => p.pts.slice(1).map((b, i) => [...p.pts[i], ...b, p.w]));
const segDist = (x, z, [ax, az, bx, bz]) => {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
};
const allBuildings = [...town.buildings, ...buildings];
const rectOf = (b) => (b.face === 'e' || b.face === 'w' ? { x: b.x, z: b.z, w: b.d, d: b.w } : b);
const solids = [...town.props, ...post.props, ...props].filter((p) => p.r > 0);
const points = [...landmarks, ...entrances.map((e) => ({ ...e, r: 8 })), ...town.stones, ...post.stones, ...town.plazas];
const nodes = [...fishing];
function free(x, z, { clear = 4.5, town: inTown = false } = {}) {
  const inland = Math.max(...allLands.map((l) => l.r - Math.hypot(x - l.x, z - l.z)));
  if (inland < 4) return false;
  if (Math.hypot(x - 0, z - 0) < 100) return false; // Hearthvale's island is the owner's
  if (!inTown && Math.hypot(x - C.x, z - C.z) < 42) return false;
  if (lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 4)) return false;
  if (segs.some((s) => segDist(x, z, s) < s[4] + 2.5)) return false;
  if (allBuildings.some((b) => ((r) => Math.abs(x - r.x) < r.w / 2 + 3 && Math.abs(z - r.z) < r.d / 2 + 3)(rectOf(b)))) return false;
  if (solids.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2.5)) return false;
  if (points.some((p) => Math.hypot(x - p.x, z - p.z) < (p.r ?? 3) + 3)) return false;
  if (spawns.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) return false;
  if (nodes.some((n) => Math.hypot(x - n.x, z - n.z) < clear)) return false;
  if (Math.abs(x + 92) < 6 && Math.abs(z + 4) < 18) return false; // the West Gate
  return true;
}
let nn = 0;
function scatter(type, n, cx, cz, r, opts = {}) {
  let placed = 0;
  for (let tries = 0; placed < n && tries < 4000; tries++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const x = r2(cx + Math.cos(a) * d);
    const z = r2(cz + Math.sin(a) * d);
    if (!free(x, z, opts)) continue;
    nodes.push({ id: `af_n${nn++}`, type, x, z, rot: r2(rng() * Math.PI * 2), s: r2(0.9 + rng() * 0.25) });
    placed++;
  }
  if (placed < n) throw new Error(`only placed ${placed} of ${n} ${type} near ${cx},${cz}`);
}
// The Amberwood: 14 maples, 10 coal, 10 hearthcaps (SPEC §4.3).
scatter('tree_maple', 8, -628, -98, 24);
scatter('tree_maple', 6, -560, 28, 22);
scatter('rock_coal', 7, -482, -140, 18);
scatter('rock_coal', 3, -575, -150, 14);
scatter('herb_hearthcap', 5, -632, -70, 22);
scatter('herb_hearthcap', 5, -600, 10, 18);
// Filler a tier or two lower, so a friend still in Hearthvale's band has work.
scatter('tree_birch', 6, -470, 10, 26);
scatter('rock_iron', 4, -495, -150, 22);
scatter('herb_sun', 4, -500, 30, 20);
// The Westmarch: maples and hearthcaps near the Amberfold end, a birch copse,
// and Hearthvale-tier trees and rocks along the first stretch of road.
scatter('tree_maple', 4, -400, -70, 20);
scatter('herb_hearthcap', 4, -370, -10, 18);
scatter('tree_birch', 5, -430, -20, 16);
scatter('tree_oak', 2, -430, -20, 16);
scatter('tree_pine', 3, -140, 30, 18);
scatter('rock_iron', 3, -230, -35, 16);
scatter('rock_gold', 2, -325, 60, 14);
scatter('herb_moon', 3, -270, 40, 16);

const add = merge(town, post, { lands, regions, zones, paths, lakes, docks, nodes, spawns, entrances, landmarks, skyline, props, buildings });
check(add, { id: '020_amberfold' });
console.log(writePatch('020_amberfold', add), `${nodes.length} nodes, ${spawns.length} camps, ${landmarks.length} landmarks`);
