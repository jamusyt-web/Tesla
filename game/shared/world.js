// World rules shared by the server (authority) and every client: movement,
// gathering, collision and pathfinding, plus the current map (setWorld).

import { NODE_TYPES } from './nodes.js';
import { inRect } from './nav.js';

// Node types and walking live in their own files; re-exported so existing
// imports of world.js keep working.
export * from './nodes.js';
export * from './nav.js';

export const MOVE_SPEED = 6.2; // units / second
export const INTERACT_RANGE = 2.9; // how close you must stand to hit a tree/rock
export const FISH_RANGE = 7.5;

// Swing rhythm for chopping and mining, shared so the client's timing ring
// and the server's rules agree. P is the tool's swing period in ms.
// - The client never sends a swing sooner than SWING_GATE·P after the last
//   one (an earlier tap waits), so mashing caps out at 1 damage per 0.74·P.
// - The server ignores swings closer than SWING_FLOOR·P (anti-macro), which
//   leaves ~0.19·P (95-130 ms) of headroom for network jitter, and even a
//   macro swinging at the floor does less damage than on-beat play.
// - A swing landing in the PERFECT window (the ring meeting the circle) does
//   double damage; the window starts after the gate, so mashing never scores it.
export const SWING_GATE = 0.74;
export const SWING_FLOOR = 0.55;
export const isPerfectSwing = (since, P) => since >= Math.min(P * 0.88, P - 60) && since <= P * 1.3;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The world map ──────────────────────────────────────────────────────
// Everything placed in the world lives in a map file (maps/world.json), not in
// code. The server loads it (server/map.js) and sends it to every client
// (GET /api/map), and both call setWorld() before building anything, so node
// ids and colliders always match. The exports below are live bindings: read
// them inside functions, never copy them at module load.
//
// Map format 2 (all positions in metres; x east, z south; rot in radians):
//   lands     [{ id, x, z, r }]         land: overlapping circles make any coastline
//   spawn     { x, z }                  where new heroes appear
//   regions   [{ id, name, tier, kind, x, z, r }]   towns / areas, tier 1 = starter
//   buildings [{ id, label, action, x, z, w, d, face, deco, ... }]
//   gates     [{ id, label, x, z, width, scale }]   castle-wall gatehouses
//   plazas, fountains [{ id, x, z, r }]
//   lakes     [{ id, x, z, r, deep }]   water; fishing spots within `deep` are deep water
//   docks     [{ id, x, z, w, d }]      walkable piers over water
//   zones     [{ id, kind, label, x, z, r, ground }]  named areas, tinted ground
//   paths     [{ id, pts: [[x, z], ...], w }]          dirt paths (w = half-width)
//   nodes     [{ id, type, x, z, rot, s }]            gatherables (NODE_TYPES)
//   spawns    [{ id, monster, x, z, r, count }]       monster camps
//   stones    [{ id, name, x, z, rot }]                fast-travel waystones (you arrive in front)
//   entrances [{ id, kind, x, z, rot }]                dungeon doors (kind: shared/dungeon.js DUNGEONS)
//   props     [{ id, slot, x, z, rot, r, s?, y?, v?, bob?, station? }]
//             slot = model slot (client/src/scene/manifest.js) or a proc_* kind;
//             r > 0 blocks movement; station marks a crafting station.
// (Format 1 had `bounds: { r }`, one round island at the centre; it's
// upgraded on load: see upgradeMap.)
export let MAP = null;
export let LANDS = [];
export let EXTENT = { x0: -98, z0: -98, x1: 98, z1: 98 }; // everything walkable lies inside
export let WORLD_RADIUS = 96; // furthest land from the centre
export let SPAWN = { x: 0, z: 8 };
export let REGIONS = [];
export let BUILDINGS = [];
export let GATES = [];
export let GATE = null; // the first gate (the Wilds Gate)
export let PLAZAS = [];
export let FOUNTAINS = [];
export let LAKES = [];
export let LAKE = null;
export let DOCKS = [];
export let DOCK = null;
export let ZONES = [];
export let PATHS = [];
export let NODES = [];
export let SPAWNS = [];
export let PROPS = [];
export let STONES = [];
export let ENTRANCES = [];

