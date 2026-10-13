import * as THREE from 'three';
import * as assets from './assets.js';
import { MODULE_PACKS, TEXTURES } from './manifest/index.js';
import { GATE } from '../../../shared/world.js';

// Assembles Hearthvale's buildings from Kenney's modular Fantasy Town Kit.
//
// Building-local grid: cells (i, k), i in [0, W) along +X, k in [0, D) along
// +Z; the front (door side) is +Z. One model unit = one cell. A wall module
// is a slab near local +X with its decorated face toward local -X, so for an
// edge with outward normal n: pivot = edgeMid + 0.4·n and rotY is chosen so
// local -X points along n. Roofs are stacked wedges (eave toward local -X).
// (Recipe worked out and verified by render with the art-direction agents.)

const FTK = 'fantasy-town-kit';
const ROT = { '-1,0': 0, '0,1': 90, '1,0': 180, '0,-1': -90 };
const TEX = TEXTURES[FTK];

class Builder {
  constructor(S, tex = null) {
    this.S = S; // metres per cell: [x, floor height, z]
    this.tex = tex;
    this.items = [];
  }
  put(m, lx, ly, lz, r, { tex = 'inherit', scale = 1, pack = FTK } = {}) {
    const [sx, sy, sz] = this.S;
    const base = ((r % 180) + 180) % 180 === 0 ? [sx, sy, sz] : [sz, sy, sx];
    const sc = Array.isArray(scale) ? scale : [scale, scale, scale];
    this.items.push({ slot: `${pack}:${m}`, p: [lx * sx, ly * sy, lz * sz], r, s: base.map((v, i) => v * sc[i]), tex: tex === 'inherit' ? this.tex : tex });
  }
  edges(W, D) {
    const out = [];
    for (let i = 0; i < W; i++) out.push(['S', i, i + 0.5, D, 0, 1]);
    for (let i = 0; i < W; i++) out.push(['N', i, i + 0.5, 0, 0, -1]);
    for (let k = 0; k < D; k++) out.push(['E', k, W, k + 0.5, 1, 0]);
    for (let k = 0; k < D; k++) out.push(['W', k, 0, k + 0.5, -1, 0]);
    return out;
  }
  wall(m, ex, ez, nx, nz, y, opts) {
    this.put(m, ex + 0.4 * nx, y, ez + 0.4 * nz, ROT[`${nx},${nz}`], opts);
  }
  // pick(side, idx, floor) -> module name, or null to leave the bay open
  walls(W, D, floors, pick, y0 = 0) {
    for (let f = 0; f < floors; f++)
      for (const [side, idx, ex, ez, nx, nz] of this.edges(W, D)) {
        const m = pick(side, idx, f);
        if (m) this.wall(m, ex, ez, nx, nz, y0 + f);
      }
  }
  roof(W, D, top, kind = 'roof', ridge = 'x', fill = 'wall-half', fillFull = 'wall') {
    const rise = kind === 'roof' ? 0.5 : 1.0;
    const gtop = `${kind}-gable-top`;
    if (ridge === 'z') {
      for (let i = 0; i < W; i++) {
        if (W % 2 === 1 && i === (W - 1) / 2) {
          for (let k = 0; k < D; k++) this.put(gtop, i + 0.5, top + i * rise, k + 0.5, 90);
        } else {
          const west = i < W / 2;
          const L = west ? i : W - 1 - i;
          for (let k = 0; k < D; k++) {
            let m = kind;
            if (k === 0) m = kind + (west ? '-left' : '-right');
            if (k === D - 1) m = kind + (west ? '-right' : '-left');
            this.put(m, i + 0.5, top + L * rise, k + 0.5, west ? 0 : 180);
          }
        }
        this.#fill(Math.min(i, W - 1 - i) * rise, top, fill, fillFull, [[i + 0.5, 0, 0, -1], [i + 0.5, D, 0, 1]]);
      }
    } else {
      for (let k = 0; k < D; k++) {
        if (D % 2 === 1 && k === (D - 1) / 2) {
          for (let i = 0; i < W; i++) this.put(gtop, i + 0.5, top + k * rise, k + 0.5, 0);
        } else {
          const north = k < D / 2;
          const L = north ? k : D - 1 - k;
          for (let i = 0; i < W; i++) {
            let m = kind;
            if ((north && i === W - 1) || (!north && i === 0)) m = kind + '-left';
            if ((north && i === 0) || (!north && i === W - 1)) m = kind + '-right';
            this.put(m, i + 0.5, top + L * rise, k + 0.5, north ? -90 : 90);
          }
        }
        this.#fill(Math.min(k, D - 1 - k) * rise, top, fill, fillFull, [[0, k + 0.5, -1, 0], [W, k + 0.5, 1, 0]]);
      }
    }
  }
  #fill(hh, top, fill, fillFull, edges) {
    let y = 0;
    while (y < hh - 1e-6) {
      const full = hh - y > 0.5 + 1e-6;
      for (const [ex, ez, nx, nz] of edges) this.wall(full ? fillFull : fill, ex, ez, nx, nz, top + y);
      y += full ? 1 : 0.5;
    }
  }
}

