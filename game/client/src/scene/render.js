// How a frame is drawn: the renderer, the three passes (the world; heroes
// hidden behind it as soft silhouettes; the heroes), the shadow map update,
// the camera that follows your hero (and the sun's shadow camera with it),
// fading what stands between the camera and you, and warming up shaders.
import * as THREE from 'three';
import { useGrade } from './grade.js';
import * as assets from './assets.js';
import { MONSTERS } from '../../../shared/monsters.js';

const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const defOf = (mv) => mv?.def ?? MONSTERS[mv?.type] ?? null;

export function createRenderer(low) {
  const renderer = new THREE.WebGLRenderer({ antialias: !low || devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // soft is the costly path on phone GPUs
  useGrade(renderer);
  return renderer;
}

// After the scene is set up. Heroes live in a small scene of their own, so the
// two hero passes walk a handful of objects instead of the whole world; the
// world's matrices are updated once per frame (here), not once per pass; and
// the shadow map is only redrawn when it has to be (see updateShadows).
export function setupPasses(g) {
  // X-ray pass: your hero and your party behind buildings/trees still show as a soft silhouette.
  g.silMat = new THREE.MeshBasicMaterial({ color: '#fff1b0', transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
  g.heroScene = new THREE.Scene();
  g.heroScene.fog = g.scene.fog;
  g.scene.matrixWorldAutoUpdate = false;
  g.heroScene.matrixWorldAutoUpdate = false;
  g.renderer.autoClear = false;
  g.renderer.shadowMap.autoUpdate = false;
  g.shadow = { cx: NaN, cz: NaN, until: 0, rev: -1, half: g.low ? 20 : 30 };
  const sc = g.sun.shadow.camera;
  sc.left = sc.bottom = -g.shadow.half;
  sc.right = sc.top = g.shadow.half;
  sc.updateProjectionMatrix();
}

// Something that casts a shadow changed (a tree fell, a gate opened, the
// world was rebuilt): redraw the shadow map on every frame for `seconds`.
export function markShadows(g, seconds = 0) {
  if (!g.shadow) return;
  g.shadow.until = Math.max(g.shadow.until, performance.now() + seconds * 1000);
  g.shadow.dirty = true;
}

// Heroes on screen in the silhouette pass: yours and your party's.
function silhouetteHeroes(g) {
  const party = new Set(g.hud?.party?.members?.map((m) => m.id) ?? []);
  const out = [];
  for (const pv of g.players.values()) if (pv.isMe || party.has(pv.id)) out.push(pv);
  return out;
}

export function renderFrame(g) {
  const r = g.renderer;
  const S = g.shadow;
  if (g.town && !g.dungeon && g.town.rev !== S.rev) (S.rev = g.town.rev), (S.dirty = true); // squares built or dropped
  if (S.dirty || performance.now() < S.until) {
    r.shadowMap.needsUpdate = true;
    S.dirty = false;
  }
  g.scene.updateMatrixWorld();
  g.heroScene.updateMatrixWorld();
  r.clear();
  // 1) the world
  r.render(g.scene, g.camera);
  // The heroes' scene borrows the lights (an object has one parent).
  g.heroScene.add(g.hemi, g.sun, g.sun.target);
  // 2) your party hidden behind the world, as silhouettes (no ink lines)
  const hidden = [];
  for (const pv of g.players.values()) if (pv.av.root.visible) (pv.av.root.visible = false), hidden.push(pv.av.root);
  for (const pv of silhouetteHeroes(g)) {
    if (pv.hidden) continue;
    pv.av.root.visible = true;
    pv.av.root.traverse((o) => o.isMesh && o.material.side === THREE.BackSide && o.visible && ((o.visible = false), hidden.push(o)));
  }
  g.camera.layers.set(1);
  g.heroScene.overrideMaterial = g.silMat;
  r.render(g.heroScene, g.camera);
  g.heroScene.overrideMaterial = null;
  for (const o of hidden) o.visible = true;
  for (const pv of g.players.values()) if (pv.hidden) pv.av.root.visible = false;
  // 3) the heroes (and their ground blobs, which are on layer 0)
  g.camera.layers.enable(0);
  r.render(g.heroScene, g.camera);
  g.camera.layers.set(0);
  g.scene.add(g.hemi, g.sun, g.sun.target);
}

// Compile every shader the scene needs before anyone sees it, including the
// see-through versions of anything that fades out between camera and hero
// (a faded material is transparent, which three.js draws with other shaders).
export async function warm(g) {
  try {
    updateCamera(g, 0.016);
    g.mood.update();
    const mats = (g.dungeon?.fades ?? g.town?.fades ?? []).flatMap((f) => (f.op < 1 ? [] : f.mats));
    for (const m of mats) m.transparent = true;
    const done = g.renderer.compileAsync?.(g.scene, g.camera); // starts every compile now
    for (const m of mats) m.transparent = false;
    await g.renderer.compileAsync?.(g.scene, g.camera);
    await done;
  } catch {}
}

// Compile the shaders a group of models needs before any of them is seen:
// one copy of each, plus an instanced copy of each material (scenery is
// drawn instanced) and an ink hull of each kind. Nothing here is ever drawn.
export async function warmModels(g, slots, extra = []) {
  const grp = new THREE.Group();
  for (const o of extra) grp.add(o);
  const inst = new Map(); // material → a geometry it's drawn with
  for (const s of slots) {
    const m = assets.make(s, { outline: false });
    if (!m) continue;
    grp.add(m.object);
    m.object.traverse((o) => o.isMesh && !o.isSkinnedMesh && !inst.has(o.material) && inst.set(o.material, o.geometry));
  }
  for (const [mat, geo] of inst) {
    if (Array.isArray(mat)) continue;
    const im = new THREE.InstancedMesh(geo, mat, 1);
    im.castShadow = im.receiveShadow = true;
    grp.add(im);
  }
  const hullGeo = new THREE.BoxGeometry(1, 1, 1);
  grp.add(new THREE.Mesh(hullGeo, assets.outline()), new THREE.InstancedMesh(hullGeo, assets.outline(), 1));
  try {
    await g.renderer.compileAsync?.(grp, g.camera, g.scene);
  } catch {}
}

// Follow your hero (in a battle: the middle of the fight, from the side), and
// keep the sun's shadow camera centred on the view.
export function updateCamera(g, dt) {
  const me = g.me;
  if (!me) return;
  const c = g.cam;
  let tx = me.local.x;
  let tz = me.local.z;
  let dist = c.dist;
  let pitch = c.pitch;
  let yaw = c.yaw;
  if (g.battle) {
    const mv = g.mobs.get(g.battle.mob);
    if (mv) {
      tx = (me.local.x + mv.x) / 2;
      tz = (me.local.z + mv.z) / 2;
      const boss = defOf(mv).boss;
      if (g.dungeon) {
        // Underground: keep the quarter turn (the cut-away walls depend on it).
        dist = boss ? 15 : 12;
        pitch = 0.8;
      } else {
        // Side-on view of the fight.
        yaw = Math.atan2(mv.x - me.local.x, mv.z - me.local.z) + Math.PI / 2 + 0.35;
        dist = boss ? 15 : 11.5;
        pitch = 0.55;
      }
    }
  }
  if (g.dungeon && !g.battle) dist = Math.max(10, Math.min(20, dist));
  c.target.x += (tx - c.target.x) * Math.min(1, dt * 7);
  c.target.z += (tz - c.target.z) * Math.min(1, dt * 7);
  c.curYaw = c.curYaw === undefined ? yaw : lerpAngle(c.curYaw, yaw, Math.min(1, dt * 4));
  c.curDist = c.curDist === undefined ? dist : c.curDist + (dist - c.curDist) * Math.min(1, dt * 4);
  c.curPitch = c.curPitch === undefined ? pitch : c.curPitch + (pitch - c.curPitch) * Math.min(1, dt * 4);
  const cam = g.camera;
  const hor = Math.cos(c.curPitch) * c.curDist;
  cam.position.set(c.target.x + Math.sin(c.curYaw) * hor, Math.sin(c.curPitch) * c.curDist + 1, c.target.z + Math.cos(c.curYaw) * hor);
  if (g.shakeAmt > 0) {
    g.shakeAmt = Math.max(0, g.shakeAmt - dt * 1.8);
    cam.position.x += (Math.random() - 0.5) * g.shakeAmt;
    cam.position.y += (Math.random() - 0.5) * g.shakeAmt;
  }
  cam.lookAt(c.target.x, 1.4, c.target.z);
  // Nothing past the fog is drawn.
  const far = g.scene.fog.far + 10;
  if (cam.far !== far) {
    cam.far = far;
    cam.updateProjectionMatrix();
  }
  updateShadows(g);
}

// The sun's shadow box: centred a little ahead of the hero (the camera sees
// more ground beyond them than behind), snapped to whole shadow-map texels and
// moved only in steps of 3 m. The map is redrawn only when the box moves or a
// caster changed (markShadows), not every frame.
const SUN_TOWN = new THREE.Vector3(40, 34, 10);
const SUN_CRYPT = new THREE.Vector3(6, 40, 12);
const _l = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
function updateShadows(g) {
  const S = g.shadow;
  const c = g.cam;
  const off = g.dungeon ? SUN_CRYPT : SUN_TOWN;
  const push = g.dungeon || g.battle ? 0 : S.half * 0.35;
  const yaw = c.curYaw ?? c.yaw;
  let x = c.target.x - Math.sin(yaw) * push;
  let z = c.target.z - Math.cos(yaw) * push;
  if (Math.hypot(x - S.cx, z - S.cz) < 3 && S.off === off) return;
  // Snap to the texel grid in the light's own frame so redraws line up exactly.
  _l.copy(off).normalize();
  _r.set(0, 1, 0).cross(_l).normalize();
  _u.copy(_l).cross(_r);
  const texel = (2 * S.half) / g.sun.shadow.mapSize.x;
  const a = Math.round((x * _r.x + z * _r.z) / texel) * texel;
  const b = Math.round((x * _u.x + z * _u.z) / texel) * texel;
  const d = x * _l.x + z * _l.z;
  // Back from (a, b, d) in the light's frame to a point on the ground.
  const px = _r.x * a + _u.x * b + _l.x * d;
  const py = _r.y * a + _u.y * b + _l.y * d;
  const pz = _r.z * a + _u.z * b + _l.z * d;
  // Slide along the light direction down to y = 0 (same shadow, same texels).
  const k = py / _l.y;
  x = px - _l.x * k;
  z = pz - _l.z * k;
  S.cx = x;
  S.cz = z;
  S.off = off;
  g.sun.position.set(x + off.x, off.y, z + off.z);
  g.sun.target.position.set(x, 0, z);
  g.sun.updateMatrixWorld();
  g.sun.target.updateMatrixWorld();
  S.dirty = true;
}

// Fade buildings that sit between the camera and your hero.
export function fadeOccluders(g, dt) {
  if (!g.me) return;
  const head = g.battle ? new THREE.Vector3(g.cam.target.x, 1.4, g.cam.target.z) : new THREE.Vector3(g.me.local.x, 1.4, g.me.local.z);
  const dir = head.clone().sub(g.camera.position);
  const len = dir.length();
  const ray = new THREE.Ray(g.camera.position, dir.normalize());
  const hit = new THREE.Vector3();
  for (const f of g.dungeon?.fades ?? g.town.fades) {
    const blocks = ray.intersectBox(f.box, hit) && hit.distanceTo(g.camera.position) < len - 0.5 && !f.box.containsPoint(head);
    const target = blocks ? 0.28 : 1;
    if (Math.abs(f.op - target) < 0.01) continue;
    f.op += (target - f.op) * Math.min(1, dt * 8);
    if (Math.abs(f.op - target) < 0.01) f.op = target;
    for (const m of f.mats) {
      m.transparent = f.op < 1;
      m.opacity = f.op;
      m.depthWrite = f.op >= 1;
    }
    for (const o of f.outlines) o.visible = f.op > 0.9;
  }
}

