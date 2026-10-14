// Walking: what's solid in the current world (colliders, indexed in a coarse
// grid), whether a point is walkable, the lazily built navigation grid with A*,
// and stepping along a path. Reads the current map from world.js at call time.
import { MOVE_SPEED, BUILDINGS, GATES, ENTRANCES, FOUNTAINS, NODES, PROPS, STONES, EXTENT, CRYPT, STONE_R, gateColliders, landDistance, quarter, around } from './world.js';
import { NODE_TYPES } from './nodes.js';
import { nearestRoad, roadRoute } from './roads.js';

export const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

// ── Collision ──────────────────────────────────────────────────────────
// Everything solid in the current world: building footprints and gatehouse
// walls as rectangles; fountains, standing nodes and solid props as circles.
// They're indexed in a coarse grid, so a walkability test only looks at what's
// nearby however big the world gets.
export function buildColliders() {
  const rects = BUILDINGS.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d }))
    .concat(GATES.flatMap((g) => gateColliders(g)))
    .concat(ENTRANCES.map((e) => (quarter(e.rot) ? { x: e.x, z: e.z, w: CRYPT.d, d: CRYPT.w } : { x: e.x, z: e.z, w: CRYPT.w, d: CRYPT.d })));
  const circles = FOUNTAINS.map((f) => ({ x: f.x, z: f.z, r: f.r }));
  // (Trees in a shifting grove don't block: they come and go, so a solid one
  // would leave an invisible wall where it stood. You brush through them.)
  for (const n of NODES) {
    const t = NODE_TYPES[n.type];
    if (t.r > 0 && !n.grove) circles.push({ x: n.x, z: n.z, r: t.r * n.s });
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
  if (around('lakes', x, z).some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 0.3) && !around('docks', x, z).some((d) => Math.abs(x - d.x) < d.w / 2 && Math.abs(z - d.z) < d.d / 2)) return false;
  const near = col.grid ? col.grid.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET))) ?? NONE : col;
  for (const r of near.rects) if (inRect(x, z, r, PLAYER_R)) return false;
  for (const c of near.circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + PLAYER_R) ** 2) return false;
  return true;
}

// ── Navigation grid + A* ───────────────────────────────────────────────
// A grid of 1 m cells over the whole world. Cells are worked out a 32 m tile
// at a time, the first time a search reaches them, and kept per tile (so the
// memory is only for places someone has walked near); each search only looks
// at a window around its start and goal. Long walks go by road (roads.js).
const CELL = 1;
const TILE = 32;
const ROAD_MIN = 100; // a walk this long (m) tries the roads first

