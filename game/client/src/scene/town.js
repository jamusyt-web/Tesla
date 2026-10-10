import * as THREE from 'three';
import { mesh, toon, shade } from './toon.js';
import {
  BUILDINGS, ZONES, GATE, FOUNTAIN, LAKE, DOCK, WORLD_RADIUS, NODE_TYPES,
  generateNodes, generateScenery, doorPoint, mulberry32,
} from '../../../shared/world.js';

const OL = 0.04;
const sph = (r, a = 14, b = 10) => new THREE.SphereGeometry(r, a, b);
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Path network: plaza → every building door and every zone.
function pathSegments() {
  const segs = [];
  for (const b of BUILDINGS) {
    const [dx, dz] = doorPoint(b);
    segs.push([0, 0, dx, dz, 1.7]);
  }
  segs.push([0, 0, GATE.x, GATE.z - 4, 2.2]);
  segs.push([GATE.x, GATE.z - 4, 0, -56, 1.6]);
  segs.push([0, 0, -36, 0, 2]);
  segs.push([0, 0, 36, 0, 2]);
  segs.push([-14, 16, -26, 36, 1.5]);
  segs.push([16, 17, DOCK.x, DOCK.z - DOCK.d / 2, 1.6]);
  return segs;
}

function distSeg(px, pz, [ax, az, bx, bz]) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

// ── Gatherable node views ────────────────────────────────────────────────
export class NodeView {
  constructor(node, fxp) {
    this.node = node;
    this.type = NODE_TYPES[node.type];
    this.fx = fxp;
    this.root = new THREE.Group();
    this.root.position.set(node.x, 0, node.z);
    this.alive = true;
    this.maxHp = this.type.hp;
    this.hp = this.maxHp;
    this.shake = 0;
    this.shakeDir = new THREE.Vector3();
    this.fall = null;
    this.grow = 0;
    this.t = Math.random() * 10;
    this.full = new THREE.Group();
    this.full.rotation.y = node.rot;
    this.full.scale.setScalar(node.s);
    this.root.add(this.full);
    this.stump = new THREE.Group();
    this.stump.scale.setScalar(node.s);
    this.stump.visible = false;
    this.root.add(this.stump);
    this.build();
    this.root.traverse((o) => {
      if (o.isMesh && o.material.side !== THREE.BackSide) {
        o.castShadow = true;
        o.userData.node = node.id;
      }
    });
  }

  get height() {
    return { tree: this.node.type === 'tree_pine' ? 6 : 4.6, rock: 2, herb: 1, fish: 0.5 }[this.type.kind] * this.node.s;
  }

