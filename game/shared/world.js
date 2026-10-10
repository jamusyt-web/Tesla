// The town of Hearthvale. Pure data + deterministic generation so the server
// (authority) and every client build exactly the same world, node ids included.

export const WORLD_RADIUS = 96; // walkable island radius
export const SPAWN = { x: 0, z: 8 };
export const MOVE_SPEED = 6.2; // units / second
export const INTERACT_RANGE = 2.9; // how close you must stand to hit a tree/rock
export const FISH_RANGE = 7.5;

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

// ── Buildings: axis-aligned footprints (w along x, d along z). Door faces +z
// unless `face` says otherwise. `action` is what tapping it opens.
export const BUILDINGS = [
  { id: 'workshop', label: 'Workshop', icon: '🔨', action: 'craft', x: -17, z: -6, w: 9, d: 7, face: 'e', color: '#d98b5f', roof: '#8a4b3a' },
  { id: 'market', label: 'Grand Market', icon: '⚖️', action: 'market', x: 18, z: -6, w: 11, d: 8, face: 'w', color: '#f2d38a', roof: '#3f7fbf' },
  { id: 'shop', label: 'Your Shop', icon: '🏪', action: 'shop', x: -15, z: 16, w: 9, d: 7, face: 'n', color: '#f6c6a6', roof: '#c4534a' },
  { id: 'townhall', label: 'Town Hall', icon: '🏛️', action: 'townhall', x: 16, z: 17, w: 11, d: 8, face: 'n', color: '#efe6d2', roof: '#5b7f4a' },
  { id: 'cottage1', x: -30, z: 4, w: 6, d: 5, face: 'e', color: '#f1e1b6', roof: '#b4553f', deco: true },
  { id: 'cottage2', x: 31, z: 6, w: 6, d: 5, face: 'w', color: '#d7e7f0', roof: '#6d5aa8', deco: true },
  { id: 'cottage3', x: -2, z: 30, w: 6, d: 5, face: 'n', color: '#f8d7da', roof: '#4f7d8c', deco: true },
  { id: 'cottage4', x: -28, z: -22, w: 6, d: 5, face: 's', color: '#e6f0d0', roof: '#a8643a', deco: true },
  { id: 'cottage5', x: 30, z: -22, w: 6, d: 5, face: 's', color: '#fbe7c6', roof: '#3d6f9c', deco: true },
];

// The gate to the Wilds is an arch you walk through; the posts are solid.
export const GATE = { id: 'gate', label: 'Wilds Gate', icon: '⚔️', x: 0, z: -34, width: 7 };

export const FOUNTAIN = { x: 0, z: 0, r: 3.2 };
export const LAKE = { x: 26, z: 46, r: 14 };
export const DOCK = { x: 26, z: 32, w: 3, d: 10 }; // pier running into the lake from the north shore

// Named regions. Tinted ground + signposts on the client, spawn areas on the server.
export const ZONES = [
  { id: 'forest', label: 'Whisperwood', icon: '🌲', x: -54, z: 0, r: 22, ground: '#5f9e4f' },
  { id: 'quarry', label: 'Copperstone Quarry', icon: '⛏️', x: 54, z: 0, r: 20, ground: '#b9a68a' },
  { id: 'garden', label: 'Herb Garden', icon: '🌿', x: -30, z: 40, r: 11, ground: '#7fc46a' },
  { id: 'lake', label: 'Mirror Lake', icon: '🎣', x: LAKE.x, z: LAKE.z, r: LAKE.r + 4, ground: '#e3d29a' },
  { id: 'wilds', label: 'The Wilds', icon: '⚔️', x: 0, z: -66, r: 30, ground: '#6c9a54' },
];

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

// Fishing loot table by rod tier: weights.
export function fishTable(rodTier, fishingLvl) {
  const luck = 1 + fishingLvl * 0.04 + (rodTier - 1) * 0.5;
  return [
    { id: 'minnow', w: 60, xp: 9 },
    { id: 'trout', w: 26 * luck, xp: 18 },
    { id: 'golden_koi', w: 2.2 * luck, xp: 60 },
    { id: 'old_boot', w: 8, xp: 3 },
  ];
}

function scatter(rng, n, cx, cz, r, minGap, avoid, existing) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (avoid && avoid(x, z)) continue;
    if ([...existing, ...out].some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minGap * minGap)) continue;
    out.push({ x: +x.toFixed(2), z: +z.toFixed(2) });
  }
  return out;
}

