// World rules shared by the server (authority) and every client: movement,
// gathering, collision and pathfinding, plus the current map (setWorld).

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

const LISTS = ['lands', 'regions', 'buildings', 'gates', 'plazas', 'fountains', 'lakes', 'docks', 'zones', 'paths', 'nodes', 'spawns', 'stones', 'props'];

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
    });
  }
  return out;
}

// The waystones a map made before they existed gets (Hearthvale's two).
const FIRST_STONES = [
  { id: 'stone_square', name: 'Hearthvale Square', x: 6.2, z: 5.2, rot: -1.76 },
  { id: 'stone_wildwatch', name: 'Wildwatch', x: 3, z: -40.5, rot: 3.14 },
];

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
  // Maps from before fast travel: add the starter waystones (unless something
  // already uses their ids).
  if (m?.format === 2 && !m.stones) {
    const used = new Set(LISTS.flatMap((k) => (Array.isArray(m[k]) ? m[k].map((e) => e?.id) : [])));
    m = { ...m, stones: FIRST_STONES.filter((s) => !used.has(s.id)).map((s) => ({ ...s })) };
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

// ── Resource node types ────────────────────────────────────────────────
// hp: total swing power to break; tier: minimum tool tier; lvl: skill level gate.
export const NODE_TYPES = {
  tree_oak: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Oak Tree', hp: 6, tier: 1, lvl: 1, xp: 7, respawn: 18, r: 0.9, drops: [{ id: 'oak_log', min: 2, max: 3 }], rare: [{ id: 'golden_acorn', p: 0.006 }] },
  tree_birch: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Birch Tree', hp: 10, tier: 1, lvl: 4, xp: 15, respawn: 24, r: 0.8, drops: [{ id: 'birch_log', min: 2, max: 3 }], rare: [{ id: 'golden_acorn', p: 0.01 }] },
  tree_pine: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Ancient Pine', hp: 18, tier: 2, lvl: 8, xp: 32, respawn: 40, r: 1.0, drops: [{ id: 'pine_log', min: 2, max: 4 }], rare: [{ id: 'golden_acorn', p: 0.03 }] },
  rock_stone: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Boulder', hp: 5, tier: 1, lvl: 1, xp: 6, respawn: 16, r: 1.0, drops: [{ id: 'stone', min: 2, max: 3 }], rare: [] },
  rock_copper: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Copper Vein', hp: 8, tier: 1, lvl: 2, xp: 11, respawn: 22, r: 1.0, drops: [{ id: 'copper_ore', min: 1, max: 2 }, { id: 'stone', min: 0, max: 1 }], rare: [] },
  rock_iron: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Iron Vein', hp: 14, tier: 2, lvl: 5, xp: 22, respawn: 30, r: 1.1, drops: [{ id: 'iron_ore', min: 1, max: 2 }], rare: [{ id: 'sapphire', p: 0.008 }] },
  rock_gold: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Gold Vein', hp: 22, tier: 3, lvl: 8, xp: 42, respawn: 45, r: 1.2, drops: [{ id: 'gold_ore', min: 1, max: 2 }], rare: [{ id: 'sapphire', p: 0.035 }] },
  herb_mint: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Mint', hp: 1, tier: 0, lvl: 1, xp: 5, respawn: 14, r: 0, drops: [{ id: 'mint_leaf', min: 1, max: 2 }], rare: [] },
  herb_sun: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Sunpetal', hp: 1, tier: 0, lvl: 3, xp: 10, respawn: 20, r: 0, drops: [{ id: 'sunpetal', min: 1, max: 2 }], rare: [] },
  herb_moon: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Moonbloom', hp: 1, tier: 0, lvl: 7, xp: 22, respawn: 32, r: 0, drops: [{ id: 'moonbloom', min: 1, max: 1 }], rare: [] },
  fish_spot: { kind: 'fish', tool: 'rod', skill: 'fishing', name: 'Fishing Spot', hp: 1, tier: 1, lvl: 1, xp: 9, respawn: 6, r: 0, drops: [], rare: [] },
};

// Fishing spots near the middle of a lake are deep water (bigger fish).
export const isDeepSpot = (n) => LAKES.some((l) => Math.hypot(n.x - l.x, n.z - l.z) < l.deep);

const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

// ── Collision ──────────────────────────────────────────────────────────
// Everything solid in the current world: building footprints and gatehouse
// walls as rectangles; fountains, standing nodes and solid props as circles.
// They're indexed in a coarse grid, so a walkability test only looks at what's
// nearby however big the world gets.
export function buildColliders() {
  const rects = BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })).concat(GATES.flatMap((g) => gateColliders(g)));
  const circles = FOUNTAINS.map((f) => ({ x: f.x, z: f.z, r: f.r }));
  for (const n of NODES) {
    const t = NODE_TYPES[n.type];
    if (t.r > 0) circles.push({ x: n.x, z: n.z, r: t.r * n.s });
  }
  for (const p of PROPS) if (p.r > 0) circles.push({ x: p.x, z: p.z, r: p.r });
  for (const st of STONES) circles.push({ x: st.x, z: st.z, r: STONE_R });
  return indexColliders({ rects, circles });
}

