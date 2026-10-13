import * as THREE from 'three';
import * as assets from './assets.js';
import { BUILDINGS, DOCKS, LAKES, PLAZAS, doorPoint, zonesOfKind, mulberry32 } from '../../../shared/world.js';

// Ambient villagers and pets. Purely decorative and client-side, but their
// routes are driven by the wall clock, so every player sees the same
// villager at the same spot at the same moment, with no network traffic.

const VILLAGERS = [
  { name: 'Farmer Bram', lines: ['Fine weather for planting!', 'Have you tried the herb garden?', 'Oak planks sell well at the market.'] },
  { name: 'Witch Hazel', lines: ['Moonbloom glows at night, you know…', 'Bring me sunpetals, dearie.', 'Potions need slime gel. Ew.'] },
  { name: 'Sir Gareth', lines: ['The Wilds grow restless.', 'A golem roams the ruins up north!', 'Defend when the beast winds up.'] },
  { name: 'Little Pip', lines: ['I saw a golden koi!!', 'Wanna race to the fountain?', 'The dock is my favourite place.'] },
  { name: 'Merchant Ola', lines: ['Buy low, sell high!', 'Check the order book before you sell.', 'The Order Board pays well for what the town needs.'] },
  { name: 'Granny Moss', lines: ['Back in my day trees were taller.', 'Perfect swings fell trees faster, dear.', 'Have a lovely day!'] },
];
const PET_LINES = ['*happy noises*', '*wiggles*', '*looks at you expectantly*', '*sniff sniff*'];

// A soft dark disc under someone who walks about.
const BLOB_GEO = new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.26, depthWrite: false });
function blob(size) {
  const m = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
  m.position.y = 0.02;
  m.scale.setScalar(Math.max(0.6, Math.max(size?.x ?? 1, size?.z ?? 1) * 0.9));
  m.renderOrder = -1;
  return m;
}

const ANIMATED = 6; // walkers animated at once
const MAX_WALKERS = 20; // in the whole world

class Walker {
  constructor(slot, variant, route, speed, seed, info) {
    const made = assets.make(slot, { variant, unique: false, castShadow: false });
    this.obj = made.object;
    this.mixer = made.mixer;
    this.walk = assets.findClip(made.actions, 'walk');
    this.idle = assets.findClip(made.actions, 'idle');
    this.cur = null;
    this.info = info;
    // Timeline: walk each leg, then pause at the stop.
    const r = mulberry32(seed);
    this.legs = [];
    let t = 0;
    for (const pts of route) {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const walkT = len / speed;
      const pause = 3 + r() * 5;
      this.legs.push({ pts, len, t0: t, walkT, pause });
      t += walkT + pause;
    }
    this.total = t;
    this.offset = r() * t;
    this.obj.traverse((o) => (o.userData.npc = this));
    this.obj.add(blob(made.size)); // they move, so a blob rather than a shadow-map shadow
  }

  setAnim(a) {
    if (!a || this.cur === a) return;
    a.reset().fadeIn(0.25).play();
    this.cur?.fadeOut(0.25);
    this.cur = a;
  }

