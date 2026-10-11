import * as THREE from 'three';
import { mesh, toon, shade } from './toon.js';
import * as assets from './assets.js';
import { waterMaterial, seaMaterial, groundTexture } from './water.js';
import { buildModular, buildGate } from './buildings.js';
import { PROC_BUILDERS, buildWaystone } from './procprops.js';
import {
  BUILDINGS, ZONES, GATES, FOUNTAINS, LAKES, DOCKS, PLAZAS, PROPS, NODES, STONES, LANDS, EXTENT, SPAWN, NODE_TYPES,
  pathSegments, zonesOfKind, landDistance, mulberry32,
} from '../../../shared/world.js';

// Small ground cover: no ink line and no shadow (they'd just add noise).
const NO_OUTLINE = new Set(['deco_flower', 'deco_grass', 'deco_lily_pad', 'deco_mushroom']);
const NO_SHADOW = new Set(['deco_flower', 'deco_grass', 'deco_lily_pad']);
const OL = 0.03;
const sph = (r, a = 14, b = 10) => new THREE.SphereGeometry(r, a, b);
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function distSeg(px, pz, [ax, az, bx, bz]) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

const hash = (str) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);

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
    if (this.modelSize) return this.modelSize.y * this.node.s;
    return { tree: this.node.type === 'tree_pine' ? 6 : 4.6, rock: 2, herb: 1, fish: 0.5 }[this.type.kind] * this.node.s;
  }

  build() {
    const k = this.node.type;
    if (assets.has(k)) return this.#buildModel(k);
    this.#buildProcedural(k);
  }

  // Imported model for the standing node, plus a stump / rubble / sprout for
  // the depleted state (model if the manifest has one, procedural otherwise).
  #buildModel(k) {
    const kind = this.type.kind;
    const variant = Math.abs(hash(this.node.id));
    const m = assets.make(k, { variant });
    this.full.add(m.object);
    this.modelSize = m.size;
    if (kind === 'rock') {
      const ore = { rock_copper: '#e07b39', rock_iron: '#c9d3df', rock_gold: '#ffd23f' }[k];
      if (ore) {
        // Coloured ore crystals studded around the boulder.
        const r = mulberry32(variant);
        const om = toon(ore, { emissive: ore, emissiveIntensity: k === 'rock_gold' ? 0.4 : 0.15 });
        const rad = Math.max(m.size.x, m.size.z) * 0.45;
        for (let i = 0; i < 6; i++) {
          const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 + r() * 0.1), om);
          const a = r() * Math.PI * 2;
          c.position.set(Math.cos(a) * rad, 0.3 + r() * m.size.y * 0.6, Math.sin(a) * rad);
          c.rotation.set(r() * 3, r() * 3, 0);
          this.full.add(c);
        }
      }
    }
    const depleted = { tree: `${k}_stump`, rock: 'rock_rubble', herb: 'herb_sprout' }[kind];
    if (depleted && assets.has(depleted)) this.stump.add(assets.make(depleted, { variant }).object);
    else if (kind === 'tree') this.#stump(k === 'tree_birch' ? '#f2efe6' : k === 'tree_pine' ? '#6b4226' : '#8b5a33');
    else if (kind === 'rock') this.#pebbles('#9c9a94');
    else if (kind === 'herb') {
      const sprout = mesh(sph(0.1, 6, 5), '#4fae4f');
      sprout.position.y = 0.06;
      sprout.scale.y = 0.5;
      this.stump.add(sprout);
    }
  }

  #pebbles(base) {
    for (let i = 0; i < 3; i++) {
      const peb = mesh(new THREE.IcosahedronGeometry(0.22, 0), base);
      peb.position.set(Math.cos(i * 2.1) * 0.8, 0.12, Math.sin(i * 2.1) * 0.8);
      peb.scale.y = 0.6;
      this.stump.add(peb);
    }
  }

  #buildProcedural(k) {
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
    this.shake = 0; // a leftover hit-shake would twist the hidden model
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
      this.fx.puff.burst(new THREE.Vector3(p.x, 0.3, p.z), { n: 10, color: ['#cbbfa8', '#b8ab92'], speed: 2, up: 1.5, gravity: 1, size: 0.6, life: 0.8, drag: 3 });
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
        this.fx.puff.burst(land, { n: 22, color: ['#cbbfa8', '#b8ab92', '#a89a82'], speed: 4, up: 2, gravity: 2, size: 0.8, life: 1, drag: 2.5 });
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
    if (!F.visible) return; // felled / broken: nothing to animate until it regrows
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
// Everything goes into one group (`root`), so the world editor can throw a
// whole town away and build it again after an edit (see disposeTown).
//
// The world can be far bigger than the screen, so the ground, grass, stepping
// stones and props are built in CHUNK-sized squares as the camera comes near
// them and thrown away when it's far off. Buildings, water, nodes and labels
// are few enough to build once (three.js skips drawing what's off screen).
const CHUNK = 96;

