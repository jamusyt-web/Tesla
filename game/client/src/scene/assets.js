import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODELS, PALETTES, MODULE_PACKS, TEXTURES } from './manifest/index.js';
import { toon, outlineMat } from './toon.js';

// Loads every model listed in the manifest (manifest/) once, converts it to the game's
// toon look, and hands out cheap clones. If a model is missing or fails to
// load, `has()` is false and callers fall back to their procedural version,
// so the game always runs — and you can swap any model by editing the
// manifest (see ASSETS.md).

// Every asset URL carries the build's version (vite.config.js), so the server
// can let browsers keep models and textures cached for good.
const VERSION = typeof __ASSET_VERSION__ === 'string' ? __ASSET_VERSION__ : '';
export const versioned = (u) => (VERSION && u.startsWith('/') && !/[?&]v=/.test(u) ? `${u}${u.includes('?') ? '&' : '?'}v=${VERSION}` : u);
const manager = new THREE.LoadingManager();
manager.setURLModifier(versioned); // also the textures a model file points to
const loader = new GLTFLoader(manager);
const gltfs = new Map(); // url -> gltf
const ready = new Map(); // slot -> { scene, animations, scale, def }
const matCache = new Map();
const hullCache = new WeakMap();
const OUTLINE_WORLD = 0.03; // ink line thickness in metres

const gradMap = toon('#ffffff').gradientMap;

// Shift every pack toward Hearthvale's warm, saturated palette in the shader,
// so textured (palette-atlas) and plain-coloured models get the same grade.
// Two pulls first: Kenney's jade greens toward our leaf green, and its
// lavender stone/plaster/iron greys toward warm grey (saturated blues and
// purples are left alone).
const GRADE = `
  {
    vec3 c = diffuseColor.rgb;
    float w = smoothstep(0.08, 0.20, c.g - c.b) * step(c.r, c.b);
    float d = (c.b - c.r) * w * 0.6;
    c.r += d;
    c.b -= d;
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float k = step(max(c.r, c.g), c.b) * (1.0 - smoothstep(0.35, 0.6, (mx - mn) / max(mx, 1e-3))) * 0.55;
    c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))) * vec3(1.05, 1.0, 0.92), k);
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 1.0);
    diffuseColor.rgb = c * vec3(1.02, 1.0, 0.97);
  }`;
function graded(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + GRADE);
  };
  mat.customProgramCacheKey = () => 'hv-grade';
  return mat;
}

// ── Palette-atlas recolours ───────────────────────────────────────────
// Most Kenney packs paint models by sampling a shared swatch atlas, so a
// material colour can only darken them. `remap` repaints the atlas instead:
// [{ band?, to: '#hex', ref? }] — texels in the hue band (all texels if no
// band) take the colour `to`, keeping their light/dark steps: a texel whose
// luma equals `ref` becomes exactly `to`. First matching rule wins.
const BANDS = {
  metal: (h, s) => h >= 200 && h <= 265 && s >= 0.08 && s <= 0.45, // lavender-grey steel
  red: (h, s) => (h >= 340 || h < 15) && s > 0.45,
  orange: (h, s) => h >= 15 && h < 30 && s > 0.35, // wood handles, leather
  yellow: (h, s) => h >= 30 && h < 55 && s > 0.35,
  green: (h, s) => h >= 70 && h < 180 && s > 0.25,
  white: (h, s, v) => s < 0.12 && v > 0.7,
  warm: (h, s) => h < 60 && s > 0.2, // every orange/tan/cream fur or wood tone
};
const BAND_REF = { metal: 0.62, red: 0.45, orange: 0.55, yellow: 0.7, green: 0.5, white: 0.85 };
const remapCache = new Map();
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function remapTexture(tex, remap) {
  const key = tex.uuid + JSON.stringify(remap);
  if (remapCache.has(key)) return remapCache.get(key);
  const img = tex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const px = data.data;
  const rules = remap.map((r) => ({ test: BANDS[r.band] || null, to: hexRgb(r.to), ref: r.ref ?? BAND_REF[r.band] ?? 0.55 }));
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    const s = mx ? d / mx : 0;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    const rule = rules.find((x) => !x.test || x.test(h, s, mx));
    if (!rule) continue;
    const k = (0.299 * r + 0.587 * g + 0.114 * b) / rule.ref;
    for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, rule.to[c] * k);
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false; // same layout as the glTF texture it replaces
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  remapCache.set(key, t);
  return t;
}

