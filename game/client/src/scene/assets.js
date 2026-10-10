import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODELS } from './manifest.js';
import { toon, outlineMat } from './toon.js';

// Loads every model listed in manifest.js once, converts it to the game's
// toon look, and hands out cheap clones. If a model is missing or fails to
// load, `has()` is false and callers fall back to their procedural version,
// so the game always runs — and you can swap any model by editing the
// manifest (see ASSETS.md).

const loader = new GLTFLoader();
const gltfs = new Map(); // url -> gltf
const ready = new Map(); // slot -> { scene, animations, scale, def }
const matCache = new Map();
const hullCache = new WeakMap();
const OUTLINE_WORLD = 0.035; // ink line thickness in metres

const gradMap = toon('#ffffff').gradientMap;

// Shift pack colours toward Hearthvale's warm, saturated palette.
function stylize(color, tint) {
  const c = color.clone();
  const hsl = {};
  c.getHSL(hsl);
  hsl.s = Math.min(1, hsl.s * 1.12 + 0.03);
  hsl.l = Math.min(0.92, hsl.l * 1.04 + 0.01);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  if (tint) c.lerp(new THREE.Color(tint.color), tint.amount ?? 0.6);
  return c;
}

function toToon(m, tint) {
  const key = m.uuid + (tint ? JSON.stringify(tint) : '');
  if (matCache.has(key)) return matCache.get(key);
  if (m.map) {
    // Kenney packs colour models from a small palette atlas: keep it crisp.
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.needsUpdate = true;
  }
  // Textured models get their palette tweak baked into the texture instead
  // (scripts/import-assets.py), so only plain-coloured materials are shifted.
  const base = m.color || new THREE.Color('#ffffff');
  const color = m.map ? (tint ? base.clone().lerp(new THREE.Color(tint.color), tint.amount ?? 0.6) : base.clone()) : stylize(base, tint);
  const t = new THREE.MeshToonMaterial({
    color,
    map: m.map || null,
    gradientMap: gradMap,
    transparent: m.transparent,
    opacity: m.opacity,
    side: m.side,
    alphaTest: m.alphaTest,
    emissive: tint?.emissive || '#000000',
    emissiveIntensity: tint?.emissive ? 0.35 : 0,
  });
  t.vertexColors = !!m.vertexColors;
  matCache.set(key, t);
  return t;
}

// Inverted-hull outline needs smooth normals even on flat-shaded models.
function hullGeometry(geo) {
  if (hullCache.has(geo)) return hullCache.get(geo);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  hullCache.set(geo, merged);
  return merged;
}

const outlineFor = (scale) => outlineMat(Math.round((OUTLINE_WORLD / Math.max(scale, 1e-3)) * 1000) / 1000);

export async function loadAssets(onProgress = () => {}) {
  const urls = new Set();
  for (const def of Object.values(MODELS)) for (const u of [].concat(def.url)) urls.add(u);
  let done = 0;
  await Promise.all(
    [...urls].map((url) =>
      loader
        .loadAsync(url)
        .then((g) => gltfs.set(url, g))
        .catch((e) => console.warn('model failed to load, using fallback:', url, e?.message))
        .finally(() => onProgress(++done / urls.size)),
    ),
  );
  for (const [slot, def] of Object.entries(MODELS)) {
    const variants = [].concat(def.url).map((u) => gltfs.get(u)).filter(Boolean);
    if (!variants.length) continue;
    ready.set(slot, variants.map((g) => prepare(g, def)));
  }
}

// Normalise a loaded model: toon materials, size in metres, feet on y=0.
function prepare(gltf, def) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let scale = def.scale ?? 1;
  if (def.height) scale = def.height / Math.max(size.y, 1e-3);
  else if (def.width) scale = def.width / Math.max(size.x, size.z, 1e-3);
  else if (def.fit) scale = Math.min(def.fit[0] / Math.max(size.x, 1e-3), def.fit[1] / Math.max(size.z, 1e-3));
  const center = box.getCenter(new THREE.Vector3());
  return { gltf, def, scale, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z), size: size.multiplyScalar(scale), skinned: hasSkin(root) };
}