const cells = (metres, target) => Math.max(1, Math.round(metres / target));

// ── Recipes (W × D metres, front = +Z) ──────────────────────────────────
function cottage(W, D, tex, seed) {
  const nx = cells(W, 2.1);
  const nz = cells(D, 2.3);
  const b = new Builder([W / nx, 2.8, D / nz], tex);
  const door = Math.floor(nx / 2) + (seed % 2 && nx > 2 ? -1 : 0);
  b.walls(nx, nz, 1, (side, idx) => {
    if (side === 'S') return idx === door ? 'wall-door' : 'wall-window-shutters';
    if ((side === 'E' || side === 'W') && idx === 0) return 'wall-window-round';
    if (side === 'N' && idx === Math.floor(nx / 2)) return 'wall-window-small';
    return 'wall';
  });
  b.roof(nx, nz, 1, 'roof', 'x');
  const cx = seed % 2 ? nx + 0.4 : -0.4;
  const rot = seed % 2 ? 180 : 0;
  b.put('chimney-base', cx, 0, 0.5, rot, { tex: null });
  b.put('chimney', cx, 1, 0.5, rot, { tex: null });
  b.put('chimney-top', cx, 1.7, 0.5, rot, { tex: null });
  // The chimney mesh sits 0.34 cells off its pivot, toward local +X.
  return { b, nx, nz, top: 1 + (nz / 2) * 0.5, smoke: seed % 3 !== 2 && [cx + (rot ? -0.34 : 0.34), 2.45, 0.5] };
}

function workshop(W, D) {
  const nx = cells(W, 2.25);
  const nz = cells(D, 2.3);
  const b = new Builder([W / nx, 2.8, D / nz], TEX.roof_slate);
  b.walls(nx, nz, 1, (side, idx) => {
    if (side === 'S') return idx === 0 || idx === nx - 1 ? 'wall-wood-window-shutters' : 'wall-wood-doorway-square-wide';
    if (side === 'E' || side === 'W') return idx === Math.floor(nz / 2) ? 'wall-wood-window-glass' : 'wall-wood-detail-cross';
    return 'wall-wood';
  });
  b.roof(nx, nz, 1, 'roof', 'z', 'wall-wood-half', 'wall-wood');
  const mid = Math.floor(nz / 2) + 0.5;
  b.put('chimney-base', nx + 0.4, 0, mid, 180, { tex: null });
  b.put('chimney', nx + 0.4, 1, mid, 180, { tex: null });
  b.put('chimney-top', nx + 0.4, 2, mid, 180, { tex: null });
  b.put('wheel', -0.4, 0, nz - 0.5, 0);
  return { b, nx, nz, top: 1 + (nx / 2) * 0.5, smoke: [nx + 0.06, 2.75, mid] };
}