// A black/white copy of an atlas: white where the texel is in `band`. Used as
// an emissive map so only part of a model glows (a lantern's glass).
function maskTexture(tex, band) {
  return remapTexture(tex, [{ band, to: '#ffffff', ref: 0.0001 }, { to: '#000000' }]);
}

// def (the manifest entry) can recolour named materials, repaint a palette
// atlas (`remap`) and make thin leaf/petal planes double-sided.
function toToon(m, tint, def = {}) {
  const re = def.recolor?.[m.name] || def.recolor?.['*'] || PALETTES[def._pack]?.[m.name];
  const key = m.uuid + (tint ? JSON.stringify(tint) : '') + (re || '') + (def.doubleSide ? 'D' : '') + JSON.stringify([def.remap, def.glowBand, def.texture]);
  if (matCache.has(key)) return matCache.get(key);
  if (m.map) {
    // Kenney packs colour models from a small palette atlas: keep it crisp.
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.needsUpdate = true;
  }
  const color = re ? new THREE.Color(re) : (m.color || new THREE.Color('#ffffff')).clone();
  if (tint) color.lerp(new THREE.Color(tint.color), tint.amount ?? 0.6);
  const t = new THREE.MeshToonMaterial({
    color,
    map: m.map && def.remap ? remapTexture(m.map, def.remap) : (def.texture && textures.get(def.texture)) || m.map || null,
    gradientMap: gradMap,
    transparent: m.transparent,
    opacity: m.opacity,
    side: def.doubleSide ? THREE.DoubleSide : m.side,
    alphaTest: m.alphaTest,
    emissive: tint?.emissive || '#000000',
    emissiveIntensity: tint?.emissive ? (tint.glow ?? 0.35) : 0,
  });
  t.vertexColors = !!m.vertexColors;
  if (def.glowBand && m.map) {
    // { band, color, amount }: light up just that part of the atlas.
    t.emissiveMap = maskTexture(m.map, def.glowBand.band);
    t.emissive = new THREE.Color(def.glowBand.color);
    t.emissiveIntensity = def.glowBand.amount ?? 0.6;
  }
  graded(t);
  matCache.set(key, t);
  return t;
}