const PLAYER_R = 0.45;
const BUCKET = 8; // metres per index cell
const bucketKey = (i, j) => (i + 32768) * 65536 + (j + 32768);
const NONE = { rects: [], circles: [] };

export function indexColliders(col) {
  const grid = new Map();
  const add = (kind, o, x0, z0, x1, z1) => {
    for (let i = Math.floor((x0 - PLAYER_R) / BUCKET); i <= Math.floor((x1 + PLAYER_R) / BUCKET); i++)
      for (let j = Math.floor((z0 - PLAYER_R) / BUCKET); j <= Math.floor((z1 + PLAYER_R) / BUCKET); j++) {
        const k = bucketKey(i, j);
        let b = grid.get(k);
        if (!b) grid.set(k, (b = { rects: [], circles: [] }));
        b[kind].push(o);
      }
  };
  for (const r of col.rects) add('rects', r, r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2);
  for (const c of col.circles) add('circles', c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  col.grid = grid;
  return col;
}

export function isWalkable(x, z, col) {
  if (landDistance(x, z) > 0) return false;
  // Lakes are water, except where a dock runs over them.
  if (LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 0.3) && !DOCKS.some((d) => Math.abs(x - d.x) < d.w / 2 && Math.abs(z - d.z) < d.d / 2)) return false;
  const near = col.grid ? col.grid.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? NONE : col;
  for (const r of near.rects) if (inRect(x, z, r, PLAYER_R)) return false;
  for (const c of near.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + PLAYER_R) ** 2) return false;
  return true;
}

// ── Navigation grid + A* ───────────────────────────────────────────────
// A grid of 1 m cells over the whole world. Cells are worked out a tile at a
// time, the first time a search reaches them, and each search only looks at a
// window around its start and goal, so even a huge world costs little.
const CELL = 1;
const TILE = 32;

