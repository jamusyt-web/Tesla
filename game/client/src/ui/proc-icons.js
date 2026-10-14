import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, outlineMat } from '../scene/toon.js';
import * as assets from '../scene/assets.js';
import { ITEMS } from '../../../shared/items.js';

// Small hand-built models for item icons that no asset pack has (fishing
// rods, a leather vest, an amulet, an acorn, metal ingots). They go through
// the same icon renderer as the 3D models, so the bag looks like one set.

const INK = 0.022;
// Flat things (vest, amulet) turn to face the icon camera, which sits up and
// to the right; the renderer also yaws every icon by -0.5 rad.
const FACE_CAMERA = 0.9;

// A toon mesh with an ink hull built from smoothed normals, so faceted
// shapes get an unbroken outline.
export function inked(geo, color, { thick = INK, emissive = null } = {}) {
  const m = new THREE.Mesh(geo, toon(color, emissive ? { emissive, emissiveIntensity: 0.25 } : {}));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const hull = mergeVertices(g, 1e-4);
  hull.computeVertexNormals();
  m.add(new THREE.Mesh(hull, outlineMat(thick)));
  return m;
}

// A thin cylinder between two points (fishing line, chain links).
function strand(a, b, r, color) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = inked(new THREE.CylinderGeometry(r, r, dir.length(), 6), color, { thick: 0.008 });
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

