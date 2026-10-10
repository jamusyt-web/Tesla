import * as THREE from 'three';
import { Avatar } from '../scene/avatar.js';
import * as assets from '../scene/assets.js';
import { MODELS } from '../scene/manifest.js';
import { PROC_ICONS } from './proc-icons.js';

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
  cam.near = 0.1; // item icons change the clip planes; reset for portraits
  cam.far = 50;
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

// ── Item icons rendered from 3D models (slot "icon:<itemId>" in the manifest)
const iconCache = new Map();
export function itemIcon(itemId) {
  if (iconCache.has(itemId)) return iconCache.get(itemId);
  let url = null;
  const proc = !assets.has(`icon:${itemId}`) && PROC_ICONS[itemId]; // a manifest model wins
  if (proc || assets.has(`icon:${itemId}`)) {
    const { r, scene, cam } = renderer();
    const obj = proc ? new THREE.Group().add(proc()) : assets.make(`icon:${itemId}`, { outline: true, castShadow: false }).object;
    scene.add(obj);
    const pose = MODELS[`icon:${itemId}`]?.pose;
    if (pose) obj.rotation.set(...pose.map((d) => (d * Math.PI) / 180));
    obj.rotation.y -= 0.5;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const rad = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    r.setSize(128, 128);
    cam.aspect = 1;
    cam.position.set(c.x + rad * 1.1, c.y + rad * 1.5, c.z + rad * 2.6);
    cam.near = rad / 50;
    cam.far = rad * 20;
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // Crop the view to the model's actual on-screen outline, so long thin
    // things (tools, fish) fill the icon as much as chunky ones do.
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.isMesh || o.material.side === THREE.BackSide) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 1500));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
    });
    if (x1 > x0) {
      const s = Math.max(x1 - x0, y1 - y0) / 2 / 0.86; // leave room for the ink outline
      const F = 128 / s;
      cam.setViewOffset(F, F, (((x0 + x1) / 2 - s + 1) / 2) * F, ((1 - ((y0 + y1) / 2 + s)) / 2) * F, 128, 128);
    }
    r.render(scene, cam);
    cam.clearViewOffset();
    url = r.domElement.toDataURL();
    scene.remove(obj);
  }
  iconCache.set(itemId, url);
  return url;
}
