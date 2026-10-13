// A chunk's scenery and gatherable nodes, merged so a dense square costs a
// few draw calls instead of one (plus an ink hull) per model.
//
// Every opaque part has its colours baked into its vertices (material colour
// × texture × vertex colour, colour grade included: the packs paint models
// from palette swatches, so a vertex's texel is its face's colour), so a
// square's scenery is one mesh per kind of glow and sidedness.
// Near (the squares around you): big meshes are cut in quarters (each culled
// on its own), what casts a shadow goes into one more mesh that is only ever
// drawn into the shadow map (it lives on SHADOW_LAYER; see render.js), and
// two things are kept per quarter so each can be hidden by distance (see
// tiles): the ink shells (a fixed 3 cm line in the world; in 24 m tiles,
// drawn within 40 m)
// and the small ground detail like flowers and grass (drawn within 48 m).
// Far: no small detail, no glow, no ink and no shadow; it sits in the fog.
//
// Things added under a key (a node's standing or felled look) can be hidden
// and shown again later without rebuilding: their triangles collapse to a
// point in the index buffer.
//
// Building is incremental (add a few things per frame, then finish()), so a
// chunk never stalls a frame.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as assets from './assets.js';
import { toon, outlineMat } from './toon.js';
import { MERGE, keepDetail } from '../../../shared/budget.js';

export const INK = 0.03; // metres
export const SHADOW_LAYER = 5; // drawn only into the shadow map
// The merge rules are shared with the budget estimator (shared/budget.js).
export const { casterMin: CASTER_MIN, detailMax: DETAIL_MAX, noOutline: NO_OUTLINE, noShadow: NO_SHADOW, splitTris: SPLIT_TRIS } = MERGE;
// Where the town's sun sits, from what it lights. It never moves, so the
// shadow-only meshes keep just the faces turned away from it: those are the
// ones the shadow map is drawn from (if the sun ever moves, drop this).
export const SUN_TOWN = new THREE.Vector3(40, 34, 10);
const SUN_DIR = SUN_TOWN.clone().normalize();
const FAINT = 0.15; // a glow this weak is folded into the colour instead

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _t = new THREE.Color();
const _box = new THREE.Box3();

const isHull = (o) => o.isMesh && o.material?.side === THREE.BackSide;
const isGraded = (m) => m.customProgramCacheKey?.() === 'hv-grade';
const glowOf = (m) => (m.emissive && m.emissive.getHex() && m.emissiveIntensity >= FAINT ? `${m.emissive.getHexString()}|${m.emissiveIntensity}` : '');

function placeMatrix(pl, local) {
  _m.compose(_p.set(pl.x, pl.y ?? 0, pl.z), _q.setFromEuler(_e.set(0, pl.rot ?? 0, 0)), _s.setScalar(pl.s ?? 1));
  return new THREE.Matrix4().multiplyMatrices(_m, local);
}

function indexed(g) {
  if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
  return g;
}

// A copy of src with just the attributes asked for (normals made if missing,
// zero uvs if a texture needs them).
function copy(src, keep) {
  const g = new THREE.BufferGeometry();
  for (const k of keep) if (src.attributes[k]) g.setAttribute(k, src.attributes[k].clone());
  if (src.index) g.setIndex(src.index.clone());
  if (keep.includes('normal') && !g.attributes.normal) g.computeVertexNormals();
  if (keep.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return indexed(g);
}

// Keep only the triangles facing away from the sun.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
function awayFromSun(g) {
  const p = g.attributes.position;
  const idx = g.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [i0, i1, i2] = [idx[i], idx[i + 1], idx[i + 2]];
    _a.set(p.getX(i1) - p.getX(i0), p.getY(i1) - p.getY(i0), p.getZ(i1) - p.getZ(i0));
    _b.set(p.getX(i2) - p.getX(i0), p.getY(i2) - p.getY(i0), p.getZ(i2) - p.getZ(i0));
    if (_n.crossVectors(_a, _b).dot(SUN_DIR) < 0) keep.push(i0, i1, i2);
  }
  g.setIndex(keep);
  return g;
}