// The world uses the defaults (sized to the current map); a shop interior
// passes its own small grid and walkable test (shared/shop.js).
export class NavGrid {
  constructor(col, { half = null, bounds = null, cell = CELL, walkable = isWalkable, margin = 0.2 } = {}) {
    this.col = col;
    this.cs = cell;
    this.walk = walkable;
    this.margin = margin;
    const b = bounds ?? (half != null ? { x0: -half, z0: -half, x1: half, z1: half } : EXTENT);
    this.ox = b.x0;
    this.oz = b.z0;
    this.nx = Math.ceil((b.x1 - b.x0) / cell);
    this.nz = Math.ceil((b.z1 - b.z0) / cell);
    this.block = new Uint8Array(this.nx * this.nz);
    this.tx = Math.ceil(this.nx / TILE);
    this.done = new Uint8Array(this.tx * Math.ceil(this.nz / TILE));
  }
  // A cell is open only if its centre and the area around it are walkable,
  // so paths never squeeze through gaps narrower than a hero.
  #fill(ti, tj) {
    this.done[tj * this.tx + ti] = 1;
    const m = this.margin;
    const w = (x, z) => this.walk(x, z, this.col);
    for (let j = tj * TILE; j < Math.min(this.nz, (tj + 1) * TILE); j++)
      for (let i = ti * TILE; i < Math.min(this.nx, (ti + 1) * TILE); i++) {
        const [x, z] = this.center(i, j);
        const ok = w(x, z) && w(x - m, z - m) && w(x + m, z - m) && w(x - m, z + m) && w(x + m, z + m);
        this.block[j * this.nx + i] = ok ? 0 : 1;
      }
  }
  center(i, j) {
    return [this.ox + (i + 0.5) * this.cs, this.oz + (j + 0.5) * this.cs];
  }
  cell(x, z) {
    return [Math.floor((x - this.ox) / this.cs), Math.floor((z - this.oz) / this.cs)];
  }
  open(i, j) {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    const ti = (i / TILE) | 0;
    const tj = (j / TILE) | 0;
    if (!this.done[tj * this.tx + ti]) this.#fill(ti, tj);
    return !this.block[j * this.nx + i];
  }
  // Straight line clear? (fine sampling against the exact colliders)
  clear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / Math.min(0.3, this.cs * 0.4)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.walk(ax + (bx - ax) * t, az + (bz - az) * t, this.col)) return false;
    }
    return true;
  }
  // Nearest open cell to a point (for taps on water/buildings).
  nearestOpen(x, z) {
    const [ci, cj] = this.cell(x, z);
    for (let r = 0; r < 12; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.open(ci + di, cj + dj)) return this.center(ci + di, cj + dj);
        }
    return null;
  }
  // Returns a list of waypoints [[x,z],...] excluding start, or null.
  findPath(sx, sz, tx, tz) {
    if (this.walk(tx, tz, this.col) && this.clear(sx, sz, tx, tz)) return [[tx, tz]];
    let goal = [tx, tz];
    if (!this.walk(tx, tz, this.col)) {
      const g = this.nearestOpen(tx, tz);
      if (!g) return null;
      goal = g;
      if (this.clear(sx, sz, goal[0], goal[1])) return [goal];
    }
    let [si, sj] = this.cell(sx, sz);
    if (!this.open(si, sj)) {
      const s = this.nearestOpen(sx, sz);
      if (!s) return null;
      [si, sj] = this.cell(s[0], s[1]);
    }
    let [gi, gj] = this.cell(goal[0], goal[1]);
    let retargeted = false;
    if (!this.open(gi, gj)) {
      retargeted = true;
      // The goal point is walkable but its grid cell's centre isn't (e.g. the
      // edge of the narrow dock): aim A* at the nearest open cell instead.
      const g = this.nearestOpen(goal[0], goal[1]);
      if (!g) return null;
      [gi, gj] = this.cell(g[0], g[1]);
    }
    // Search near the straight line first; widen once if the way round is longer.
    const cells = this.#astar(si, sj, gi, gj, 48) ?? this.#astar(si, sj, gi, gj, 160);
    if (!cells) return null;
    if (!retargeted) {
      if (cells.length) cells[cells.length - 1] = goal;
      else cells.push(goal);
    } else {
      // Only step off the grid onto the exact goal if that last hop is clear
      // (never cut a corner over water or through a wall to get there).
      const [lx, lz] = cells.length ? cells[cells.length - 1] : this.center(gi, gj);
      if (!cells.length) cells.push([lx, lz]);
      if (this.clear(lx, lz, goal[0], goal[1])) cells.push(goal);
    }
    // String-pull: skip waypoints we have line of sight past.
    const out = [];
    let ax = sx;
    let az = sz;
    let k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--)
        if (this.clear(ax, az, cells[m][0], cells[m][1])) {
          far = m;
          break;
        }
      out.push(cells[far]);
      [ax, az] = cells[far];
      k = far + 1;
    }
    return out;
  }
  // A* between two cells inside a window `pad` cells around them. Returns the
  // cell centres after the start up to the goal, or null.
  #astar(si, sj, gi, gj, pad) {
    const i0 = Math.max(0, Math.min(si, gi) - pad);
    const j0 = Math.max(0, Math.min(sj, gj) - pad);
    const W = Math.min(this.nx - 1, Math.max(si, gi) + pad) - i0 + 1;
    const H = Math.min(this.nz - 1, Math.max(sj, gj) + pad) - j0 + 1;
    const start = (sj - j0) * W + (si - i0);
    const target = (gj - j0) * W + (gi - i0);
    const g = new Float32Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const heap = new MinHeap();
    const limit = Math.max(30000, Math.min(W * H, 120000));
    g[start] = 0;
    heap.push(start, 0);
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === target) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > limit) return null;
      const ci = cur % W;
      const cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H || !this.open(ni + i0, nj + j0)) continue;
          if (di && dj && (!this.open(ci + di + i0, cj + j0) || !this.open(ci + i0, cj + dj + j0))) continue; // no corner cutting
          const nid = nj * W + ni;
          const cost = g[cur] + (di && dj ? 1.4142 : 1);
          if (cost < g[nid]) {
            g[nid] = cost;
            from[nid] = cur;
            heap.push(nid, cost + Math.hypot(gi - i0 - ni, gj - j0 - nj));
          }
        }
    }
    if (from[target] === -1 && target !== start) return null;
    const cells = [];
    for (let c = target; c !== -1 && c !== start; c = from[c]) cells.push(this.center((c % W) + i0, ((c / W) | 0) + j0));
    return cells.reverse();
  }
}

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const { k, v } = this;
    const top = k[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

// Advance an entity along its waypoint list. Mutates e {x,z,rot,path}. Returns true while moving.
export function stepPath(e, dt, speed = MOVE_SPEED) {
  let budget = speed * dt;
  while (budget > 0 && e.path && e.path.length) {
    const [tx, tz] = e.path[0];
    const dx = tx - e.x;
    const dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) e.rot = Math.atan2(dx, dz);
    if (d <= budget) {
      e.x = tx;
      e.z = tz;
      budget -= d;
      e.path.shift();
    } else {
      e.x += (dx / d) * budget;
      e.z += (dz / d) * budget;
      budget = 0;
    }
  }
  if (e.path && !e.path.length) e.path = null;
  return !!e.path;
}