  update(dt, now) {
    if (!this.total) return;
    const tau = (now / 1000 + this.offset) % this.total;
    let leg = this.legs[0];
    for (const l of this.legs) if (tau >= l.t0) leg = l;
    const into = tau - leg.t0;
    let x;
    let z;
    let rot = this.obj.rotation.y;
    if (into < leg.walkT && leg.len > 0) {
      // Position along the leg's polyline.
      let d = (into / leg.walkT) * leg.len;
      const p = leg.pts;
      let i = 1;
      for (; i < p.length; i++) {
        const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        if (d <= seg || i === p.length - 1) {
          const k = seg ? Math.min(1, d / seg) : 1;
          x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k;
          z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k;
          rot = Math.atan2(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
          break;
        }
        d -= seg;
      }
      this.setAnim(this.walk || this.idle);
    } else {
      const last = leg.pts[leg.pts.length - 1];
      x = last[0];
      z = last[1];
      this.setAnim(this.idle || this.walk);
    }
    this.obj.position.set(x, 0, z);
    let dr = ((rot - this.obj.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (dr < -Math.PI) dr += Math.PI * 2;
    this.obj.rotation.y += dr * Math.min(1, dt * 8);
    if (this.animate !== false) this.mixer?.update(dt);
  }
}

export class Townsfolk {
  constructor(scene, nav, { low = false } = {}) {
    this.walkers = [];
    // One group for everyone, so the town's folk can be hidden all at once (in a dungeon).
    this.root = new THREE.Group();
    scene.add(this.root);
    scene = this.root;
    // Villagers stroll between doors, plaza corners, the foot of each dock and garden edges.
    const stops = [
      ...BUILDINGS.map((b) => doorPoint(b)),
      ...PLAZAS.flatMap((p) => [[p.x + 5, p.z + 6], [p.x - 6, p.z + 5], [p.x + 6, p.z - 6], [p.x - 5, p.z - 6]]),
      ...DOCKS.map((d) => [d.x, d.z - d.d / 2 - 1.5]),
      ...zonesOfKind('garden').map((g) => [g.x + 9, g.z - 4]),
    ];
    const plan = (seq) => {
      const legs = [];
      for (let i = 0; i < seq.length; i++) {
        const a = seq[i];
        const b = seq[(i + 1) % seq.length];
        const path = nav.findPath(a[0], a[1], b[0], b[1]);
        if (!path) return null;
        legs.push([a, ...path]);
      }
      return legs;
    };
    if (assets.has('npc_villager')) {
      const r = mulberry32(2024);
      const n = Math.min(low ? 4 : 6, VILLAGERS.length);
      for (let i = 0; i < n; i++) {
        const seq = [];
        for (let k = 0; k < 4; k++) seq.push(stops[Math.floor(r() * stops.length)]);
        const route = plan(seq);
        if (!route) continue;
        const w = new Walker('npc_villager', i, route, 1.5 + r() * 0.4, 100 + i, { ...VILLAGERS[i], kind: 'villager' });
        if (this.walkers.length >= MAX_WALKERS) break;
        this.walkers.push(w);
        scene.add(w.obj);
      }
    }
    if (assets.has('npc_pet')) {
      const r = mulberry32(77);
      const homes = BUILDINGS.filter((b) => b.deco).map((b) => doorPoint(b)).concat(PLAZAS.flatMap((p) => [[p.x + 3, p.z + 8], [p.x - 8, p.z - 3]]));
      const n = low ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const [hx, hz] = homes[i % homes.length];
        const seq = [];
        for (let k = 0; k < 3; k++) {
          const a = r() * Math.PI * 2;
          const p = nav.nearestOpen(hx + Math.cos(a) * (2 + r() * 4), hz + Math.sin(a) * (2 + r() * 4));
          if (p) seq.push(p);
        }
        const route = seq.length === 3 && plan(seq);
        if (!route) continue;
        const w = new Walker('npc_pet', i, route, 1.1 + r() * 0.5, 300 + i, { name: null, lines: PET_LINES, kind: 'pet' });
        if (this.walkers.length >= MAX_WALKERS) break;
        this.walkers.push(w);
        scene.add(w.obj);
      }
    }
    const forests = zonesOfKind('forest');
    if (forests.length) this.#wild(scene, nav, 'npc_deer', forests.flatMap((f) => [[f.x - 6, f.z + 8, 7], [f.x - 10, f.z - 9, 6]]), (low ? 2 : 3) * forests.length, 900, ['*the deer flicks its ears*', '*munch munch*']);
    if (LAKES.length) this.#wild(scene, nav, 'npc_beaver', LAKES.map((l) => [l.x - 14, l.z - 6, 3]), LAKES.length, 950, ['*gnaw gnaw*', '*slaps tail*']);
  }

  // Forest deer and a lake beaver: same clockwork wandering, in their habitat.
  #wild(scene, nav, slot, anchors, count, seedBase, lines) {
    if (!assets.has(slot)) return;
    const r = mulberry32(seedBase);
    for (let i = 0; i < count; i++) {
      const [ax, az, rad] = anchors[i % anchors.length];
      const seq = [];
      for (let k = 0; k < 3; k++) {
        const a = r() * Math.PI * 2;
        const p = nav.nearestOpen(ax + Math.cos(a) * rad * r(), az + Math.sin(a) * rad * r());
        if (p) seq.push(p);
      }
      if (seq.length < 3) continue;
      const legs = [];
      let ok = true;
      for (let j = 0; j < 3 && ok; j++) {
        const path = nav.findPath(seq[j][0], seq[j][1], seq[(j + 1) % 3][0], seq[(j + 1) % 3][1]);
        if (!path) ok = false;
        else legs.push([seq[j], ...path]);
      }
      if (!ok) continue;
      if (this.walkers.length >= MAX_WALKERS) break;
      const w = new Walker(slot, 0, legs, 1.2, seedBase + i, { name: null, lines, kind: 'pet' });
      this.walkers.push(w);
      scene.add(w.obj);
    }
  }

  get objects() {
    return this.walkers.map((w) => w.obj);
  }

  // Everyone keeps walking their rounds, but only the nearest few (to
  // `focus`, where the camera looks) are animated; the rest hold a pose.
  update(dt, focus = null) {
    const now = Date.now();
    if (focus && (this.rank = (this.rank ?? 0) - dt) <= 0) {
      this.rank = 0.5;
      const d = (w) => (w.obj.position.x - focus.x) ** 2 + (w.obj.position.z - focus.z) ** 2;
      const near = [...this.walkers].sort((a, b) => d(a) - d(b)).slice(0, ANIMATED);
      for (const w of this.walkers) w.animate = near.includes(w);
    }
    for (const w of this.walkers) w.update(dt, now);
  }
}
