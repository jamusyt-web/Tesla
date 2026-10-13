// How a frame is drawn: the renderer, the three passes (the world; heroes
// hidden behind it as soft silhouettes; the heroes), the shadow map update,
// the camera that follows your hero (and the sun's shadow camera with it),
// fading what stands between the camera and you, and warming up shaders.
import * as THREE from 'three';
import { useGrade } from './grade.js';
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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  useGrade(renderer);
  return renderer;
}

// After the scene is set up: frames clear by hand and shadows update on our say.
export function setupPasses(g) {
  // X-ray pass: heroes behind buildings/trees still show as a soft silhouette.
  g.silMat = new THREE.MeshBasicMaterial({ color: '#fff1b0', transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
  g.renderer.autoClear = false;
  g.renderer.shadowMap.autoUpdate = false;
}

export function renderFrame(g) {
  const r = g.renderer;
  r.shadowMap.needsUpdate = true;
  r.clear();
  // 1) world  2) heroes hidden behind the world, as silhouettes  3) heroes
  r.render(g.scene, g.camera);
  g.camera.layers.set(1);
  g.scene.overrideMaterial = g.silMat;
  r.render(g.scene, g.camera);
  g.scene.overrideMaterial = null;
  r.render(g.scene, g.camera);
  g.camera.layers.set(0);
}

// Compile every shader the scene needs before anyone sees it.
export async function warm(g) {
  try {
    updateCamera(g, 0.016);
    g.mood.update();
    await g.renderer.compileAsync?.(g.scene, g.camera);
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
  if (g.dungeon) {
    // Moonlight from almost straight above (short shadows).
    g.sun.position.set(c.target.x + 6, 40, c.target.z + 12);
    g.sun.target.position.set(c.target.x, 0, c.target.z);
    return;
  }
  g.sun.position.set(c.target.x + 40, 34, c.target.z + 10);
  g.sun.target.position.set(c.target.x, 0, c.target.z);
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

