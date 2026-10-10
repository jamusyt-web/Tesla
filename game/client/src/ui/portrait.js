import * as THREE from 'three';
import { Avatar } from '../scene/avatar.js';

// Renders avatar portraits to data URLs with one shared offscreen renderer.
let R = null;
const cache = new Map();

function renderer() {
  if (R) return R;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(160, 160);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b08a66', 1.8));
  const d = new THREE.DirectionalLight('#ffffff', 1.6);
  d.position.set(2, 3, 4);
  scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  R = { r, scene, cam };
  return R;
}

export function portrait(cfg, { full = false } = {}) {
  const key = JSON.stringify(cfg) + full;
  if (cache.has(key)) return cache.get(key);
  const { r, scene, cam } = renderer();
  const av = new Avatar(cfg, { shadowBlob: false });
  av.update(0.016);
  scene.add(av.root);
  if (full) {
    r.setSize(160, 200);
    cam.aspect = 160 / 200;
    cam.position.set(0, 1.4, 6.6);
    cam.lookAt(0, 1.15, 0);
  } else {
    r.setSize(160, 160);
    cam.aspect = 1;
    cam.position.set(0.4, 1.75, 3.2);
    cam.lookAt(0, 1.55, 0);
  }
  cam.updateProjectionMatrix();
  r.render(scene, cam);
  const url = r.domElement.toDataURL();
  scene.remove(av.root);
  av.dispose();
  cache.set(key, url);
  return url;
}
