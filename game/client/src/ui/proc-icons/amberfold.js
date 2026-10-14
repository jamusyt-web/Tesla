// Amberfold's item icons drawn in code (SPEC Phase 3 W1a): the ones no
// model pack has. Builders return an Object3D for the icon renderer
// (client/src/ui/portrait.js), sized to about one unit.
import * as THREE from 'three';
import { inked, rod, vest, amulet, ingot } from '../proc-icons.js';
import { ITEMS } from '../../../../shared/items.js';

// A maple leaf: five points, extruded a little.
function leaf(color, glow = null) {
  const s = new THREE.Shape();
  const pts = 10;
  for (let i = 0; i <= pts; i++) {
    const a = Math.PI / 2 + (i / pts) * Math.PI * 2;
    const r = i % 2 ? 0.28 : 0.62;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  geo.translate(0, 0.08, -0.04);
  const g = new THREE.Group();
  g.add(inked(geo, color, { emissive: glow }));
  const stem = inked(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 6), '#7a4a2a');
  stem.position.y = -0.55;
  g.add(stem);
  g.rotation.set(0.2, 0.9, -0.25);
  return g;
}

// A glossy drop of amber.
function drop(color, glow) {
  const geo = new THREE.SphereGeometry(0.45, 14, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0) p.setX(i, p.getX(i) * (1 - y * 1.6)), p.setZ(i, p.getZ(i) * (1 - y * 1.6)), p.setY(i, y * 1.7);
  }
  geo.computeVertexNormals();
  return inked(geo, color, { emissive: glow });
}

// Honeycomb: a little cluster of hexagonal cells.
function comb() {
  const g = new THREE.Group();
  const cell = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6);
  for (const [x, z] of [[0, 0], [0.35, 0.2], [-0.35, 0.2], [0, 0.4], [0.35, -0.2], [-0.35, -0.2], [0, -0.4]]) {
    const m = inked(cell, '#f2b33a', { emissive: '#d98a1a' });
    m.position.set(x, 0, z);
    g.add(m);
  }
  g.rotation.set(1.1, 0, 0.2);
  return g;
}

// An antler: a curved beam with tines.
function antler(color, big = false) {
  const g = new THREE.Group();
  const beam = (len, r, x, y, rz) => {
    const m = inked(new THREE.CylinderGeometry(r * 0.6, r, len, 7), color);
    m.position.set(x, y, 0);
    m.rotation.z = rz;
    g.add(m);
  };
  beam(1.1, 0.09, 0, 0, 0.35);
  beam(0.5, 0.06, -0.25, 0.25, -0.6);
  beam(0.45, 0.06, -0.05, 0.45, -0.3);
  if (big) beam(0.4, 0.05, 0.12, -0.1, -0.9), beam(0.35, 0.05, -0.35, 0.05, -1.1);
  g.rotation.y = 0.6;
  return g;
}

// Lumps (coal): a few chunky dark stones.
function lumps(color) {
  const g = new THREE.Group();
  for (const [x, y, z, s] of [[0, 0, 0, 0.42], [0.42, -0.1, 0.15, 0.3], [-0.38, -0.12, 0.1, 0.32], [0.05, 0.32, -0.1, 0.26]]) {
    const m = inked(new THREE.DodecahedronGeometry(s, 0), color);
    m.position.set(x, y, z);
    m.rotation.set(x * 3, y * 3, z * 3);
    g.add(m);
  }
  return g;
}

// A haunch of venison: a meaty drumstick with its bone.
function haunch() {
  const g = new THREE.Group();
  const meat = new THREE.SphereGeometry(0.42, 12, 10);
  meat.scale(1, 1.25, 1);
  g.add(inked(meat, '#b5523a'));
  const bone = inked(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), '#f3e6cf');
  bone.position.y = -0.7;
  const knob = inked(new THREE.SphereGeometry(0.13, 10, 8), '#f3e6cf');
  knob.position.y = -1.0;
  g.add(bone, knob);
  g.rotation.z = -0.7;
  return g;
}

// A coil of rope.
function rope() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const t = inked(new THREE.TorusGeometry(0.45 - i * 0.04, 0.09, 8, 24), '#c99a5a', { thick: 0.015 });
    t.rotation.x = Math.PI / 2;
    t.position.y = i * 0.16 - 0.16;
    g.add(t);
  }
  g.rotation.set(0.5, 0, 0.2);
  return g;
}

export default () => ({
  steel_bar: () => ingot('#9aa6b4'),
  venison: haunch,
  coal: () => lumps('#3a3634'),
  amber_sap: () => drop('#f0a020', '#d97a10'),
  heartwood_sap: () => drop('#9a5a2a', '#6a3a1a'),
  honeycomb: comb,
  antler: () => antler('#e9d8b4'),
  elder_antler: () => antler('#d9c08a', true),
  rod_amber: () => rod(ITEMS.rod_amber.skin),
  climbing_rope: rope,
  steel_brigandine: () => vest('#7d8794', '#4f5864'),
  thornroot_jerkin: () => vest('#5f7a3a', '#3f5226'),
  amber_pendant: () => amulet('#e0b04a', '#f0a020'),
  heartwood_amulet: () => amulet('#8a5a32', '#7fc05a'),
  charm_forager_1: () => leaf('#e0782a', '#c95a1a'),
  charm_forager_2: () => leaf('#f2b33a', '#ffb020'),
  trophy_amberfold: () => leaf('#d9a441', '#ffb020'),
});