export function buildTown(scene, fx, { low = false, focus = null } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const pickables = [];
  const animated = [];
  const labels = [];
  const rng = mulberry32(99);
  const segs = pathSegments();
  const fades = [];
  const inPlaza = (x, z, pad = 0) => PLAZAS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);
  const inDock = (x, z, pad = 0) => DOCKS.some((d) => Math.abs(x - d.x) < d.w / 2 + pad && Math.abs(z - d.z) < d.d / 2 + pad);

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
  root.add(sky);
  animated.push((dt, t, cam) => sky.position.copy(cam.position));

  // Sea: one big plane under everything; the shader knows the coastline.
  {
    const cx = (EXTENT.x0 + EXTENT.x1) / 2;
    const cz = (EXTENT.z0 + EXTENT.z1) / 2;
    const size = Math.max(EXTENT.x1 - EXTENT.x0, EXTENT.z1 - EXTENT.z0) + 840;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(size, size), seaMaterial({ lands: LANDS, center: [cx, cz], shallow: '#58a8bc', deep: '#1b4f74', fog: scene.fog }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(cx, -2.2, cz);
    root.add(sea);
    animated.push((dt, t) => {
      const u = sea.material.uniforms;
      u.time.value = t;
      if (scene.fog) (u.fogNear.value = scene.fog.near), (u.fogFar.value = scene.fog.far);
      sea.position.y = -2.2 + Math.sin(t * 0.8) * 0.06;
    });
  }

  // Ground shape and colour at any point: gentle undulation, flat plazas,
  // lake beds, and beach then cliff falling away past the coast.
  const grass = new THREE.Color('#74a04c');
  const grass2 = new THREE.Color('#628c42');
  const pathCol = new THREE.Color('#b89b6e');
  const plazaCol = new THREE.Color('#a89a82');
  const sand = new THREE.Color('#d6bd8a');
  const cliff = new THREE.Color('#7a5b40');
  const zoneCols = new Map(ZONES.map((z) => [z, new THREE.Color(z.ground || '#74a04c')]));
  const heightAt = (x, z, near) => {
    const s = landDistance(x, z);
    let y = 0;
    if (s > 1) {
      const k = smooth(1, 9, s);
      y = -k * 5 + Math.sin(x * 0.3 + z * 0.2) * 0.3 * k;
    } else if (!near.plazas.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2.8)) y = Math.sin(x * 0.13) * Math.cos(z * 0.11) * 0.12;
    for (const l of near.lakes) {
      const dl = Math.hypot(x - l.x, z - l.z);
      if (dl < l.r) y = Math.min(y, -0.7 * (1 - dl / l.r) - 0.05);
    }
    return y;
  };
  const colourAt = (x, z, near, c) => {
    const n = Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.07 + z * 0.11) * 0.6;
    c.copy(grass).lerp(grass2, 0.5 + n * 0.25);
    for (const zn of near.zones) {
      const w = 1 - smooth(zn.r - 4, zn.r + 3, Math.hypot(x - zn.x, z - zn.z));
      if (w > 0) c.lerp(zoneCols.get(zn), w * 0.75);
    }
    for (const l of near.lakes) {
      const dl = Math.hypot(x - l.x, z - l.z);
      if (dl < l.r + 3.5) c.lerp(sand, 1 - smooth(l.r + 1, l.r + 3.5, dl));
    }
    let pd = Infinity;
    for (const s of near.segs) pd = Math.min(pd, distSeg(x, z, s) - s[4]);
    if (pd < 0.6) c.lerp(pathCol, 1 - smooth(-0.4, 0.6, pd));
    for (const p of near.plazas) {
      const rp = Math.hypot(x - p.x, z - p.z);
      if (rp < p.r + 0.8) c.lerp(plazaCol, 1 - smooth(p.r - 0.7, p.r + 0.8, rp));
    }
    const s = landDistance(x, z);
    if (s > 1) c.lerp(s < 5 ? sand : cliff, Math.min(1, smooth(1, 9, s) * 2));
    return c;
  };
  // What's close enough to a square to affect its ground (keeps the loops short).
  const nearRect = (x0, z0, x1, z1, pad) => {
    const hit = (x, z, r) => x + r > x0 - pad && x - r < x1 + pad && z + r > z0 - pad && z - r < z1 + pad;
    return {
      zones: ZONES.filter((zn) => hit(zn.x, zn.z, zn.r + 3)),
      lakes: LAKES.filter((l) => hit(l.x, l.z, l.r + 3.5)),
      plazas: PLAZAS.filter((p) => hit(p.x, p.z, p.r + 3)),
      segs: segs.filter((s) => Math.max(s[0], s[2]) + s[4] + 1 > x0 - pad && Math.min(s[0], s[2]) - s[4] - 1 < x1 + pad && Math.max(s[1], s[3]) + s[4] + 1 > z0 - pad && Math.min(s[1], s[3]) - s[4] - 1 < z1 + pad),
      buildings: BUILDINGS.filter((b) => hit(b.x, b.z, Math.max(b.w, b.d) / 2 + 1)),
    };
  };

  // Plazas: concentric paving rings and spokes (sized to the plaza).
  for (const p of PLAZAS) {
    const k = p.r / 11.2;
    const rings = [[0, 11.2, '#b3a58c'], [10.4, 11.2, '#8a7c66'], [6.2, 6.9, '#988a72'], [3.6, 4.2, '#988a72']];
    rings.forEach(([a, b, col], i) => {
      const m = new THREE.Mesh(a ? new THREE.RingGeometry(a * k, b * k, 64) : new THREE.CircleGeometry(b * k, 64), toon(col));
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, 0.02 + i * 0.004, p.z);
      m.receiveShadow = true;
      root.add(m);
    });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3.4 * k), toon('#988a72'));
      spoke.rotation.x = -Math.PI / 2;
      spoke.rotation.z = -a;
      spoke.position.set(p.x + Math.cos(a) * 8.6 * k, 0.035, p.z + Math.sin(a) * 8.6 * k);
      spoke.receiveShadow = true;
      root.add(spoke);
    }
  }

  // Sort the chunked things into their squares once.
  const chunkOf = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const bucket = (map, k, v) => (map.get(k) ?? map.set(k, []).get(k)).push(v);
  const propsIn = new Map();
  for (const pr of PROPS) bucket(propsIn, chunkOf(pr.x, pr.z), pr);
  // Sparse stepping stones along the paths.
  const stonesIn = new Map();
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
      if (!inPlaza(x, z, 0.3)) bucket(stonesIn, chunkOf(x, z), [x, z, rng() * 3, 0.6 + rng() * 0.6, 0.7 + rng() * 0.4]);
    }
  }

  // Crafting stations: an invisible tap target on each (the visuals are props).
  for (const pr of PROPS.filter((x) => x.station)) {
    const pickVol = new THREE.Mesh(cyl(pr.r + 0.35, pr.r + 0.35, 1.8, 10), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    pickVol.position.set(pr.x, 0.9, pr.z);
    pickVol.layers.set(2); // never drawn; the tap raycaster checks every layer
    pickVol.userData.station = pr.station;
    root.add(pickVol);
    pickables.push(pickVol);
  }

  // ── Buildings
  // Anything that can hide the hero fades out while it's between them and the camera.
  const fadeable = (grp) => {
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
  };
  for (const [i, b] of BUILDINGS.entries()) {
    const grp = buildModular(b, i) || buildHouse(b, rng);
    root.add(grp);
    fadeable(grp);
    grp.traverse((o) => {
      if (o.isMesh) o.userData.building = b.id;
    });
    if (!b.deco) {
      pickables.push(grp);
      labels.push({ kind: 'place', id: b.id, text: b.label, icon: b.icon, glyph: b.glyph, pos: new THREE.Vector3(b.x, grp.userData.top + 0.9, b.z) });
    }
    if (grp.userData.smoke) animated.push((dt, t) => {
      if (Math.random() < dt * 2.5) fx.puff.burst(grp.userData.smoke, { n: 1, color: ['#f4f4f4', '#e2e2e2'], speed: 0.25, up: 0.9, gravity: -0.5, size: 0.55, life: 2.6, drag: 0.6, jitter: 0.15, spin: 0 });
    });
  }

  // Gatehouses: the castle-kit wall and arch, or a simple timber arch without it.
  for (const gt of GATES) {
    const castle = buildGate(gt);
    const k = gt.scale / 4.5;
    if (castle) {
      root.add(castle);
      fadeable(castle);
      for (const sx of [-1, 1]) {
        const flame = new THREE.Mesh(sph(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb340' }));
        flame.position.set(gt.x + sx * 1.75 * k, 3.15 * k, gt.z + 2.45 * k);
        const torch = mesh(cyl(0.07, 0.09, 0.55, 6), '#6b4226');
        torch.position.set(gt.x + sx * 1.75 * k, 2.75 * k, gt.z + 2.35 * k);
        torch.rotation.x = 0.35;
        animated.push((dt, t) => flame.scale.setScalar(1 + Math.sin(t * 13 + sx) * 0.18));
        root.add(torch, flame);
      }
      labels.push({ kind: 'place', id: gt.id, text: gt.label, icon: gt.icon, glyph: gt.glyph, pos: new THREE.Vector3(gt.x, castle.userData.top + 1.2, gt.z) });
    } else {
      const grp = new THREE.Group();
      grp.position.set(gt.x, 0, gt.z);
      for (const s of [-1, 1]) {
        const pillar = mesh(box(1.4, 5, 1.4), '#b3aa9c', { outline: OL });
        pillar.position.set((gt.width / 2) * s, 2.5, 0);
        const cap = mesh(box(1.8, 0.5, 1.8), '#9c9284', { outline: OL });
        cap.position.set((gt.width / 2) * s, 5.2, 0);
        const torch = mesh(cyl(0.08, 0.1, 0.6, 6), '#6b4226');
        torch.position.set((gt.width / 2 - 0.9) * s, 3.2, 0.75);
        const flame = new THREE.Mesh(sph(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffb340' }));
        flame.position.set((gt.width / 2 - 0.9) * s, 3.65, 0.75);
        animated.push((dt, t) => flame.scale.setScalar(1 + Math.sin(t * 13 + s) * 0.18));
        grp.add(pillar, cap, torch, flame);
      }
      const beam = mesh(box(gt.width + 2.4, 0.9, 1.0), '#8b5a33', { outline: OL });
      beam.position.y = 5.9;
      const roof = mesh(new THREE.ConeGeometry(1, 1, 4), '#c4534a', { outline: OL });
      roof.scale.set(gt.width * 0.75, 1.1, 1.4);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 6.9;
      const banner = mesh(box(1.8, 1.4, 0.08), '#c4534a', { outline: 0.02 });
      banner.position.set(0, 4.8, 0.55);
      grp.add(beam, roof, banner);
      root.add(grp);
      labels.push({ kind: 'place', id: gt.id, text: gt.label, icon: gt.icon, glyph: gt.glyph, pos: new THREE.Vector3(gt.x, 8.3, gt.z) });
    }
  }

  // Fountains
  for (const f of FOUNTAINS) {
    const grp = new THREE.Group();
    grp.position.set(f.x, 0, f.z);
    const rim = mesh(cyl(f.r, f.r + 0.2, 0.7, 24), '#c9c1b2', { outline: OL });
    rim.position.y = 0.35;
    const water = new THREE.Mesh(cyl(f.r - 0.3, f.r - 0.3, 0.1, 24), toon('#5aa9c2', { emissive: '#2a7a9a', emissiveIntensity: 0.1 }));
    water.position.y = 0.62;
    const pillar = mesh(cyl(0.35, 0.5, 2.2, 10), '#c9c1b2', { outline: OL });
    pillar.position.y = 1.4;
    const bowl = mesh(cyl(1.2, 0.5, 0.45, 14), '#c9c1b2', { outline: OL });
    bowl.position.y = 2.5;
    const top = mesh(sph(0.35), '#ffd84a', { outline: OL });
    top.position.y = 3.0;
    grp.add(rim, water, pillar, bowl, top);
    root.add(grp);
    const spout = new THREE.Vector3(f.x, 3.1, f.z);
    animated.push((dt) => {
      if (Math.random() < dt * 30) fx.puff.burst(spout, { n: 1, color: ['#bfeaff', '#ffffff', '#8fd8ff'], speed: 1.6, up: 3, gravity: 9, size: 0.16, life: 0.75, jitter: 0.1 });
    });
  }

  // Waystones (fast travel): tap one to walk up and open the world map.
  const stones = new Map();
  for (const st of STONES) {
    const ws = buildWaystone(st, { fx, animate: (fn) => animated.push(fn) });
    ws.group.position.set(st.x, 0, st.z);
    ws.group.rotation.y = st.rot ?? 0;
    ws.group.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.stone = st.id;
      if (o.material.side !== THREE.BackSide) o.castShadow = true;
    });
    root.add(ws.group);
    pickables.push(ws.group);
    stones.set(st.id, ws);
    labels.push({ kind: 'stone', id: st.id, text: st.name, glyph: 'waystone', pos: new THREE.Vector3(st.x, 5, st.z) });
  }

  // Lakes: water, reeds round the shore, lily pads (skipping any dock).
  for (const l of LAKES) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(l.r + 0.6, 64), waterMaterial({ radius: l.r + 0.6, foamAt: l.r + 0.1, shallow: '#5fb3c4', deep: '#1f5f86', fog: scene.fog, opacity: 0.93 }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(l.x, -0.12, l.z);
    water.userData.water = true;
    root.add(water);
    pickables.push(water);
    animated.push((dt, t) => {
      const u = water.material.uniforms;
      u.time.value = t;
      if (scene.fog) (u.fogNear.value = scene.fog.near), (u.fogFar.value = scene.fog.far);
    });
    const ring = (n, d0, d1) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const d = d0 + rng() * (d1 - d0);
        const x = l.x + Math.cos(a) * d;
        const z = l.z + Math.sin(a) * d;
        if (!inDock(x, z, 1.5)) out.push({ x, z });
      }
      return out;
    };
    for (const { x, z } of ring(Math.round(26 * (l.r / 14)), l.r - 0.4, l.r + 0.8)) {
      const reed = mesh(cyl(0.03, 0.04, 1.4, 4), '#5f9e4f');
      reed.position.set(x, 0.5, z);
      const cat = mesh(new THREE.CapsuleGeometry(0.07, 0.25, 3, 6), '#7c4a2c');
      cat.position.set(x, 1.25, z);
      root.add(reed, cat);
    }
    const pads = ring(Math.round(14 * (l.r / 14)), 3, l.r - 2).map((p) => ({ ...p, y: -0.06, rot: rng() * 6.28, s: 0.8 + rng() * 0.6 }));
    scatterModels(root, 'deco_lily_pad', pads, { outline: false, castShadow: false });
  }
  // Docks: planks on posts.
  for (const d of DOCKS) {
    const dock = new THREE.Group();
    const planks = Math.round(d.d / 0.6);
    for (let i = 0; i < planks; i++) {
      const p = mesh(box(d.w + 0.4, 0.15, 0.52), i % 2 ? '#b98552' : '#a8763f', { outline: 0.02 });
      p.position.set(d.x, 0.25, d.z - d.d / 2 + 0.3 + i * 0.6);
      dock.add(p);
    }
    for (const sx of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const post = mesh(cyl(0.12, 0.12, 1.6, 6), '#7c4a2c', { outline: 0.02 });
        post.position.set(d.x + (d.w / 2 + 0.15) * sx, 0.2, d.z - d.d / 2 + 1 + i * (d.d / 3.3));
        dock.add(post);
      }
    root.add(dock);
  }

  // Zone names floating over each zone.
  for (const zn of ZONES) labels.push({ kind: 'zone', id: zn.id, text: zn.label, glyph: zn.glyph, pos: new THREE.Vector3(zn.x, 0.5, zn.z) });

  // Butterflies around gardens and plazas.
  const homes = [...zonesOfKind('garden'), ...PLAZAS];
  for (let i = 0; homes.length && i < 10; i++) {
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
    const home = homes[i < 6 ? 0 : i % homes.length];
    const ph = rng() * 10;
    const r = 4 + rng() * 5;
    root.add(bf);
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
  for (const n of NODES) {
    const v = new NodeView(n, fx);
    nodes.set(n.id, v);
    root.add(v.root);
    pickables.push(v.root);
  }


  // ── Chunks: ground, grass, stepping stones and props near the camera ──
  const chunks = new Map(); // "i,j" → { group, anim, pick }
  const ctx = (anim) => ({ fx, animate: (fn) => anim.push(fn) });
  const wilds = zonesOfKind('wilds');
  function buildChunk(ci, cj) {
    const x0 = ci * CHUNK;
    const z0 = cj * CHUNK;
    const group = new THREE.Group();
    const anim = [];
    const pick = [];
    const crng = mulberry32(((ci * 73856093) ^ (cj * 19349663)) >>> 0);
    const near = nearRect(x0, z0, x0 + CHUNK, z0 + CHUNK, 6);
    // Squares far out at sea have nothing in them.
    const onLand = landDistance(x0 + CHUNK / 2, z0 + CHUNK / 2) < CHUNK * 0.71 + 14;
    if (onLand) {
      // Ground tile. Normals come from the height function, so neighbouring
      // tiles shade identically along their shared edge.
      const SEG = Math.round(CHUNK / (low ? 1.57 : 1.12));
      const g = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
      g.rotateX(-Math.PI / 2);
      g.translate(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      const e = 0.5;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, heightAt(x, z, near));
        const nx = heightAt(x - e, z, near) - heightAt(x + e, z, near);
        const nz = heightAt(x, z - e, near) - heightAt(x, z + e, near);
        const l = Math.hypot(nx, 2 * e, nz);
        nor.setXYZ(i, nx / l, (2 * e) / l, nz / l);
        colourAt(x, z, near, c);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const ground = new THREE.Mesh(g, groundMatFor());
      ground.receiveShadow = true;
      ground.userData.ground = true;
      group.add(ground);
      pick.push(ground);

      // Grass tufts everywhere that isn't paved, built on or wet.
      const tufts = [];
      const tries = Math.round(CHUNK * CHUNK * (low ? 0.042 : 0.106));
      for (let i = 0; i < tries; i++) {
        const x = x0 + crng() * CHUNK;
        const z = z0 + crng() * CHUNK;
        if (landDistance(x, z) > -1 || near.plazas.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.8)) continue;
        if (near.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1)) continue;
        if (near.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 2) || near.segs.some((s) => distSeg(x, z, s) < s[4] + 0.4)) continue;
        tufts.push([x, z]);
      }
      if (tufts.length) {
        const im = new THREE.InstancedMesh(tuftGeo, toon('#ffffff'), tufts.length * 3);
        const o = new THREE.Object3D();
        let k = 0;
        for (const [x, z] of tufts) {
          const wild = wilds.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 6);
          for (let j = 0; j < 3; j++) {
            o.position.set(x + (crng() - 0.5) * 0.4, 0, z + (crng() - 0.5) * 0.4);
            o.rotation.set((crng() - 0.5) * 0.5, crng() * 3, (crng() - 0.5) * 0.5);
            o.scale.setScalar(0.6 + crng() * 0.9);
            o.updateMatrix();
            im.setMatrixAt(k, o.matrix);
            im.setColorAt(k++, c.set(wild ? ['#4e6e38', '#43602f', '#5b7a42'][j] : ['#6b9a48', '#5a8a3d', '#7caa55'][j]));
          }
        }
        group.add(im);
      }
    }

    // Stepping stones
    const stones = stonesIn.get(`${ci},${cj}`);
    if (stones?.length) {
      const im = new THREE.InstancedMesh(stoneGeo, toon('#ffffff'), stones.length);
      const o = new THREE.Object3D();
      const col = new THREE.Color();
      stones.forEach(([x, z, rot, sc, sq], i) => {
        o.position.set(x, 0.03, z);
        o.rotation.set(0, rot, 0);
        o.scale.set(sc, 1, sc * sq);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        im.setColorAt(i, col.set(['#b8ac96', '#a89c86', '#c4b8a2'][i % 3]));
      });
      im.receiveShadow = true;
      group.add(im);
    }

    // Props: models instanced per slot and variant; proc_* kinds built in
    // code (procprops.js); bobbing ones animate.
    const groups = new Map();
    for (const pr of propsIn.get(`${ci},${cj}`) ?? []) {
      if (pr.slot.startsWith('proc_')) {
        const make = PROC_BUILDERS[pr.slot];
        if (!make) continue;
        const obj = make(pr, ctx(anim));
        obj.position.set(pr.x, pr.y || 0, pr.z);
        obj.rotation.y = pr.rot;
        obj.traverse((o) => o.isMesh && o.material.side !== THREE.BackSide && (o.castShadow = true));
        group.add(obj);
        continue;
      }
      if (!assets.has(pr.slot)) continue;
      if (pr.bob) {
        const m = assets.make(pr.slot, { variant: pr.v || 0 });
        m.object.position.set(pr.x, pr.y || 0, pr.z);
        m.object.rotation.y = pr.rot;
        if (pr.s) m.object.scale.multiplyScalar(pr.s);
        group.add(m.object);
        const ph = pr.x * 0.7;
        anim.push((dt, t) => {
          m.object.position.y = (pr.y || 0) + Math.sin(t * 1.6 + ph) * 0.08;
          m.object.rotation.z = Math.sin(t * 1.1 + ph) * 0.06;
        });
        continue;
      }
      const v = (pr.v || 0) % assets.variantCount(pr.slot);
      const key = pr.slot + '|' + v;
      if (!groups.has(key)) groups.set(key, { slot: pr.slot, v, list: [] });
      groups.get(key).list.push({ x: pr.x, z: pr.z, y: pr.y || 0, rot: pr.rot, s: pr.s ?? 1 });
    }
    for (const gp of groups.values()) {
      const inst = assets.instanced(gp.slot, gp.list, { variant: gp.v, outline: !NO_OUTLINE.has(gp.slot), castShadow: !NO_SHADOW.has(gp.slot) });
      if (inst) group.add(inst);
    }
    root.add(group);
    pickables.push(...pick);
    return { group, anim, pick };
  }
  function dropChunk(k) {
    const ch = chunks.get(k);
    chunks.delete(k);
    root.remove(ch.group);
    disposeTree(ch.group);
    for (const p of ch.pick) pickables.splice(pickables.indexOf(p), 1);
  }
  // Distance from a point to a chunk's square.
  const gap = (ci, cj, x, z) => Math.hypot(Math.max(0, ci * CHUNK - x, x - (ci + 1) * CHUNK), Math.max(0, cj * CHUNK - z, z - (cj + 1) * CHUNK));
  const town = { viewRadius: low ? 120 : 150 };
  // Build what's within view of (x, z), nearest first, for up to `budget` ms
  // (always at least one square); drop what's well out of view.
  function stream(x, z, budget) {
    const R = town.viewRadius;
    for (const k of [...chunks.keys()]) {
      const [ci, cj] = k.split(',').map(Number);
      if (gap(ci, cj, x, z) > R + 70) dropChunk(k);
    }
    const want = [];
    const i0 = Math.floor((x - R) / CHUNK);
    const j0 = Math.floor((z - R) / CHUNK);
    for (let ci = i0; ci <= Math.floor((x + R) / CHUNK); ci++)
      for (let cj = j0; cj <= Math.floor((z + R) / CHUNK); cj++) {
        const d = gap(ci, cj, x, z);
        if (d <= R && !chunks.has(`${ci},${cj}`)) want.push([d, ci, cj]);
      }
    want.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    let built = 0;
    for (const [, ci, cj] of want) {
      chunks.set(`${ci},${cj}`, buildChunk(ci, cj));
      built++;
      if (performance.now() - t0 > budget) break;
    }
    return want.length - built; // still to build
  }
  const start = focus ?? SPAWN;
  stream(start.x, start.z, Infinity);

  const dir = new THREE.Vector3();
  let nextStream = 0;
  let pending = 0;
  return Object.assign(town, {
    root,
    pickables,
    nodes,
    stones,
    labels,
    fades,
    chunks,
    // Build/drop squares around a point (the game and editor call this with
    // where the camera looks; update() does it on its own otherwise).
    focus(x, z, budget = 6) {
      pending = stream(x, z, budget);
    },
    update(dt, t, cam) {
      for (const a of animated) a(dt, t, cam);
      for (const ch of chunks.values()) for (const a of ch.anim) a(dt, t, cam);
      for (const n of nodes.values()) n.update(dt);
      // Every quarter second (every frame while squares are still missing),
      // stream around where the middle of the screen meets the ground.
      if (cam && (pending || t >= nextStream)) {
        nextStream = t + 0.25;
        cam.getWorldDirection(dir);
        const k = dir.y < -0.05 ? -cam.position.y / dir.y : 30;
        pending = stream(cam.position.x + dir.x * k, cam.position.z + dir.z * k, 6);
      }
    },
  });
}

