// The road network: every map path as a graph, so a long walk doesn't need a
// huge grid search. A long route walks to the nearest road, follows the roads
// the shortest way (Dijkstra), and walks off them to where it's going (see
// NavGrid.findPath in nav.js). Deterministic, so the client's prediction and
// the server's path agree.
import { PATHS } from './world.js';

const MERGE = 1.5; // points this close are one junction
const BUCKET = 32; // metres per cell of the segment index
const key = (i, j) => (i + 32768) * 65536 + (j + 32768);

// Closest point on segment a–b to p: [t, x, z, distance].
function project(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
  const x = ax + vx * t;
  const z = az + vz * t;
  return [t, x, z, Math.hypot(px - x, pz - z)];
}

// { pts: [[x, z]], adj: [[[to, len]]], segs: [[a, b]], grid } from the map's paths.
export function buildRoads(paths = PATHS) {
  const pts = [];
  const nodeAt = (x, z) => {
    for (let i = 0; i < pts.length; i++) if (Math.hypot(pts[i][0] - x, pts[i][1] - z) < MERGE) return i;
    pts.push([x, z]);
    return pts.length - 1;
  };
  // Each path's points, plus a junction wherever another path ends on it.
  const lines = paths.filter((p) => p.pts?.length > 1).map((p) => p.pts.map(([x, z]) => [x, z]));
  for (const line of lines)
    for (const end of [line[0], line[line.length - 1]])
      for (const other of lines) {
        if (other === line) continue;
        for (let i = 1; i < other.length; i++) {
          const [t, x, z, d] = project(end[0], end[1], other[i - 1][0], other[i - 1][1], other[i][0], other[i][1]);
          if (d < 4 && t > 0.01 && t < 0.99) {
            other.splice(i, 0, [x, z]); // split the other path there
            end[0] = x;
            end[1] = z;
            break;
          }
        }
      }
  const segs = [];
  const adj = [];
  for (const line of lines) {
    let prev = nodeAt(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) {
      const cur = nodeAt(line[i][0], line[i][1]);
      if (cur !== prev) segs.push([prev, cur]);
      prev = cur;
    }
  }
  for (let i = 0; i < pts.length; i++) adj.push([]);
  for (const [a, b] of segs) {
    const len = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    adj[a].push([b, len]);
    adj[b].push([a, len]);
  }
  // Index the segments in BUCKET cells for nearest-road queries.
  const grid = new Map();
  segs.forEach(([a, b], s) => {
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    for (let i = Math.floor(Math.min(ax, bx) / BUCKET); i <= Math.floor(Math.max(ax, bx) / BUCKET); i++)
      for (let j = Math.floor(Math.min(az, bz) / BUCKET); j <= Math.floor(Math.max(az, bz) / BUCKET); j++) {
        const k = key(i, j);
        (grid.get(k) ?? grid.set(k, []).get(k)).push(s);
      }
  });
  return { pts, adj, segs, grid };
}

// The nearest point on any road within maxD of (x, z): { s, t, x, z, d } or null.
export function nearestRoad(R, x, z, maxD = 120) {
  let best = null;
  const r = Math.ceil(maxD / BUCKET);
  const ci = Math.floor(x / BUCKET);
  const cj = Math.floor(z / BUCKET);
  const seen = new Set();
  for (let i = ci - r; i <= ci + r; i++)
    for (let j = cj - r; j <= cj + r; j++)
      for (const s of R.grid.get(key(i, j)) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const [a, b] = R.segs[s];
        const [t, px, pz, d] = project(x, z, R.pts[a][0], R.pts[a][1], R.pts[b][0], R.pts[b][1]);
        if (d <= maxD && (!best || d < best.d)) best = { s, t, x: px, z: pz, d };
      }
  return best;
}

// Waypoints along the roads from road point A to road point B (as returned by
// nearestRoad), starting at A and ending at B; null if they aren't connected.
export function roadRoute(R, A, B) {
  const [a0, a1] = R.segs[A.s];
  const [b0, b1] = R.segs[B.s];
  if (A.s === B.s) return [[A.x, A.z], [B.x, B.z]];
  const len = (s) => Math.hypot(R.pts[R.segs[s][0]][0] - R.pts[R.segs[s][1]][0], R.pts[R.segs[s][0]][1] - R.pts[R.segs[s][1]][1]);
  const n = R.pts.length;
  const dist = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[a0] = A.t * len(A.s);
  dist[a1] = (1 - A.t) * len(A.s);
  // The graph is small (hundreds of junctions): a plain scan for the next one is fine.
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    if (done[b0] && done[b1]) break;
    for (const [v, w] of R.adj[u])
      if (dist[u] + w < dist[v]) {
        dist[v] = dist[u] + w;
        from[v] = u;
      }
  }
  const lb = len(B.s);
  const via0 = dist[b0] + B.t * lb;
  const via1 = dist[b1] + (1 - B.t) * lb;
  if (!Number.isFinite(Math.min(via0, via1))) return null;
  const chain = [];
  for (let c = via0 <= via1 ? b0 : b1; c !== -1; c = from[c]) chain.push(R.pts[c]);
  chain.reverse();
  return [[A.x, A.z], ...chain, [B.x, B.z]];
}
