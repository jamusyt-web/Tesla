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
// Map format 1 (all positions in metres; x east, z south; rot in radians):
//   bounds    { r }                     walkable island radius around (0, 0)
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
//   props     [{ id, slot, x, z, rot, r, s?, y?, v?, bob?, station? }]
//             slot = model slot (client/src/scene/manifest.js) or a proc_* kind;
//             r > 0 blocks movement; station marks a crafting station.
export let MAP = null;
export let WORLD_RADIUS = 96;
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
let HALF = WORLD_RADIUS + 2;

const LISTS = ['regions', 'buildings', 'gates', 'plazas', 'fountains', 'lakes', 'docks', 'zones', 'paths', 'nodes', 'spawns', 'props'];

// Checks a map's shape and returns a list of problems (empty = fine).
export function mapProblems(m) {
  const out = [];
  if (!m || typeof m !== 'object') return ['The map is not a JSON object.'];
  if (m.format !== 1) out.push(`Unknown map format ${m.format} (expected 1).`);
  if (!(m.bounds?.r > 10)) out.push('bounds.r must be a number above 10.');
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
    });
  }
  return out;
}

// Make `m` the current world. Throws with every problem found if it's invalid.
export function setWorld(m) {
  const bad = mapProblems(m);
  if (bad.length) throw new Error(`Invalid map:\n- ${bad.join('\n- ')}`);
  MAP = m;
  WORLD_RADIUS = m.bounds.r;
  HALF = WORLD_RADIUS + 2;
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
  return m;
}

export const zoneById = (id) => ZONES.find((z) => z.id === id) ?? null;
export const zonesOfKind = (kind) => ZONES.filter((z) => (z.kind ?? z.id) === kind);

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
export function buildColliders() {
  const rects = BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d })).concat(GATES.flatMap((g) => gateColliders(g)));
  const circles = FOUNTAINS.map((f) => ({ x: f.x, z: f.z, r: f.r }));
  for (const n of NODES) {
    const t = NODE_TYPES[n.type];
    if (t.r > 0) circles.push({ x: n.x, z: n.z, r: t.r * n.s });
  }
  for (const p of PROPS) if (p.r > 0) circles.push({ x: p.x, z: p.z, r: p.r });
  return { rects, circles };
}

const PLAYER_R = 0.45;

export function isWalkable(x, z, col) {
  if (Math.hypot(x, z) > WORLD_RADIUS) return false;
  // Lakes are water, except where a dock runs over them.
  if (LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 0.3) && !DOCKS.some((d) => Math.abs(x - d.x) < d.w / 2 && Math.abs(z - d.z) < d.d / 2)) return false;
  for (const r of col.rects) if (inRect(x, z, r, PLAYER_R)) return false;
  for (const c of col.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + PLAYER_R) ** 2) return false;
  return true;
}

// ── Navigation grid + A* ───────────────────────────────────────────────
const CELL = 1;

// The world uses the defaults (sized to the current map); a shop interior
// passes its own small grid and walkable test (shared/shop.js).
export class NavGrid {
  constructor(col, { half = HALF, cell = CELL, walkable = isWalkable, margin = 0.2 } = {}) {
    this.col = col;
    this.half = half;
    this.cs = cell;
    this.walk = walkable;
    const N = (this.n = Math.ceil((half * 2) / cell));
    this.block = new Uint8Array(N * N);
    const w = (x, z) => walkable(x, z, col);
    const m = margin;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        // A cell is open only if its centre and the area around it are
        // walkable, so paths never squeeze through gaps narrower than a hero.
        const [x, z] = this.center(i, j);
        const ok = w(x, z) && w(x - m, z - m) && w(x + m, z - m) && w(x - m, z + m) && w(x + m, z + m);
        this.block[j * N + i] = ok ? 0 : 1;
      }
  }
  center(i, j) {
    return [-this.half + (i + 0.5) * this.cs, -this.half + (j + 0.5) * this.cs];
  }
  cell(x, z) {
    return [Math.floor((x + this.half) / this.cs), Math.floor((z + this.half) / this.cs)];
  }
  open(i, j) {
    const N = this.n;
    return i >= 0 && j >= 0 && i < N && j < N && !this.block[j * N + i];
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
    const N = this.n;
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
    const start = sj * N + si;
    const target = gj * N + gi;
    const g = new Float32Array(N * N).fill(Infinity);
    const from = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, 0);
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === target) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > 30000) return null;
      const ci = cur % N;
      const cj = (cur / N) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (!this.open(ni, nj)) continue;
          if (di && dj && (!this.open(ci + di, cj) || !this.open(ci, cj + dj))) continue; // no corner cutting
          const nid = nj * N + ni;
          const cost = g[cur] + (di && dj ? 1.4142 : 1);
          if (cost < g[nid]) {
            g[nid] = cost;
            from[nid] = cur;
            heap.push(nid, cost + Math.hypot(gi - ni, gj - nj));
          }
        }
    }
    if (from[target] === -1 && target !== start) return null;
    const cells = [];
    for (let c = target; c !== -1 && c !== start; c = from[c]) cells.push(this.center(c % N, (c / N) | 0));
    cells.reverse();
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