// Smooth normals for a shell, per source geometry (computed once).
const hullBase = new WeakMap();
function smoothed(geo) {
  let h = hullBase.get(geo);
  if (!h) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position.clone());
    if (geo.index) g.setIndex(geo.index.clone());
    h = mergeVertices(g, 1e-3);
    h.computeVertexNormals();
    hullBase.set(geo, h);
  }
  return h;
}
function shell(geo, matrix) {
  const h = smoothed(geo).clone();
  h.applyMatrix4(matrix); // normals follow (normal matrix)
  const p = h.attributes.position;
  const n = h.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * INK, p.getY(i) + n.getY(i) * INK, p.getZ(i) + n.getZ(i) * INK);
  h.deleteAttribute('normal');
  return indexed(h);
}

function paint(g, color) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (col[i * 3] = color.r), (col[i * 3 + 1] = color.g), (col[i * 3 + 2] = color.b);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// The flat colour a material shows (glow folded in, grade applied).
function flatColor(mat, graded, out) {
  out.copy(mat.color ?? _t.setRGB(1, 1, 1));
  if (mat.emissive && mat.emissiveIntensity && !mat.emissiveMap) out.add(_t.copy(mat.emissive).multiplyScalar(Math.min(1, mat.emissiveIntensity)));
  return graded ? assets.gradeColor(out) : out;
}

// Materials of the shadow-only meshes. They're never drawn in colour; only
// their side matters (it picks which faces go into the shadow map), and these
// two programs exist anyway, so nothing extra gets compiled.
const proxyMat = (side) => toon('#ffffff', { vertexColors: true, ...(side === THREE.DoubleSide ? { side } : {}) });

// A list of geometries merged into one mesh, remembering where each key's
// triangles sit in the index buffer.
class Bucket {
  constructor(mat) {
    this.mat = mat;
    this.geos = [];
    this.keys = [];
  }
  push(g, key) {
    this.geos.push(g);
    this.keys.push(key);
  }
  build(ranges) {
    if (!this.geos.length) return null;
    let at = 0;
    this.geos.forEach((g, i) => {
      const n = g.index.count;
      const k = this.keys[i];
      if (k != null) {
        if (!ranges.has(k)) ranges.set(k, []);
        ranges.get(k).push([this, at, n]);
      }
      at += n;
    });
    const keyed = this.keys.some((k) => k != null);
    const geo = mergeGeometries(this.geos);
    for (const g of this.geos) g.dispose();
    this.geos = this.keys = null;
    if (!geo) return null;
    if (keyed) this.orig = geo.index.array.slice(); // (to show hidden parts again)
    this.geo = geo;
    return geo;
  }
}

export class ChunkMerge {
  // x0, z0, size: the square, for splitting it into quarters.
  // shadowOnly: only the shadow-only meshes (for things drawn on their own).
  // solid: everything added is closed (buildings), so even two-sided parts
  // need only their faces turned away from the sun for the shadow.
  constructor({ far = false, low = false, x0 = 0, z0 = 0, size = 96, shadowOnly = false, solid = false } = {}) {
    this.far = far;
    this.shadowOnly = shadowOnly;
    this.solid = solid;
    this.low = low;
    this.x0 = x0;
    this.z0 = z0;
    this.half = size / 2;
    this.buckets = new Map(); // tile|look → Bucket
    this.hulls = Array.from({ length: 16 }, () => new Bucket(outlineMat(0))); // 4 × 4 tiles
    this.shadow = new Map(); // quarter|side → Bucket
    this.ranges = new Map(); // key → [[bucket, start, count]]
    this.hidden = new Set();
    this.tiles = []; // [{ mesh, kind: 'ink' | 'detail', x0, z0, size }]
  }

