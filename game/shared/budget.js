// The phone performance budgets (SPEC §9.1), measured on the phone profile
// (390×844, DPR 3, low quality) by the census (scripts/perf/census.mjs), and
// an estimate of what each chunk of a map will cost, from the map alone
// (estimateChunk, below), for the world editor's budget meter.

export const BUDGET = {
  draws: 250, // default camera, every pass
  drawsMain: 150,
  drawsShadow: 60, // on frames that redraw the shadow map
  drawsHeroes: 40, // heroes and their silhouettes
  drawsWorst: 400, // zoomed all the way out, or a crowd of 9
  tris: 150_000,
  trisMain: 110_000,
  trisShadow: 30_000,
  trisWorst: 220_000,
  textureMiB: 24,
  programs: 40,
  updateMs: 2.5, // game logic per frame (median)
  longTaskMs: 50, // while walking
  firstLoadMB: 3, // compressed, before the first frame
  // One chunk's scenery: ground, merged props and nodes, stepping stones
  // (the tiles drawn only near the camera, ink, small detail, grass and
  // shadow-only meshes, are counted per frame instead) …
  chunkNear: { draws: 25 },
  chunkFar: { draws: 4 },
  // … and its statics: buildings, gates, waystones, lakes (a town centre).
  chunkStatics: { draws: 60 },
  // Authoring caps per chunk (SPEC §9.3).
  perChunk: { blockingProps: 40, materials: 12, landmarks: 1, nodes: 40, camps: 6 },
};

// ── How chunks are merged (client/src/scene/chunkmerge.js uses these) ─────
export const CHUNK = 96; // metres: the side of a streaming chunk
export const MERGE = {
  detailMax: 1.0, // props lower than this (m) are small detail: drawn within 48 m, half of it on phones
  casterMin: 1.5, // on phones, only things this tall (m) cast shadows
  splitTris: 2000, // a near mesh this big is cut in quarters
  noOutline: new Set(['deco_flower', 'deco_grass', 'deco_lily_pad', 'deco_mushroom']),
  noShadow: new Set(['deco_flower', 'deco_grass', 'deco_lily_pad']),
};
// Phones keep half the small detail: which half, from where it stands.
export const keepDetail = (x, z) => !((Math.floor(x * 7.31) ^ Math.floor(z * 3.77)) & 1);

// ── The estimate ─────────────────────────────────────────────────────────
// What a chunk will cost, from the map alone (and shared/slot-stats.js, the
// models' triangle counts), for the editor's budget meter; budget.test.js
// keeps it within 15% of what the census measures. Scenery is split like the
// census: `draws`/`tris` always drawn, `tileDraws`/`tileTris` only near the
// camera (ink, small detail, grass); statics apart.
import STATS from './slot-stats.js';
import { PROPS, NODES, BUILDINGS, GATES, STONES, ENTRANCES, LAKES, DOCKS, PLAZAS, FOUNTAINS, LANDS, NODE_TYPES, pathSegments } from './world.js';

// Measured once in the game (draws, triangles, ink triangles).
const STATIC_COST = {
  cottage: [2, 2300, 2300], workshop: [2, 2370, 2370], shop: [2, 4244, 3770], townhall: [2, 9708, 9512], market: [2, 3328, 316],
  house: [3, 1500, 1200], // a code-built house (no kit)
  gate: [6, 2836, 2370], stone: [4, 160, 92], crypt: [18, 2372, 2372], water: [1, 64, 0],
};
// Code-built props: [triangles, ink triangles, separate animated draws].
const PROC_COST = { proc_signboard: [36, 36, 0], proc_mine_cart: [170, 24, 0], proc_job_board: [230, 84, 0], proc_standing_stone: [12, 12, 0], proc_forge: [48, 48, 1], proc_cookpot: [330, 200, 1] };

