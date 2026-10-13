// Landmarks in the world (SPEC §5.5): a spyglass cairn on a view, broken
// pillars for a ruin, a little shrine with its light, a chest for a cache,
// a hollow stump for a secret, a dropped curio, a pedlar's stall. Each is
// built from a few toon parts merged into one mesh and one ink shell (two
// draws), and streams with its chunk. Tap one to walk over; the context
// button does the rest. Caches sparkle when you're near.
import * as THREE from 'three';
import { mesh, toon } from './toon.js';
import { mergeRigid } from './merge.js';
import { registerChunkStatic } from './town.js';
import { LANDMARKS } from '../../../shared/world.js';

const OL = 0.03;
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const at = (m, x, y, z, ry = 0) => (m.position.set(x, y, z), (m.rotation.y = ry), m);
const STONE = '#9a9284';
const WOOD = '#8a6238';

const BUILD = {
  vista(g) {
    for (const [i, r] of [0.75, 0.55, 0.38].entries()) g.add(at(mesh(new THREE.IcosahedronGeometry(r, 0), STONE, { outline: OL, mat: toon(STONE, { flatShading: true }) }), 0, 0.5 + i * 0.75, 0));
    g.add(at(mesh(cyl(0.07, 0.07, 1.6, 6), WOOD, { outline: OL }), 0.9, 0.8, 0));
    const glass = mesh(cyl(0.09, 0.13, 0.9, 8), '#c9a24a', { outline: OL });
    glass.rotation.z = Math.PI / 2.4;
    g.add(at(glass, 0.95, 1.65, 0));
  },
  ruin(g) {
    for (const [x, z, h] of [[-1.2, 0, 2.6], [1.2, 0, 1.6], [0, -1.3, 2.1]]) g.add(at(mesh(cyl(0.32, 0.38, h, 8), STONE, { outline: OL }), x, h / 2, z));
    const lintel = mesh(box(2.8, 0.35, 0.6), STONE, { outline: OL });
    lintel.rotation.z = 0.12;
    g.add(at(lintel, 0, 0.25, 1.3));
  },
  shrine(g, ctx) {
    g.add(at(mesh(box(1.6, 0.4, 1.2), STONE, { outline: OL }), 0, 0.2, 0));
    for (const x of [-0.6, 0.6]) g.add(at(mesh(box(0.18, 1.5, 0.18), WOOD, { outline: OL }), x, 1.15, 0));
    const roof = mesh(new THREE.ConeGeometry(1.1, 0.7, 4), '#7a3a2a', { outline: OL });
    roof.rotation.y = Math.PI / 4;
    g.add(at(roof, 0, 2.2, 0));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffe9a0' }));
    orb.userData.live = true; // it floats
    g.add(at(orb, 0, 1.15, 0));
    ctx.animate((dt, t) => (orb.position.y = 1.15 + Math.sin(t * 2) * 0.08));
  },
  cache(g, ctx, lm) {
    g.add(at(mesh(box(1.0, 0.55, 0.7), '#7a4f2a', { outline: OL }), 0, 0.28, 0));
    const lid = mesh(cyl(0.35, 0.35, 1.0, 10, 1), '#8a5a30', { outline: OL });
    lid.rotation.z = Math.PI / 2;
    g.add(at(lid, 0, 0.56, 0));
    g.add(at(mesh(box(1.04, 0.1, 0.74), '#c9a24a'), 0, 0.42, 0));
    // A sparkle now and then when someone is near.
    const p = new THREE.Vector3(lm.x, 1, lm.z);
    ctx.animate((dt) => {
      if (Math.random() < dt * 1.6 && ctx.fx.near(p)) ctx.fx.burst(p, { n: 4, color: ['#fff1a8', '#ffd84a', '#ffffff'], speed: 1.2, up: 1.4, size: 0.1, life: 0.8, gravity: 0.5 });
    });
  },
  secret(g) {
    g.add(at(mesh(cyl(0.7, 0.85, 1.0, 10), '#6a4a2a', { outline: OL }), 0, 0.5, 0));
    g.add(at(mesh(cyl(0.45, 0.45, 0.05, 10), '#2a1a10'), 0, 1.01, 0));
    g.add(at(mesh(new THREE.IcosahedronGeometry(0.3, 0), '#4a7a3a', { mat: toon('#4a7a3a', { flatShading: true }) }), 0.6, 0.15, 0.4));
  },
  curio(g) {
    g.add(at(mesh(cyl(0.45, 0.45, 0.05, 14), '#e0c060', { outline: OL }), 0, 0.06, 0));
    g.add(at(mesh(cyl(0.22, 0.26, 0.22, 12), '#e0c060', { outline: OL }), 0, 0.18, 0));
  },
  npc(g) {
    g.add(at(mesh(box(2.2, 0.9, 1.0), WOOD, { outline: OL }), 0, 0.45, 0));
    for (const x of [-1.0, 1.0]) g.add(at(mesh(box(0.12, 2.2, 0.12), WOOD, { outline: OL }), x, 1.1, -0.4));
    const awning = mesh(box(2.5, 0.08, 1.3), '#3a6a96', { outline: OL });
    awning.rotation.x = 0.25;
    g.add(at(awning, 0, 2.2, 0));
    for (const [x, c] of [[-0.6, '#c9a24a'], [0, '#9aa9b8'], [0.6, '#a63a2e']]) g.add(at(mesh(box(0.35, 0.3, 0.35), c, { outline: OL }), x, 1.05, 0));
  },
  landmark(g) {
    g.add(at(mesh(cyl(0.08, 0.08, 3, 6), WOOD, { outline: OL }), 0, 1.5, 0));
    g.add(at(mesh(box(0.9, 0.55, 0.04), '#a63a2e', { outline: OL }), 0.45, 2.6, 0));
  },
};

const PICK_GEO = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 8).translate(0, 1.2, 0);
PICK_GEO.userData.shared = true;
const PICK_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

registerChunkStatic(
  () => LANDMARKS,
  (lm, ctx) => {
    const build = BUILD[lm.kind] ?? BUILD.landmark;
    const g = new THREE.Group();
    build(g, ctx, lm);
    mergeRigid(g);
    g.position.set(lm.x, 0, lm.z);
    g.rotation.y = lm.rot ?? (lm.x * 0.37 + lm.z * 0.11) % (Math.PI * 2);
    const pv = new THREE.Mesh(PICK_GEO, PICK_MAT);
    pv.layers.set(2);
    pv.userData.landmark = lm.id;
    g.add(pv);
    ctx.pick(pv);
    if (lm.kind === 'npc') ctx.label({ kind: 'landmark', id: lm.id, text: lm.name, glyph: 'talk', pos: new THREE.Vector3(lm.x, 3.2, lm.z) });
    return g;
  },
  { reach: () => 3 },
);