  build() {
    const k = this.node.type;
    const F = this.full;
    if (k === 'tree_oak' || k === 'tree_birch') {
      const birch = k === 'tree_birch';
      const trunk = mesh(cyl(0.24, 0.36, 2.2, 9), birch ? '#f2efe6' : '#8b5a33', { outline: OL });
      trunk.position.y = 1.1;
      F.add(trunk);
      if (birch)
        for (let i = 0; i < 4; i++) {
          const mark = mesh(box(0.2, 0.06, 0.05), '#3b3b3b');
          mark.position.set(Math.sin(i * 2) * 0.2, 0.5 + i * 0.4, Math.cos(i * 2) * 0.27);
          mark.rotation.y = i * 2;
          F.add(mark);
        }
      const greens = birch ? ['#b4d965', '#9ccc54', '#c8e57a'] : ['#5fb04a', '#4f9d3f', '#6fc456'];
      const blobs = [[0, 3.1, 0, 1.35], [0.8, 2.6, 0.3, 0.95], [-0.75, 2.7, -0.2, 1.0], [0.1, 2.5, -0.8, 0.9], [-0.2, 3.8, 0.1, 0.85]];
      blobs.forEach(([x, y, z, r], i) => {
        const b = mesh(new THREE.IcosahedronGeometry(r * (birch ? 0.85 : 1), 1), greens[i % 3], { outline: OL });
        b.position.set(x, y + (birch ? 0.4 : 0), z);
        F.add(b);
      });
      if (!birch)
        for (let i = 0; i < 4; i++) {
          const ap = mesh(sph(0.12, 8, 6), '#e2574c');
          const a = i * 1.7;
          ap.position.set(Math.cos(a) * 1.2, 2.6 + (i % 2) * 0.6, Math.sin(a) * 1.2);
          F.add(ap);
        }
      this.#stump(birch ? '#f2efe6' : '#8b5a33');
    } else if (k === 'tree_pine') {
      const trunk = mesh(cyl(0.28, 0.42, 1.6, 9), '#6b4226', { outline: OL });
      trunk.position.y = 0.8;
      F.add(trunk);
      const tiers = [[2.0, 1.9, 2.0], [3.2, 1.55, 1.8], [4.3, 1.15, 1.6], [5.25, 0.75, 1.3]];
      tiers.forEach(([y, r, h], i) => {
        const c = mesh(new THREE.ConeGeometry(r, h, 9), i % 2 ? '#2f7d4f' : '#3a8f5c', { outline: OL });
        c.position.y = y;
        F.add(c);
        const snow = mesh(new THREE.ConeGeometry(r * 0.45, h * 0.3, 9), '#e9f6ff');
        snow.position.y = y + h * 0.36;
        if (i === 3) F.add(snow);
      });
      this.#stump('#6b4226');
    } else if (k.startsWith('rock_')) {
      const ore = { rock_stone: null, rock_copper: '#e07b39', rock_iron: '#c9d3df', rock_gold: '#ffd23f' }[k];
      const base = { rock_stone: '#9c9a94', rock_copper: '#8e8578', rock_iron: '#7c7f86', rock_gold: '#6f6a64' }[k];
      const geo = new THREE.IcosahedronGeometry(1.1, 0);
      const r = mulberry32(this.node.id.length * 97 + this.node.x * 13);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + r() * 0.3), pos.getY(i) * (0.75 + r() * 0.2), pos.getZ(i) * (0.85 + r() * 0.3));
      geo.computeVertexNormals();
      const rock = mesh(geo, base, { outline: OL, mat: toon(base, { flatShading: true }) });
      rock.position.y = 0.6;
      F.add(rock);
      const top = mesh(new THREE.IcosahedronGeometry(0.55, 0), shade(base, 1.15), { outline: OL, mat: toon(shade(base, 1.15), { flatShading: true }) });
      top.position.set(0.3, 1.3, -0.1);
      F.add(top);
      if (ore) {
        const om = toon(ore, { flatShading: true, emissive: ore, emissiveIntensity: k === 'rock_gold' ? 0.35 : 0.12 });
        for (let i = 0; i < 6; i++) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.17 + r() * 0.1), om);
          const a = r() * Math.PI * 2;
          c.position.set(Math.cos(a) * 0.95, 0.4 + r() * 0.9, Math.sin(a) * 0.95);
          c.rotation.set(r() * 3, r() * 3, 0);
          F.add(c);
        }
      }
      for (let i = 0; i < 3; i++) {
        const peb = mesh(new THREE.IcosahedronGeometry(0.22, 0), base, { mat: toon(base, { flatShading: true }) });
        peb.position.set(Math.cos(i * 2.1) * 0.8, 0.12, Math.sin(i * 2.1) * 0.8);
        peb.scale.y = 0.6;
        this.stump.add(peb);
      }
    } else if (k.startsWith('herb_')) {
      const leaf = k === 'herb_moon' ? '#5a7f6a' : '#4fae4f';
      for (let i = 0; i < 5; i++) {
        const l = mesh(sph(0.22, 8, 6), leaf, { outline: 0.02 });
        l.scale.set(0.5, 0.25, 1);
        const a = (i / 5) * Math.PI * 2;
        l.position.set(Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2);
        l.rotation.y = -a;
        l.rotation.z = 0.5;
        F.add(l);
      }
      const flower = { herb_mint: '#ffffff', herb_sun: '#ffcf3f', herb_moon: '#b78cff' }[k];
      const fm = toon(flower, { emissive: k === 'herb_moon' ? '#8f5cff' : '#000', emissiveIntensity: k === 'herb_moon' ? 0.6 : 0 });
      const heads = k === 'herb_mint' ? 5 : 3;
      for (let i = 0; i < heads; i++) {
        const stem = mesh(cyl(0.02, 0.02, 0.5, 4), '#3f8f3f');
        const a = (i / heads) * Math.PI * 2;
        stem.position.set(Math.cos(a) * 0.1, 0.35, Math.sin(a) * 0.1);
        const head = new THREE.Mesh(sph(k === 'herb_mint' ? 0.07 : 0.13, 8, 6), fm);
        head.position.set(Math.cos(a) * 0.1, 0.62, Math.sin(a) * 0.1);
        F.add(stem, head);
      }
      const sprout = mesh(sph(0.1, 6, 5), leaf);
      sprout.position.y = 0.06;
      sprout.scale.y = 0.5;
      this.stump.add(sprout);
    } else if (k === 'fish_spot') {
      this.rings = [];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        F.add(ring);
        this.rings.push(ring);
      }
      // Invisible pick target so the spot is easy to tap.
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.1;
      F.add(hit);
    }
  }

  #stump(color) {
    const s = mesh(cyl(0.32, 0.4, 0.45, 10), color, { outline: OL });
    s.position.y = 0.22;
    const ring = mesh(cyl(0.3, 0.3, 0.02, 10), '#e8c48e');
    ring.position.y = 0.46;
    const sprout = mesh(sph(0.1, 6, 5), '#6fc456');
    sprout.position.set(0.15, 0.52, 0);
    this.stump.add(s, ring, sprout);
  }

  setHp(hp) {
    this.hp = hp;
  }

  // Someone swung at it. `from` = hitter position.
  hit(from, perfect, dmg) {
    const p = this.root.position;
    this.shakeDir.set(p.x - from.x, 0, p.z - from.z).normalize();
    this.shake = perfect ? 1.4 : 1;
    const kind = this.type.kind;
    const impact = new THREE.Vector3(p.x - this.shakeDir.x * 0.5, kind === 'tree' ? 1.2 : 0.8, p.z - this.shakeDir.z * 0.5);
    const out = this.shakeDir.clone().multiplyScalar(-1);
    if (kind === 'tree') {
      this.fx.burst(impact, { n: perfect ? 22 : 12, color: ['#c98a4b', '#e3b07a', '#8b5a33'], speed: 5, up: 4, size: 0.16, dir: out });
      const leafCol = this.node.type === 'tree_birch' ? '#b4d965' : this.node.type === 'tree_pine' ? '#3a8f5c' : '#5fb04a';
      this.fx.burst(new THREE.Vector3(p.x, 3, p.z), { n: perfect ? 14 : 7, color: [leafCol, shade(leafCol, 1.2)], speed: 1.5, up: 0.5, gravity: 2, drag: 2, size: 0.2, flat: true, life: 1.6, jitter: 2, spin: 6 });
    } else if (kind === 'rock') {
      const ore = { rock_copper: '#e07b39', rock_iron: '#c9d3df', rock_gold: '#ffd23f' }[this.node.type] || '#bbb8b0';
      this.fx.burst(impact, { n: perfect ? 22 : 12, color: ['#9c9a94', '#c8c5bd', ore], speed: 5, up: 5, size: 0.15, dir: out });
      this.fx.burst(impact, { n: perfect ? 10 : 4, color: ['#fff3a0', '#ffd84a'], speed: 7, up: 5, size: 0.07, life: 0.4, gravity: 6 });
    }
    if (perfect) this.fx.burst(impact, { n: 14, color: ['#ffe066', '#fff6c2'], speed: 6, up: 6, size: 0.1, life: 0.7, gravity: 4 });
  }

  // Node broke: tree topples away from the finisher, rocks shatter, herbs pop.
  break(from) {
    this.alive = false;
    const p = this.root.position;
    const kind = this.type.kind;
    if (kind === 'tree') {
      const dir = new THREE.Vector3(p.x - from.x, 0, p.z - from.z).normalize();
      this.fall = { t: 0, axis: new THREE.Vector3(dir.z, 0, -dir.x), dir };
      this.stump.visible = true;
    } else {
      this.full.visible = false;
      this.stump.visible = true;
      const c = kind === 'rock' ? ['#9c9a94', '#c8c5bd', '#7c7f86'] : ['#4fae4f', '#9be37a', '#ffffff'];
      this.fx.burst(new THREE.Vector3(p.x, 0.8, p.z), { n: kind === 'rock' ? 30 : 14, color: c, speed: 6, up: 6, size: kind === 'rock' ? 0.3 : 0.12, life: 1.1 });
      this.fx.puff.burst(new THREE.Vector3(p.x, 0.3, p.z), { n: 10, color: ['#f1ebdd', '#e2d9c4'], speed: 2, up: 1.5, gravity: 1, size: 0.6, life: 0.8, drag: 3 });
    }
  }

  respawn() {
    this.alive = true;
    this.fall = null;
    this.full.visible = true;
    this.full.rotation.set(0, this.node.rot, 0);
    this.full.position.set(0, 0, 0);
    this.stump.visible = false;
    this.grow = 0.001;
    this.hp = this.maxHp;
  }

  update(dt) {
    this.t += dt;
    const F = this.full;
    if (this.fall) {
      const f = this.fall;
      f.t += dt;
      const k = Math.min(1, f.t / 0.9);
      const ang = (Math.PI / 2 - 0.08) * k * k; // accelerate like a real fall
      F.quaternion.setFromAxisAngle(f.axis, ang);
      F.rotateY(this.node.rot);
      if (k >= 1 && !f.landed) {
        f.landed = true;
        const p = this.root.position;
        const land = new THREE.Vector3(p.x + f.dir.x * 2.8, 0.3, p.z + f.dir.z * 2.8);
        this.fx.puff.burst(land, { n: 22, color: ['#f1ebdd', '#e2d9c4', '#d6ccb4'], speed: 4, up: 2, gravity: 2, size: 0.8, life: 1, drag: 2.5 });
        this.fx.burst(land, { n: 16, color: ['#5fb04a', '#8bcf5a'], speed: 3, up: 3, gravity: 3, size: 0.2, life: 1.4, flat: true });
        this.onLand?.();
      }
      if (f.t > 1.6) {
        const s = Math.max(0, 1 - (f.t - 1.6) / 0.5);
        F.scale.setScalar(this.node.s * s);
        if (s <= 0) {
          F.visible = false;
          F.scale.setScalar(this.node.s);
          this.fall = null;
        }
      }
      return;
    }
    if (this.grow > 0) {
      this.grow = Math.min(1, this.grow + dt * 1.8);
      const g = this.grow;
      const el = g >= 1 ? 1 : 1 - Math.pow(2, -10 * g) * Math.cos(g * 10);
      F.scale.setScalar(this.node.s * el);
      if (g >= 1) this.grow = 0;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 3.5);
      const w = Math.sin(this.t * 40) * 0.09 * this.shake;
      F.rotation.x = this.shakeDir.z * w;
      F.rotation.z = -this.shakeDir.x * w;
      if (this.type.kind === 'rock') F.position.x = Math.sin(this.t * 60) * 0.05 * this.shake;
    } else if (this.type.kind === 'tree') {
      F.rotation.z = Math.sin(this.t * 1.2 + this.node.x) * 0.012;
    }
    if (this.rings) {
      this.rings.forEach((r, i) => {
        const k = (this.t * 0.5 + i / 3) % 1;
        r.scale.setScalar(0.4 + k * 1.6);
        r.material.opacity = 0.7 * (1 - k);
      });
    }
  }
}

