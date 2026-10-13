import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, toon } from './toon.js';

// Props drawn in code instead of from a model: map props whose slot starts
// with `proc_`. Each builder gets the prop ({ x, z, rot, s, ... }) and a context
// ({ fx, animate(fn) }) and returns an Object3D placed at the origin; the town
// positions and turns it. Add a kind here, then place it in the map.
// The town merges a prop's meshes into its chunk (scene/chunkmerge.js), except
// meshes marked userData.live: anything an animation moves or recolours.
const OL = 0.03;
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (m, x, y, z) => (m.position.set(x, y, z), m);
// Small stable variation per prop (from its id), so it looks the same on every client.
const jitter = (id, k) => {
  let h = 7;
  for (const ch of `${id}:${k}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
};

export const PROC_BUILDERS = {
  // Trail sign at the edge of a named zone.
  proc_signboard() {
    const g = new THREE.Group();
    g.add(at(mesh(cyl(0.1, 0.12, 2, 6), '#7c4a2c', { outline: 0.02 }), 0, 1, 0));
    g.add(at(mesh(box(1.8, 0.7, 0.12), '#d9a066', { outline: 0.025 }), 0, 1.9, 0));
    return g;
  },

  proc_mine_cart() {
    const g = new THREE.Group();
    g.add(at(mesh(box(1.4, 0.8, 1), '#7c5530', { outline: OL }), 0, 0.7, 0));
    g.add(at(mesh(new THREE.IcosahedronGeometry(0.45, 0), '#e07b39', { mat: toon('#e07b39', { flatShading: true }) }), 0, 1.1, 0));
    for (const [x, z] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45]]) {
      const w = mesh(cyl(0.22, 0.22, 0.1, 10), '#3b3b3b');
      w.rotation.x = Math.PI / 2;
      g.add(at(w, x, 0.25, z));
    }
    return g;
  },

  // The bulletin board (paid jobs): a little roofed notice board with notes
  // pinned to its front (+z). Tapping it opens the board.
  proc_job_board(p) {
    const g = new THREE.Group();
    for (const x of [-1.05, 1.05]) g.add(at(mesh(box(0.16, 2.5, 0.16), '#5c3b22', { outline: OL }), x, 1.25, 0));
    g.add(at(mesh(box(2.2, 1.3, 0.1), '#8a6038', { outline: OL }), 0, 1.6, 0));
    g.add(at(mesh(box(2.3, 0.1, 0.16), '#5c3b22', { outline: OL }), 0, 0.92, 0.02));
    const roof = mesh(box(2.6, 0.1, 0.7), '#6b3a2a', { outline: OL });
    roof.rotation.x = -0.35;
    g.add(at(roof, 0, 2.5, 0.05));
    const notes = ['#efe4cc', '#e8d8b0', '#f4ead6', '#e6cfa0', '#efe4cc', '#ead9b8'];
    notes.forEach((col, i) => {
      const n = new THREE.Mesh(box(0.42 + jitter(p.id, 'w' + i) * 0.12, 0.5 + jitter(p.id, 'h' + i) * 0.14, 0.012), toon(col));
      n.position.set(-0.72 + (i % 3) * 0.72 + jitter(p.id, 'x' + i) * 0.12, 1.92 - Math.floor(i / 3) * 0.6, 0.06);
      n.rotation.z = jitter(p.id, 'r' + i) * 0.3;
      g.add(n);
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), toon('#a63a2e')), n.position.x, n.position.y + 0.2, 0.075));
    });
    g.userData.tap = 'jobs';
    return g;
  },

  // s scales the height (2.4 m at s = 1).
  proc_standing_stone(p) {
    const h = 2.4 * (p.s ?? 1);
    const st = mesh(box(0.9, h, 0.7), '#9a9488', { outline: OL, mat: toon('#9a9488', { flatShading: true }) });
    st.position.y = 1.1;
    st.rotation.set(jitter(p.id, 'x') * 0.2, 0, jitter(p.id, 'z') * 0.2);
    return new THREE.Group().add(st);
  },

  // Crafting station: a stone forge with glowing coals and a smoking chimney.
  proc_forge(p, { fx, animate }) {
    const g = new THREE.Group();
    g.add(at(mesh(box(1.5, 0.75, 1.2), '#8f8a82', { outline: OL }), 0, 0.375, 0));
    const coals = new THREE.Mesh(box(1.1, 0.08, 0.8), toon('#ff7a2a', { emissive: '#ff5a1a', emissiveIntensity: 0.9, unique: true }));
    coals.position.y = 0.78;
    coals.userData.live = true;
    g.add(coals);
    g.add(at(mesh(box(0.7, 2.2, 0.6), '#7d776e', { outline: OL }), 0, 1.6, -0.35));
    g.add(at(mesh(box(0.85, 0.2, 0.75), '#5f5a54', { outline: OL }), 0, 2.75, -0.35));
    const smoke = new THREE.Object3D();
    smoke.position.set(0, 3.0, -0.35);
    g.add(smoke);
    const v = new THREE.Vector3();
    animate((dt, t) => {
      coals.material.emissiveIntensity = 0.75 + Math.sin(t * 5) * 0.15 + Math.sin(t * 13) * 0.05;
      if (Math.random() < dt * 1.5 && fx.near(smoke.getWorldPosition(v))) fx.puff.burst(v, { ambient: 'smoke', n: 1, color: ['#e8e2d8', '#cfc8bc'], speed: 0.2, up: 0.8, gravity: -0.4, size: 0.5, life: 2.2, drag: 0.6, jitter: 0.12, spin: 0 });
    });
    return g;
  },

  // Crafting station: a pot of soup on a tripod over a small fire.
  proc_cookpot(p, { fx, animate }) {
    const g = new THREE.Group();
    for (const a of [0, 2.1, 4.2]) {
      const leg = mesh(cyl(0.05, 0.05, 1.3, 5), '#3b2a1a');
      leg.position.set(Math.cos(a) * 0.55, 0.62, Math.sin(a) * 0.55);
      leg.rotation.z = Math.cos(a) * 0.35;
      leg.rotation.x = -Math.sin(a) * 0.35;
      g.add(leg);
    }
    g.add(at(mesh(new THREE.SphereGeometry(0.45, 14, 10, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7), '#3a3a42', { outline: OL }), 0, 0.62, 0));
    g.add(at(new THREE.Mesh(cyl(0.36, 0.36, 0.04, 16), toon('#d88a3a', { emissive: '#a0501a', emissiveIntensity: 0.3 })), 0, 0.88, 0));
    const fire = at(new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.35, 6), toon('#ffb347', { emissive: '#ff7a1a', emissiveIntensity: 1 })), 0, 0.18, 0);
    fire.userData.live = true;
    g.add(fire);
    const steam = new THREE.Object3D();
    steam.position.y = 1.0;
    g.add(steam);
    const v = new THREE.Vector3();
    animate((dt, t) => {
      fire.scale.set(1 + Math.sin(t * 11) * 0.1, 1 + Math.sin(t * 7) * 0.2, 1);
      if (Math.random() < dt * 1.2 && fx.near(steam.getWorldPosition(v))) fx.puff.burst(v, { ambient: 'steam', n: 1, color: ['#ffffff', '#eef6ff'], speed: 0.15, up: 0.6, gravity: -0.3, size: 0.35, life: 1.6, drag: 0.6, jitter: 0.1, spin: 0 });
    });
    return g;
  },
};

// Add a code-drawn prop kind from another module (a new biome's props, say):
// slot must start with proc_, and each kind is defined once.
export function registerProc(slot, builder) {
  if (!slot.startsWith('proc_')) throw new Error(`Proc slot "${slot}" must start with proc_.`);
  if (PROC_BUILDERS[slot]) throw new Error(`Proc slot "${slot}" is defined twice.`);
  PROC_BUILDERS[slot] = builder;
}

// A fast-travel waystone (map list `stones`, not a prop): a carved pillar on a
// stepped base with glowing runes on its front (+z) and a floating crystal.
// It glows brightly once you've attuned to it. Returns { group, setAttuned }.
export function buildWaystone(st, { fx, animate }) {
  const g = new THREE.Group();
  const stone = (geo, color) => mesh(geo, color, { outline: OL, mat: toon(color, { flatShading: true }) });
  g.add(at(stone(cyl(1.25, 1.35, 0.3, 8), '#6f6a62'), 0, 0.15, 0));
  g.add(at(stone(cyl(0.95, 1.05, 0.3, 8), '#7d776e'), 0, 0.45, 0));
  const pillar = stone(cyl(0.38, 0.56, 3, 4), '#5d6470');
  pillar.rotation.y = Math.PI / 4;
  g.add(at(pillar, 0, 2.1, 0));
  g.add(at(stone(box(0.62, 0.16, 0.62), '#4f5560'), 0, 3.66, 0));
  const glow = toon('#8fe8ff', { emissive: '#4fd0ff', emissiveIntensity: 0.2, unique: true });
  // Rune marks down the front face (the face leans in a little as the pillar
  // narrows): one mesh, whose glow pulses.
  const runes = [[2.9, 0.22, 0.08], [2.55, 0.08, 0.3], [2.15, 0.26, 0.08], [1.75, 0.08, 0.36], [1.32, 0.2, 0.08]].map(([y, w, hgt]) => box(w, hgt, 0.04).rotateX(-0.04).translate(0, y, 0.56 - ((y - 0.6) / 3) * 0.18 + 0.03));
  const rune = new THREE.Mesh(mergeGeometries(runes), glow);
  rune.userData.live = true;
  g.add(rune);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), toon('#9ff0ff', { emissive: '#5fd8ff', emissiveIntensity: 0.25, flatShading: true, unique: true }));
  crystal.scale.y = 1.5;
  crystal.userData.live = true; // it floats
  g.add(crystal);
  let lit = false;
  const v = new THREE.Vector3();
  const ph = jitter(st.id, 'p') * 6;
  animate((dt, t) => {
    crystal.position.y = 4.35 + Math.sin(t * 1.6 + ph) * 0.12;
    crystal.rotation.y += dt * (lit ? 1.2 : 0.4);
    const pulse = lit ? 0.85 + Math.sin(t * 2.4 + ph) * 0.15 : 0.18;
    glow.emissiveIntensity = pulse;
    crystal.material.emissiveIntensity = pulse + (lit ? 0.2 : 0.05);
    if (Math.random() < dt * (lit ? 3 : 0.6)) {
      g.localToWorld(v.set((Math.random() - 0.5) * 1.4, 0.7, (Math.random() - 0.5) * 1.4));
      if (fx.near(v)) fx.puff.burst(v, { ambient: 'wisps', n: 1, color: lit ? ['#bff4ff', '#7fe0ff'] : ['#c8d0d8'], speed: 0.15, up: 1.4, gravity: -0.6, size: 0.12, life: 1.6, drag: 0.4, jitter: 0.05, spin: 0 });
    }
  });
  return {
    group: g,
    setAttuned(on) {
      lit = !!on;
    },
  };
}
