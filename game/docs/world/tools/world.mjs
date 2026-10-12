// Spec layout check: land circles, regions, roads, POI gaps, stone coverage, extent.
const SPEED = 6.2;
export const towns = { // id: [x, z, coreR, landR]
  hearthvale: [0, 0, 96, 96], amberfold: [-540, -60, 70, 120], rimeholt: [-520, -660, 70, 115],
  sandmere: [560, -560, 70, 120], starfall: [40, -1140, 70, 118], fourways: [0, -640, 34, 70],
};
export const roads = {
  westmarch: [[-92, -4], [-150, -12], [-230, 8], [-310, -16], [-390, -40], [-470, -52]],
  thornback: [[-540, -130], [-515, -240], [-470, -320], [-540, -400], [-500, -470], [-540, -540], [-522, -590]],
  midmarch_w: [[-450, -660], [-350, -640], [-260, -690], [-170, -650], [-80, -665], [-34, -642]],
  midmarch_e: [[34, -640], [100, -610], [200, -640], [300, -600], [400, -590], [490, -572]],
  skystair: [[0, -674], [35, -730], [-15, -820], [40, -900], [10, -980], [40, -1070]],
  causeway: [[28, -92], [25, -170], [5, -250], [0, -330], [0, -430], [-10, -520], [0, -606]],
};
// POIs near roads: [id, x, z]. Bridge span counts as road.
export const pois = {
  westmarch: [['gate_west', -92, -4], ['vista_causeway', -160, 14], ['fish_saltpools', -205, 30], ['camp_mossback', -250, -30], ['ruin_milestone', -272, 12], ['stone_westmarch', -305, -4], ['cache_hollowlog', -330, 52], ['camp_hedge_bandit', -360, -66], ['shrine_wayfarer', -398, -26], ['grove_birch', -430, -20]],
  thornback: [['camp_charcoal', -528, -190], ['camp_stag', -470, -236], ['grove_maple', -520, -270], ['vista_redfall', -468, -310], ['cache_bearden', -500, -362], ['ruin_watch', -585, -380], ['stone_thornpass', -505, -432], ['fish_tarn', -446, -462], ['camp_snowfox', -565, -490], ['grove_frostpine', -515, -505], ['pass_frozenfalls', -588, -535], ['shrine_hearthfire', -522, -548]],
  midmarch_w: [['grove_rimeedge', -400, -668], ['camp_moor_ox', -340, -608], ['vista_giantsteps', -292, -722], ['ruin_ninefold', -205, -612], ['pass_ninefold', -215, -705], ['fish_peat', -122, -700], ['camp_moor_brute', -150, -738], ['grove_heath', -60, -690]],
  midmarch_e: [['npc_pedlar', 50, -612], ['cache_cairn', 108, -702], ['grove_scrub', 150, -600], ['camp_carrion_crow', 200, -682], ['stone_saltmarsh', 250, -612], ['fish_saltmarsh', 260, -560], ['vista_saltglass', 318, -652], ['grove_dryscrub', 345, -575], ['camp_saltway_raider', 382, -684], ['shrine_dunes', 430, -548]],
  skystair: [['camp_crag_gremlin_s', 62, -720], ['grove_heather', 10, -775], ['ruin_firstshard', 74, -790], ['camp_moor_ox_s', -30, -812], ['stone_skystair', 14, -860], ['vista_skystair', -44, -880], ['camp_shard_wisp', 62, -955], ['pass_eyrie', 75, -962], ['fish_meltwater', -60, -950], ['pass_meltwater', -70, -975], ['grove_skyash', 0, -1020]],
  causeway: [['gate_north', 28, -92], ['camp_mossback_n', 55, -150], ['fish_reedbank', -20, -175], ['ruin_tollhouse', 40, -215], ['camp_hedge_bandit_n', -30, -260], ['stone_bridgehead', 18, -300], ['vista_hollowmere', -25, -320], ['bridge_hollowmere', 0, -380], ['fish_hollowmere_n', 25, -445], ['cache_drowned_cart', -30, -470], ['camp_hedge_bandit_n2', 30, -520], ['shrine_heron', -30, -560]],
};
export const stones = { stone_square: [6.2, 5.2], stone_wildwatch: [3, -40.5], stone_westmarch: [-305, -4], stone_amberfold: [-534, -55], stone_thornpass: [-505, -432], stone_rimeholt: [-514, -655], stone_fourways: [6, -635], stone_saltmarsh: [250, -612], stone_sandmere: [566, -555], stone_skystair: [14, -860], stone_starfall: [46, -1135], stone_bridgehead: [18, -300] };
export const lakes = { mirror_lake: [26, 46, 14], mill_pond: [-575, -95, 12], rimeglass_tarn: [-470, -700, 16], sandmere_oasis: [525, -605, 12], crater_lake: [40, -1190, 22], hollowmere: [0, -380, 55], saltpools: [-205, 38, 9], thornback_tarn: [-446, -472, 12], peat_pool: [-125, -706, 10], saltmarsh_pool: [262, -552, 10], meltwater_pool: [-62, -958, 10], reedbank: [-24, -184, 8] };
const segLen = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
function project(p, x, z) {
  let best = { d: Infinity, s: 0 }, acc = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i]; const dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz);
    let t = ((x - ax) * dx + (z - az) * dz) / (L * L); t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best.d) best = { d, s: acc + t * L };
    acc += L;
  }
  return best;
}
// Land circles: Hearthvale island; each town; road circles every <=60 m (r 48), skipping the bridge span.
export const lands = [['island', 0, 0, 96]];
for (const [id, [x, z, , R]] of Object.entries(towns)) if (id !== 'hearthvale') lands.push([`land_${id}`, x, z, R]);
let k = 0;
for (const [id, p] of Object.entries(roads)) {
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i]; const L = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(L / 72));
    for (let j = (i === 1 ? 0 : 1); j <= n; j++) {
      const x = ax + (bx - ax) * j / n, z = az + (bz - az) * j / n;
      if (id === 'causeway' && z < -340 && z > -420) continue; // the bridge crosses Hollowmere: lake, not land
      if (Object.values(towns).some(([tx, tz, , R]) => Math.hypot(x - tx, z - tz) < R - 20)) continue;
      if (lands.some(([, lx, lz, lr]) => Math.hypot(x - lx, z - lz) < lr - 30)) continue;
      lands.push([`land_${id}_${k++}`, Math.round(x), Math.round(z), id === 'causeway' ? 42 : 55]);
    }
  }
}
// The bridge neck: two narrow circles under the bridge ends, inside the lake (docks need land under them).
lands.push(['land_hollowmere', 0, -380, 52]);
// Pockets: off-road POIs and road ponds.
for (const [id, x, z, r] of [['pk_hollowlog', -330, 60, 34], ['pk_tarn', -440, -468, 34], ['pk_moorbrute', -150, -735, 34], ['pk_cairn', 105, -700, 32], ['pk_saltmarsh', 262, -555, 34], ['pk_saltglass', 318, -655, 34], ['pk_raider', 380, -680, 34], ['pk_firstshard', 74, -792, 30], ['pk_vista_sky', -44, -882, 32], ['pk_shardwisp', 62, -955, 28], ['pk_meltwater', -60, -952, 34], ['pk_reedbank', -22, -178, 30]]) lands.push([id, x, z, r]);
export const islands = [['isl_smugglers', -240, 85, 16], ['isl_frozenfalls', -625, -520, 16], ['isl_ninefold', -215, -760, 15], ['isl_eyrie', 112, -990, 30], ['isl_starfallen', -98, -1018, 28]];
for (const i of islands) lands.push(i);
const onLand = (x, z) => lands.some(([, lx, lz, r]) => Math.hypot(x - lx, z - lz) <= r);
const inLake = (x, z) => Object.values(lakes).some(([lx, lz, r]) => Math.hypot(x - lx, z - lz) < r);
// Regions: [id, kind, tier, biome, x, z, r]
export const regions = [
  ['hearthvale', 'town', 1, 'meadow', 0, 0, 96],
  ['westmarch', 'wild', 2, 'autumn', -285, -20, 200],
  ['amberfold', 'town', 2, 'autumn', -540, -60, 70], ['amberwood', 'wild', 2, 'autumn', -540, -80, 150],
  ['thornback', 'wild', 3, 'alpine', -515, -360, 230],
  ['rimeholt', 'town', 3, 'alpine', -520, -660, 70], ['rimefells', 'wild', 3, 'alpine', -520, -680, 140],
  ['midmarch_w', 'wild', 3, 'heath', -230, -665, 215],
  ['fourways', 'outpost', 3, 'heath', 0, -640, 34],
  ['midmarch_e', 'wild', 4, 'heath', 255, -625, 230],
  ['sandmere', 'town', 4, 'desert', 560, -560, 70], ['dunesea', 'wild', 4, 'desert', 590, -580, 140],
  ['skystair', 'wild', 5, 'crystal', 20, -890, 200],
  ['starfall', 'town', 5, 'crystal', 40, -1140, 70], ['craterrim', 'wild', 5, 'crystal', 40, -1150, 130],
  ['hollowmere', 'wild', 2, 'heath', 5, -350, 265],
];
const regionAt = (x, z) => regions.filter(([, , , , rx, rz, r]) => Math.hypot(x - rx, z - rz) <= r).sort((a, b) => a[6] - b[6])[0]?.[0] ?? '-';
const out = [];
for (const [id, p] of Object.entries(roads)) {
  const L = segLen(p);
  const ps = pois[id].map(([n, x, z]) => ({ n, x, z, ...project(p, x, z) })).sort((a, b) => a.s - b.s);
  const stops = [0, ...ps.map((q) => q.s), L];
  let gap = 0; for (let i = 1; i < stops.length; i++) gap = Math.max(gap, stops[i] - stops[i - 1]);
  const bad = ps.filter((q) => !onLand(q.x, q.z) || (inLake(q.x, q.z) && !q.n.startsWith('bridge')));
  out.push(`${id}: ${Math.round(L)} m, ${Math.round(L / SPEED)} s, ${ps.length} POIs, max gap ${Math.round(gap)} m, max off-road ${Math.round(Math.max(...ps.map((q) => q.d)))} m, off-land/in-lake: ${bad.map((b) => b.n).join(',') || 'none'}`);
  out.push('   ' + ps.map((q) => `${q.n}[${regionAt(q.x, q.z)}]`).join(' '));
}
console.log(out.join('\n'));
let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
for (const [, x, z, r] of lands) { minx = Math.min(minx, x - r); maxx = Math.max(maxx, x + r); minz = Math.min(minz, z - r); maxz = Math.max(maxz, z + r); }
let area = 0, far = 0, farAt = null, N = 0;
for (let x = minx; x <= maxx; x += 4) for (let z = minz; z <= maxz; z += 4) {
  if (!onLand(x, z) || inLake(x, z)) continue; area += 16; N++;
  const d = Math.min(...Object.values(stones).map(([sx, sz]) => Math.hypot(x - sx, z - sz)));
  if (d > far) { far = d; farAt = [x, z]; }
}
console.log('land circles', lands.length, 'extent x', minx, maxx, 'z', minz, maxz, `(${maxx - minx} x ${maxz - minz} m)`, 'land km2', (area / 1e6).toFixed(3), 'x island', (area / (Math.PI * 96 * 96)).toFixed(1));
console.log('nav MB per grid', ((maxx - minx + 4) * (maxz - minz + 4) / 1e6).toFixed(2), 'bitmap 16 m cells', Math.ceil((maxx - minx) / 16), 'x', Math.ceil((maxz - minz) / 16), '=', Math.ceil(Math.ceil((maxx - minx) / 16) * Math.ceil((maxz - minz) / 16) / 8), 'bytes');
console.log('farthest land from a stone', Math.round(far), 'm at', farAt);
for (const [a, b] of [['hearthvale', 'amberfold'], ['amberfold', 'rimeholt'], ['rimeholt', 'fourways'], ['fourways', 'sandmere'], ['fourways', 'starfall'], ['hearthvale', 'fourways']]) {
  const d = Math.hypot(towns[a][0] - towns[b][0], towns[a][1] - towns[b][1]); console.log(`fee ${a}->${b}: ${Math.round(d)} m straight, ${5 + Math.floor(d / 25)} g`);
}
if (process.argv[2] === 'lands') console.log(lands.map(([id, x, z, r]) => `${id} ${x},${z} r${r}`).join('; '));
// Town POI check: towns' own landmarks lie on land, not in lakes.
export const townPois = {
  hearthvale: [['vista_wildwatch_cliff', -20, -92], ['secret_whisper_hollow', -70, 12], ['cache_under_pier', 34, 30], ['curio_lost_hat', 30, 60]],
  amberfold: [['lm_great_mill', -505, -95], ['lm_elder_oak', -610, -30], ['door_thornroot', -612, -10], ['vista_millrace', -470, -120], ['cache_millers_box', -585, -120], ['shrine_harvest', -500, -10], ['curio_lost_scythe', -640, -90]],
  rimeholt: [['lm_rime_beacon', -575, -610], ['door_icefall', -600, -720], ['vista_beacon_crag', -585, -600], ['cache_trappers', -440, -720], ['ruin_old_shaft', -620, -680], ['curio_frozen_lantern', -470, -620]],
  sandmere: [['lm_sunken_colossus', 640, -610], ['door_ashkar', 650, -595], ['vista_salt_quay', 600, -470], ['cache_caravan_box', 520, -660], ['ruin_caravanserai', 660, -520], ['curio_brass_compass', 480, -620]],
  starfall: [['lm_starfallen', 40, -1190], ['door_shard_vault', -30, -1215], ['vista_observatory', 95, -1150], ['cache_fallen_star', 120, -1180], ['secret_lens_grotto', -50, -1170], ['curio_star_chart', 60, -1080]],
  fourways: [['lm_waystation_tower', 10, -650]],
};
const tb = [];
for (const [t, list] of Object.entries(townPois)) for (const [n, x, z] of list) if (!onLand(x, z) || inLake(x, z)) tb.push(`${t}:${n}`);
console.log('town POIs off land or in lake:', tb.join(', ') || 'none');

// Islands must not touch any other land; passage ends must be on land (from side on main land, to side on its island).
for (const [id, x, z, r] of islands) {
  const touch = lands.filter(([lid, lx, lz, lr]) => lid !== id && Math.hypot(x - lx, z - lz) < r + lr);
  console.log('island', id, 'touches', touch.map((t) => t[0]).join(',') || 'nothing');
}
const passages = [['pass_smugglers', -232, 52, -238, 78], ['pass_ninefold', -215, -705, -215, -752], ['pass_frozenfalls', -588, -535, -622, -520], ['pass_meltwater', -70, -975, -92, -1000], ['pass_eyrie', 75, -962, 100, -985]];
for (const [id, x, z, tx, tz] of passages) console.log(id, 'from on land', onLand(x, z) && !inLake(x, z), 'to on land', onLand(tx, tz) && !inLake(tx, tz));
// dock check: every point along the bridge x=0, z -328..-432 on land
let ok = true; for (let z = -432; z <= -328; z += 1) if (!onLand(0, z)) ok = false; console.log('bridge over land', ok);
