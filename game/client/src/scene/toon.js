import * as THREE from 'three';

// 3-band gradient = the soft cel-shaded "Shop Titans" look.
const grad = (() => {
  const data = new Uint8Array([136, 136, 136, 255, 206, 206, 206, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const cache = new Map();
export function toon(color, opts = {}) {
  const { unique, flatShading, ...rest } = opts; // toon has no flatShading; polyhedron geos are faceted anyway
  const key = color + JSON.stringify(rest);
  if (!unique && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: grad, ...rest });
  if (!unique) cache.set(key, m);
  return m;
}

// Inverted-hull outline: push vertices along normals, draw back faces in ink.
// Every thickness shares one shader program: the thickness is a uniform.
const outlineMats = new Map();
export function outlineMat(thickness = 0.03, color = '#1e140e') {
  const key = thickness + color;
  if (outlineMats.has(key)) return outlineMats.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.userData.thick = thickness; // (for merging: the hull can be pushed out ahead of time)
  m.onBeforeCompile = (s) => {
    s.uniforms.thick = { value: thickness };
    s.vertexShader = 'uniform float thick;\n' + s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * thick;');
  };
  m.customProgramCacheKey = () => 'outline';
  outlineMats.set(key, m);
  return m;
}

export function mesh(geo, color, { outline = 0, shadow = true, receive = false, mat = null } = {}) {
  const m = new THREE.Mesh(geo, mat || toon(color));
  m.castShadow = shadow;
  m.receiveShadow = receive;
  if (outline) {
    const o = new THREE.Mesh(geo, outlineMat(outline));
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return '#' + c.getHexString();
};