const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

// Deterministic list of all gatherable nodes in the town.
export function generateNodes() {
  const rng = mulberry32(1337);
  const nodes = [];
  const add = (type, pts) => pts.forEach((p) => nodes.push({ id: `n${nodes.length}`, type, x: p.x, z: p.z, rot: +(rng() * 6.28).toFixed(2), s: +(0.9 + rng() * 0.25).toFixed(2) }));
  const placed = () => nodes;
  const forest = ZONES[0];
  // Oaks on the town-side edge, birch in the middle, ancient pines deep west.
  const forestAvoid = (x, z) => x > forest.x + 18 || x < -WORLD_RADIUS + 6;
  add('tree_oak', scatter(rng, 16, forest.x + 9, forest.z, 12, 3.4, forestAvoid, placed()));
  add('tree_birch', scatter(rng, 12, forest.x - 4, forest.z, 11, 3.4, forestAvoid, placed()));
  add('tree_pine', scatter(rng, 8, forest.x - 16, forest.z, 9, 3.8, forestAvoid, placed()));
  const q = ZONES[1];
  const qAvoid = (x, z) => x > WORLD_RADIUS - 6 || x < q.x - 18;
  add('rock_stone', scatter(rng, 12, q.x - 7, q.z, 11, 3.2, qAvoid, placed()));
  add('rock_copper', scatter(rng, 9, q.x + 1, q.z, 12, 3.2, qAvoid, placed()));
  add('rock_iron', scatter(rng, 6, q.x + 10, q.z - 4, 8, 3.5, qAvoid, placed()));
  add('rock_gold', scatter(rng, 4, q.x + 13, q.z + 6, 6, 3.6, qAvoid, placed()));
  const g = ZONES[2];
  add('herb_mint', scatter(rng, 10, g.x, g.z, 8, 1.8, null, placed()));
  add('herb_sun', scatter(rng, 7, g.x, g.z, 8, 1.8, null, placed()));
  add('herb_moon', scatter(rng, 4, g.x, g.z, 8, 1.8, null, placed()));
  // Fishing spots sit on the water around the end of the dock and the shore.
  const fishPts = [
    { x: DOCK.x - 3.5, z: DOCK.z + DOCK.d / 2 + 1.5 },
    { x: DOCK.x + 3.5, z: DOCK.z + DOCK.d / 2 + 1.5 },
    { x: DOCK.x, z: DOCK.z + DOCK.d / 2 + 4 },
    { x: LAKE.x - 10, z: LAKE.z + 2 },
    { x: LAKE.x + 10, z: LAKE.z - 1 },
    { x: LAKE.x + 3, z: LAKE.z + 10 },
  ];
  add('fish_spot', fishPts);
  return nodes;
}

// Decorative scenery (not gatherable) — still deterministic so collisions match.
export function generateScenery() {
  const rng = mulberry32(4242);
  const trees = [];
  // A ring of big decorative trees framing the island edge.
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng() * 0.05;
    const d = WORLD_RADIUS + 2 + rng() * 6;
    trees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: 1.2 + rng() * 0.8, kind: rng() > 0.5 ? 'pine' : 'round' });
  }
  // Scattered town greenery — avoid paths, plaza, buildings and zones.
  const blocked = (x, z) =>
    Math.hypot(x, z) < 12 ||
    BUILDINGS.some((b) => inRect(x, z, b, 3)) ||
    ZONES.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r + 2) ||
    Math.abs(x) < 3 || Math.abs(z) < 3 || Math.hypot(x, z) > WORLD_RADIUS - 4;
  const deco = scatter(rng, 46, 0, 0, WORLD_RADIUS - 6, 4, blocked, []);
  deco.forEach((p) => trees.push({ ...p, s: 0.8 + rng() * 0.5, kind: rng() > 0.6 ? 'pine' : 'round', solid: true }));
  const flowers = [];
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const d = 6 + Math.sqrt(rng()) * (WORLD_RADIUS - 10);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (BUILDINGS.some((b) => inRect(x, z, b, 1)) || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 1) continue;
    flowers.push({ x, z, c: Math.floor(rng() * 5), s: 0.7 + rng() * 0.6 });
  }
  return { trees, flowers };
}