// Where to stand to work a node: the nearest walkable point on a ring around
// it. Pass `nav` to only accept points you can actually walk to from (fromX, fromZ).
export function approachPoint(node, fromX, fromZ, col, nav = null) {
  const t = NODE_TYPES[node.type];
  const cands = [];
  if (t.kind === 'fish') {
    // Stand on the dock end or the shore facing the spot.
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      for (const d of [2, 3.5, 5, 6.5]) {
        const x = node.x + Math.cos(ang) * d;
        const z = node.z + Math.sin(ang) * d;
        if (isWalkable(x, z, col)) cands.push({ x, z, k: d + 0.02 * Math.hypot(x - fromX, z - fromZ) });
      }
    }
  } else {
    const ring = (t.r * node.s || 0) + 1.2;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = node.x + Math.cos(ang) * ring;
      const z = node.z + Math.sin(ang) * ring;
      if (isWalkable(x, z, col)) cands.push({ x, z, k: Math.hypot(x - fromX, z - fromZ) });
    }
  }
  cands.sort((a, b) => a.k - b.k);
  for (const c of cands) if (!nav || nav.findPath(fromX, fromZ, c.x, c.z)) return [c.x, c.z];
  return null;
}

// Building door location (where you walk to enter).
export function doorPoint(b) {
  const off = { n: [0, -b.d / 2 - 1.4], s: [0, b.d / 2 + 1.4], e: [b.w / 2 + 1.4, 0], w: [-b.w / 2 - 1.4, 0] }[b.face || 's'];
  return [b.x + off[0], b.z + off[1]];
}