const LISTS = ['lands', 'regions', 'buildings', 'gates', 'plazas', 'fountains', 'lakes', 'docks', 'zones', 'paths', 'nodes', 'spawns', 'stones', 'entrances', 'props'];

// Checks a map's shape and returns a list of problems (empty = fine).
export function mapProblems(m) {
  const out = [];
  if (!m || typeof m !== 'object') return ['The map is not a JSON object.'];
  if (m.format !== 2) out.push(`Unknown map format ${m.format} (expected 2).`);
  if (!m.lands?.length) out.push('The map needs at least one piece of land (lands).');
  if (!Number.isFinite(m.spawn?.x) || !Number.isFinite(m.spawn?.z)) out.push('spawn needs x and z.');
  const ids = new Set();
  for (const k of LISTS) {
    const list = m[k] ?? [];
    if (!Array.isArray(list)) {
      out.push(`${k} must be a list.`);
      continue;
    }
    list.forEach((e, i) => {
      const where = `${k}[${i}]${e?.id ? ` (${e.id})` : ''}`;
      if (!e || typeof e !== 'object') return out.push(`${where} is not an object.`);
      if (typeof e.id !== 'string' || !e.id) out.push(`${where} needs an id.`);
      else if (ids.has(e.id)) out.push(`${where}: the id "${e.id}" is used twice.`);
      else ids.add(e.id);
      if (k === 'paths') {
        if (!Array.isArray(e.pts) || e.pts.length < 2 || e.pts.some((p) => !Number.isFinite(p?.[0]) || !Number.isFinite(p?.[1]))) out.push(`${where} needs at least two [x, z] points.`);
      } else if (!Number.isFinite(e.x) || !Number.isFinite(e.z)) out.push(`${where} needs numeric x and z.`);
      if (k === 'nodes' && !NODE_TYPES[e.type]) out.push(`${where}: unknown node type "${e.type}".`);
      if (k === 'props' && typeof e.slot !== 'string') out.push(`${where} needs a slot.`);
      if (k === 'buildings' && !(e.w > 0 && e.d > 0)) out.push(`${where} needs a positive w and d.`);
      if (k === 'lands' && !(e.r >= 5)) out.push(`${where} needs a radius r of at least 5.`);
      if (k === 'stones' && (typeof e.name !== 'string' || !e.name.trim())) out.push(`${where} needs a name.`);
      if ((k === 'stones' || k === 'entrances') && e.rot != null && !Number.isFinite(e.rot)) out.push(`${where} needs a numeric rot (the way it faces, in radians).`);
      if (k === 'entrances' && typeof e.kind !== 'string') out.push(`${where} needs a dungeon kind.`);
    });
  }
  return out;
}

// The waystones a map made before they existed gets (Hearthvale's two).
const FIRST_STONES = [
  { id: 'stone_square', name: 'Hearthvale Square', x: 6.2, z: 5.2, rot: -1.76 },
  { id: 'stone_wildwatch', name: 'Wildwatch', x: 3, z: -40.5, rot: 3.14 },
];

// …and the Hollow Crypt's door, in the Wilds.
const FIRST_ENTRANCES = [{ id: 'crypt_hollow', kind: 'hollow_crypt', x: 0, z: -74, rot: 0 }];