const hasSkin = (o) => {
  let s = false;
  o.traverse((c) => (s ||= c.isSkinnedMesh));
  return s;
};

export const has = (slot) => ready.has(slot);
export const variantCount = (slot) => ready.get(slot)?.length || 0;
export const sizeOf = (slot, v = 0) => ready.get(slot)?.[v % ready.get(slot).length]?.size;

// A fresh, independent copy of a model (with outlines). Returns
// { object, mixer?, actions? } — object's origin is at the model's feet.
export function make(slot, { variant = 0, tint = null, outline = true, castShadow = true } = {}) {
  const list = ready.get(slot);
  if (!list) return null;
  const p = list[variant % list.length];
  const src = p.gltf.scene;
  const inner = p.skinned ? cloneSkinned(src) : src.clone(true);
  inner.position.copy(p.offset);
  const pivot = new THREE.Group();
  const scaled = new THREE.Group();
  scaled.scale.setScalar(p.scale);
  if (p.def.rotY) scaled.rotation.y = p.def.rotY;
  scaled.add(inner);
  pivot.add(scaled);
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => toToon(m, tint)) : toToon(o.material, tint);
    o.castShadow = castShadow;
    o.receiveShadow = true;
    if (outline && !o.isSkinnedMesh && p.def.outline !== false) {
      const hull = new THREE.Mesh(hullGeometry(o.geometry), outlineFor(p.scale));
      hull.raycast = () => {};
      hull.castShadow = false;
      o.add(hull);
    }
  });
  const out = { object: pivot, size: p.size };
  if (p.gltf.animations?.length) {
    const mixer = new THREE.AnimationMixer(inner);
    const actions = {};
    for (const clip of p.gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    out.mixer = mixer;
    out.actions = actions;
  }
  return out;
}

// Many copies of one model as InstancedMeshes (one per sub-mesh, plus its
// outline) — for scenery like trees, bushes and flowers.
// placements: [{ x, z, y?, rot?, s? }]. Returns a Group or null.
export function instanced(slot, placements, { variant = 0, tint = null, outline = true, castShadow = true } = {}) {
  const list = ready.get(slot);
  if (!list || !placements.length) return null;
  const p = list[variant % list.length];
  const group = new THREE.Group();
  const root = p.gltf.scene;
  root.updateMatrixWorld(true);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.def.rotY || 0, 0)), new THREE.Vector3(p.scale, p.scale, p.scale));
  const off = new THREE.Matrix4().makeTranslation(p.offset.x, p.offset.y, p.offset.z);
  const o = new THREE.Object3D();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().multiplyMatrices(off, m.matrixWorld));
    const mat = Array.isArray(m.material) ? toToon(m.material[0], tint) : toToon(m.material, tint);
    const im = new THREE.InstancedMesh(m.geometry, mat, placements.length);
    const hull = outline ? new THREE.InstancedMesh(hullGeometry(m.geometry), outlineFor(p.scale * (placements[0].s ?? 1)), placements.length) : null;
    placements.forEach((pl, i) => {
      o.position.set(pl.x, pl.y ?? 0, pl.z);
      o.rotation.set(0, pl.rot ?? 0, 0);
      o.scale.setScalar(pl.s ?? 1);
      o.updateMatrix();
      const mtx = new THREE.Matrix4().multiplyMatrices(o.matrix, local);
      im.setMatrixAt(i, mtx);
      hull?.setMatrixAt(i, mtx);
    });
    im.castShadow = castShadow;
    im.receiveShadow = true;
    group.add(im);
    if (hull) {
      hull.raycast = () => {};
      group.add(hull);
    }
  });
  return group;
}
