import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODELS, PALETTES, TEXTURES, GROUPS } from './manifest/index.js';
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
  metal: (h, s, v) => h >= 200 && h <= 265 && s >= 0.08 && s <= 0.45 && v < 0.7, // lavender-grey steel (not pale snow)
  ice: (h, s, v) => h >= 185 && h <= 230 && s < 0.3 && v >= 0.7, // snow and frost: pale blue-white
  blue: (h, s) => h >= 205 && h < 255 && s > 0.45,
  purple: (h, s) => h >= 255 && h < 340 && s > 0.2, // purple, mauve, pink crystal
  dark: (h, s, v) => v < 0.22, // near-black
  red: (h, s) => (h >= 340 || h < 15) && s > 0.45,
  orange: (h, s) => h >= 15 && h < 30 && s > 0.35, // wood handles, leather
  yellow: (h, s) => h >= 30 && h < 55 && s > 0.35,
  green: (h, s) => h >= 70 && h < 180 && s > 0.25,
  white: (h, s, v) => s < 0.12 && v > 0.7,
  warm: (h, s) => h < 60 && s > 0.2, // every orange/tan/cream fur or wood tone
};
const BAND_REF = { metal: 0.62, red: 0.45, orange: 0.55, yellow: 0.7, green: 0.5, white: 0.85, ice: 0.85, blue: 0.45, purple: 0.5, dark: 0.15 };
const remapCache = new Map();
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function remapTexture(tex, remap) {
  const key = tex.uuid + JSON.stringify(remap);
  if (remapCache.has(key)) return remapCache.get(key);
  // From the pixels read while loading (a fresh read here would wait on the GPU).
  const src = pixelsOf(tex);
  const cv = document.createElement('canvas');
  cv.width = src.w;
  cv.height = src.h;
  const ctx = cv.getContext('2d');
  const data = new ImageData(new Uint8ClampedArray(src.data), src.w, src.h);
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
  pixelCache.set(t, { w: src.w, h: src.h, data: px });
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
// Materials are shared by what they look like (texture, colour, flags), not by
// which model file they came from, so identical ones are one material.
function toToon(m, tint, def = {}) {
  const re = def.recolor?.[m.name] || def.recolor?.['*'] || PALETTES[def._pack]?.[m.name];
  const look = [m.map?.uuid ?? '', m.color?.getHexString() ?? '', m.transparent, m.opacity, m.side, m.alphaTest, !!m.vertexColors];
  const key = JSON.stringify([look, tint, re, def.doubleSide, def.remap, def.glowBand, def.texture, def.grade]);
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
  if (def.grade !== false) graded(t); // grade:false keeps a slot's own colours (ice, crystal)
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

// The ink material (one shader for every thickness): for shader warm-up.
export const outline = () => outlineMat(OUTLINE_WORLD);

const ACTOR_OUTLINE = 0.036; // characters and monsters get a bolder line than the scenery
const outlineFor = (scale, world = OUTLINE_WORLD) => outlineMat(Math.round((world / Math.max(scale, 1e-3)) * 1000) / 1000);

const textures = new Map(); // url -> Texture (palette variants for modular kits)
const texLoader = new THREE.TextureLoader(manager);

// The groups loaded (or loading): id → Promise.
const groups = new Map();
const groupListeners = [];
export const groupReady = (id) => groups.has(id);
// fn(id) after each group finishes loading (the game swaps in monster models).
export const onGroup = (fn) => groupListeners.push(fn);

// Load the 'core' group (and any others named) before the first frame.
export async function loadAssets(onProgress = () => {}, ids = ['core']) {
  await Promise.all(ids.map((id, i) => ensureGroup(id, i === 0 ? onProgress : () => {})));
  // Read the scenery textures' pixels now, while nothing is being drawn: far
  // chunks bake them into vertex colours, and a read in mid-game waits on the GPU.
  for (const t of [...imageKeys.values(), ...textures.values()]) pixelsOf(t);
}

// Load a group of models once; later calls get the same promise.
export function ensureGroup(id, onProgress = () => {}) {
  if (!groups.has(id)) {
    const p = loadGroup(GROUPS[id] ?? [], onProgress).then(() => {
      for (const fn of groupListeners) fn(id);
    });
    groups.set(id, p);
  }
  return groups.get(id);
}

async function loadGroup(slots, onProgress) {
  const defs = slots.map((s) => [s, MODELS[s]]).filter(([, d]) => d);
  const urls = new Set();
  for (const [, def] of defs) for (const u of [].concat(def.url)) if (!gltfs.has(u)) urls.add(u);
  // A kit's palette swaps come with the group that has its pieces; a slot's own texture with the slot.
  const packs = new Set(slots.filter((s) => s.includes(':')).map((s) => s.split(':')[0]));
  const wanted = Object.entries(TEXTURES)
    .filter(([pack]) => packs.has(pack))
    .flatMap(([, t]) => Object.values(t))
    .concat(defs.map(([, d]) => d.texture).filter(Boolean));
  const texUrls = [...new Set(wanted)].filter((u) => !textures.has(u));
  const total = urls.size + texUrls.length || 1;
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
  await shareTextures();
  for (const [slot, def] of defs) {
    if (ready.has(slot)) continue;
    const variants = [].concat(def.url).map((u) => gltfs.get(u)).filter(Boolean);
    if (!variants.length) continue;
    ready.set(slot, variants.map((g, i) => prepare(g, def.heights ? { ...def, height: def.heights[i % def.heights.length] } : def)));
  }
}

// Many model files point at the same palette image (each pack's colormap.png),
// but every file gets its own Texture: keep one per image (and sampling), so
// the GPU holds each picture once. Images are known by their resolved URL, or
// by a hash of their bytes when they are packed inside the model file.
const imageKeys = new Map(); // `key|wrap|flip` → Texture
const fnv = (bytes) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(36) + ':' + bytes.length;
};
async function textureKey(url, gltf, tex) {
  const ref = gltf.parser.associations.get(tex);
  const def = ref?.textures != null ? gltf.parser.json.textures?.[ref.textures] : null;
  const img = def ? gltf.parser.json.images?.[def.source] : null;
  if (!img) return null;
  if (img.uri && !img.uri.startsWith('data:')) return new URL(img.uri, new URL(url, location.href)).pathname;
  if (img.bufferView != null) return 'bv:' + fnv(new Uint8Array(await gltf.parser.getDependency('bufferView', img.bufferView)));
  return null;
}
// Kenney palette atlases are columns of colour swatches 32–64 px wide with a
// vertical gradient in each; at 256 px they keep every swatch, so phones hold
// a quarter of the memory per atlas.
const ATLAS_MAX = 256;
function shrink(tex) {
  const img = tex.image;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!(w > ATLAS_MAX || h > ATLAS_MAX)) return;
  const k = ATLAS_MAX / Math.max(w, h);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false; // nearest: swatches stay exact colours
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  img.close?.(); // an ImageBitmap's pixels are no longer needed
  tex.image = cv;
  tex.needsUpdate = true;
}