// Older map files, brought up to the current format (a new object; the input is untouched).
export function upgradeMap(m) {
  if (m?.format === 1) {
    const { bounds, ...rest } = m;
    const out = {};
    for (const [k, v] of Object.entries(rest)) {
      out[k] = k === 'format' ? 2 : v;
      if (k === 'rev') out.lands = [{ id: 'island', x: 0, z: 0, r: bounds?.r ?? 96 }];
    }
    out.lands ??= [{ id: 'island', x: 0, z: 0, r: bounds?.r ?? 96 }];
    m = out;
  }
  // Maps from before fast travel: add the starter waystones, where they still
  // fit (on land, clear of buildings) and unless something uses their ids.
  if (m?.format === 2 && !m.stones) {
    const used = new Set(LISTS.flatMap((k) => (Array.isArray(m[k]) ? m[k].map((e) => e?.id) : [])));
    const lands = Array.isArray(m.lands) ? m.lands : [];
    const builds = Array.isArray(m.buildings) ? m.buildings : [];
    const fits = (x, z) => lands.some((l) => Math.hypot(x - l.x, z - l.z) < l.r - 3) && !builds.some((b) => inRect(x, z, b, 2));
    const ok = (s) => !used.has(s.id) && fits(s.x, s.z) && fits(...stoneFront(s));
    m = { ...m, stones: FIRST_STONES.filter(ok).map((s) => ({ ...s })) };
  }
  // …and from before dungeons: the Hollow Crypt, where it still fits.
  if (m?.format === 2 && !m.entrances) {
    const used = new Set(LISTS.flatMap((k) => (Array.isArray(m[k]) ? m[k].map((e) => e?.id) : [])));
    const lands = Array.isArray(m.lands) ? m.lands : [];
    const builds = Array.isArray(m.buildings) ? m.buildings : [];
    const fits = (e) => lands.some((l) => Math.hypot(e.x - l.x, e.z - l.z) < l.r - 8) && !builds.some((b) => inRect(e.x, e.z, b, 6));
    m = { ...m, entrances: FIRST_ENTRANCES.filter((e) => !used.has(e.id) && fits(e)).map((e) => ({ ...e })) };
  }
  return m;
}

// Make `m` the current world (upgrading an old file first) and return it.
// Throws with every problem found if it's invalid.
export function setWorld(m) {
  m = upgradeMap(m);
  const bad = mapProblems(m);
  if (bad.length) throw new Error(`Invalid map:\n- ${bad.join('\n- ')}`);
  MAP = m;
  LANDS = m.lands;
  EXTENT = {
    x0: Math.floor(Math.min(...LANDS.map((l) => l.x - l.r)) - 2),
    z0: Math.floor(Math.min(...LANDS.map((l) => l.z - l.r)) - 2),
    x1: Math.ceil(Math.max(...LANDS.map((l) => l.x + l.r)) + 2),
    z1: Math.ceil(Math.max(...LANDS.map((l) => l.z + l.r)) + 2),
  };
  WORLD_RADIUS = Math.max(...LANDS.map((l) => Math.hypot(l.x, l.z) + l.r));
  SPAWN = m.spawn;
  REGIONS = m.regions ?? [];
  BUILDINGS = m.buildings ?? [];
  GATES = (m.gates ?? []).map((g) => ({ scale: GATE_SCALE, width: 7, ...g }));
  GATE = GATES[0] ?? null;
  PLAZAS = m.plazas ?? [];
  FOUNTAINS = m.fountains ?? [];
  LAKES = (m.lakes ?? []).map((l) => ({ deep: 6.5, ...l }));
  LAKE = LAKES[0] ?? null;
  DOCKS = m.docks ?? [];
  DOCK = DOCKS[0] ?? null;
  ZONES = m.zones ?? [];
  PATHS = m.paths ?? [];
  NODES = m.nodes ?? [];
  SPAWNS = m.spawns ?? [];
  PROPS = (m.props ?? []).map((p) => ({ rot: 0, r: 0, ...p }));
  STONES = (m.stones ?? []).map((st) => ({ rot: 0, ...st }));
  ENTRANCES = (m.entrances ?? []).map((e) => ({ rot: 0, ...e }));
  return m;
}