  // Which quarter of the square a world matrix's origin is in (0–3).
  // Which 24 m tile (of 4 × 4) a world matrix's origin is in.
  #tile(W) {
    const e = W.elements;
    const t = (v) => Math.max(0, Math.min(3, Math.floor((v * 2) / this.half)));
    return t(e[12] - this.x0) + 4 * t(e[14] - this.z0);
  }
  #quarter(W) {
    const e = W.elements;
    return (e[12] - this.x0 >= this.half ? 1 : 0) + (e[14] - this.z0 >= this.half ? 2 : 0);
  }

  #bucket(look, mat, q, detail) {
    const k = (detail ? 'd' : '') + q + '|' + look;
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = Object.assign(new Bucket(mat), { look, q, detail })));
    return b;
  }

  // One mesh's geometry (src), placed by matrix W, drawn as `mat`, sorted
  // into its quarter of the square (near) or the square's one mesh (far).
  #part(src, mat, W, { key = null, ink = true, cast = true, graded = isGraded(mat), detail = false } = {}) {
    if (!mat.visible) return;
    if (this.shadowOnly) return cast && !mat.transparent && this.#cast(src, mat, W, key);
    const q = this.far ? -1 : this.#quarter(W);
    const side = mat.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide;
    if (mat.transparent || (mat.emissiveMap && !this.far)) {
      // See-through, or glowing through a mask (a lantern's glass): its own
      // material (and see-through things aren't drawn that far out).
      if (this.far) return;
      const keep = ['position', 'normal', ...(mat.map || mat.emissiveMap ? ['uv'] : []), ...(mat.vertexColors ? ['color'] : [])];
      const g = copy(src, keep).applyMatrix4(W);
      if (mat.vertexColors && !g.attributes.color) paint(g, _t.setRGB(1, 1, 1));
      this.#bucket(mat.uuid, mat, q, detail).push(g, key);
    } else {
      // Opaque: its colours baked into the vertices (material colour × texture
      // × vertex colour, graded), into the mesh for its glow and sides. The
      // packs colour models from palette swatches, so a vertex's texel is
      // the colour of its face.
      const glow = this.far ? '' : glowOf(mat);
      const g = copy(src, ['position', 'normal']).applyMatrix4(W);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const uv = mat.map ? src.attributes.uv : null;
      const vc = mat.vertexColors ? src.attributes.color : null;
      const base = glow ? new THREE.Color().copy(mat.color) : flatColor(mat, false, new THREE.Color());
      for (let i = 0; i < n; i++) {
        _c.copy(base);
        if (uv) _c.multiply(assets.texel(mat.map, uv.getX(i), uv.getY(i), _t));
        if (vc) _c.multiply(_t.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)));
        if (graded) assets.gradeColor(_c);
        (col[i * 3] = _c.r), (col[i * 3 + 1] = _c.g), (col[i * 3 + 2] = _c.b);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const vmat = toon('#ffffff', { vertexColors: true, ...(side === THREE.DoubleSide ? { side } : {}), ...(glow ? { emissive: '#' + glow.split('|')[0], emissiveIntensity: +glow.split('|')[1] } : {}) });
      this.#bucket(`vcol|${glow}|${side}`, vmat, q, detail).push(g, key);
    }
    if (this.far) return;
    if (ink) this.hulls[this.#tile(W)].push(shell(src, W), key);
    if (cast && !mat.transparent) this.#cast(src, mat, W, key);
  }
  #cast(src, mat, W, key) {
    const side = mat.side === THREE.DoubleSide && !this.solid ? THREE.DoubleSide : THREE.FrontSide;
    const k = this.#tile(W) + '|' + side; // (the sun's view is small: 24 m tiles cull well)
    let b = this.shadow.get(k);
    if (!b) this.shadow.set(k, (b = new Bucket(proxyMat(side))));
    const g = copy(src, ['position']).applyMatrix4(W);
    if (side === THREE.FrontSide) awayFromSun(g);
    if (g.index.count) b.push(g, key);
  }

  // A model placement: { slot, v, x, z, y, rot, s }.
  place(pl, key = null) {
    const P = assets.parts(pl.slot, pl.v ?? 0);
    if (!P) return;
    const h = P.size.y * (pl.s ?? 1);
    const detail = h < DETAIL_MAX;
    if (detail && this.far) return; // (small detail isn't drawn that far out)
    if (detail && this.low && !keepDetail(pl.x, pl.z)) return; // (and half of it on phones)
    const cast = !NO_SHADOW.has(pl.slot) && (!this.low || h >= CASTER_MIN);
    for (const part of P.parts) this.#part(part.geometry, part.material, placeMatrix(pl, part.matrix), { key, ink: part.outline && !NO_OUTLINE.has(pl.slot), cast, graded: part.graded, detail });
  }

  // Every visible mesh under obj (world matrices must be current), e.g. a
  // node's standing or felled look. Meshes with an ink hull child get a shell.
  // Meshes marked userData.live (animated ones) are left out.
  object(obj, key = null, { cast = true } = {}) {
    if (cast && this.low) {
      _box.setFromObject(obj);
      cast = _box.max.y - _box.min.y >= CASTER_MIN;
    }
    obj.traverse((o) => {
      if (!o.isMesh || isHull(o) || Array.isArray(o.material)) return;
      for (let p = o; p; p = p.parent) if (!p.visible || p.userData.live) return;
      const ink = o.children.some(isHull);
      this.#part(o.geometry, o.material, o.matrixWorld, { key, ink, cast: cast && o.castShadow });
    });
  }

  // Make the meshes (into this.group), one bucket per step. Returns the group.
  *finishSteps() {
    const group = new THREE.Group();
    this.building = group;
    // A look with few triangles in all is drawn as one mesh for the square;
    // a big one stays in quarters, so the quarters off screen are skipped.
    const byLook = new Map();
    for (const [k, b] of this.buckets) if (!b.detail && b.q >= 0) (byLook.get(b.look) ?? byLook.set(b.look, []).get(b.look)).push([k, b]);
    for (const list of byLook.values()) {
      if (list.length < 2 || list.reduce((n, [, b]) => n + b.geos.reduce((m, g) => m + g.index.count / 3, 0), 0) >= SPLIT_TRIS) continue;
      const one = Object.assign(new Bucket(list[0][1].mat), { look: list[0][1].look, q: -1, detail: false });
      for (const [k, b] of list) {
        one.geos.push(...b.geos);
        one.keys.push(...b.keys);
        this.buckets.delete(k);
      }
      this.buckets.set('-1|' + one.look, one);
    }
    for (const b of this.buckets.values()) {
      const geo = b.build(this.ranges);
      if (geo) {
        const m = new THREE.Mesh(geo, b.mat);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        group.add(m);
        if (b.detail) this.tiles.push({ mesh: m, kind: 'detail', x0: this.x0 + (b.q & 1) * this.half, z0: this.z0 + (b.q >> 1) * this.half, size: this.half });
      }
      yield;
    }
    if (!this.far) {
      for (const [q, b] of this.hulls.entries()) {
        const hg = b.build(this.ranges);
        if (!hg) continue;
        const h = new THREE.Mesh(hg, b.mat);
        h.raycast = () => {};
        h.matrixAutoUpdate = false;
        group.add(h);
        const s = this.half / 2;
        this.tiles.push({ mesh: h, kind: 'ink', x0: this.x0 + (q % 4) * s, z0: this.z0 + Math.floor(q / 4) * s, size: s });
        yield;
      }
      for (const b of this.shadow.values()) {
        const geo = b.build(this.ranges);
        if (!geo) continue;
        const s = new THREE.Mesh(geo, b.mat);
        s.castShadow = true;
        s.layers.set(SHADOW_LAYER);
        s.raycast = () => {};
        s.matrixAutoUpdate = false;
        group.add(s);
        yield;
      }
    }
    this.group = group;
    for (const k of this.hidden) this.show(k, false, true);
    return group;
  }
  finish() {
    const it = this.finishSteps();
    while (!it.next().done);
    return this.group;
  }

  // Hide or show what was added under `key` (before or after finish()).
  // Returns whether anything changed.
  show(key, on, force = false) {
    if (!force && on === !this.hidden.has(key)) return false;
    if (on) this.hidden.delete(key);
    else this.hidden.add(key);
    if (!this.group) return true;
    for (const [b, at, n] of this.ranges.get(key) ?? []) {
      const idx = b.geo.index;
      if (on) idx.array.set(b.orig.subarray(at, at + n), at);
      else idx.array.fill(b.orig[at], at, at + n);
      idx.addUpdateRange(at, n);
      idx.needsUpdate = true;
    }
    return true;
  }
}

// Free a merged group's geometries.
export function disposeMerged(group) {
  group?.traverse((o) => o.geometry?.dispose());
}

// Turn on the shadow layer for everything under root that casts a shadow
// (anything else there can only cast through a shadow-only mesh). On low,
// small things stop casting.
export function casters(root, low = false) {
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow) return;
    if (low && !o.isSkinnedMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (_box.max.y - _box.min.y < CASTER_MIN && _box.max.y < CASTER_MIN + 0.5) {
        o.castShadow = false;
        return;
      }
    }
    o.layers.enable(SHADOW_LAYER);
  });
  return root;
}
