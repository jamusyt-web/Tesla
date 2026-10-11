import * as THREE from 'three';
import { mesh, toon } from './toon.js';
import * as assets from './assets.js';
import { ROOM } from '../../../shared/shop.js';
import { ITEMS, RARITY } from '../../../shared/items.js';
import { itemObject } from '../ui/portrait.js';

// The inside of a player shop: a timber-and-plaster merchant hall seen through
// a cutaway (the front wall is knee-high), with 8 displays, a counter and till.
// Every shop uses this same room (shared/shop.js ROOM); only the goods differ.

const OL = 0.03;
const WOOD = '#7a5134';
const WOOD_DARK = '#4a3324';
const PLASTER = '#d8c9ab';
const STONE = '#7d776e';

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 8; row++) {
    const y = row * 32;
    let px = -rnd() * 120;
    while (px < 256) {
      const len = 90 + rnd() * 110;
      const v = 0.82 + rnd() * 0.18;
      x.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(98 * v)},${Math.round(62 * v)})`;
      x.fillRect(px, y, len, 32);
      x.fillStyle = 'rgba(40,22,10,0.55)';
      x.fillRect(px, y, 2, 32);
      for (let k = 0; k < 3; k++) {
        x.fillStyle = `rgba(60,35,18,${0.08 + rnd() * 0.1})`;
        x.fillRect(px + rnd() * len, y + 4 + rnd() * 24, 30 + rnd() * 50, 1.5);
      }
      px += len;
    }
    x.fillStyle = 'rgba(30,16,8,0.7)';
    x.fillRect(0, y + 30, 256, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2.25);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const place = (o, x, y, z, ry = 0) => (o.position.set(x, y, z), (o.rotation.y = ry), o);

// ── Fixtures (procedural, so a shop works with no extra models) ─────────
function shelf() {
  const g = new THREE.Group();
  g.add(place(mesh(box(2.0, 1.9, 0.08), WOOD_DARK, { outline: OL }), 0, 0.95, -0.26));
  for (const sx of [-1, 1]) g.add(place(mesh(box(0.1, 1.9, 0.6), WOOD, { outline: OL }), sx * 0.95, 0.95, 0));
  for (const y of [0.1, 0.72, 1.32, 1.86]) g.add(place(mesh(box(1.9, 0.07, 0.56), WOOD, { outline: OL }), 0, y, 0));
  return g;
}
function rack() {
  const g = new THREE.Group();
  for (const sz of [-1, 1]) g.add(place(mesh(box(0.12, 1.7, 0.12), WOOD_DARK, { outline: OL }), 0, 0.85, sz * 0.8));
  g.add(place(mesh(box(0.1, 0.1, 1.8), WOOD, { outline: OL }), 0.05, 1.55, 0));
  g.add(place(mesh(box(0.35, 0.1, 1.8), WOOD, { outline: OL }), 0.12, 0.12, 0));
  return g;
}
function bin() {
  if (assets.has('prop_crate_open')) {
    const m = assets.make('prop_crate_open').object;
    m.scale.multiplyScalar(1.15);
    return m;
  }
  const g = new THREE.Group();
  g.add(place(mesh(box(0.95, 0.6, 0.95), WOOD, { outline: OL }), 0, 0.3, 0));
  return g;
}
function table() {
  const g = new THREE.Group();
  g.add(place(mesh(box(1.4, 0.09, 1.0), WOOD, { outline: OL }), 0, 0.82, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(place(mesh(box(0.09, 0.8, 0.09), WOOD_DARK, { outline: OL }), sx * 0.6, 0.4, sz * 0.4));
  const cloth = mesh(box(0.9, 0.012, 1.02), '#7a2f2a');
  g.add(place(cloth, 0, 0.875, 0));
  return g;
}
function pedestal() {
  const g = new THREE.Group();
  g.add(place(mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.9, 10), STONE, { outline: OL }), 0, 0.45, 0));
  g.add(place(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 10), '#9a948a', { outline: OL }), 0, 0.94, 0));
  return g;
}
const FIXTURE = { shelf, rack, bin, table, pedestal };

// Where copies of the displayed item sit on each kind of fixture (local space).
// cell: [width, height] each copy is fitted into (metres).
const ARRANGE = {
  shelf: { max: 6, cell: [0.5, 0.48], at: (i) => [(i % 3) * 0.6 - 0.6, i < 3 ? 0.76 : 1.36, 0.02, 0] },
  table: { max: 4, cell: [0.5, 0.42], at: (i) => [(i % 2) * 0.62 - 0.31, 0.9, i < 2 ? -0.2 : 0.22, i * 1.3] },
  rack: { max: 3, cell: [0.5, 1.3], at: (i) => [0.18, 0.18, (i - 1) * 0.55, 0], lean: 0.28 },
  bin: { max: 8, cell: [0.34, 0.3], at: (i) => [Math.cos(i * 2.4) * 0.22 * (i % 3 ? 1 : 0.4), 0.5 + Math.floor(i / 3) * 0.12, Math.sin(i * 2.4) * 0.22 * (i % 3 ? 1 : 0.4), i * 1.9] },
  pedestal: { max: 1, cell: [0.6, 0.7], at: () => [0, 1.0, 0, 0] },
};
// Each item's size in its icon pose, measured once, so any model fits its spot.
const sizeCache = new Map();
function itemSize(id, o) {
  if (!sizeCache.has(id)) {
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    sizeCache.set(id, b.isEmpty() ? new THREE.Vector3(1, 1, 1) : b.getSize(new THREE.Vector3()));
  }
  return sizeCache.get(id);
}
const copiesFor = (kind, qty) => (kind === 'bin' ? Math.min(8, Math.ceil(2 * Math.log2(qty + 1))) : Math.min(qty, ARRANGE[kind].max));

export function buildInterior({ low = false } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1e1611');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 80);
  const pickables = [];

  // Light: warm bounce, a "window" sun with shadows, two lanterns.
  const hemi = new THREE.HemisphereLight('#fff1dc', '#5a3f2c', 1.15);
  hemi.layers.enableAll();
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe4bd', 1.6);
  sun.position.set(-6, 9, 6);
  sun.layers.enableAll();
  if (!low) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun, sun.target);
  if (!low)
    for (const x of [-3.2, 3.2]) {
      const l = new THREE.PointLight('#ffb347', 6, 9, 2);
      l.position.set(x, 2.6, -2.8);
      l.layers.enableAll();
      scene.add(l);
    }

  // Floor (with an outside strip beyond the door so NPCs walk in from somewhere).
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshToonMaterial({ map: plankTexture(), gradientMap: toon('#fff').gradientMap }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.floor = true;
  scene.add(floor);
  pickables.push(floor);
  const street = mesh(box(4, 0.1, 3), '#9c958a');
  street.position.set(0, -0.05, ROOM.d / 2 + 1.5);
  street.receiveShadow = true;
  scene.add(street);
  const rug = mesh(box(3.6, 0.02, 2.6), '#6e2a26');
  rug.position.set(-0.2, 0.011, 1.3);
  rug.receiveShadow = true;
  const rugIn = mesh(box(3.2, 0.022, 2.2), '#8a3a30');
  rugIn.position.set(-0.2, 0.012, 1.3);
  rugIn.receiveShadow = true;
  const mat = mesh(box(1.4, 0.03, 0.7), '#a07a4a');
  mat.position.set(ROOM.mat.x, 0.015, ROOM.mat.z);
  mat.userData.door = true;
  scene.add(rug, rugIn, mat);
  pickables.push(mat);

  // Walls: back and sides full height, front cut down to a knee wall + door posts.
  const H = ROOM.wallH;
  const walls = new THREE.Group();
  const wall = (w, h, d, x, y, z) => {
    const m = mesh(box(w, h, d), PLASTER, { outline: OL });
    m.position.set(x, y, z);
    m.receiveShadow = true;
    walls.add(m);
  };
  wall(ROOM.w + 0.6, H, 0.3, 0, H / 2, -ROOM.d / 2 - 0.15);
  for (const sx of [-1, 1]) wall(0.3, H, ROOM.d + 0.3, sx * (ROOM.w / 2 + 0.15), H / 2, 0);
  for (const sx of [-1, 1]) wall(ROOM.w / 2 - ROOM.door.w / 2 + 0.3, 0.55, 0.3, sx * (ROOM.w / 4 + ROOM.door.w / 4 + 0.15), 0.275, ROOM.d / 2 + 0.15);
  // Timber framing and a stone base, so it reads as a sturdy merchant hall.
  const beam = (w, h, d, x, y, z) => walls.add(place(mesh(box(w, h, d), WOOD_DARK, { outline: OL }), x, y, z));
  for (let x = -6; x <= 6; x += 2) beam(0.22, H, 0.12, x, H / 2, -ROOM.d / 2 + 0.03);
  beam(ROOM.w + 0.4, 0.22, 0.14, 0, H - 0.1, -ROOM.d / 2 + 0.03);
  beam(ROOM.w + 0.4, 0.16, 0.14, 0, 2.15, -ROOM.d / 2 + 0.03);
  for (const sx of [-1, 1]) {
    for (let z = -4.5; z <= 4.5; z += 3) beam(0.12, H, 0.22, sx * (ROOM.w / 2 - 0.03), H / 2, z);
    beam(0.14, 0.22, ROOM.d + 0.4, sx * (ROOM.w / 2 - 0.03), H - 0.1, 0);
    beam(0.2, 2.5, 0.2, sx * (ROOM.door.w / 2 + 0.1), 1.25, ROOM.d / 2 + 0.15); // door posts
  }
  walls.add(place(mesh(box(ROOM.w + 0.6, 0.35, 0.34), STONE, { outline: OL }), 0, 0.17, -ROOM.d / 2 - 0.12));
  for (const sx of [-1, 1]) walls.add(place(mesh(box(0.34, 0.35, ROOM.d + 0.3), STONE, { outline: OL }), sx * (ROOM.w / 2 + 0.12), 0.17, 0));
  walls.traverse((o) => o.isMesh && (o.castShadow = true));
  scene.add(walls);

  // Wall sconces: an iron bracket and a lantern that glows.
  for (const x of [-3.2, 3.2]) {
    const sc = new THREE.Group();
    sc.add(place(mesh(box(0.06, 0.06, 0.4), '#2e2a2a'), 0, 0.3, 0.2));
    sc.add(place(mesh(box(0.26, 0.05, 0.26), '#2e2a2a', { outline: OL }), 0, 0.3, 0.4));
    sc.add(place(new THREE.Mesh(box(0.2, 0.26, 0.2), toon('#ffd27a', { emissive: '#ffae3a', emissiveIntensity: 0.9 })), 0, 0.14, 0.4));
    sc.add(place(mesh(new THREE.ConeGeometry(0.2, 0.16, 4), '#2e2a2a', { outline: OL }), 0, 0.4, 0.4, Math.PI / 4));
    sc.position.set(x, 2.25, -ROOM.d / 2 + 0.02);
    scene.add(sc);
  }
  if (assets.has('flags_banners')) {
    const f = assets.make('flags_banners', { variant: 2 }).object;
    f.scale.multiplyScalar(0.55);
    f.position.set(-ROOM.w / 2 + 0.35, 0.6, 3.0);
    f.rotation.y = Math.PI / 2;
    scene.add(f);
  }
  for (const d of ROOM.decor)
    if (assets.has('flower_pots')) {
      const p = assets.make('flower_pots', { variant: 1 }).object;
      p.position.set(d.x, 0, d.z);
      scene.add(p);
    }

  // Counter and till.
  const C = ROOM.counter;
  const counter = new THREE.Group();
  counter.add(place(mesh(box(C.w, 0.95, C.d), WOOD_DARK, { outline: OL }), 0, 0.475, 0));
  counter.add(place(mesh(box(C.w + 0.16, 0.08, C.d + 0.16), WOOD, { outline: OL }), 0, 0.99, 0));
  counter.position.set(C.x, 0, C.z);
  counter.traverse((o) => o.isMesh && ((o.castShadow = true), (o.userData.till = true)));
  scene.add(counter);
  pickables.push(counter);
  // The till: an iron-banded strongbox with the day's coins stacked beside it.
  const till = new THREE.Group();
  till.add(place(mesh(box(0.62, 0.34, 0.42), '#5a3a24', { outline: OL }), 0, 0.17, 0));
  till.add(place(mesh(box(0.66, 0.08, 0.46), '#6b4a2e', { outline: OL }), 0, 0.37, 0));
  for (const x of [-0.2, 0.2]) till.add(place(mesh(box(0.06, 0.44, 0.47), '#3b3a40'), x, 0.2, 0));
  till.add(place(mesh(box(0.1, 0.1, 0.03), '#d9a93a'), 0, 0.24, 0.225));
  for (let i = 0; i < 3; i++)
    for (let k = 0; k < 4 - i; k++) till.add(place(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 10), '#f2c14e', { mat: toon('#f2c14e', { emissive: '#a06a00', emissiveIntensity: 0.25 }) }), 0.45 + i * 0.13, 0.013 + k * 0.026, 0.05 - i * 0.04));
  till.position.set(ROOM.till.x, 1.03, ROOM.till.z);
  till.rotation.y = -Math.PI / 2;
  till.traverse((o) => (o.userData.till = true));
  scene.add(till);
  pickables.push(till);
  if (assets.has('market_goods_bottles')) {
    const b = assets.make('market_goods_bottles').object;
    b.scale.multiplyScalar(0.5);
    b.position.set(C.x, 1.03, C.z + 1.0);
    scene.add(b);
  }

  // The 8 displays.
  const fixtures = ROOM.fixtures.map((f) => {
    const g = FIXTURE[f.kind]();
    g.position.set(f.x, 0, f.z);
    g.rotation.y = f.rot;
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
      o.userData.fixture = f.slot;
    });
    scene.add(g);
    pickables.push(g);
    const goods = new THREE.Group();
    g.add(goods);
    let glow = null;
    if (f.kind === 'pedestal') {
      glow = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.02;
      g.add(glow);
    }
    return { ...f, group: g, goods, glow, item: null, qty: 0, top: f.kind === 'shelf' ? 2.1 : f.kind === 'rack' ? 1.8 : 1.3 };
  });

  const setDisplay = (slot, s) => {
    const fx = fixtures[slot];
    const item = s?.item || null;
    const qty = s?.qty || 0;
    const want = item ? copiesFor(fx.kind, qty) : 0;
    if (fx.item === item && fx.goods.children.length === want) return;
    fx.goods.clear();
    fx.item = item;
    fx.qty = qty;
    if (fx.glow) fx.glow.material.opacity = 0;
    if (!item) return;
    const A = ARRANGE[fx.kind];
    const flat = ['tool', 'gear'].includes(ITEMS[item]?.cat) && fx.kind !== 'rack' && fx.kind !== 'pedestal';
    for (let i = 0; i < want; i++) {
      const o = itemObject(item, { castShadow: !low });
      if (!o) break;
      const [x, y, z, ry] = A.at(i);
      const holder = new THREE.Group();
      holder.add(o);
      const sz = itemSize(item, o);
      const [cw, ch] = A.cell;
      const lying = flat ? Math.max(sz.x, sz.y, sz.z) : Math.max(sz.x, sz.z);
      holder.scale.setScalar(Math.min(cw / lying, ch / (flat ? Math.min(sz.x, sz.z) : sz.y)));
      holder.position.set(x, y, z);
      holder.rotation.y = ry || 0;
      if (flat) holder.rotation.x = -Math.PI / 2 + 0.25; // tools and gear lie down
      if (A.lean) holder.rotation.z = A.lean;
      holder.traverse((c) => (c.userData.fixture = slot));
      fx.goods.add(holder);
    }
    if (fx.glow) fx.glow.material.color.set(RARITY[ITEMS[item].rarity]?.color || '#ffffff'), (fx.glow.material.opacity = 0.55);
  };

  let t = 0;
  const update = (dt) => {
    t += dt;
    for (const fx of fixtures)
      if (fx.kind === 'pedestal' && fx.goods.children[0]) {
        fx.goods.children[0].rotation.y += dt * 0.4;
        fx.goods.children[0].position.y = 1.0 + Math.sin(t * 1.6) * 0.04;
      }
  };

  // Fixed 3/4 cutaway camera that fits the room width (zoomable a little).
  let zoom = 1;
  const resize = (w, h) => {
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? 52 : 40;
    camera.updateProjectionMatrix();
  };
  const aim = (followX = 0) => {
    const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const fit = Math.max(9, Math.min(18, (ROOM.w / 2 + 1) / Math.tan(hfov / 2)));
    const dist = fit * zoom;
    const portrait = camera.aspect < 1 && fit > 14;
    const cx = portrait ? Math.max(-3, Math.min(3, followX)) : 0;
    camera.position.set(cx, dist * 0.64, dist * 0.77 + 0.4);
    camera.lookAt(cx, 0.5, -0.5);
  };
  const setZoom = (z) => (zoom = Math.max(0.8, Math.min(1.25, z)));

  return { scene, camera, fixtures, pickables, setDisplay, update, resize, aim, setZoom, get zoom() { return zoom; } };
}