// ── Collision ──────────────────────────────────────────────────────────
export function buildColliders(nodes, scenery) {
  const rects = BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
  const circles = [{ x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r }];
  // Gate posts
  circles.push({ x: GATE.x - GATE.width / 2, z: GATE.z, r: 0.9 }, { x: GATE.x + GATE.width / 2, z: GATE.z, r: 0.9 });
  for (const n of nodes) {
    const t = NODE_TYPES[n.type];
    if (t.r > 0) circles.push({ x: n.x, z: n.z, r: t.r * n.s });
  }
  for (const t of scenery.trees) if (t.solid) circles.push({ x: t.x, z: t.z, r: 0.8 * t.s });
  return { rects, circles };
}

const PLAYER_R = 0.45;

export function isWalkable(x, z, col) {
  if (Math.hypot(x, z) > WORLD_RADIUS) return false;
  // Lake is water, except for the dock.
  const inDock = Math.abs(x - DOCK.x) < DOCK.w / 2 && Math.abs(z - DOCK.z) < DOCK.d / 2;
  if (!inDock && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 0.3) return false;
  for (const r of col.rects) if (inRect(x, z, r, PLAYER_R)) return false;
  for (const c of col.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + PLAYER_R) ** 2) return false;
  return true;
}

// ── Navigation grid + A* ───────────────────────────────────────────────
const CELL = 1;
const HALF = WORLD_RADIUS + 2;
const N = Math.ceil((HALF * 2) / CELL);

export class NavGrid {
  constructor(col) {
    this.col = col;
    this.n = N;
    this.block = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const [x, z] = this.center(i, j);
        this.block[j * N + i] = isWalkable(x, z, col) ? 0 : 1;
      }
  }
  center(i, j) {
    return [-HALF + (i + 0.5) * CELL, -HALF + (j + 0.5) * CELL];
  }
  cell(x, z) {
    return [Math.floor((x + HALF) / CELL), Math.floor((z + HALF) / CELL)];
  }
  open(i, j) {
    return i >= 0 && j >= 0 && i < N && j < N && !this.block[j * N + i];
  }
  // Straight line clear? (fine sampling against the exact colliders)
  clear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / 0.3));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!isWalkable(ax + (bx - ax) * t, az + (bz - az) * t, this.col)) return false;
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
    if (isWalkable(tx, tz, this.col) && this.clear(sx, sz, tx, tz)) return [[tx, tz]];
    let goal = [tx, tz];
    if (!isWalkable(tx, tz, this.col)) {
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
    const [gi, gj] = this.cell(goal[0], goal[1]);
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
    cells[cells.length - 1] = goal;
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

// Where to stand to work a node: nearest walkable point on a ring around it.
export function approachPoint(node, fromX, fromZ, col) {
  const t = NODE_TYPES[node.type];
  const ring = t.kind === 'fish' ? null : (t.r * node.s || 0) + 1.2;
  if (t.kind === 'fish') {
    // Stand on the dock end or the shore facing the spot.
    const cands = [];
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      for (const d of [2, 3.5, 5, 6.5]) {
        const x = node.x + Math.cos(ang) * d;
        const z = node.z + Math.sin(ang) * d;
        if (isWalkable(x, z, col)) cands.push([x, z, d]);
      }
    }
    cands.sort((a, b) => a[2] - b[2] + 0.02 * (Math.hypot(a[0] - fromX, a[1] - fromZ) - Math.hypot(b[0] - fromX, b[1] - fromZ)));
    return cands[0] ? [cands[0][0], cands[0][1]] : null;
  }
  let best = null;
  let bestD = Infinity;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const x = node.x + Math.cos(ang) * ring;
    const z = node.z + Math.sin(ang) * ring;
    if (!isWalkable(x, z, col)) continue;
    const d = Math.hypot(x - fromX, z - fromZ);
    if (d < bestD) {
      bestD = d;
      best = [x, z];
    }
  }
  return best;
}

// Building door location (where you walk to enter).
export function doorPoint(b) {
  const off = { n: [0, -b.d / 2 - 1.4], s: [0, b.d / 2 + 1.4], e: [b.w / 2 + 1.4, 0], w: [-b.w / 2 - 1.4, 0] }[b.face || 's'];
  return [b.x + off[0], b.z + off[1]];
}
