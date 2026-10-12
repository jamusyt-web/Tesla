import { lands, regions, lakes, towns } from './world.mjs';
const onLand = (x, z) => lands.some(([, lx, lz, r]) => Math.hypot(x - lx, z - lz) <= r);
const inLake = (x, z) => Object.values(lakes).some(([lx, lz, r]) => Math.hypot(x - lx, z - lz) < r);
const regionAt = (x, z) => regions.filter(([, , , , rx, rz, r]) => Math.hypot(x - rx, z - rz) <= r).sort((a, b) => a[6] - b[6])[0]?.[0] ?? '-';
const pts = { mossjaw: [0, -60], old_bristle: [-300, 30], hollow_stag: [-600, -150], frostmaw: [-560, -480], moor_king: [-150, -740], captain_vex: [380, -690], glasswing: [620, -500], starmaw: [90, -1220],
  antlered_elder: [-600, -130], old_tusk: [-440, -600], brass_colossus: [665, -545], prism_warden: [-40, -1180], npc_tinker: [30, -14], npc_pell: [8, -628],
  door_thornroot: [-612, -10], door_icefall: [-600, -720], door_ashkar: [650, -595], door_shard: [-30, -1215], smoke_sig_A: [-570, -74], gate_west: [-92, -4], gate_north: [28, -92] };
for (const [n, [x, z]] of Object.entries(pts)) {
  const core = Object.entries(towns).find(([id, [tx, tz, cr]]) => id !== 'hearthvale' && id !== 'fourways' && Math.hypot(x - tx, z - tz) < cr + 6);
  console.log(n.padEnd(15), 'land', onLand(x, z), 'lake', inLake(x, z), 'region', regionAt(x, z), core && !n.startsWith('npc') && !n.startsWith('smoke') ? 'IN CORE ' + core[0] : '');
}