const shared = new Set(); // model files already gone through
async function shareTextures() {
  for (const [url, gltf] of gltfs) {
    if (shared.has(url)) continue;
    shared.add(url);
    const mats = new Set();
    gltf.scene.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => mats.add(m)));
    for (const m of mats)
      for (const slot of ['map', 'emissiveMap']) {
        const tex = m[slot];
        if (!tex) continue;
        const key = await textureKey(url, gltf, tex);
        if (!key) continue;
        const full = `${key}|${tex.wrapS},${tex.wrapT}|${tex.flipY}`;
        const keep = imageKeys.get(full);
        if (!keep) imageKeys.set(full, tex), shrink(tex);
        else if (keep !== tex) m[slot] = keep;
      }
  }
  for (const t of textures.values()) shrink(t); // the palette variants for building kits
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

// A model's meshes as make()/instanced() place them: each sub-mesh's shared
// geometry, its toon material and its matrix within the model (sized, feet on
// y = 0). For merging scenery (scene/chunkmerge.js). Cached per slot·variant.
const partsCache = new Map();
export function parts(slot, variant = 0) {
  const list = ready.get(slot);
  if (!list) return null;
  const key = slot + '|' + (variant % list.length);
  if (partsCache.has(key)) return partsCache.get(key);
  const p = list[variant % list.length];
  const root = p.gltf.scene;
  root.updateMatrixWorld(true);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.def.rotY || 0, 0)), new THREE.Vector3(p.scale * p.stretch[0], p.scale * p.stretch[1], p.scale * p.stretch[2]));
  const off = new THREE.Matrix4().makeTranslation(p.offset.x, p.offset.y, p.offset.z);
  const out = [];
  root.traverse((m) => {
    if (!m.isMesh || m.isSkinnedMesh) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().multiplyMatrices(off, m.matrixWorld));
    const material = toToon(Array.isArray(m.material) ? m.material[0] : m.material, p.def.tint ?? null, p.def);
    out.push({ geometry: m.geometry, material, matrix, outline: p.def.outline !== false, graded: p.def.grade !== false });
  });
  const r = { parts: out, size: p.size, def: p.def };
  partsCache.set(key, r);
  return r;
}