function shop(W, D) {
  const nx = cells(W, 2.25);
  const nz = cells(D, 2.3);
  const b = new Builder([W / nx, 2.8, D / nz], TEX.shop);
  b.walls(nx, nz, 2, (side, idx, f) => {
    if (f === 0) {
      if (side === 'S') return idx === 0 || idx === nx - 1 ? 'wall-window-glass' : idx === 1 ? 'wall-door' : 'wall-doorway-square-wide';
      return idx % 2 === 0 ? 'wall' : 'wall-window-small';
    }
    if (side === 'S') return idx === 0 || idx === nx - 1 ? 'wall-wood-window-shutters' : 'wall-wood';
    return idx % 2 === 0 ? 'wall-wood-detail-diagonal' : 'wall-wood-window-glass';
  });
  b.roof(nx, nz, 2, 'roof', 'z', 'wall-wood-half', 'wall-wood');
  for (let i = 0; i < nx; i++) if (i !== 2) b.put('overhang', i + 0.5, 0, nz + 0.4, 90);
  b.put('stall-red', 2.5, 0, nz + 0.55, 0, { scale: 0.9, tex: null });
  for (let i = 1; i < nx - 1; i++) b.put('banner-green', i + 0.5, 1, nz + 0.4, 90);
  return { b, nx, nz, top: 2 + (nx / 2) * 0.5 };
}

// Body plus a clock tower one cell in front of the middle bay (you enter
// through the tower). `D` includes the tower cell.
function townhall(W, D) {
  const nx = cells(W, 2.2) | 1; // odd, so the tower sits on the middle bay
  const nz = cells(D, 2.0) - 1; // body rows; the last row is the tower
  const S = [W / nx, 2.8, D / (nz + 1)];
  const b = new Builder(S, TEX.hall);
  const mid = (nx - 1) / 2;
  b.walls(nx, nz, 2, (side, idx, f) => {
    if (side === 'S' && idx === mid && f === 0) return null;
    if (side === 'S') return f === 0 ? 'wall-window-glass' : 'wall-window-round';
    return idx % 2 ? 'wall-detail-cross' : 'wall-window-small';
  });
  b.roof(nx, nz, 2, 'roof-high', 'x');
  const T = 5;
  const tx = mid + 0.5;
  const tz = nz + 0.5;
  for (let f = 0; f < T; f++)
    for (const [side, ex, ez, nX, nZ] of [['S', tx, nz + 1, 0, 1], ['E', mid + 1, tz, 1, 0], ['W', mid, tz, -1, 0], ['N', tx, nz, 0, -1]]) {
      if (side === 'N' && f < 2) continue;
      b.wall(side === 'S' && f === 0 ? 'wall-door' : f === 1 || f === 3 ? 'wall-window-round' : 'wall', ex, ez, nX, nZ, f);
    }
  b.put('roof-high-point', tx, T, tz, 0);
  for (const [ex, ez, nX, nZ] of [[tx, nz + 1, 0, 1], [mid + 1, tz, 1, 0], [mid, tz, -1, 0], [tx, nz, 0, -1]])
    b.put('wheel', ex + 0.4 * nX, 4.18, ez + 0.4 * nZ, ROT[`${nX},${nZ}`], { scale: 1.35 });
  b.put('banner-red', mid - 0.5, 1, nz + 0.4, 90);
  b.put('banner-red', mid + 1.5, 1, nz + 0.4, 90);
  return { b, nx, nz: nz + 1, top: T + 1.2 };
}

