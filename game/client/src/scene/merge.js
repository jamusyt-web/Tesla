// Merging a model built from many small parts into a few meshes, so it costs
// a few draw calls instead of one (plus one ink hull) per part.
//
// bakeSkinned(rig, host): every opaque part under `rig` goes into one
// vertex-coloured SkinnedMesh, each vertex bound rigidly to the nearest Bone
// above its part, and every inked part into one ink shell bound the same way.
// The bones keep animating as before. Parts with see-through or double-sided
// materials stay as they are.
//
// mergeRigid(obj): the same for something that doesn't bend (a tool, a
// waystone): one vertex-coloured mesh per kind of glow, and one ink shell, as
// children of obj. Meshes marked userData.live (animated) are left as they are.
// skinnedCopies(obj, bone): those meshes as SkinnedMeshes riding one bone, so
// a hero's tools draw with the same shaders as the hero.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, outlineMat } from './toon.js';

// Opaque, one-sided, untextured: can be painted into vertex colours (a glow
// is kept as the material's, per group of parts that share it).
const opaque = (m) => !Array.isArray(m) && !m.transparent && m.side === THREE.FrontSide && !m.map;
const FAINT = 0.15; // a glow this weak is folded into the colour instead
const hullThickness = (part) => part.children.find((c) => c.isMesh && c.material.side === THREE.BackSide)?.material.userData.thick ?? 0;
const isHull = (o) => o.isMesh && o.material.side === THREE.BackSide;

function indexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  g.setIndex(Array.from({ length: n }, (_, i) => i));
  return g;
}

// A part's geometry in `space` (its matrix), with only the attributes we keep.
function solidPart(part, space, color, bone) {
  const src = part.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  if (src.index) g.setIndex(src.index.clone());
  if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
  else g.computeVertexNormals();
  indexed(g).applyMatrix4(space);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (col[i * 3] = color.r), (col[i * 3 + 1] = color.g), (col[i * 3 + 2] = color.b);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (bone != null) skin(g, bone);
  return g;
}

// The ink shell of a part: smooth normals, pushed out by the line thickness
// in the part's own space (as the hull child used to be drawn), then placed.
function hullPart(part, thick, space, bone) {
  const src = part.geometry;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.attributes.position.clone());
  if (src.index) g.setIndex(src.index.clone());
  const h = mergeVertices(g, 1e-3);
  h.computeVertexNormals();
  const p = h.attributes.position;
  const nr = h.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nr.getX(i) * thick, p.getY(i) + nr.getY(i) * thick, p.getZ(i) + nr.getZ(i) * thick);
  indexed(h).applyMatrix4(space);
  if (bone != null) skin(h, bone);
  return h;
}

function skin(g, bone) {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) (idx[i * 4] = bone), (w[i * 4] = 1);
  g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
}

const colorOf = (m) => m.color ?? new THREE.Color('#ffffff');

// Skinned meshes are culled by a sphere around their rest pose, padded so a
// lunge, a fall or a raised arm never pops out of view.
function cullSphere(mesh) {
  const g = mesh.geometry;
  g.computeBoundingSphere();
  mesh.boundingSphere = g.boundingSphere.clone();
  mesh.boundingSphere.radius = mesh.boundingSphere.radius * 1.5 + 1;
}

export function bakeSkinned(rig, host) {
  host.updateMatrixWorld(true);
  const bones = [];
  rig.traverse((o) => o.isBone && bones.push(o));
  const boneOf = (o) => {
    for (let p = o.parent; p; p = p.parent) if (p.isBone) return bones.indexOf(p);
    return 0;
  };
  const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const parts = [];
  rig.traverse((o) => o.isMesh && !isHull(o) && opaque(o.material) && parts.push(o));
  const byGlow = new Map(); // glow ('' for none) → part geometries
  const hulls = [];
  for (const part of parts) {
    const space = new THREE.Matrix4().multiplyMatrices(inv, part.matrixWorld);
    const bone = boneOf(part);
    const m = part.material;
    const faint = m.emissive && m.emissiveIntensity < FAINT;
    const color = faint ? colorOf(m).clone().add(m.emissive.clone().multiplyScalar(m.emissiveIntensity)) : colorOf(m);
    const glow = faint ? '' : glowOf(m);
    if (!byGlow.has(glow)) byGlow.set(glow, []);
    byGlow.get(glow).push(solidPart(part, space, color, bone));
    const t = hullThickness(part);
    if (t > 0) hulls.push(hullPart(part, t, space, bone));
  }
  for (const part of parts) part.parent.remove(part); // (its ink hull goes with it)
  const skeleton = new THREE.Skeleton(bones);
  const make = (geos, mat) => {
    const geo = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const m = new THREE.SkinnedMesh(geo, mat);
    cullSphere(m);
    host.add(m);
    m.updateMatrixWorld(true);
    m.bind(skeleton);
    return m;
  };
  // Each its own material: a hit flashes one hero or monster, not all of them.
  const meshes = [...byGlow].map(([glow, geos]) => make(geos, glow ? toon('#ffffff', { vertexColors: true, emissive: '#' + glow.split('|')[0], emissiveIntensity: +glow.split('|')[1], unique: true }) : toon('#ffffff', { vertexColors: true, unique: true })));
  const body = meshes[0];
  const hull = hulls.length ? make(hulls, outlineMat(0)) : null;
  if (hull) hull.raycast = () => {};
  return { body, meshes, hull, skeleton, bones };
}