// The colour of a texture at (u, v), as linear RGB (for baking a far chunk's
// colours into its vertices). Pixels are read once per texture.
const pixelCache = new WeakMap();
function pixelsOf(tex) {
  let px = pixelCache.get(tex);
  if (px || !tex?.image?.width) return px;
  const img = tex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  px = { w: cv.width, h: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
  pixelCache.set(tex, px);
  return px;
}
export function texel(tex, u, v, out) {
  const px = pixelsOf(tex);
  const x = Math.min(px.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * px.w)));
  const yy = tex.flipY ? 1 - (v - Math.floor(v)) : v - Math.floor(v);
  const y = Math.min(px.h - 1, Math.max(0, Math.floor(yy * px.h)));
  const i = (y * px.w + x) * 4;
  return out.setRGB(px.data[i] / 255, px.data[i + 1] / 255, px.data[i + 2] / 255, THREE.SRGBColorSpace);
}

// The colour grade (GRADE above) on one linear colour, for colours baked into
// vertices where the shader's version doesn't run.
export function gradeColor(c) {
  let { r, g, b } = c;
  const w = THREE.MathUtils.smoothstep(g - b, 0.08, 0.2) * (r <= b ? 1 : 0);
  const d = (b - r) * w * 0.6;
  r += d;
  b -= d;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const k = (b >= Math.max(r, g) ? 1 : 0) * (1 - THREE.MathUtils.smoothstep((mx - mn) / Math.max(mx, 1e-3), 0.35, 0.6)) * 0.55;
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  r = r + (l * 1.05 - r) * k;
  g = g + (l * 1.0 - g) * k;
  b = b + (l * 0.92 - b) * k;
  return c.setRGB(r * 1.02, g, b * 0.97);
}

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
    if (unique && p.def.grade !== false) [].concat(o.material).forEach(graded);
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
// Bakes every module into building space. Opaque parts have their colours
// baked into the vertices (material colour × palette texel, graded), so a
// whole house is one or two meshes (+ its outline) instead of hundreds; see-
// through or glowing parts keep their own material.
const ATTRS = ['position', 'normal', 'uv'];
function normalizeGeo(g) {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!ATTRS.includes(k)) out.deleteAttribute(k);
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

const _bc = new THREE.Color();
const _bt = new THREE.Color();
export function assemble(items, { castShadow = true } = {}) {
  const solids = new Map(); // key -> { mat, geos }
  const baked = new Map(); // side → vertex-coloured geometries
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
      const m = toToon(src, null, {});
      const g = normalizeGeo(o.geometry);
      g.applyMatrix4(mtx);
      if (m.transparent || m.emissiveMap || (m.emissive?.getHex() && m.emissiveIntensity >= 0.15)) {
        const key = src.uuid + (tex ? it.tex : '');
        if (!solids.has(key)) solids.set(key, { src, tex, geos: [] });
        solids.get(key).geos.push(g);
      } else {
        const map = tex || m.map;
        const uv = g.attributes.uv;
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          _bc.copy(m.color);
          if (map) _bc.multiply(texel(map, uv.getX(i), uv.getY(i), _bt));
          gradeColor(_bc);
          (col[i * 3] = _bc.r), (col[i * 3 + 1] = _bc.g), (col[i * 3 + 2] = _bc.b);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.deleteAttribute('uv');
        const side = m.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide;
        (baked.get(side) ?? baked.set(side, []).get(side)).push(g);
      }
      if (p.def.outline !== false) {
        const h = hullGeometry(o.geometry).clone();
        h.applyMatrix4(mtx);
        hulls.push(h.index ? h.toNonIndexed() : h);
      }
    });
  }
  const group = new THREE.Group();
  for (const [side, geos] of baked) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), toon('#ffffff', { vertexColors: true, ...(side === THREE.DoubleSide ? { side } : {}) }));
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
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