const hashId = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
const slotTris = (slot, v = 0) => {
  const s = STATS[slot];
  if (!s) return null;
  const vv = s.v[v % s.v.length];
  return { tris: vv.tris, double: s.double || vv.double > 0, ink: s.ink && !MERGE.noOutline.has(slot), h: s.h, glow: !!s.glow };
};
const distSeg = (px, pz, [ax, az, bx, bz]) => {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
};

export function estimateChunk(i, j, { level = 'near', low = true } = {}) {
  const far = level === 'far';
  const x0 = i * CHUNK;
  const z0 = j * CHUNK;
  const H = CHUNK / 2;
  const inChunk = (e) => e.x >= x0 && e.x < x0 + CHUNK && e.z >= z0 && e.z < z0 + CHUNK;
  const quarter = (x, z) => (x - x0 >= H ? 1 : 0) + (z - z0 >= H ? 2 : 0);
  const tile = (x, z) => Math.max(0, Math.min(3, Math.floor((x - x0) / 24))) + 4 * Math.max(0, Math.min(3, Math.floor((z - z0) / 24)));
  const looks = new Map(); // look → { tris, quarters: Set }
  const detail = new Set(); // quarter|look
  const inkTiles = new Set();
  const S = { draws: 0, tris: 0, tileDraws: 0, tileTris: 0 };
  const T = { draws: 0, tris: 0 };
  // One merged part at (x, z).
  const part = (x, z, tris, { double = false, ink = false, isDetail = false, look = null } = {}) => {
    if (isDetail) {
      if (far || (low && !keepDetail(x, z))) return;
      detail.add(`${quarter(x, z)}|${look ?? double}`);
      S.tileTris += tris;
    } else {
      const k = far ? `far|${double}` : look ?? `vcol|${double}`;
      const l = looks.get(k) ?? looks.set(k, { tris: 0, quarters: new Set() }).get(k);
      l.tris += tris;
      l.quarters.add(quarter(x, z));
      S.tris += tris;
    }
    if (ink && !far) {
      inkTiles.add(tile(x, z));
      S.tileTris += tris;
    }
  };
  const land = LANDS.some((l) => Math.hypot(Math.max(0, x0 - l.x, l.x - x0 - CHUNK), Math.max(0, z0 - l.z, l.z - z0 - CHUNK)) - l.r < 14);
  if (land) {
    // Ground.
    const n = far ? 1 : 2;
    const seg = Math.round(CHUNK / n / (low ? 1.57 : 1.12) / (far ? 2 : 1));
    S.draws += n * n;
    S.tris += n * n * seg * seg * 2;
    // Grass tufts (near): how much of the chunk is open, sampled.
    if (!far) {
      const segs = pathSegments();
      let open = 0;
      let all = 0;
      for (let x = x0 + 2; x < x0 + CHUNK; x += 4)
        for (let z = z0 + 2; z < z0 + CHUNK; z += 4) {
          all++;
          const d = Math.min(...LANDS.map((l) => Math.hypot(x - l.x, z - l.z) - l.r));
          if (d > -1 || PLAZAS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.8)) continue;
          if (BUILDINGS.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1)) continue;
          if (LAKES.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 2) || segs.some((s) => distSeg(x, z, s) < s[4] + 0.4)) continue;
          open++;
        }
      const tufts = Math.round(CHUNK * CHUNK * (low ? 0.042 : 0.106) * (open / all));
      if (tufts) (S.tileDraws += 4), (S.tileTris += tufts * 3 * 4);
      // Stepping stones along the paths.
      let stones = 0;
      for (const s of segs) {
        const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
        if (len < 4) continue;
        let inside = 0;
        for (let k = 0; k < 10; k++) inside += inChunk({ x: s[0] + ((s[2] - s[0]) * (k + 0.5)) / 10, z: s[1] + ((s[3] - s[1]) * (k + 0.5)) / 10 }) ? 1 : 0;
        stones += Math.ceil(len * (low ? 0.5 : 0.9)) * (inside / 10);
      }
      if (stones >= 1) (S.draws += 1), (S.tris += Math.round(stones) * 28);
    }
  }
  // Props.
  for (const pr of PROPS) {
    if (!inChunk(pr)) continue;
    if (pr.slot.startsWith('proc_')) {
      const [tris, ink, live] = PROC_COST[pr.slot] ?? [60, 40, 0];
      part(pr.x, pr.z, tris);
      if (ink && !far) (inkTiles.add(tile(pr.x, pr.z)), (S.tileTris += ink));
      S.draws += live;
      continue;
    }
    const m = slotTris(pr.slot, pr.v || 0);
    if (!m) continue;
    if (pr.bob) {
      S.draws += 2;
      S.tris += m.tris * 2;
      continue;
    }
    const isDetail = m.h * (pr.s ?? 1) < MERGE.detailMax;
    part(pr.x, pr.z, m.tris, { double: m.double, ink: m.ink, isDetail, look: m.glow ? `own|${pr.slot}` : null });
  }
  // Merged statics.
  for (const p of PLAZAS) if (inChunk(p)) part(p.x, p.z, 480);
  for (const f of FOUNTAINS) if (inChunk(f)) part(f.x, f.z, 540, { ink: true });
  for (const d of DOCKS) if (inChunk(d)) part(d.x, d.z, Math.round(d.d / 0.6) * 12 + 192, { ink: true });
  for (const l of LAKES)
    if (inChunk(l)) {
      part(l.x, l.z, Math.round(26 * (l.r / 14)) * 100);
      const pad = slotTris('deco_lily_pad');
      if (pad) for (let k = 0; k < Math.round(14 * (l.r / 14)); k++) part(l.x + Math.cos(k) * l.r * 0.5, l.z + Math.sin(k) * l.r * 0.5, pad.tris, { double: pad.double, isDetail: true });
    }
  // Gathering nodes: standing and felled looks (fishing spots: ripples).
  let fish = 0;
  for (const n of NODES) {
    if (!inChunk(n)) continue;
    const kind = NODE_TYPES[n.type]?.kind;
    if (kind === 'fish') {
      fish++;
      continue;
    }
    const v = Math.abs(hashId(n.id));
    const full = slotTris(n.type, v);
    if (full) part(n.x, n.z, full.tris, { double: full.double, ink: full.ink });
    if (['rock_copper', 'rock_iron', 'rock_gold'].includes(n.type)) part(n.x, n.z, 48, { look: `glow|${n.type}` });
    const stump = slotTris({ tree: `${n.type}_stump`, rock: 'rock_rubble', herb: 'herb_sprout' }[kind] ?? '', v);
    if (stump) part(n.x, n.z, stump.tris, { double: stump.double, ink: stump.ink });
    else part(n.x, n.z, kind === 'tree' ? 128 : kind === 'rock' ? 60 : 48, { ink: kind === 'tree' });
  }
  // Merged meshes: a look with few triangles is one mesh, a big one a mesh per quarter.
  for (const l of looks.values()) S.draws += far || l.tris < MERGE.splitTris ? 1 : l.quarters.size;
  S.tileDraws += detail.size + inkTiles.size;
  // Statics.
  const add = ([d, t, ink]) => ((T.draws += d), (T.tris += t + ink));
  for (const b of BUILDINGS) if (inChunk(b)) add(STATIC_COST[b.deco ? 'cottage' : b.recipe ?? b.id] ?? STATIC_COST.house);
  for (const g of GATES) if (inChunk(g)) add(STATIC_COST.gate);
  for (const s of STONES) if (inChunk(s)) add(STATIC_COST.stone);
  for (const e of ENTRANCES) if (inChunk(e)) add(STATIC_COST.crypt);
  for (const l of LAKES) if (inChunk(l)) add(STATIC_COST.water);
  if (fish) add([1, fish * 2, 0]);
  return { scenery: S, statics: T };
}