// Inverted-hull outline needs smooth normals even on flat-shaded models.
function hullGeometry(geo, skinned = false) {
  if (hullCache.has(geo)) return hullCache.get(geo);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (skinned) for (const k of ['skinIndex', 'skinWeight']) g.setAttribute(k, geo.attributes[k].clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  merged.userData.shared = true; // cached: reused by every copy, never disposed
  hullCache.set(geo, merged);
  return merged;
}

const ACTOR_OUTLINE = 0.036; // characters and monsters get a bolder line than the scenery
const outlineFor = (scale, world = OUTLINE_WORLD) => outlineMat(Math.round((world / Math.max(scale, 1e-3)) * 1000) / 1000);

const textures = new Map(); // url -> Texture (palette variants for modular kits)
const texLoader = new THREE.TextureLoader(manager);

// Modular building pieces are loaded "raw": no re-centering or resizing,
// because their pivots are what make walls and roofs line up.
for (const [pack, names] of Object.entries(MODULE_PACKS)) for (const n of names) MODELS[`${pack}:${n}`] ??= { url: `/models/${pack}/${n}.glb`, raw: true, outline: !/^(flag|banner|stall|fountain-center|metal-gate)/.test(n) };

export async function loadAssets(onProgress = () => {}) {
  const urls = new Set();
  for (const def of Object.values(MODELS)) for (const u of [].concat(def.url)) urls.add(u);
  const texUrls = [...new Set(Object.values(TEXTURES).flatMap((t) => Object.values(t)).concat(Object.values(MODELS).map((d) => d.texture).filter(Boolean)))];
  const total = urls.size + texUrls.length;
  await Promise.all(
    texUrls.map((u) =>
      texLoader
        .loadAsync(u)
        .then((t) => {
          t.flipY = false; // glTF UV convention
          t.colorSpace = THREE.SRGBColorSpace;
          t.magFilter = t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          textures.set(u, t);
        })
        .catch(() => console.warn('texture failed to load:', u)),
    ),
  );
  let done = 0;
  await Promise.all(
    [...urls].map((url) =>
      loader
        .loadAsync(url)
        .then((g) => gltfs.set(url, g))
        .catch((e) => console.warn('model failed to load, using fallback:', url, e?.message))
        .finally(() => onProgress((++done + texUrls.length) / total)),
    ),
  );
  for (const [slot, def] of Object.entries(MODELS)) {
    const variants = [].concat(def.url).map((u) => gltfs.get(u)).filter(Boolean);
    if (!variants.length) continue;
    ready.set(slot, variants.map((g, i) => prepare(g, def.heights ? { ...def, height: def.heights[i % def.heights.length] } : def)));
  }
}

// Normalise a loaded model: toon materials, size in metres, feet on y=0.
function prepare(gltf, def) {
  def._pack = [].concat(def.url)[0].split('/')[2];
  const root = gltf.scene;
  root.traverse((o) => o.geometry && (o.geometry.userData.shared = true)); // copies share these
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (def.raw) {
    root.updateMatrixWorld(true);
    const sz = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    return { gltf, def, scale: 1, stretch: [1, 1, 1], offset: new THREE.Vector3(), size: sz, skinned: false };
  }
  let scale = def.scale ?? 1;
  if (def.height) scale = def.height / Math.max(size.y, 1e-3);
  else if (def.width) scale = def.width / Math.max(size.x, size.z, 1e-3);
  else if (def.fit) scale = Math.min(def.fit[0] / Math.max(size.x, 1e-3), def.fit[1] / Math.max(size.z, 1e-3));
  const center = box.getCenter(new THREE.Vector3());
  const st = def.stretch || [1, 1, 1];
  const sz = size.multiplyScalar(scale);
  sz.set(sz.x * st[0], sz.y * st[1] - (def.sink || 0), sz.z * st[2]);
  return { gltf, def, scale, stretch: st, offset: new THREE.Vector3(-center.x, -box.min.y - (def.sink || 0) / scale, -center.z), size: sz, skinned: hasSkin(root) };
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
export function make(slot, { variant = 0, tint = null, outline = true, castShadow = true, unique = false } = {}) {
  const list = ready.get(slot);
  if (!list) return null;
  const p = list[variant % list.length];
  tint = tint ?? p.def.tint ?? null;
  const src = p.gltf.scene;
  const inner = p.skinned ? cloneSkinned(src) : src.clone(true);
  inner.position.copy(p.offset);
  const pivot = new THREE.Group();
  const scaled = new THREE.Group();
  scaled.scale.set(p.scale * p.stretch[0], p.scale * p.stretch[1], p.scale * p.stretch[2]);
  if (p.def.rotY) scaled.rotation.y = p.def.rotY;
  scaled.add(inner);
  pivot.add(scaled);
  // Collect first: adding outline children while traversing would recurse forever.
  const meshes = [];
  inner.traverse((o) => o.isMesh && meshes.push(o));
  const ol = /^(mob_|npc_)/.test(slot) ? ACTOR_OUTLINE : OUTLINE_WORLD;
  meshes.forEach((o) => {
    // unique: own material copies (e.g. so one monster can flash red alone)
    const conv = (m) => (unique ? toToon(m, tint, p.def).clone() : toToon(m, tint, p.def));
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    if (unique) [].concat(o.material).forEach(graded);
    o.castShadow = castShadow;
    o.receiveShadow = true;
    if (outline && p.def.outline !== false) {
      let hull;
      if (o.isSkinnedMesh) {
        // Same inked look for rigged characters: a skinned hull that bends
        // with the same skeleton (the push along the normal happens before
        // skinning, so the line stays even while animating).
        hull = new THREE.SkinnedMesh(hullGeometry(o.geometry, true), outlineFor(p.scale, ol));
        hull.bind(o.skeleton, o.bindMatrix);
      } else hull = new THREE.Mesh(hullGeometry(o.geometry), outlineFor(p.scale, ol));
      hull.raycast = () => {};
      hull.castShadow = false;
      hull.frustumCulled = !o.isSkinnedMesh; // a posed character can leave its rest-pose bounds
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
// placements: [{ x, z, y?, rot?, s?, sv?: [x, y, z] }]. Returns a Group or null.
export function instanced(slot, placements, { variant = 0, tint = null, outline = true, castShadow = true } = {}) {
  const list = ready.get(slot);
  if (!list || !placements.length) return null;
  const p = list[variant % list.length];
  tint = tint ?? p.def.tint ?? null;
  const group = new THREE.Group();
  const root = p.gltf.scene;
  root.updateMatrixWorld(true);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.def.rotY || 0, 0)), new THREE.Vector3(p.scale * p.stretch[0], p.scale * p.stretch[1], p.scale * p.stretch[2]));
  const off = new THREE.Matrix4().makeTranslation(p.offset.x, p.offset.y, p.offset.z);
  const o = new THREE.Object3D();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().multiplyMatrices(off, m.matrixWorld));
    const mat = Array.isArray(m.material) ? toToon(m.material[0], tint, p.def) : toToon(m.material, tint, p.def);
    const im = new THREE.InstancedMesh(m.geometry, mat, placements.length);
    const hull = outline && p.def.outline !== false ? new THREE.InstancedMesh(hullGeometry(m.geometry), outlineFor(p.scale * (placements[0].s ?? 1)), placements.length) : null;
    placements.forEach((pl, i) => {
      o.position.set(pl.x, pl.y ?? 0, pl.z);
      o.rotation.set(0, pl.rot ?? 0, 0);
      if (pl.sv) o.scale.set(...pl.sv);
      else o.scale.setScalar(pl.s ?? 1);
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

// Find an animation clip by loose name (packs name them differently).
const CLIP_RE = {
  idle: /idle|static|stand/i,
  walk: /walk|run|move/i,
  attack: /attack|punch|swing|interact|bite|shoot|^eat$/i,
  hit: /hit|hurt|damage|emote-no|gesture-negative/i,
  die: /die|death|dead/i,
};
export function findClip(actions, what) {
  if (!actions) return null;
  if (actions[what]) return actions[what];
  const re = CLIP_RE[what];
  const k = re && Object.keys(actions).find((n) => re.test(n));
  return k ? actions[k] : null;
}

// ── Modular building assembly ────────────────────────────────────────
// items: [{ slot, p: [x,y,z], r: degrees, s: number|[x,y,z], tex?: url }]
// Bakes every module into building space and merges by material, so a whole
// house is ~2 meshes (+ its outline) instead of hundreds.
const ATTRS = ['position', 'normal', 'uv'];
function normalizeGeo(g) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!ATTRS.includes(k)) out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

export function assemble(items, { castShadow = true } = {}) {
  const solids = new Map(); // key -> { mat, geos }
  const hulls = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const it of items) {
    const p = ready.get(it.slot)?.[0];
    if (!p) continue;
    const sc = Array.isArray(it.s) ? it.s : [it.s ?? 1, it.s ?? 1, it.s ?? 1];
    e.set(0, ((it.r || 0) * Math.PI) / 180, 0);
    m4.compose(new THREE.Vector3(...it.p), q.setFromEuler(e), new THREE.Vector3(...sc));
    const root = p.gltf.scene;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mtx = new THREE.Matrix4().multiplyMatrices(m4, o.matrixWorld);
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      const tex = it.tex && textures.get(it.tex);
      const key = src.uuid + (tex ? it.tex : '');
      if (!solids.has(key)) solids.set(key, { src, tex, geos: [] });
      const g = normalizeGeo(o.geometry);
      g.applyMatrix4(mtx);
      solids.get(key).geos.push(g);
      if (p.def.outline !== false) {
        const h = hullGeometry(o.geometry).clone();
        h.applyMatrix4(mtx);
        hulls.push(h.index ? h.toNonIndexed() : h);
      }
    });
  }
  const group = new THREE.Group();
  for (const { src, tex, geos } of solids.values()) {
    const geo = mergeGeometries(geos);
    if (!geo) continue;
    const mat = toToon(src, null, {}).clone();
    graded(mat);
    if (tex) mat.map = tex;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (hulls.length) {
    for (const h of hulls) for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal') h.deleteAttribute(k);
    const hg = mergeGeometries(hulls);
    if (hg) {
      const hm = new THREE.Mesh(hg, outlineMat(OUTLINE_WORLD));
      hm.raycast = () => {};
      group.add(hm);
    }
  }
  return group;
}

export const hasModules = (pack, names) => names.every((n) => ready.has(`${pack}:${n}`));
