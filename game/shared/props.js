// Town dressing: where each prop stands. Shared by server and client so solid
// props (r > 0) block movement identically on both. `slot` refers to a model
// slot in client/src/scene/manifest.js; props whose slot has no model are
// simply not drawn (their collider still applies, so keep r: 0 for optional
// dressing). rot is radians around Y, v picks a model variant.
import { BUILDINGS, GATE, LAKE, DOCK, ZONES } from './world.js';

const P = [];
const add = (slot, x, z, rot = 0, r = 0, extra = {}) => P.push({ slot, x: +x.toFixed(2), z: +z.toFixed(2), rot: +rot.toFixed(3), r, ...extra });
const faceCenter = (x, z) => Math.atan2(-x, -z);
const b = Object.fromEntries(BUILDINGS.map((x) => [x.id, x]));
const deg = (d) => (d * Math.PI) / 180;

// ── Plaza: benches facing the fountain in the gaps between paths, lamps
// on the ring, direction signs at the east/west forks.
for (const a of [65, 118, 241, 300]) {
  const x = Math.cos(deg(a)) * 9.4;
  const z = Math.sin(deg(a)) * 9.4;
  add('bench_park', x, z, faceCenter(x, z), 0.8);
}
for (const a of [82, 132, 226, 284]) add('lamp_post', Math.cos(deg(a)) * 10.8, Math.sin(deg(a)) * 10.8, 0, 0.35);
add('signpost_directions', -12.6, 3.6, deg(90), 0.4);
add('signpost_directions', 12.6, -3.8, deg(-90), 0.4);

// ── Workshop yard (north of the workshop) ─────────────────────────────
{
  const w = b.workshop; // x -21.5..-12.5, z -9.5..-2.5, door east
  add('workshop_anvil', w.x - 2.5, w.z - 5.6, deg(10), 0.7);
  add('workshop_workbench', w.x + 0.8, w.z - 5.9, deg(0), 0.8);
  add('workshop_grindstone', w.x + 3.6, w.z - 5.5, deg(-20), 0.6);
  add('workshop_chopping_block', w.x - 6.3, w.z + 2.2, 0, 0.55);
  add('workshop_lumber_pile', w.x - 6.6, w.z - 2.2, deg(90), 1.0);
  add('prop_barrel', w.x + 5.0, w.z - 4.6, 0, 0.55);
  add('prop_barrel_alt', w.x + 5.6, w.z - 3.5, 0, 0.55);
  add('prop_crate', w.x - 4.6, w.z - 5.4, deg(15), 0.65);
  add('prop_crate', w.x - 5.4, w.z - 4.2, deg(-10), 0.65, { v: 1 });
}

// ── Grand Market: canopy stalls along the north side, cargo out back ──
{
  const m = b.market; // x 12.5..23.5, z -10..-2, open pavilion
  for (const [dx, v] of [[-3, 0], [3.6, 1]]) {
    add('market_stall_canopy', m.x + dx, m.z - 8.4, 0, 1.6);
    add('market_table', m.x + dx, m.z - 8.3, deg(90), 0, { v });
  }
  add('market_goods_fruit', m.x - 3.4, m.z - 8.3, 0, 0, { y: 0.9 });
  add('market_goods_bottles', m.x + 4.0, m.z - 8.2, 0, 0, { y: 0.9 });
  add('prop_crate', m.x + 6.9, m.z - 2.8, deg(5), 0.65, { v: 1 });
  add('prop_crate', m.x + 6.9, m.z - 1.6, deg(-8), 0.65);
  add('prop_crate_open', m.x + 6.8, m.z + 1.4, deg(90), 0.7, { v: 1 });
  add('prop_barrel', m.x + 6.6, m.z + 3.2, 0, 0.55);
  add('flags_banners', m.x - 5.9, m.z - 4.6, 0, 0.3, { v: 2 });
  add('flags_banners', m.x - 5.9, m.z + 4.6, 0, 0.3, { v: 2 });
}

// ── Your Shop: welcoming front, sign, pots, stock by the side ─────────
{
  const s = b.shop; // x -19.5..-10.5, z 12.5..19.5, door north
  add('flower_pots', s.x - 2.1, s.z - 4.05, 0, 0.3);
  add('flower_pots', s.x + 2.1, s.z - 4.05, 0, 0.3, { v: 1 });
  add('shop_sign', s.x + 5.4, s.z - 4.6, deg(-90), 0.35);
  add('prop_barrel', s.x - 5.3, s.z - 2.2, 0, 0.55);
  add('prop_crate_open', s.x - 5.4, s.z + 0.2, deg(90), 0.7);
  add('prop_chest', s.x - 5.3, s.z + 2.4, deg(90), 0.55);
  add('lantern_hanging', s.x - 1.2, s.z - 3.65, deg(180), 0, { y: 1.9 });
}

// ── Town Hall: banners and hedges either side of the door ─────────────
{
  const t = b.townhall; // door north, through the clock tower
  const front = t.z - t.d / 2;
  add('flags_banners', t.x - 4.9, front - 1.0, 0, 0.3);
  add('flags_banners', t.x + 4.9, front - 1.0, 0, 0.3);
  add('hedge_planter', t.x - 3.0, front - 0.7, 0, 0.6);
  add('hedge_planter', t.x + 3.0, front - 0.7, 0, 0.6);
  add('flowers_planters', t.x - 3.0, front - 0.75, 0, 0, { v: 1 });
  add('flowers_planters', t.x + 3.0, front - 0.75, 0, 0, { v: 1 });
}