// ── Town builder ─────────────────────────────────────────────────────────
export function buildTown(scene, fx, { low = false } = {}) {
  const pickables = [];
  const animated = [];
  const labels = [];
  const rng = mulberry32(99);
  const segs = pathSegments();
  const fades = [];

  // Sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#5fb8f0') }, mid: { value: new THREE.Color('#a9dcf7') }, bot: { value: new THREE.Color('#fde7c4') } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  scene.add(sky);
  animated.push((dt, t, cam) => sky.position.copy(cam.position));

  // Ocean
  const ocean = new THREE.Mesh(new THREE.CircleGeometry(420, 48), toon('#4fb7e6', { emissive: '#1d6f9a', emissiveIntensity: 0.15 }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -2.2;
  ocean.receiveShadow = false;
  scene.add(ocean);
  animated.push((dt, t) => (ocean.position.y = -2.2 + Math.sin(t * 0.8) * 0.08));

  // Ground: vertex-colored terrain with paths, zone tints, sandy shore, cliff falloff.
  const SIZE = 236;
  const SEG = low ? 150 : 210;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color('#8fd16a');
  const grass2 = new THREE.Color('#7cc25c');
  const path = new THREE.Color('#e9d2a0');
  const plaza = new THREE.Color('#dcc9a6');
  const sand = new THREE.Color('#f3dfa6');
  const cliff = new THREE.Color('#b98e5c');
  const zoneCols = ZONES.map((z) => new THREE.Color(z.ground));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.07 + z * 0.11) * 0.6;
    c.copy(grass).lerp(grass2, 0.5 + n * 0.25);
    ZONES.forEach((zn, k) => {
      const d = Math.hypot(x - zn.x, z - zn.z);
      const w = 1 - smooth(zn.r - 4, zn.r + 3, d);
      if (w > 0) c.lerp(zoneCols[k], w * 0.75);
    });
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r + 3.5) c.lerp(sand, 1 - smooth(LAKE.r + 1, LAKE.r + 3.5, dl));
    let pd = Infinity;
    for (const s of segs) pd = Math.min(pd, distSeg(x, z, s) - s[4]);
    if (pd < 0.6) c.lerp(path, 1 - smooth(-0.4, 0.6, pd));
    if (r < 12) c.lerp(plaza, 1 - smooth(10.5, 12, r));
    let y = 0;
    if (r > WORLD_RADIUS + 1) {
      const k = smooth(WORLD_RADIUS + 1, WORLD_RADIUS + 9, r);
      c.lerp(r < WORLD_RADIUS + 5 ? sand : cliff, Math.min(1, k * 2));
      y = -k * 5 + Math.sin(x * 0.3 + z * 0.2) * 0.3 * k;
    } else {
      y = r > 14 ? (Math.sin(x * 0.13) * Math.cos(z * 0.11)) * 0.12 : 0;
    }
    if (dl < LAKE.r) y = -0.7 * (1 - dl / LAKE.r) - 0.05;
    pos.setY(i, y);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon('#fff').gradientMap }));
  ground.receiveShadow = true;
  ground.userData.ground = true;
  scene.add(ground);
  pickables.push(ground);

  // Plaza: concentric paving rings, plus sparse stepping stones along paths.
  {
    const rings = [[0, 11.2, '#e6d8b8'], [10.4, 11.2, '#c9b48c'], [6.2, 6.9, '#d4c29d'], [3.6, 4.2, '#d4c29d']];
    rings.forEach(([a, b, col], i) => {
      const m = new THREE.Mesh(a ? new THREE.RingGeometry(a, b, 64) : new THREE.CircleGeometry(b, 64), toon(col));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02 + i * 0.004;
      m.receiveShadow = true;
      scene.add(m);
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3.4), toon('#d4c29d'));
      spoke.rotation.x = -Math.PI / 2;
      spoke.rotation.z = -a;
      spoke.position.set(Math.cos(a) * 8.6, 0.035, Math.sin(a) * 8.6);
      spoke.receiveShadow = true;
      scene.add(spoke);
    }
    const stones = [];
    for (const s of segs) {
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (len < 4) continue;
      for (let i = 0; i < len * (low ? 0.5 : 0.9); i++) {
        const t = rng();
        const off = (rng() - 0.5) * s[4] * 1.4;
        const nx = -(s[3] - s[1]) / len;
        const nz = (s[2] - s[0]) / len;
        const x = s[0] + (s[2] - s[0]) * t + nx * off;
        const z = s[1] + (s[3] - s[1]) * t + nz * off;
        if (Math.hypot(x, z) < 11.5) continue;
        stones.push([x, z]);
      }
    }
    const geo = cyl(0.36, 0.4, 0.06, 7);
    const im = new THREE.InstancedMesh(geo, toon('#ffffff'), stones.length);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    stones.forEach(([x, z], i) => {
      o.position.set(x, 0.03, z);
      o.rotation.y = rng() * 3;
      const sc = 0.6 + rng() * 0.6;
      o.scale.set(sc, 1, sc * (0.7 + rng() * 0.4));
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, col.set(['#efe2c4', '#e2d1ad', '#f3e8d0'][i % 3]));
    });
    im.receiveShadow = true;
    scene.add(im);
  }

  // Grass tufts (instanced cones).
  {
    const tufts = [];
    for (let i = 0; i < (low ? 1200 : 3000); i++) {
      const a = rng() * Math.PI * 2;
      const d = 12 + Math.sqrt(rng()) * (WORLD_RADIUS - 13);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (BUILDINGS.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1)) continue;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2) continue;
      if (segs.some((s) => distSeg(x, z, s) < s[4] + 0.4)) continue;
      tufts.push([x, z]);
    }
    const geo = new THREE.ConeGeometry(0.12, 0.5, 4);
    geo.translate(0, 0.25, 0);
    const im = new THREE.InstancedMesh(geo, toon('#ffffff'), tufts.length * 3);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    let k = 0;
    for (const [x, z] of tufts)
      for (let j = 0; j < 3; j++) {
        o.position.set(x + (rng() - 0.5) * 0.4, 0, z + (rng() - 0.5) * 0.4);
        o.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
        o.scale.setScalar(0.6 + rng() * 0.9);
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
        const wild = z < -40;
        im.setColorAt(k++, col.set(wild ? ['#5c9a45', '#4e8a3b', '#6aa84f'][j] : ['#79c95a', '#6abb4d', '#8fd96a'][j]));
      }
    scene.add(im);
  }

  // Flowers
  const scenery = generateScenery();
  {
    const fl = scenery.flowers;
    const geo = sph(0.13, 6, 5);
    const im = new THREE.InstancedMesh(geo, toon('#ffffff'), fl.length);
    const stem = new THREE.InstancedMesh(cyl(0.02, 0.02, 0.3, 4), toon('#4f9d3f'), fl.length);
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    const pal = ['#ff7aa2', '#ffd84a', '#ffffff', '#b78cff', '#ff9f5a'];
    fl.forEach((f, i) => {
      o.position.set(f.x, 0.3 * f.s, f.z);
      o.scale.setScalar(f.s);
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, col.set(pal[f.c]));
      o.position.y = 0.15 * f.s;
      o.updateMatrix();
      stem.setMatrixAt(i, o.matrix);
    });
    scene.add(im, stem);
  }

  // Decorative trees (instanced).
  {
    const round = scenery.trees.filter((t) => t.kind === 'round');
    const pine = scenery.trees.filter((t) => t.kind === 'pine');
    const o = new THREE.Object3D();
    const trunkR = new THREE.InstancedMesh(cyl(0.3, 0.42, 2.2, 7), toon('#8b5a33'), round.length + pine.length);
    const leafR = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 1), toon('#ffffff'), round.length * 2);
    const leafP = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 2.4, 8), toon('#ffffff'), pine.length * 3);
    const col = new THREE.Color();
    let ti = 0;
    let li = 0;
    let pi = 0;
    for (const t of [...round, ...pine]) {
      o.rotation.set(0, rng() * 6, 0);
      o.position.set(t.x, 1.1 * t.s, t.z);
      o.scale.setScalar(t.s);
      o.updateMatrix();
      trunkR.setMatrixAt(ti++, o.matrix);
      if (t.kind === 'round') {
        for (let j = 0; j < 2; j++) {
          o.position.set(t.x + (j ? 0.6 : 0) * t.s, (3 + j * 0.3) * t.s, t.z + (j ? 0.4 : 0) * t.s);
          o.scale.setScalar(t.s * (j ? 0.75 : 1.05));
          o.updateMatrix();
          leafR.setMatrixAt(li, o.matrix);
          leafR.setColorAt(li++, col.set(['#5fb04a', '#6fc456', '#4f9d3f'][(li + j) % 3]));
        }
      } else {
        for (let j = 0; j < 3; j++) {
          o.position.set(t.x, (2.4 + j * 1.15) * t.s, t.z);
          o.scale.setScalar(t.s * (1 - j * 0.25));
          o.updateMatrix();
          leafP.setMatrixAt(pi, o.matrix);
          leafP.setColorAt(pi++, col.set(j % 2 ? '#2f7d4f' : '#3a8f5c'));
        }
      }
    }
    for (const im of [trunkR, leafR, leafP]) {
      im.castShadow = true;
      scene.add(im);
    }
  }

  // ── Buildings
  const buildingMeshes = [];
  for (const b of BUILDINGS) {
    const grp = buildHouse(b, rng);
    scene.add(grp);
    const mats = [];
    const outlines = [];
    grp.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.side === THREE.BackSide) outlines.push(o);
      else {
        o.material = o.material.clone();
        mats.push(o.material);
      }
    });
    grp.updateMatrixWorld(true);
    fades.push({ box: new THREE.Box3().setFromObject(grp), mats, outlines, op: 1 });
    grp.traverse((o) => {
      if (o.isMesh) o.userData.building = b.id;
    });
    if (!b.deco) {
      pickables.push(grp);
      labels.push({ kind: 'place', id: b.id, text: b.label, icon: b.icon, pos: new THREE.Vector3(b.x, grp.userData.top + 0.9, b.z) });
    }
    buildingMeshes.push(grp);
    if (grp.userData.smoke) animated.push((dt, t) => {
      if (Math.random() < dt * 2.5) fx.puff.burst(grp.userData.smoke, { n: 1, color: ['#f4f4f4', '#e2e2e2'], speed: 0.25, up: 0.9, gravity: -0.5, size: 0.55, life: 2.6, drag: 0.6, jitter: 0.15, spin: 0 });
    });
  }

  // Wilds gate
  {
    const grp = new THREE.Group();
    grp.position.set(GATE.x, 0, GATE.z);
    for (const s of [-1, 1]) {
      const pillar = mesh(box(1.4, 5, 1.4), '#b3aa9c', { outline: OL });
      pillar.position.set((GATE.width / 2) * s, 2.5, 0);
      const cap = mesh(box(1.8, 0.5, 1.8), '#9c9284', { outline: OL });
      cap.position.set((GATE.width / 2) * s, 5.2, 0);
      const torch = mesh(cyl(0.08, 0.1, 0.6, 6), '#6b4226');
      torch.position.set((GATE.width / 2 - 0.9) * s, 3.2, 0.75);
      const flame = new THREE.Mesh(sph(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb340' }));
      flame.position.set((GATE.width / 2 - 0.9) * s, 3.65, 0.75);
      animated.push((dt, t) => flame.scale.setScalar(1 + Math.sin(t * 13 + s) * 0.18));
      grp.add(pillar, cap, torch, flame);
    }
    const beam = mesh(box(GATE.width + 2.4, 0.9, 1.0), '#8b5a33', { outline: OL });
    beam.position.y = 5.9;
    const roof = mesh(new THREE.ConeGeometry(1, 1, 4), '#c4534a', { outline: OL });
    roof.scale.set(GATE.width * 0.75, 1.1, 1.4);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 6.9;
    const banner = mesh(box(1.8, 1.4, 0.08), '#c4534a', { outline: 0.02 });
    banner.position.set(0, 4.8, 0.55);
    grp.add(beam, roof, banner);
    scene.add(grp);
    labels.push({ kind: 'place', id: 'gate', text: GATE.label, icon: GATE.icon, pos: new THREE.Vector3(GATE.x, 8.3, GATE.z) });
  }

  // Fountain
  {
    const grp = new THREE.Group();
    const rim = mesh(cyl(FOUNTAIN.r, FOUNTAIN.r + 0.2, 0.7, 24), '#c9c1b2', { outline: OL });
    rim.position.y = 0.35;
    const water = new THREE.Mesh(cyl(FOUNTAIN.r - 0.3, FOUNTAIN.r - 0.3, 0.1, 24), toon('#6fd0f5', { emissive: '#3aa8de', emissiveIntensity: 0.25 }));
    water.position.y = 0.62;
    const pillar = mesh(cyl(0.35, 0.5, 2.2, 10), '#c9c1b2', { outline: OL });
    pillar.position.y = 1.4;
    const bowl = mesh(cyl(1.2, 0.5, 0.45, 14), '#c9c1b2', { outline: OL });
    bowl.position.y = 2.5;
    const top = mesh(sph(0.35), '#ffd84a', { outline: OL });
    top.position.y = 3.0;
    grp.add(rim, water, pillar, bowl, top);
    scene.add(grp);
    const spout = new THREE.Vector3(0, 3.1, 0);
    animated.push((dt) => {
      if (Math.random() < dt * 30) fx.puff.burst(spout, { n: 1, color: ['#bfeaff', '#ffffff', '#8fd8ff'], speed: 1.6, up: 3, gravity: 9, size: 0.16, life: 0.75, jitter: 0.1 });
    });
  }

  // Lake + dock + reeds + lily pads
  {
    const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 0.6, 48), new THREE.MeshToonMaterial({ color: '#5cc4ee', transparent: true, opacity: 0.88, emissive: '#2b8fc4', emissiveIntensity: 0.2 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, -0.12, LAKE.z);
    water.userData.water = true;
    scene.add(water);
    pickables.push(water);
    animated.push((dt, t) => (water.material.emissiveIntensity = 0.18 + Math.sin(t * 1.3) * 0.05));
    const dock = new THREE.Group();
    const planks = Math.round(DOCK.d / 0.6);
    for (let i = 0; i < planks; i++) {
      const p = mesh(box(DOCK.w + 0.4, 0.15, 0.52), i % 2 ? '#b98552' : '#a8763f', { outline: 0.02 });
      p.position.set(DOCK.x, 0.25, DOCK.z - DOCK.d / 2 + 0.3 + i * 0.6);
      dock.add(p);
    }
    for (const sx of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const post = mesh(cyl(0.12, 0.12, 1.6, 6), '#7c4a2c', { outline: 0.02 });
        post.position.set(DOCK.x + (DOCK.w / 2 + 0.15) * sx, 0.2, DOCK.z - DOCK.d / 2 + 1 + i * (DOCK.d / 3.3));
        dock.add(post);
      }
    scene.add(dock);
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const d = LAKE.r - 0.4 + rng() * 1.2;
      const x = LAKE.x + Math.cos(a) * d;
      const z = LAKE.z + Math.sin(a) * d;
      if (Math.abs(x - DOCK.x) < 3 && z < LAKE.z) continue;
      const reed = mesh(cyl(0.03, 0.04, 1.4, 4), '#5f9e4f');
      reed.position.set(x, 0.5, z);
      const cat = mesh(new THREE.CapsuleGeometry(0.07, 0.25, 3, 6), '#7c4a2c');
      cat.position.set(x, 1.25, z);
      scene.add(reed, cat);
    }
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2;
      const d = 3 + rng() * (LAKE.r - 5);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.5 + rng() * 0.3, 12, 0.3, Math.PI * 1.8), toon('#4fae4f'));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(LAKE.x + Math.cos(a) * d, -0.05, LAKE.z + Math.sin(a) * d);
      scene.add(pad);
      if (i % 3 === 0) {
        const fl = mesh(sph(0.14, 8, 6), '#ff9fc4');
        fl.position.set(pad.position.x, 0.05, pad.position.z);
        scene.add(fl);
      }
    }
  }

  // Lamp posts along the main paths
  {
    const lamps = [];
    for (const s of segs.slice(0, 6)) {
      const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (len < 8) continue;
      const t = 0.55;
      const nx = -(s[3] - s[1]) / len;
      const nz = (s[2] - s[0]) / len;
      lamps.push([s[0] + (s[2] - s[0]) * t + nx * (s[4] + 0.9), s[1] + (s[3] - s[1]) * t + nz * (s[4] + 0.9)]);
    }
    for (const [x, z] of lamps) {
      const post = mesh(cyl(0.1, 0.14, 3, 6), '#4a4a5a', { outline: 0.02 });
      post.position.set(x, 1.5, z);
      const lantern = new THREE.Mesh(box(0.4, 0.5, 0.4), toon('#fff1b0', { emissive: '#ffcf5a', emissiveIntensity: 0.8 }));
      lantern.position.set(x, 3.2, z);
      const cap = mesh(new THREE.ConeGeometry(0.35, 0.3, 4), '#4a4a5a');
      cap.position.set(x, 3.6, z);
      cap.rotation.y = Math.PI / 4;
      scene.add(post, lantern, cap);
    }
  }

  // Zone dressing + signposts
  for (const zn of ZONES) {
    const sign = new THREE.Group();
    const dx = -zn.x;
    const dz = -zn.z;
    const d = Math.hypot(dx, dz);
    const sx = zn.x + (dx / d) * (zn.r - 1);
    const sz = zn.z + (dz / d) * (zn.r - 1);
    sign.position.set(sx, 0, sz);
    const post = mesh(cyl(0.1, 0.12, 2, 6), '#7c4a2c', { outline: 0.02 });
    post.position.y = 1;
    const board = mesh(box(1.8, 0.7, 0.12), '#d9a066', { outline: 0.025 });
    board.position.y = 1.9;
    sign.add(post, board);
    sign.lookAt(0, 0, 0);
    scene.add(sign);
    labels.push({ kind: 'zone', id: zn.id, text: `${zn.icon} ${zn.label}`, pos: new THREE.Vector3(zn.x, 0.5, zn.z) });
  }
  // Quarry: mine cart + rails
  {
    const q = ZONES[1];
    const cart = new THREE.Group();
    const tub = mesh(box(1.4, 0.8, 1), '#7c5530', { outline: OL });
    tub.position.y = 0.7;
    const ore = mesh(new THREE.IcosahedronGeometry(0.45, 0), '#e07b39', { mat: toon('#e07b39', { flatShading: true }) });
    ore.position.y = 1.1;
    cart.add(tub, ore);
    for (const [x, z] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45]]) {
      const w = mesh(cyl(0.22, 0.22, 0.1, 10), '#3b3b3b');
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.25, z);
      cart.add(w);
    }
    cart.position.set(q.x - 14, 0, q.z + 9);
    cart.rotation.y = 0.6;
    scene.add(cart);
  }
  // Forest: mushrooms and logs
  {
    const f = ZONES[0];
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * f.r;
      const x = f.x + Math.cos(a) * d;
      const z = f.z + Math.sin(a) * d;
      const stem = mesh(cyl(0.07, 0.09, 0.3, 6), '#f4ead6');
      stem.position.set(x, 0.15, z);
      const capM = mesh(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), i % 3 ? '#e2574c' : '#b78cff', { outline: 0.02 });
      capM.position.set(x, 0.28, z);
      scene.add(stem, capM);
    }
  }
  // Wilds: standing stones
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = mesh(box(0.9, 2.4 + rng(), 0.7), '#9a9488', { outline: OL, mat: toon('#9a9488', { flatShading: true }) });
    st.position.set(Math.cos(a) * 9, 1.1, -86 + Math.sin(a) * 9);
    st.rotation.set((rng() - 0.5) * 0.2, rng() * 3, (rng() - 0.5) * 0.2);
    scene.add(st);
  }

  // Clouds
  for (let i = 0; i < 14; i++) {
    const cg = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const p = new THREE.Mesh(sph(2 + rng() * 2, 10, 8), toon('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.35 }));
      p.position.set(j * 2.6 - 4, rng() * 1.2, rng() * 2);
      p.scale.y = 0.6;
      cg.add(p);
    }
    cg.position.set((rng() - 0.5) * 300, 34 + rng() * 14, (rng() - 0.5) * 300);
    const sp = 1 + rng() * 2;
    scene.add(cg);
    animated.push((dt) => {
      cg.position.x += sp * dt;
      if (cg.position.x > 170) cg.position.x = -170;
    });
  }

  // Butterflies around the garden and plaza
  for (let i = 0; i < 10; i++) {
    const bf = new THREE.Group();
    const col = ['#ff9fc4', '#ffd84a', '#9fd8ff', '#ffffff'][i % 4];
    const wm = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
    const wings = [-1, 1].map((s) => {
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.14, 8), wm);
      w.position.x = 0.12 * s;
      const p = new THREE.Group();
      p.add(w);
      bf.add(p);
      return p;
    });
    const home = i < 6 ? ZONES[2] : { x: 0, z: 0 };
    const ph = rng() * 10;
    const r = 4 + rng() * 5;
    scene.add(bf);
    animated.push((dt, t) => {
      const a = t * 0.3 + ph;
      bf.position.set(home.x + Math.cos(a) * r, 1.2 + Math.sin(t * 2 + ph) * 0.4, home.z + Math.sin(a * 1.3) * r);
      bf.rotation.y = -a;
      wings[0].rotation.y = Math.sin(t * 25) * 1.1;
      wings[1].rotation.y = -Math.sin(t * 25) * 1.1;
    });
  }

  // ── Gatherable nodes
  const nodes = new Map();
  for (const n of generateNodes()) {
    const v = new NodeView(n, fx);
    nodes.set(n.id, v);
    scene.add(v.root);
    pickables.push(v.root);
  }

  return {
    pickables,
    nodes,
    labels,
    fades,
    update(dt, t, cam) {
      for (const a of animated) a(dt, t, cam);
      for (const n of nodes.values()) n.update(dt);
    },
  };
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function gableRoof(w, d, h, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - 0.5, 0);
  shape.lineTo(0, h);
  shape.lineTo(w / 2 + 0.5, 0);
  shape.lineTo(-w / 2 - 0.5, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
  geo.translate(0, 0, -(d + 1) / 2);
  return mesh(geo, color, { outline: OL, mat: toon(color, { flatShading: true }) });
}

