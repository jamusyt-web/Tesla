// Amberfold's code-drawn pieces (SPEC Phase 3 W1b): the Smokehouse (its
// signature station), the mouth of the Thornroot Warren (a cave kit's door
// look), and a little apple-cart. procprops.js installs them. Each is a few
// toon parts; the chunk streamer merges them, keeping only what moves
// (smoke, glows) live.
import * as THREE from 'three';
import { mesh, toon } from '../toon.js';
import { CRYPT } from '../../../../shared/world.js';

const OL = 0.03;
const cyl = (a, b, h, s = 10) => new THREE.CylinderGeometry(a, b, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const at = (m, x, y, z, ry = 0) => (m.position.set(x, y, z), (m.rotation.y = ry), m);
const rock = (r, color) => mesh(new THREE.DodecahedronGeometry(r, 0), color, { outline: OL, mat: toon(color, { flatShading: true }) });
// Installed by procprops.js (so tests and the editor see the same kinds).
export default function install({ registerProc, ENTRANCE_LOOKS }) {
  const SMOKE = { ambient: 'smoke', n: 1, color: ['#e8e2d8', '#cfc8bc'], speed: 0.2, up: 0.8, gravity: -0.4, size: 0.5, life: 2.4, drag: 0.6, jitter: 0.12, spin: 0 };

  // The Smokehouse: a timber shed with a hanging rack of fish and a chimney.
  registerProc('proc_smokehouse', (p, { fx, animate }) => {
    const g = new THREE.Group();
    g.add(at(mesh(box(1.9, 1.5, 1.4), '#8a5a32', { outline: OL }), 0, 0.75, 0));
    const roof = mesh(new THREE.ConeGeometry(1.55, 0.9, 4), '#c9682f', { outline: OL });
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.8);
    g.add(at(roof, 0, 1.95, 0, Math.PI / 4));
    g.add(at(mesh(box(0.9, 1.0, 0.06), '#3b2a1a'), 0, 0.6, 0.71)); // the doorway
    g.add(at(mesh(box(0.35, 1.1, 0.35), '#8f8a82', { outline: OL }), 0.55, 2.3, -0.3)); // chimney
    // A rack of fish and venison outside, drying.
    for (const x of [-1.2, 1.2]) g.add(at(mesh(cyl(0.05, 0.05, 1.5, 5), '#6b4226'), x, 0.75, 0.95));
    const bar = at(mesh(cyl(0.04, 0.04, 2.5, 5), '#6b4226'), 0, 1.45, 0.95);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    for (const [x, c] of [[-0.8, '#d9a441'], [-0.3, '#a8483a'], [0.2, '#d9a441'], [0.7, '#a8483a']]) g.add(at(mesh(box(0.16, 0.5, 0.08), c, { outline: 0.015 }), x, 1.12, 0.95));
    const top = new THREE.Object3D();
    top.position.set(0.55, 2.95, -0.3);
    g.add(top);
    const v = new THREE.Vector3();
    animate((dt) => {
      if (Math.random() < dt * 2 && fx.near(top.getWorldPosition(v))) fx.puff.burst(v, SMOKE);
    });
    return g;
  });

  // An apple cart by the harvest shrine and the square.
  registerProc('proc_applecart', () => {
    const g = new THREE.Group();
    g.add(at(mesh(box(1.8, 0.5, 1.0), '#9a6238', { outline: OL }), 0, 0.75, 0));
    for (const sx of [-1, 1]) {
      const w = mesh(cyl(0.42, 0.42, 0.12, 12), '#6b4226', { outline: OL });
      w.rotation.x = Math.PI / 2;
      g.add(at(w, sx * 0.6, 0.42, 0.56));
    }
    for (let i = 0; i < 14; i++) g.add(at(mesh(new THREE.SphereGeometry(0.12, 8, 6), i % 3 ? '#d9442f' : '#e0a33a'), -0.7 + (i % 7) * 0.23, 1.1 + Math.floor(i / 7) * 0.1, -0.2 + Math.floor(i / 7) * 0.3));
    g.add(at(mesh(box(1.4, 0.08, 0.08), '#6b4226'), 1.6, 0.7, 0)); // the handle
    return g;
  });

  // The Warren's door: a mound of red-brown rock with a dark mouth, roots
  // over it, glowing mushrooms and two hanging lanterns. Inside CRYPT's footprint.
  ENTRANCE_LOOKS.cave = (grp, ctx) => {
    const R = '#8a5a42';
    const R2 = '#a06a4a';
    const W = CRYPT.w;
    const D = CRYPT.d;
    for (const [x, y, z, r, c] of [[-2.2, 1.2, -0.6, 1.9, R], [2.1, 1.1, -0.5, 1.8, R2], [0, 2.6, -1.0, 2.1, R], [-1.3, 3.2, -1.8, 1.4, R2], [1.4, 3.0, -1.9, 1.5, R], [-2.5, 0.6, 1.6, 0.9, R2], [2.5, 0.5, 1.7, 0.8, R]]) {
      const m = rock(r, c);
      m.position.set(x, y, z);
      m.rotation.set(x, z, y);
      grp.add(m);
    }
    // The dark mouth, facing out (+z).
    const mouth = mesh(new THREE.CircleGeometry(1.25, 16, 0, Math.PI), '#1b120c');
    mouth.position.set(0, 0.02, D / 2 - 2.35);
    mouth.scale.set(1, 1.6, 1);
    grp.add(mouth);
    // Roots arching over the mouth and down the rock.
    const root = (pts, r) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 16, r, 6), '#5a3a24', { outline: 0.02 });
    grp.add(root([[-1.6, 0, 1.2], [-1.4, 1.8, 0.9], [0, 2.6, 0.7], [1.4, 1.9, 0.9], [1.7, 0, 1.3]], 0.16));
    grp.add(root([[-2.6, 0, 0.2], [-2.1, 2.4, 0.4], [-0.8, 3.6, -0.2]], 0.12));
    grp.add(root([[2.7, 0, 0.4], [2.2, 2.0, 0.5], [1.0, 3.4, 0]], 0.12));
    // Glowing mushrooms about the door.
    const glow = toon('#ffd27a', { emissive: '#ffb84a', emissiveIntensity: 0.8 });
    for (const [x, z, s] of [[-2.0, 2.4, 1], [-2.5, 1.9, 0.7], [2.2, 2.5, 0.9], [1.6, 3.0, 0.6], [-0.9, 3.1, 0.5]]) {
      grp.add(at(mesh(cyl(0.06 * s, 0.08 * s, 0.4 * s, 6), '#f3e6cf'), x, 0.2 * s, z));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), glow);
      grp.add(at(cap, x, 0.38 * s, z));
    }
    // Two lanterns on posts, lit.
    for (const sx of [-1, 1]) {
      grp.add(at(mesh(cyl(0.07, 0.09, 2.2, 6), '#6b4226', { outline: 0.02 }), sx * (W / 2 - 0.4), 1.1, D / 2 - 0.6));
      const lamp = new THREE.Mesh(box(0.3, 0.35, 0.3), toon('#ffcf6a', { emissive: '#ffb340', emissiveIntensity: 1 }));
      lamp.userData.live = true;
      grp.add(at(lamp, sx * (W / 2 - 0.4), 2.1, D / 2 - 0.6));
      ctx.animate((dt, t) => (lamp.material.emissiveIntensity = 0.85 + Math.sin(t * 6 + sx) * 0.15));
    }
  };
}