// A ring of striped stalls, open toward the front.
function market(W, D) {
  const nx = cells(W, 2.2);
  const nz = cells(D, 2.2);
  const b = new Builder([W / nx, 2.8, D / nz], null);
  const pal = [['stall-red', null], ['stall-green', null], ['stall-green', TEX.roof_blue]];
  let n = 0;
  const st = (x, z, r) => {
    const [m, t] = pal[n++ % pal.length];
    b.put(m, x, 0, z, r, { tex: t });
  };
  for (let i = 0; i < nx; i++) st(i + 0.5, 0.5, 180);
  for (let k = 1; k < nz - 1; k++) {
    st(0.5, k + 0.5, 90);
    st(nx - 0.5, k + 0.5, -90);
  }
  b.put('lantern', 0.15, 0, nz - 0.1, 0, { scale: 0.8 });
  b.put('lantern', nx - 0.15, 0, nz - 0.1, 0, { scale: 0.8 });
  return { b, nx, nz, top: 1.6 };
}

const RECIPES = { workshop, shop, townhall, market };
const COTTAGE_TEX = ['cot_a', 'cot_b', 'cot_c', 'cot_d', 'cot_e'];

export const canBuild = () => assets.hasModules(FTK, MODULE_PACKS[FTK]);

// Build a game building (a map `buildings` entry) as one group.
// Returns null if the kit isn't loaded (caller falls back to procedural).
export function buildModular(b, index) {
  if (!canBuild()) return null;
  const faceRot = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[b.face || 's'];
  const swap = b.face === 'e' || b.face === 'w';
  const W = swap ? b.d : b.w;
  const D = swap ? b.w : b.d;
  const made = b.deco ? cottage(W, D, TEX[COTTAGE_TEX[index % COTTAGE_TEX.length]], index) : RECIPES[b.id]?.(W, D);
  if (!made) return null;
  const mesh = assets.assemble(made.b.items);
  const [sx, sy, sz] = made.b.S;
  // Centre the footprint, then turn the front toward the building's face.
  mesh.position.set((-made.nx * sx) / 2, 0, (-made.nz * sz) / 2);
  const inner = new THREE.Group();
  inner.add(mesh);
  inner.rotation.y = faceRot;
  const grp = new THREE.Group();
  grp.position.set(b.x, 0, b.z);
  grp.add(inner);
  grp.userData.top = made.top * sy + 0.6;
  if (made.smoke) {
    const at = new THREE.Object3D();
    at.position.set(made.smoke[0] * sx, made.smoke[1] * sy, made.smoke[2] * sz);
    mesh.add(at);
    grp.updateMatrixWorld(true);
    grp.userData.smoke = at.getWorldPosition(new THREE.Vector3());
    mesh.remove(at);
  }
  return grp;
}

// A gatehouse (a map `gates` entry): castle-kit arch tower, walls and corner towers.
export function buildGate(g = GATE) {
  if (!g || !assets.hasModules('castle-kit', MODULE_PACKS['castle-kit'])) return null;
  const s = g.scale;
  const tex = TEXTURES['castle-kit'].grey_red;
  const items = [];
  const put = (m, x, y, z, r = 0, sc = 1) => items.push({ slot: `castle-kit:${m}`, p: [x * s, y * s, z * s], r, s: s * sc, tex });
  put('tower-square-arch', 0, 0, 0);
  put('tower-square-mid', 0, 1.01, 0);
  put('tower-square-top-roof-high-windows', 0, 2.02, 0);
  put('metal-gate', 0, 0.45, 0, 90);
  put('flag-banner-short', 0, 1.15, 0.47, -90, 0.9);
  for (const sx of [-1, 1]) {
    put('wall', sx, 0, 0, 90);
    put('wall', sx * 2, 0, 0, 90);
    put('tower-square-base', sx * 3, 0, 0);
    put('tower-square-mid-windows', sx * 3, 1.31, 0);
    put('tower-square-top-roof', sx * 3, 2.32, 0);
  }
  const grp = new THREE.Group();
  grp.add(assets.assemble(items));
  grp.position.set(g.x, 0, g.z);
  grp.userData.top = 3.3 * s;
  return grp;
}