// A map as text, one entity per line: readable, and diffs show exactly what moved.
export function formatMap(m) {
  const keys = Object.keys(m);
  const lines = ['{'];
  keys.forEach((k, ki) => {
    const v = m[k];
    const comma = ki < keys.length - 1 ? ',' : '';
    if (Array.isArray(v)) {
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((e, i) => lines.push(`    ${JSON.stringify(e)}${i < v.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export const zoneById = (id) => ZONES.find((z) => z.id === id) ?? null;
export const stoneById = (id) => STONES.find((st) => st.id === id) ?? null;

// Where a point is: the smallest zone and region around it (either may be null).
export function placeAt(x, z) {
  const inner = (list) => {
    let best = null;
    for (const e of list) if (Math.hypot(x - e.x, z - e.z) < e.r && (!best || e.r < best.r)) best = e;
    return best;
  };
  return { zone: inner(ZONES), region: inner(REGIONS) };
}

// ── Fast travel ────────────────────────────────────────────────────────
// Walk up to a waystone to attune to it; then, standing at any waystone,
// pay a fee to travel to any other you're attuned to.
export const STONE_RANGE = 6; // how close counts as "at" a stone (and attunes you)
export const STONE_R = 0.7; // its collision radius
// The fee grows with the distance: a few gold across town, more across the world.
export const travelFee = (a, b) => 5 + Math.round(Math.hypot(a.x - b.x, a.z - b.z) / 25);
// Where you appear: a couple of metres in front of the stone.
export const stoneFront = (st, d = 2.6) => [st.x + Math.sin(st.rot ?? 0) * d, st.z + Math.cos(st.rot ?? 0) * d];
// Dungeon entrances: a crypt about 6 m wide and 7.6 m deep, its door on the
// front (the way `rot` faces). You stand in front of the door to go in.
export const CRYPT = { w: 6, d: 7.6 };
export const quarter = (rot) => Math.round((rot ?? 0) / (Math.PI / 2)) & 1; // 1 when turned sideways
export const entranceFront = (e, d = 2.2) => [e.x + Math.sin(e.rot ?? 0) * (CRYPT.d / 2 + d), e.z + Math.cos(e.rot ?? 0) * (CRYPT.d / 2 + d)];

// The stone you're standing at (nearest within range), if any.
export function stoneNear(x, z) {
  let best = null;
  let bd = STONE_RANGE;
  for (const st of STONES) {
    const d = Math.hypot(x - st.x, z - st.z);
    if (d <= bd) (best = st), (bd = d);
  }
  return best;
}
export const zonesOfKind = (kind) => ZONES.filter((z) => (z.kind ?? z.id) === kind);

// Signed distance to the coast: negative on land, positive out at sea.
export function landDistance(x, z) {
  let d = Infinity;
  for (const l of LANDS) d = Math.min(d, Math.hypot(x - l.x, z - l.z) - l.r);
  return d;
}

// Every dirt path as straight segments [ax, az, bx, bz, w].
export function pathSegments() {
  const out = [];
  for (const p of PATHS) for (let i = 1; i < p.pts.length; i++) out.push([p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1], p.w]);
  return out;
}

// The gatehouse is built from castle-kit modules (1 unit = gate.scale metres):
// the arch tower in the middle, two wall sections and a corner tower each side.
export const GATE_SCALE = 4.5;
const GATE_OPENING = 1.25; // half-width of the walkable arch at scale 4.5 (model: 0.255 × scale)

export function gateColliders(g = GATE) {
  if (!g) return [];
  const s = g.scale ?? GATE_SCALE;
  const open = (GATE_OPENING * s) / GATE_SCALE;
  const out = [];
  for (const sx of [-1, 1]) {
    // arch tower sides
    out.push({ x: g.x + sx * (open + 0.5 * s) / 2, z: g.z, w: 0.5 * s - open, d: 0.94 * s });
    // two wall sections and the corner tower
    out.push({ x: g.x + sx * 2 * s, z: g.z, w: 3 * s, d: s });
  }
  return out;
}

// Fishing spots near the middle of a lake are deep water (bigger fish).
export const isDeepSpot = (n) => LAKES.some((l) => Math.hypot(n.x - l.x, n.z - l.z) < l.deep);

// Building door location (where you walk to enter).
export function doorPoint(b) {
  const off = { n: [0, -b.d / 2 - 1.4], s: [0, b.d / 2 + 1.4], e: [b.w / 2 + 1.4, 0], w: [-b.w / 2 - 1.4, 0] }[b.face || 's'];
  return [b.x + off[0], b.z + off[1]];
}