function buildHouse(b, rng) {
  const grp = new THREE.Group();
  grp.position.set(b.x, 0, b.z);
  // Model faces +z; rotate so the door faces the building's `face` direction.
  const faceRot = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[b.face || 's'];
  const inner = new THREE.Group();
  inner.rotation.y = faceRot;
  grp.add(inner);
  const swap = b.face === 'e' || b.face === 'w';
  const W = swap ? b.d : b.w;
  const D = swap ? b.w : b.d;
  const H = b.id === 'townhall' ? 4.6 : b.deco ? 3.2 : 3.8;

  if (b.id === 'market') {
    // Open-air market pavilion with a striped canopy and stalls.
    const deck = mesh(box(W, 0.3, D), '#c9a374', { outline: OL });
    deck.position.y = 0.15;
    inner.add(deck);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = mesh(cyl(0.18, 0.22, 4.2, 8), '#8b5a33', { outline: OL });
      post.position.set((x * W) / 2 - x * 0.4, 2.1, (z * D) / 2 - z * 0.4);
      inner.add(post);
    }
    const stripes = 10;
    for (let i = 0; i < stripes; i++) {
      const seg = mesh(new THREE.ConeGeometry(1, 1, stripes, 1, true, (i / stripes) * Math.PI * 2, (Math.PI * 2) / stripes), i % 2 ? '#ffffff' : b.roof, { mat: toon(i % 2 ? '#fff7ea' : b.roof, { side: THREE.DoubleSide }) });
      seg.scale.set(W * 0.78, 2.4, D * 0.78);
      seg.position.y = 5.3;
      inner.add(seg);
    }
    const flag = mesh(cyl(0.05, 0.05, 1.4, 5), '#6b4226');
    flag.position.y = 7;
    const cloth = mesh(box(0.9, 0.5, 0.04), '#ffd84a');
    cloth.position.set(0.45, 7.4, 0);
    inner.add(flag, cloth);
    const goods = ['#e2574c', '#ffd84a', '#7ed957', '#ff9f5a', '#b78cff'];
    for (let i = 0; i < 3; i++) {
      const stall = mesh(box(2.2, 1, 1.1), '#b98552', { outline: OL });
      stall.position.set(-3 + i * 3, 0.8, 0.4);
      inner.add(stall);
      for (let j = 0; j < 4; j++) {
        const g = mesh(sph(0.22, 8, 6), goods[(i + j) % 5]);
        g.position.set(-3.7 + i * 3 + j * 0.45, 1.45, 0.4 + (j % 2) * 0.2);
        inner.add(g);
      }
    }
    const board = mesh(box(2.6, 1.7, 0.15), '#7c4a2c', { outline: OL });
    board.position.set(0, 1.6, -D / 2 + 0.6);
    const paper = mesh(box(2.2, 1.3, 0.05), '#fff7ea');
    paper.position.set(0, 1.6, -D / 2 + 0.7);
    inner.add(board, paper);
    grp.userData.top = 7.6;
    return grp;
  }

  const walls = mesh(box(W, H, D), b.color, { outline: OL });
  walls.position.y = H / 2;
  walls.receiveShadow = true;
  inner.add(walls);
  const trim = mesh(box(W + 0.15, 0.35, D + 0.15), '#8b5a33', { outline: 0 });
  trim.position.y = 0.17;
  inner.add(trim);
  for (const sx of [-1, 1]) {
    const beam = mesh(box(0.25, H, 0.25), '#8b5a33');
    beam.position.set((sx * W) / 2, H / 2, D / 2);
    inner.add(beam);
  }
  const roofH = b.id === 'townhall' ? 3 : 2.4;
  const roof = gableRoof(D, W, roofH, b.roof);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = H;
  inner.add(roof);
  // Door
  const door = mesh(box(1.3, 2.1, 0.15), '#7c4a2c', { outline: 0.025 });
  door.position.set(0, 1.05, D / 2 + 0.05);
  const knob = mesh(sph(0.07, 6, 5), '#ffd84a');
  knob.position.set(0.4, 1.05, D / 2 + 0.15);
  const arch = mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 12, 1, false, 0, Math.PI), '#7c4a2c');
  arch.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  arch.position.set(0, 2.1, D / 2 + 0.05);
  inner.add(door, knob, arch);
  // Windows with warm glow
  const winMat = toon('#ffe9a8', { emissive: '#ffcf6a', emissiveIntensity: 0.45 });
  for (const sx of [-1, 1]) {
    if (W < 5 && !b.deco) continue;
    const win = new THREE.Mesh(box(0.9, 0.9, 0.1), winMat);
    win.position.set(sx * (W / 2 - 1.1), H * 0.58, D / 2 + 0.06);
    const frame = mesh(box(1.1, 1.1, 0.08), '#fff7ea');
    frame.position.set(sx * (W / 2 - 1.1), H * 0.58, D / 2 + 0.03);
    const sill = mesh(box(1.2, 0.15, 0.35), '#8b5a33');
    sill.position.set(sx * (W / 2 - 1.1), H * 0.58 - 0.6, D / 2 + 0.15);
    inner.add(frame, win, sill);
    for (let f = 0; f < 3; f++) {
      const fl = mesh(sph(0.12, 6, 5), ['#ff7aa2', '#ffd84a', '#ffffff'][f]);
      fl.position.set(sx * (W / 2 - 1.1) - 0.35 + f * 0.35, H * 0.58 - 0.45, D / 2 + 0.2);
      inner.add(fl);
    }
  }
  // Chimney
  const chim = mesh(box(0.7, 1.6, 0.7), '#b3aa9c', { outline: OL });
  chim.position.set(W * 0.25, H + roofH * 0.65, -D * 0.15);
  inner.add(chim);
  const top = H + roofH;
  grp.userData.top = top;
  const smokePos = new THREE.Vector3(0, H + roofH * 0.65 + 1, 0);
  inner.updateMatrixWorld(true);
  smokePos.set(W * 0.25, H + roofH * 0.65 + 1, -D * 0.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), faceRot).add(grp.position);
  if (!b.deco || rng() > 0.4) grp.userData.smoke = smokePos;

  if (b.id === 'shop') {
    const stripes = 6;
    for (let i = 0; i < stripes; i++) {
      const s = mesh(box(W / stripes, 0.12, 1.5), i % 2 ? '#fff7ea' : '#e2574c');
      s.position.set(-W / 2 + (i + 0.5) * (W / stripes), 2.75, D / 2 + 0.7);
      s.rotation.x = 0.35;
      inner.add(s);
    }
    const sign = mesh(box(2.4, 0.8, 0.15), '#f7b928', { outline: OL });
    sign.position.set(0, H - 0.35, D / 2 + 0.12);
    inner.add(sign);
    for (const sx of [-1, 1]) {
      const barrel = mesh(cyl(0.4, 0.45, 0.9, 10), '#a8763f', { outline: OL });
      barrel.position.set(sx * (W / 2 + 0.6), 0.45, D / 2 + 0.4);
      inner.add(barrel);
    }
  } else if (b.id === 'workshop') {
    const anvil = mesh(box(0.9, 0.5, 0.45), '#4a4a5a', { outline: OL });
    anvil.position.set(-W / 2 + 1.2, 0.85, D / 2 + 1.3);
    const block = mesh(cyl(0.35, 0.4, 0.6, 8), '#8b5a33', { outline: OL });
    block.position.set(-W / 2 + 1.2, 0.3, D / 2 + 1.3);
    inner.add(anvil, block);
    for (let i = 0; i < 6; i++) {
      const log = mesh(cyl(0.25, 0.25, 1.8, 8), '#8b5a33', { outline: 0.025 });
      log.rotation.z = Math.PI / 2;
      log.position.set(W / 2 - 1.2, 0.25 + Math.floor(i / 3) * 0.45, D / 2 + 0.9 + (i % 3) * 0.5 - (i >= 3 ? -0.25 : 0));
      inner.add(log);
    }
  } else if (b.id === 'townhall') {
    const tower = mesh(box(2.2, 3.2, 2.2), b.color, { outline: OL });
    tower.position.set(0, H + roofH + 0.4, 0);
    const troof = mesh(new THREE.ConeGeometry(1.9, 2.2, 4), b.roof, { outline: OL, mat: toon(b.roof, { flatShading: true }) });
    troof.rotation.y = Math.PI / 4;
    troof.position.set(0, H + roofH + 3.1, 0);
    const clock = mesh(cyl(0.7, 0.7, 0.1, 20), '#fff7ea', { outline: 0.03 });
    clock.rotation.x = Math.PI / 2;
    clock.position.set(0, H + roofH + 0.8, 1.12);
    const hand = mesh(box(0.06, 0.5, 0.04), '#3b2a1a');
    hand.position.set(0, H + roofH + 0.95, 1.2);
    inner.add(tower, troof, clock, hand);
    for (const sx of [-1, 1]) {
      const pole = mesh(cyl(0.06, 0.06, 3, 5), '#6b4226');
      pole.position.set(sx * (W / 2 + 0.8), 1.5, D / 2 + 0.6);
      const fl = mesh(box(0.05, 0.8, 1.1), '#5b7f4a');
      fl.position.set(sx * (W / 2 + 0.8), 2.5, D / 2 + 1.15);
      inner.add(pole, fl);
    }
    grp.userData.top = H + roofH + 4.2;
  }
  return grp;
}