export function rod(skin) {
  const g = new THREE.Group();
  const pole = inked(new THREE.CylinderGeometry(0.02, 0.05, 1.7, 8), skin.handle);
  pole.position.y = 0.85;
  const grip = inked(new THREE.CylinderGeometry(0.065, 0.065, 0.42, 10), '#8b5a33');
  grip.position.y = 0.22;
  const reel = inked(new THREE.TorusGeometry(0.11, 0.04, 8, 18), skin.head, { emissive: skin.glow });
  reel.position.set(0.1, 0.5, 0);
  reel.rotation.y = Math.PI / 2;
  const hub = inked(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), skin.edge);
  hub.position.copy(reel.position);
  hub.rotation.z = Math.PI / 2;
  g.add(pole, grip, reel, hub);
  for (const y of [0.75, 1.05, 1.35]) {
    const ring = inked(new THREE.TorusGeometry(0.045, 0.012, 6, 12), skin.head, { thick: 0.01 });
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
  const tip = new THREE.Vector3(0, 1.7, 0);
  const bob = new THREE.Vector3(0.55, 0.85, 0);
  g.add(strand(tip, bob, 0.008, '#f4f4f4'));
  const float = inked(new THREE.SphereGeometry(0.08, 10, 8), '#e8505a');
  float.position.copy(bob);
  const cap = inked(new THREE.SphereGeometry(0.081, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#fff8ea');
  cap.position.copy(bob);
  g.add(float, cap);
  g.rotation.z = -0.55;
  return g;
}

// A vest silhouette, extruded and bevelled into a chunky toon shape.
export function vest(cloth = '#9a6238', trim = '#7a4a2a') {
  const half = (side) => {
    const s = new THREE.Shape();
    const x = (v) => v * side;
    s.moveTo(x(0.06), -0.75);
    s.lineTo(x(0.62), -0.75);
    s.quadraticCurveTo(x(0.68), -0.2, x(0.6), 0.05);
    s.quadraticCurveTo(x(0.42), 0.12, x(0.4), 0.42); // armhole
    s.lineTo(x(0.3), 0.62); // shoulder strap
    s.lineTo(x(0.16), 0.6);
    s.lineTo(x(0.06), -0.05); // V neck
    s.closePath();
    return s;
  };
  const g = new THREE.Group();
  const opts = { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 2 };
  for (const side of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(half(side), opts);
    geo.translate(0, 0, -0.11);
    g.add(inked(geo, cloth));
  }
  // Stitched trim and buttons down the front.
  for (const [y, c] of [[-0.18, '#e9c27a'], [-0.42, '#e9c27a']]) {
    const b = inked(new THREE.SphereGeometry(0.05, 10, 8), c, { thick: 0.012 });
    b.position.set(0.11, y, 0.2);
    g.add(b);
  }
  const hem = inked(new THREE.BoxGeometry(1.3, 0.08, 0.38), trim);
  hem.position.y = -0.72;
  g.add(hem);
  g.rotation.set(0.25, FACE_CAMERA, 0);
  return g;
}

export function amulet(gold = '#f2c14e', stone = null) {
  const g = new THREE.Group();
  // An open loop of chain whose gap sits at the bottom, where the pendant hangs.
  const chain = inked(new THREE.TorusGeometry(0.55, 0.03, 8, 40, Math.PI * 1.55), gold, { thick: 0.012 });
  chain.rotation.z = -Math.PI * 0.275;
  chain.position.y = 0.25;
  const end = 0.55 * Math.sin(Math.PI * 0.225);
  const endY = 0.25 - 0.55 * Math.cos(Math.PI * 0.225);
  const bail = inked(new THREE.TorusGeometry(0.07, 0.025, 6, 12), gold, { thick: 0.01 });
  bail.position.y = -0.24;
  bail.rotation.y = Math.PI / 2;
  for (const sx of [-1, 1]) g.add(strand(new THREE.Vector3(sx * end, endY, 0), new THREE.Vector3(sx * 0.05, -0.2, 0), 0.025, gold));
  const setting = inked(new THREE.TorusGeometry(0.2, 0.05, 8, 20), gold);
  setting.position.y = -0.5;
  g.add(chain, setting, bail);
  g.rotation.y = FACE_CAMERA;
  const gem = !stone && assets.make('icon:sapphire', { outline: true, castShadow: false });
  if (gem) {
    const o = gem.object;
    o.scale.setScalar(0.32);
    o.position.set(0, -0.66, 0.02);
    g.add(o);
  } else {
    const s = inked(new THREE.OctahedronGeometry(0.17), stone ?? '#4f7bff', { emissive: stone ?? '#3f6bff' });
    s.position.y = -0.5;
    g.add(s);
  }
  return g;
}

function acorn() {
  const g = new THREE.Group();
  const nut = new THREE.IcosahedronGeometry(0.5, 1);
  nut.scale(0.85, 1.05, 0.85);
  const body = inked(nut, '#f2c230', { emissive: '#ffb020' });
  body.position.y = -0.1;
  const capGeo = new THREE.SphereGeometry(0.5, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(1, 0.55, 1);
  const cap = inked(capGeo, '#a8742a');
  cap.position.y = 0.18;
  const stem = inked(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 6), '#7a5226');
  stem.position.y = 0.52;
  stem.rotation.z = -0.3;
  g.add(body, cap, stem);
  return g;
}

// A trapezoid ingot: wide base, narrower bevelled top.
export function ingot(color, glow = null) {
  const [bx, bz, tx, tz, h] = [1.0, 0.5, 0.78, 0.32, 0.3];
  const v = [
    [-bx / 2, 0, -bz / 2], [bx / 2, 0, -bz / 2], [bx / 2, 0, bz / 2], [-bx / 2, 0, bz / 2],
    [-tx / 2, h, -tz / 2], [tx / 2, h, -tz / 2], [tx / 2, h, tz / 2], [-tx / 2, h, tz / 2],
  ];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
  const pos = [];
  for (const [a, b, c, d] of faces) for (const i of [a, b, c, a, c, d]) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const g = new THREE.Group();
  // Two stacked bars read as "metal stock" better than one.
  const a = inked(geo, color, { emissive: glow });
  a.position.set(-0.08, 0, 0.18);
  const b = inked(geo, color, { emissive: glow });
  b.position.set(0.1, 0, -0.2);
  b.rotation.y = 0.12;
  const c = inked(geo, color, { emissive: glow });
  c.position.set(0.02, 0.3, 0);
  c.rotation.y = -0.1;
  g.add(a, b, c);
  return g;
}

export const PROC_ICONS = {
  rod_basic: () => rod(ITEMS.rod_basic.skin),
  rod_fine: () => rod(ITEMS.rod_fine.skin),
  rod_master: () => rod(ITEMS.rod_master.skin),
  armor_leather: () => vest(),
  amulet_sapphire: () => amulet(),
  golden_acorn: acorn,
  copper_bar: () => ingot('#e07b39'),
  iron_bar: () => ingot('#c9d3df'),
  gold_bar: () => ingot('#ffd23f', '#ffb020'),
};

// A town's own item icons, drawn in code ({ itemId: () => Object3D }), for
// items no model pack has. Each item gets one builder.
export function registerIcons(town, map) {
  map = typeof map === 'function' ? map() : map;
  for (const id of Object.keys(map)) if (PROC_ICONS[id]) throw new Error(`${town}: icon for "${id}" is defined twice.`);
  Object.assign(PROC_ICONS, map);
}

// Each town's own icons (client/src/ui/proc-icons/<town>.js).
import AMBERFOLD from './proc-icons/amberfold.js';
registerIcons('amberfold', AMBERFOLD);