// The vertex-coloured material for a glow (or none): its colour lives in the vertices.
const glowOf = (m) => (m.emissive && m.emissive.getHex() && m.emissiveIntensity ? `${m.emissive.getHexString()}|${m.emissiveIntensity}` : '');
const vcolMat = (glow) => (glow ? toon('#ffffff', { vertexColors: true, emissive: '#' + glow.split('|')[0], emissiveIntensity: +glow.split('|')[1] }) : toon('#ffffff', { vertexColors: true }));
export const PLAIN_VCOL = () => vcolMat('');

export function mergeRigid(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const parts = [];
  const live = (o) => {
    for (let p = o; p; p = p.parent) if (p.userData.live) return true;
    return false;
  };
  obj.traverse((o) => o.isMesh && !isHull(o) && !live(o) && parts.push(o));
  const byGlow = new Map(); // glow → part geometries
  const hulls = [];
  for (const part of parts) {
    const space = new THREE.Matrix4().multiplyMatrices(inv, part.matrixWorld);
    const glow = glowOf(part.material);
    if (!byGlow.has(glow)) byGlow.set(glow, []);
    byGlow.get(glow).push(solidPart(part, space, colorOf(part.material)));
    const t = hullThickness(part);
    if (t > 0) hulls.push(hullPart(part, t, space));
  }
  for (const part of parts) part.parent.remove(part);
  const add = (geos, mat) => {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    for (const g of geos) g.dispose();
    obj.add(m);
    return m;
  };
  for (const [glow, geos] of byGlow) Object.assign(add(geos, vcolMat(glow)), { castShadow: true, receiveShadow: true });
  if (hulls.length) add(hulls, outlineMat(0)).raycast = () => {};
  return obj;
}

// The merged meshes of obj as SkinnedMeshes bound rigidly to skeleton bone
// `bone`, in that bone's own space. plainMat replaces the plain colour
// material (a hero passes its own, so tools flash with it). Geometries are
// cached per (obj, bone): pass the same obj for the same model.
const skinCache = new WeakMap();
export function skinnedCopies(obj, skeleton, bone, plainMat) {
  let byBone = skinCache.get(obj);
  if (!byBone) skinCache.set(obj, (byBone = new Map()));
  if (!byBone.has(bone))
    byBone.set(
      bone,
      obj.children
        .filter((c) => c.isMesh)
        .map((c) => {
          const g = c.geometry.clone();
          skin(g, bone);
          g.userData.shared = true;
          return { geo: g, mat: c.material };
        }),
    );
  const rest = new THREE.Matrix4().copy(skeleton.boneInverses[bone]).invert(); // the bone where it was at bind time
  return byBone.get(bone).map(({ geo, mat }) => {
    const m = new THREE.SkinnedMesh(geo, mat === PLAIN_VCOL() ? plainMat : mat);
    m.frustumCulled = false; // (a tool is small and always near a hero who is drawn)
    if (isHull(m)) m.raycast = () => {};
    m.bind(skeleton, rest);
    return m;
  });
}

// A model whose parts its animation moves one by one (most Kenney animals):
// one SkinnedMesh per look (texture, colour, sides), whose "bones" are those
// parts themselves (still moved by the animation, but no longer drawn), plus
// one ink shell. Returns null when there's nothing to gain.
export function bakeNodes(model, host) {
  host.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const parts = [];
  model.traverse((o) => o.isMesh && !o.isSkinnedMesh && !isHull(o) && !Array.isArray(o.material) && !o.material.transparent && parts.push(o));
  if (parts.length < 2) return null;
  const groups = new Map(); // look → { mat, geos }
  const hulls = [];
  parts.forEach((part, bone) => {
    const m = part.material;
    const space = new THREE.Matrix4().multiplyMatrices(inv, part.matrixWorld);
    const src = part.geometry;
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', ...(m.map ? ['uv'] : [])]) if (src.attributes[k]) g.setAttribute(k, src.attributes[k].clone());
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m.map && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (src.index) g.setIndex(src.index.clone());
    indexed(g).applyMatrix4(space);
    skin(g, bone);
    const look = `${m.map?.uuid ?? ''}|${m.color?.getHex()}|${m.side}|${glowOf(m)}|${m.vertexColors}`;
    if (!groups.has(look)) groups.set(look, { mat: m, geos: [] });
    groups.get(look).geos.push(g);
    const t = hullThickness(part);
    if (t > 0) hulls.push(hullPart(part, t, space, bone));
  });
  const skeleton = new THREE.Skeleton(parts);
  const make = (geos, mat) => {
    const geo = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const sm = new THREE.SkinnedMesh(geo, mat);
    cullSphere(sm);
    host.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton);
    return sm;
  };
  const meshes = [...groups.values()].map(({ mat, geos }) => make(geos, mat));
  const hull = hulls.length ? make(hulls, outlineMat(0)) : null;
  if (hull) hull.raycast = () => {};
  for (const part of parts) part.visible = false; // (their ink hulls go with them)
  return { meshes, hull };
}
