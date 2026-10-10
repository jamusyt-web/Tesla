import * as THREE from 'three';
import { ITEMS } from '../../../shared/items.js';
import { mesh, toon } from './toon.js';

const O = 0.018; // outline thickness for small props

// Build the 3D model for a tool/weapon from its item skin. The grip is at the
// origin and the tool extends along +Y; the "business end" faces +Z.
export function buildTool(itemId) {
  const it = ITEMS[itemId];
  const g = new THREE.Group();
  if (!it) return g;
  const s = it.skin || { handle: '#8a5a33', head: '#aaa', edge: '#eee' };
  const glowMat = s.glow ? toon(s.head, { emissive: s.glow, emissiveIntensity: 0.45 }) : null;
  const kind = it.tool || (it.slot === 'weapon' ? 'sword' : null);

  if (kind === 'axe') {
    const handle = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.95, 8), s.handle, { outline: O });
    handle.position.y = 0.38;
    g.add(handle);
    // Wedge-shaped blade, bigger with tier.
    const size = 0.85 + it.tier * 0.1;
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.08);
    shape.lineTo(0.26, -0.17);
    shape.quadraticCurveTo(0.34, 0, 0.26, 0.17);
    shape.lineTo(0, 0.08);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
    geo.translate(0, 0, -0.025);
    const blade = mesh(geo, s.head, { outline: O, mat: glowMat });
    blade.scale.setScalar(size);
    blade.rotation.y = -Math.PI / 2; // blade points +Z
    blade.position.y = 0.74;
    g.add(blade);
    const edge = mesh(new THREE.BoxGeometry(0.04, 0.3 * size, 0.04), s.edge);
    edge.position.set(0, 0.74, 0.3 * size);
    g.add(edge);
    if (it.tier >= 3) {
      const spike = mesh(new THREE.ConeGeometry(0.05, 0.18, 6), s.head, { outline: O, mat: glowMat });
      spike.rotation.x = -Math.PI / 2;
      spike.position.set(0, 0.74, -0.1);
      g.add(spike);
    }
    const cap = mesh(new THREE.SphereGeometry(0.06, 8, 6), s.edge);
    cap.position.y = 0.86;
    g.add(cap);
  } else if (kind === 'pick') {
    const handle = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.95, 8), s.handle, { outline: O });
    handle.position.y = 0.38;
    g.add(handle);
    const arc = mesh(new THREE.TorusGeometry(0.3, 0.045 + it.tier * 0.006, 6, 14, Math.PI * 0.75), s.head, { outline: O, mat: glowMat });
    arc.rotation.z = Math.PI / 2 + Math.PI * 0.125;
    arc.rotation.y = Math.PI / 2;
    arc.position.y = 0.6;
    g.add(arc);
    for (const sgn of [1, -1]) {
      const tip = mesh(new THREE.ConeGeometry(0.05, 0.14, 6), s.edge);
      const a = Math.PI * 0.125 + (sgn > 0 ? 0 : Math.PI * 0.75);
      tip.position.set(0, 0.6 + Math.cos(a) * 0.3, Math.sin(a) * 0.3 * (sgn > 0 ? 1 : 1));
      tip.lookAt(new THREE.Vector3(0, tip.position.y - 0.1, tip.position.z * 3));
      tip.rotateX(Math.PI / 2);
      g.add(tip);
    }
  } else if (kind === 'rod') {
    const rod = mesh(new THREE.CylinderGeometry(0.012, 0.035, 1.7, 6), s.handle, { outline: 0.012 });
    rod.position.y = 0.7;
    g.add(rod);
    const reel = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), s.head);
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.05, 0.08, 0);
    g.add(reel);
    for (let i = 0; i < 3; i++) {
      const ring = mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 8), s.edge, { shadow: false });
      ring.position.y = 0.5 + i * 0.4;
      g.add(ring);
    }
    const tip = new THREE.Object3D();
    tip.position.y = 1.55;
    g.add(tip);
    g.userData.tip = tip;
  } else if (kind === 'sword') {
    const grip = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 8), s.handle, { outline: O });
    grip.position.y = 0.02;
    g.add(grip);
    const pommel = mesh(new THREE.SphereGeometry(0.05, 8, 6), s.edge);
    pommel.position.y = -0.1;
    g.add(pommel);
    const guard = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.3), s.edge, { outline: O });
    guard.position.y = 0.15;
    g.add(guard);
    const len = 0.6 + (it.atk || 4) * 0.008;
    const bladeGeo = new THREE.CylinderGeometry(0.0, 0.06, len, 4, 1);
    bladeGeo.scale(0.4, 1, 1);
    const blade = mesh(bladeGeo, s.head, { outline: O, mat: glowMat || toon(s.head, { emissive: '#ffffff', emissiveIntensity: 0.08 }) });
    blade.position.y = 0.17 + len / 2;
    g.add(blade);
  }
  g.userData.kind = kind;
  return g;
}