// ── Cottages: pots by the door, firewood ──────────────────────────────
for (const c of BUILDINGS.filter((x) => x.deco)) {
  const off = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[c.face];
  const half = c.face === 'n' || c.face === 's' ? c.d / 2 : c.w / 2;
  const side = c.face === 'n' || c.face === 's' ? [1, 0] : [0, 1];
  const fx = c.x + off[0] * (half + 0.6);
  const fz = c.z + off[1] * (half + 0.6);
  add('flower_pots', fx + side[0] * 1.6, fz + side[1] * 1.6, 0, 0.3, { v: c.x > 0 ? 2 : 0 });
  add('workshop_lumber_pile', c.x - off[0] * (half + 1.3), c.z - off[1] * (half + 1.3), Math.atan2(side[0], side[1]), 0.9, { v: 1 });
}

// ── Dock & lake ───────────────────────────────────────────────────────
{
  const z0 = DOCK.z - DOCK.d / 2;
  for (let i = 0; i < 4; i++) {
    const z = z0 + 1.3 + i * 2.5;
    add('dock_railing', DOCK.x - DOCK.w / 2 - 0.15, z, deg(90), 0);
    if (i !== 2) add('dock_railing', DOCK.x + DOCK.w / 2 + 0.15, z, deg(90), 0);
  }
  add('dock_pilings', DOCK.x - DOCK.w / 2 - 1.2, DOCK.z + DOCK.d / 2 - 0.4, 0, 0, { y: -1 });
  add('dock_pilings', DOCK.x + DOCK.w / 2 + 1.4, DOCK.z + 1.2, deg(40), 0, { y: -1 });
  add('boat_rowing', DOCK.x + DOCK.w / 2 + 2.3, DOCK.z + 3.4, deg(4), 0, { y: -0.25 });
  add('boat_rowing', LAKE.x - 11.5, LAKE.z - 11.2, deg(-60), 0.9, { v: 1, y: -0.1 });
  add('lake_buoy', LAKE.x + 2, LAKE.z - 3.2, 0, 0, { v: 1, bob: true, y: -0.35 });
  add('lake_buoy', LAKE.x - 7, LAKE.z + 7, 0, 0, { bob: true, y: -0.35 });
  add('lake_buoy', LAKE.x + 8, LAKE.z + 6, 0, 0, { bob: true, y: -0.35 });
  add('fishing_drying_rack', DOCK.x - 5.2, z0 + 0.4, deg(0), 0.8);
  add('prop_bucket', DOCK.x - 3.3, z0 + 1.6, 0, 0.3);
  add('market_stall_gazebo', DOCK.x + 5.6, z0 - 1.6, deg(-90), 1.4);
  add('bench_rustic', DOCK.x - 6.4, z0 - 2.4, deg(20), 0.6);
}

// ── Herb garden: low fence with an opening toward town ────────────────
{
  const g = ZONES[2];
  const gap = deg(-45); // the path from Your Shop arrives from the north-east
  for (let a = 0; a < 360; a += 15) {
    const ang = deg(a);
    let d = ang - gap;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < deg(26)) continue;
    const x = g.x + Math.cos(ang) * 11.6;
    const z = g.z + Math.sin(ang) * 11.6;
    add('fence_low', x, z, -ang, 0.45);
  }
  add('prop_bucket', g.x + 6.8, g.z - 7.6, 0, 0.3);
  add('workshop_tools_leaning', g.x + 8.6, g.z - 5.4, deg(30), 0, { v: 3 });
}

// ── Forest & quarry entrances ─────────────────────────────────────────
add('workshop_chopping_block', -34.2, -4.2, 0, 0.55);
add('workshop_tools_leaning', -33.6, -5.6, deg(-30), 0, { v: 4 });
add('signpost_trail', -33.8, 4.6, deg(90), 0.3);
add('prop_crate', 37.6, -4.0, deg(12), 0.65, { v: 1 });
add('prop_barrel_alt', 38.6, -5.2, 0, 0.55);
add('workshop_tools_leaning', 37.8, 4.6, deg(200), 0, { v: 1 });
add('signpost_trail', 36.4, 4.8, deg(-90), 0.3);
add('tent', 44, -16.5, deg(30), 1.6);
add('campfire', 47.6, -14.2, 0, 0.6);

// ── The Wilds gate (castle wall built on the client): cannons on the
// town side, an adventurers' outpost just beyond it ─────────────────────
add('wilds_gate_defense', GATE.x - 5.6, GATE.z + 4.2, deg(180), 0.8);
add('wilds_gate_defense', GATE.x + 5.6, GATE.z + 4.2, deg(180), 0.8);
add('tent', GATE.x - 9.5, GATE.z - 8, deg(40), 1.6);
add('campfire', GATE.x - 6, GATE.z - 10.2, 0, 0.6);
add('bench_rustic', GATE.x - 3.8, GATE.z - 9.4, deg(-60), 0.6);
add('signpost_trail', GATE.x + 4.4, GATE.z - 4.6, deg(180), 0.3);
// Goblin camp near the goblins.
add('tent', 26.5, -66, deg(-120), 1.6, { v: 1 });
add('campfire', 23.5, -64.5, 0, 0.6);
add('wilds_goblin_camp', 27.8, -62.6, 0, 0.3);
add('wilds_goblin_camp', 18.5, -61.5, 0, 0.3, { v: 1 });
add('fence_wood', 14.2, -66, deg(80), 0.6, { v: 3 });

export const PROPS = P;