const tuftGeo = new THREE.ConeGeometry(0.12, 0.5, 4).translate(0, 0.25, 0);
tuftGeo.userData.shared = true;
const stoneGeo = new THREE.CylinderGeometry(0.36, 0.4, 0.06, 7);
stoneGeo.userData.shared = true;
let groundMatCache = null;
const groundMatFor = () => (groundMatCache ??= new THREE.MeshToonMaterial({ vertexColors: true, map: groundTexture(), gradientMap: toon('#fff').gradientMap }));

// Free what a group alone owns. Model geometry shared with other copies
// (flagged by assets.js) is left alone.
function disposeTree(obj) {
  const seen = new Set();
  obj.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    const g = o.geometry;
    if (g && !g.userData.shared && !seen.has(g)) {
      seen.add(g);
      g.dispose();
    }
  });
}

// Remove a town built by buildTown and free what it alone owns.
export function disposeTown(town) {
  town.root.parent?.remove(town.root);
  disposeTree(town.root);
}

// Place many copies of a model slot (instanced), spreading them across the
// slot's variants. Returns false if the slot has no model (use a fallback).
function scatterModels(scene, slot, placements, opts = {}) {
  if (!assets.has(slot) || !placements.length) return false;
  const n = assets.variantCount(slot);
  for (let v = 0; v < n; v++) {
    const mine = placements.filter((p, i) => (p.v ?? i) % n === v);
    const g = assets.instanced(slot, mine, { ...opts, variant: v });
    if (g) scene.add(g);
  }
  return true;
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