// The world passes its road network; a shop interior or a dungeon passes its
// own small grid and walkable test (shared/shop.js) and no roads.
export class NavGrid {
  constructor(col, { half = null, bounds = null, cell = CELL, walkable = isWalkable, margin = 0.2, roads = null } = {}) {
    this.col = col;
    this.cs = cell;
    this.walk = walkable;
    this.margin = margin;
    this.roads = roads?.segs.length ? roads : null;
    const b = bounds ?? (half != null ? { x0: -half, z0: -half, x1: half, z1: half } : EXTENT);
    this.ox = b.x0;
    this.oz = b.z0;
    this.nx = Math.ceil((b.x1 - b.x0) / cell);
    this.nz = Math.ceil((b.z1 - b.z0) / cell);
    this.tx = Math.ceil(this.nx / TILE);
    this.tz = Math.ceil(this.nz / TILE);
    this.tiles = new Map(); // tile index → TILE×TILE bytes, 1 = blocked
    this.legs = new Map(); // a stretch of road → the waypoints that walk it
    this.lastKey = -1;
    this.lastTile = null;
  }
  // A cell is open only if its centre and the area around it are walkable,
  // so paths never squeeze through gaps narrower than a hero.
  #fill(ti, tj) {
    const t = new Uint8Array(TILE * TILE);
    const m = this.margin;
    const w = (x, z) => this.walk(x, z, this.col);
    for (let j = tj * TILE; j < Math.min(this.nz, (tj + 1) * TILE); j++)
      for (let i = ti * TILE; i < Math.min(this.nx, (ti + 1) * TILE); i++) {
        const [x, z] = this.center(i, j);
        const ok = w(x, z) && w(x - m, z - m) && w(x + m, z - m) && w(x - m, z + m) && w(x + m, z + m);
        t[(j - tj * TILE) * TILE + (i - ti * TILE)] = ok ? 0 : 1;
      }
    return t;
  }
  // Forget what's been worked out (something solid moved, e.g. a gate opened).
  invalidate() {
    this.tiles.clear();
    this.legs.clear();
    this.lastKey = -1;
    this.lastTile = null;
  }
  // Bytes held by worked-out tiles.
  get bytes() {
    return this.tiles.size * TILE * TILE;
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
    const k = tj * this.tx + ti;
    let t = k === this.lastKey ? this.lastTile : this.tiles.get(k);
    if (!t) this.tiles.set(k, (t = this.#fill(ti, tj)));
    this.lastKey = k;
    this.lastTile = t;
    return !t[(j - tj * TILE) * TILE + (i - ti * TILE)];
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
  findPath(sx, sz, tx, tz, { roads = true } = {}) {
    if (roads && this.roads && Math.hypot(tx - sx, tz - sz) > ROAD_MIN) {
      const p = this.#viaRoads(sx, sz, tx, tz);
      if (p) return p;
    }
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
  // A long walk: to the nearest road, along the roads, and off them to the
  // goal. Null when the roads don't help (none near, or a detour).
  #viaRoads(sx, sz, tx, tz) {
    const R = this.roads;
    const A = nearestRoad(R, sx, sz);
    const B = nearestRoad(R, tx, tz);
    if (!A || !B) return null;
    const mid = roadRoute(R, A, B);
    if (!mid) return null;
    let len = A.d + B.d;
    for (let i = 1; i < mid.length; i++) len += Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]);
    if (len > Math.hypot(tx - sx, tz - sz) * 2.5 + 40) return null; // a long way round: try the grid
    const out = [];
    // A straight stretch: walked as is where it's clear; where something
    // stands on it, a short search round just that 16 m piece.
    const piece = (ax, az, bx, bz) => {
      if (this.clear(ax, az, bx, bz)) return [[bx, bz]];
      return this.findPath(ax, az, bx, bz, { roads: false });
    };
    const stretch = (ax, az, bx, bz) => {
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 16));
      const pts = [];
      let [px, pz] = [ax, az];
      for (let k = 1; k <= n; k++) {
        const p = piece(px, pz, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
        if (!p) return null;
        pts.push(...p);
        [px, pz] = pts[pts.length - 1];
      }
      return pts;
    };
    let [ax, az] = [sx, sz];
    const legs = [...mid, [tx, tz]];
    for (const [k, [x, z]] of legs.entries()) {
      if (Math.hypot(x - ax, z - az) < 0.05) continue;
      // Stretches between two road junctions are the same every time: kept
      // (each starts at its junction, so get there first if we're not on it).
      const inner = k > 0 && k < legs.length - 2;
      let p;
      if (inner) {
        const [jx, jz] = mid[k - 1];
        if (Math.hypot(jx - ax, jz - az) > 0.05) {
          const c = piece(ax, az, jx, jz);
          if (!c) return null;
          out.push(...c);
        }
        const key = `${jx},${jz}|${x},${z}`;
        p = this.legs.get(key);
        if (p === undefined) this.legs.set(key, (p = stretch(jx, jz, x, z)));
      } else p = k === legs.length - 1 ? this.findPath(ax, az, x, z, { roads: false }) : stretch(ax, az, x, z);
      if (!p) return null;
      out.push(...p);
      [ax, az] = out[out.length - 1];
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

