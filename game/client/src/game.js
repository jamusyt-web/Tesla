import * as THREE from 'three';
import { Avatar } from './scene/avatar.js';
import { Mob } from './scene/mobs.js';
import { buildTown } from './scene/town.js';
import { Particles, Rings } from './scene/fx.js';
import { h } from './util/dom.js';
import { sfx } from './util/sfx.js';
import { ITEMS } from '../../shared/items.js';
import { MONSTERS } from '../../shared/monsters.js';
import {
  generateNodes, generateScenery, buildColliders, NavGrid, stepPath, approachPoint, doorPoint,
  BUILDINGS, NODE_TYPES, INTERACT_RANGE, FISH_RANGE, GATE, ZONES,
} from '../../shared/world.js';

const INTERP_DELAY = 130; // ms behind real time we render other players
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const isTouch = matchMedia('(pointer: coarse)').matches;

// Shared static world data (same deterministic generation as the server).
const STATIC = (() => {
  const nodes = generateNodes();
  const col = buildColliders(nodes, generateScenery());
  return { nodes: new Map(nodes.map((n) => [n.id, n])), col, nav: new NavGrid(col) };
})();

class RemoteBody {
  constructor() {
    this.buf = [];
  }
  push(x, z, rot, act) {
    const now = performance.now();
    const last = this.buf[this.buf.length - 1];
    // Entity was idle (no snapshots): re-anchor so we don't interpolate across the gap.
    if (last && now - last.t > 250) this.buf.push({ ...last, t: now - 100 });
    this.buf.push({ t: now, x, z, rot, act });
    if (this.buf.length > 30) this.buf.splice(0, this.buf.length - 30);
  }
  sample() {
    const rt = performance.now() - INTERP_DELAY;
    const b = this.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= rt) {
        const a = b[i];
        const n = b[i + 1];
        if (!n) return a;
        const k = (rt - a.t) / (n.t - a.t);
        return { x: a.x + (n.x - a.x) * k, z: a.z + (n.z - a.z) * k, rot: lerpAngle(a.rot, n.rot, k), act: n.act };
      }
    }
    return b[b.length - 1];
  }
}

export class GameClient {
  constructor(root, sock, hud) {
    this.root = root;
    this.sock = sock;
    this.hud = hud;
    this.players = new Map();
    this.mobs = new Map();
    this.me = null;
    this.myId = null;
    this.intent = null;
    this.gather = null;
    this.fishing = null;
    this.battle = null;
    this.cam = { yaw: 0, pitch: 0.8, dist: isTouch ? 16 : 18, target: new THREE.Vector3() };
    this.shakeAmt = 0;
    this.clock = new THREE.Clock();
    this.t = 0;
    this.keys = new Set();
    this.lastKeyMove = 0;

    const low = isTouch || Math.min(screen.width, screen.height) < 700;
    this.low = low;
    const renderer = new THREE.WebGLRenderer({ antialias: !low || devicePixelRatio < 2, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.el = h('div#game');
    this.el.append(renderer.domElement);
    this.labelLayer = h('div.labels');
    this.el.append(this.labelLayer);
    root.append(this.el);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#cdeaf7', 70, 190);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
    const hemi = new THREE.HemisphereLight('#dff3ff', '#a37d55', 1.5);
    hemi.layers.enableAll(); // lights must be on the hero layer too
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.layers.enableAll();
    sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 140;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.fx = new Particles(scene);
    this.fx.puff = new Particles(scene, 300, true);
    // X-ray pass: heroes behind buildings/trees still show as a soft silhouette.
    this.silMat = new THREE.MeshBasicMaterial({ color: '#fff1b0', transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false });
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    this.rings = new Rings(scene);
    this.town = buildTown(scene, this.fx, { low });
    this.nodeLabels = new Map();
    this.#makeStaticLabels();
    this.#makeMarker();
    this.#makeGuide();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();
    this.#bindInput();
    this.#bindNet();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.running = true;
    this.loop();
  }

  resize() {
    const w = innerWidth;
    const hh = innerHeight;
    this.renderer.setSize(w, hh);
    this.camera.aspect = w / hh;
    this.camera.fov = w < hh ? 55 : 45;
    this.camera.updateProjectionMatrix();
  }

  // ── Labels (HTML overlay, always crisp, never clipped) ──────────────
  #makeStaticLabels() {
    this.staticLabels = this.town.labels.map((l) => {
      const el =
        l.kind === 'place'
          ? h('div.place', { on: { click: (e) => (e.stopPropagation(), this.goBuilding(l.id)) } }, h('span.ic', l.icon), l.text)
          : h('div.zone-tag', l.text);
      this.labelLayer.append(el);
      return { ...l, el };
    });
  }
  #makeMarker() {
    const m = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#ffd84a' }));
    arrow.rotation.x = Math.PI;
    arrow.position.y = 1;
    m.add(ring, arrow);
    m.visible = false;
    this.scene.add(m);
    this.marker = m;
  }

  // Quest guide: a soft light pillar + spinning gem over the target, and a
  // trail of glowing dots along the actual walking path to it.
  #makeGuide() {
    const grad = document.createElement('canvas');
    grad.width = 1;
    grad.height = 64;
    const gx = grad.getContext('2d');
    const gg = gx.createLinearGradient(0, 0, 0, 64);
    gg.addColorStop(0, 'rgba(255,230,120,0)');
    gg.addColorStop(1, 'rgba(255,230,120,1)');
    gx.fillStyle = gg;
    gx.fillRect(0, 0, 1, 64);
    const tex = new THREE.CanvasTexture(grad);
    const group = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 26, 20, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }),
    );
    pillar.position.y = 13;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: '#ffd84a', fog: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 36), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    group.add(pillar, gem, ring);
    group.visible = false;
    this.scene.add(group);
    const MAXD = 70;
    const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.9, depthWrite: false }), MAXD);
    dots.count = 0;
    dots.frustumCulled = false;
    this.scene.add(dots);
    this.guide = { group, gem, ring, dots, MAXD, pts: [], target: null, recalc: 0, from: null };
  }

  setGuide(tg) {
    this.guide.target = tg ? { x: tg.x, z: tg.z, y: tg.y } : null;
  }

  #updateGuide(dt) {
    const G = this.guide;
    const tg = G.target;
    G.group.visible = !!tg;
    if (!tg || !this.me) {
      G.dots.count = 0;
      return;
    }
    G.group.position.set(tg.x, 0, tg.z);
    G.gem.position.y = tg.y + 0.6 + Math.sin(this.t * 3) * 0.25;
    G.gem.rotation.y += dt * 2;
    G.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);
    const L = this.me.local;
    // Re-plan the trail occasionally, or when the target/you moved a lot.
    G.recalc -= dt;
    const moved = !G.from || Math.hypot(G.from.x - L.x, G.from.z - L.z) > 2.5 || Math.hypot(G.from.tx - tg.x, G.from.tz - tg.z) > 1.5;
    if (G.recalc <= 0 || moved) {
      G.recalc = 0.8;
      G.from = { x: L.x, z: L.z, tx: tg.x, tz: tg.z };
      const path = Math.hypot(tg.x - L.x, tg.z - L.z) > 5 ? STATIC.nav.findPath(L.x, L.z, tg.x, tg.z) : null;
      G.pts = [];
      if (path) {
        let ax = L.x;
        let az = L.z;
        let carry = 1.6;
        for (const [bx, bz] of path) {
          const seg = Math.hypot(bx - ax, bz - az);
          let d = carry;
          while (d < seg && G.pts.length < G.MAXD) {
            G.pts.push([ax + ((bx - ax) * d) / seg, az + ((bz - az) * d) / seg]);
            d += 1.6;
          }
          carry = d - seg;
          ax = bx;
          az = bz;
        }
        G.pts = G.pts.slice(0, Math.max(0, G.pts.length - 1));
      }
    }
    const o = new THREE.Object3D();
    G.pts.forEach(([x, z], i) => {
      o.position.set(x, 0.08, z);
      o.scale.setScalar(0.75 + 0.35 * Math.max(0, Math.sin(this.t * 5 - i * 0.6)));
      o.updateMatrix();
      G.dots.setMatrixAt(i, o.matrix);
    });
    G.dots.count = G.pts.length;
    G.dots.instanceMatrix.needsUpdate = true;
  }

  project(v, out = {}) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * innerHeight;
    out.vis = p.z < 1 && p.z > -1 && out.x > -100 && out.x < innerWidth + 100 && out.y > -100 && out.y < innerHeight + 100;
    return out;
  }

  // Floating text at a world position (damage numbers, loot, PERFECT!).
  floatText(pos, text, cls = '') {
    const s = this.project(pos);
    if (!s.vis) return;
    const el = h('div.float' + (cls ? '.' + cls.split(' ').join('.') : ''), text);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    this.labelLayer.append(el);
    setTimeout(() => el.remove(), 1700);
  }

  // ── Entities ─────────────────────────────────────────────────────────
  addPlayer(p, isMe = false) {
    if (this.players.has(p.id)) this.removePlayer(p.id);
    const av = new Avatar(p.avatar, { equip: p.equip, layer: 1 });
    av.root.position.set(p.x, 0, p.z);
    av.root.rotation.y = p.rot || 0;
    av.root.userData = { kind: 'player', id: p.id };
    av.root.traverse((o) => (o.userData.player = p.id));
    this.scene.add(av.root);
    const tag = h('div.tag' + (isMe ? '.me' : ''), h('div.bubbles'), h('div', h('span.lvl', p.level), h('span.nm', p.name)));
    this.labelLayer.append(tag);
    const pv = { id: p.id, info: p, av, tag, body: new RemoteBody(), act: p.act, x: p.x, z: p.z, rot: p.rot || 0, isMe };
    pv.body.push(p.x, p.z, p.rot || 0, p.act);
    this.players.set(p.id, pv);
    if (isMe) {
      this.me = pv;
      this.myId = p.id;
      pv.local = { x: p.x, z: p.z, rot: p.rot || 0, path: null };
      pv.srv = { x: p.x, z: p.z, act: p.act };
      this.cam.target.set(p.x, 0, p.z);
    }
    this.#applyAct(pv, p.act);
    return pv;
  }
  removePlayer(id) {
    const pv = this.players.get(id);
    if (!pv) return;
    this.scene.remove(pv.av.root);
    pv.av.dispose();
    pv.tag.remove();
    this.players.delete(id);
  }
  #applyAct(pv, act) {
    pv.act = act;
    const hold = { chop: 'axe', mine: 'pick', fish: 'rod', battle: 'weapon' }[act] ?? null;
    if (pv.isMe && this.gather) pv.av.hold(this.gather.tool);
    else if (pv.isMe && this.fishing) pv.av.hold('rod');
    else if (pv.isMe && this.battle) pv.av.hold('weapon');
    else pv.av.hold(hold);
  }

  addMob(m) {
    let mv = this.mobs.get(m.id);
    if (mv) return mv;
    const mob = new Mob(m.type);
    mob.root.position.set(m.x, 0, m.z);
    mob.root.userData = { kind: 'mob', id: m.id };
    mob.root.traverse((o) => (o.userData.mob = m.id));
    this.scene.add(mob.root);
    const d = MONSTERS[m.type];
    const tag = h('div.tag.mob', h('span.fight.hidden', '⚔️'), h('div', h('span.lvl', { style: { background: d.boss ? '#a868e0' : '#ea5a4f', boxShadow: 'none' } }, d.lvl), h('span.nm', d.name)));
    this.labelLayer.append(tag);
    mv = { id: m.id, type: m.type, mob, tag, body: new RemoteBody(), state: m.state, x: m.x, z: m.z };
    mv.body.push(m.x, m.z, m.rot, m.state);
    this.mobs.set(m.id, mv);
    this.#mobState(mv, m.state);
    return mv;
  }
  #mobState(mv, st) {
    const prev = mv.state;
    mv.state = st;
    mv.tag.querySelector('.fight').classList.toggle('hidden', st !== 'battle');
    if (st === 'dead') {
      if (prev !== 'dead' && mv.mob.root.visible) {
        mv.mob.play('die');
        setTimeout(() => mv.state === 'dead' && (mv.mob.root.visible = false), 800);
      } else mv.mob.root.visible = false;
    } else if (prev === 'dead' || !mv.mob.root.visible) {
      mv.mob.oneShot = null;
      mv.mob.root.visible = true;
      mv.body.buf = [];
      this.fx.burst(new THREE.Vector3(mv.x, 0.5, mv.z), { n: 14, color: ['#ffffff', '#e9e2d0'], speed: 3, up: 2, gravity: 2, size: 0.4, life: 0.7, drag: 2 });
    }
  }

  // ── Networking ───────────────────────────────────────────────────────
  #bindNet() {
    const s = this.sock;
    this.off = [
      s.on('welcome', (m) => this.onWelcome(m)),
      s.on('_close', () => {
        this.endFishing();
        this.stopGather();
      }),
      s.on('join', (m) => {
        this.addPlayer(m.p);
        this.hud.setOnline(this.players.size);
        this.hud.chatLine({ sys: true, text: `👋 ${m.p.name} arrived in town.` });
      }),
      s.on('leave', (m) => {
        const pv = this.players.get(m.id);
        if (pv) this.hud.chatLine({ sys: true, text: `${pv.info.name} left.` });
        this.removePlayer(m.id);
        this.hud.setOnline(this.players.size);
      }),
      s.on('s', (m) => this.onSnapshot(m)),
      s.on('nh', (m) => this.onNodeHit(m)),
      s.on('node', (m) => this.onNode(m)),
      s.on('loot', (m) => this.onLoot(m)),
      s.on('cast', (m) => {
        const pv = this.players.get(m.by);
        if (pv && !pv.isMe) {
          pv.av.hold('rod');
          pv.av.play('cast');
        }
      }),
      s.on('reel', (m) => {
        const pv = this.players.get(m.by);
        if (pv && !pv.isMe) pv.av.play('reel');
      }),
      s.on('bite', (m) => this.onBite(m)),
      s.on('landed', (m) => {
        const pv = this.players.get(m.by);
        if (!pv || pv.isMe) return;
        pv.av.hold(null);
        if (m.ok && ITEMS[m.item]) {
          pv.av.play('cheer');
          this.floatText(pv.av.root.position.clone().setY(3), ITEMS[m.item].icon, 'crit');
        }
      }),
      s.on('fishResult', (m) => this.onFishResult(m)),
      s.on('emote', (m) => this.onEmote(m)),
      s.on('chat', (m) => this.onChat(m)),
      s.on('equip', (m) => this.players.get(m.id)?.av.setEquip(m.equip)),
      s.on('avatar', (m) => {
        const pv = this.players.get(m.id);
        if (pv) {
          pv.info.avatar = m.avatar;
          pv.av.build(m.avatar);
          pv.av.root.traverse((o) => (o.userData.player = pv.id));
        }
      }),
      s.on('battle', (m) => this.onBattle(m.b)),
      s.on('bres', (m) => this.onBattleRound(m)),
      s.on('battleEnd', (m) => this.onBattleEnd(m)),
    ];
  }

  onWelcome(m) {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.mobs.keys()]) {
      const mv = this.mobs.get(id);
      this.scene.remove(mv.mob.root);
      mv.tag.remove();
      this.mobs.delete(id);
    }
    this.battle = null;
    this.gather = null;
    this.endFishing();
    this.hud.hideRhythm();
    this.addPlayer(m.you, true);
    for (const p of m.players) this.addPlayer(p);
    for (const mob of m.mobs) this.addMob(mob);
    for (const n of this.town.nodes.values()) if (!n.alive) n.respawn();
    for (const ns of m.nodes) {
      const v = this.town.nodes.get(ns.id);
      if (!v) continue;
      v.setHp(ns.hp);
      if (!ns.alive) {
        v.alive = false;
        v.full.visible = false;
        v.stump.visible = true;
      }
    }
    this.channel = m.channel;
    this.hud.onWelcome(m);
    this.hud.setOnline(this.players.size);
    for (const b of m.battles) this.onBattle(b);
  }

  onSnapshot(m) {
    for (const [id, x, z, rot, act] of m.p) {
      const pv = this.players.get(id);
      if (!pv) continue;
      if (pv.isMe) {
        pv.srv = { x, z, act };
        if (act !== pv.act && !(act === 'walk' || act === 'idle')) this.#applyAct(pv, act);
        pv.act = act;
        continue;
      }
      pv.body.push(x, z, rot, act);
      if (act !== pv.act) this.#applyAct(pv, act);
    }
    for (const [id, x, z, rot, st] of m.m) {
      const mv = this.mobs.get(id);
      if (!mv) continue;
      mv.body.push(x, z, rot, st);
      if (st !== mv.state) this.#mobState(mv, st);
    }
  }

  // ── Input ────────────────────────────────────────────────────────────
  #bindInput() {
    const c = this.renderer.domElement;
    const ptrs = new Map();
    let down = null;
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      sfx.unlock();
      c.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), yaw: this.cam.yaw, pitch: this.cam.pitch, moved: false };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.cam.dist };
        down = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.cam.dist = Math.max(9, Math.min(34, pinch.dist * (pinch.d / d)));
        return;
      }
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 10) down.moved = true;
        if (down.moved && !this.battle) {
          this.cam.yaw = down.yaw - dx * 0.008;
          this.cam.pitch = Math.max(0.45, Math.min(1.3, down.pitch + dy * 0.004));
        }
      }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (down && !down.moved && performance.now() - down.t < 600 && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
      if (!ptrs.size) down = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(9, Math.min(34, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'e' || k === 'f') {
        e.preventDefault();
        this.actionKey();
        return;
      }
      if (k === 'q') this.cam.yaw += 0.3;
      if (k === 'r') this.cam.yaw -= 0.3;
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  pick(x, y) {
    const v = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const objs = [...this.town.pickables, ...[...this.players.values()].filter((p) => !p.isMe).map((p) => p.av.root), ...[...this.mobs.values()].filter((m) => m.mob.root.visible).map((m) => m.mob.root)];
    const hits = this.raycaster.intersectObjects(objs, true);
    let ground = null;
    for (const hit of hits) {
      const u = hit.object.userData;
      if (u.mob) return { kind: 'mob', id: u.mob, point: hit.point };
      if (u.player) return { kind: 'player', id: u.player, point: hit.point };
      if (u.node) return { kind: 'node', id: u.node, point: hit.point };
      if (u.building) return { kind: 'building', id: u.building, point: hit.point };
      if ((u.ground || u.water) && !ground) ground = { kind: 'ground', point: hit.point };
    }
    return ground;
  }

  tap(x, y) {
    if (this.battle) return;
    // While fishing or gathering, taps are the action itself.
    if (this.fishing) {
      this.reel();
      return;
    }
    // Gathering: a tap anywhere on/inside the timing ring (or on the node) is a swing.
    if (this.gather) {
      const n = STATIC.nodes.get(this.gather.node);
      const c = this.project(new THREE.Vector3(n.x, NODE_TYPES[n.type].kind === 'tree' ? 2.2 : 1.3, n.z));
      if (Math.hypot(x - c.x, y - c.y) <= 110) return this.swing();
    }
    const hit = this.pick(x, y);
    if (!hit) return;
    if (this.gather && hit.kind === 'node' && hit.id === this.gather.node) {
      this.swing();
      return;
    }
    this.stopGather();
    if (hit.kind === 'ground') return this.walkTo(hit.point.x, hit.point.z, true);
    if (hit.kind === 'node') return this.goNode(hit.id);
    if (hit.kind === 'mob') return this.goMob(hit.id);
    if (hit.kind === 'player') return this.hud.openProfile(hit.id);
    if (hit.kind === 'building') {
      const b = BUILDINGS.find((bb) => bb.id === hit.id);
      if (b && !b.deco) return this.goBuilding(b.id);
      return this.walkTo(hit.point.x, hit.point.z, true);
    }
  }

  actionKey() {
    if (this.fishing) return this.reel();
    if (this.gather) return this.swing();
  }

  walkTo(x, z, marker = false, onArrive = null) {
    if (this.hud.fight) return false; // mid reel-fight: stay put
    if (this.fishing) this.endFishing(); // the server cancels too when it gets the move
    const L = this.me.local;
    const path = STATIC.nav.findPath(L.x, L.z, x, z);
    if (!path) return false;
    L.path = path;
    this.intent = onArrive ? { onArrive } : null;
    this.sock.send({ t: 'move', x, z });
    if (marker) {
      const end = path[path.length - 1];
      this.marker.position.set(end[0], 0.05, end[1]);
      this.marker.visible = true;
      this.markerT = 0;
      this.rings.spawn({ x: end[0], z: end[1] }, { color: '#ffffff', size: 1.1, life: 0.45 });
      sfx.tap();
    }
    return true;
  }

  goNode(id) {
    const node = STATIC.nodes.get(id);
    const view = this.town.nodes.get(id);
    const t = NODE_TYPES[node.type];
    if (!view.alive) {
      this.hud.toast(`This ${t.name} is regrowing…`);
      return;
    }
    const L = this.me.local;
    const range = t.kind === 'fish' ? FISH_RANGE - 0.5 : INTERACT_RANGE + t.r * node.s;
    const arrive = () => this.startNodeAction(id);
    if (Math.hypot(L.x - node.x, L.z - node.z) <= range && STATIC.nav.clear(L.x, L.z, node.x + (L.x - node.x) * 0.5, node.z + (L.z - node.z) * 0.5)) return arrive();
    const ap = approachPoint(node, L.x, L.z, STATIC.col, STATIC.nav);
    if (!ap || !this.walkTo(ap[0], ap[1], false, arrive)) this.hud.toast("Can't reach that.");
    this.hud.ring?.(view);
  }

  startNodeAction(id) {
    const node = STATIC.nodes.get(id);
    const t = NODE_TYPES[node.type];
    const L = this.me.local;
    L.rot = Math.atan2(node.x - L.x, node.z - L.z);
    if (t.kind === 'herb') {
      this.me.av.play('pick');
      this.sock.req('hit', { node: id }).then(() => sfx.pick()).catch((e) => this.hud.toast(e.message, 'err'));
      return;
    }
    if (t.kind === 'fish') return this.cast(id);
    const toolId = this.hud.me.equip[t.tool];
    const tool = ITEMS[toolId];
    if (!tool || !(this.hud.me.inv[toolId] > 0)) return this.hud.toast(`You need ${t.tool === 'axe' ? 'an axe' : 'a pickaxe'}. Craft one at the Workshop!`, 'err');
    this.gather = { node: id, tool: t.tool, period: tool.speed, last: 0, queued: false, kind: t.kind };
    this.me.av.hold(t.tool);
    this.me.av.setState('gather');
    this.hud.showRhythm(this.gather);
    this.swing();
  }

  swing() {
    const g = this.gather;
    if (!g) return;
    const now = performance.now();
    const since = now - g.last;
    if (g.last && since < g.period * 0.74) {
      // Too early: buffer one tap so mashing still swings at max speed.
      if (!g.queued) {
        g.queued = true;
        setTimeout(() => {
          if (this.gather === g) {
            g.queued = false;
            this.swing();
          }
        }, g.period * 0.74 - since + 5);
      }
      return;
    }
    g.last = now;
    this.me.av.play('swing', Math.min(0.42, g.period / 1000 * 0.62));
    const node = STATIC.nodes.get(g.node);
    this.me.local.rot = Math.atan2(node.x - this.me.local.x, node.z - this.me.local.z);
    if (navigator.vibrate) navigator.vibrate(12);
    this.hud.rhythmSwing(now);
    this.sock.req('hit', { node: g.node }).catch((e) => {
      this.hud.toast(e.message, 'err');
      this.stopGather();
    });
  }

  stopGather() {
    if (!this.gather) return;
    this.gather = null;
    this.hud.hideRhythm();
    this.me.av.hold(null);
    this.me.av.setState('idle');
  }

  onNodeHit(m) {
    const view = this.town.nodes.get(m.id);
    if (!view) return;
    const pv = this.players.get(m.by);
    view.setHp(m.hp);
    const from = pv ? (pv.isMe ? this.me.local : pv) : view.root.position;
    // Small delay so the impact lines up with the downswing.
    setTimeout(() => {
      view.hit({ x: from.x, z: from.z }, m.perfect, m.dmg);
      const top = view.root.position.clone().setY(view.type.kind === 'tree' ? 2.4 : 1.6);
      if (pv?.isMe || (pv && pv.av.root.position.distanceTo(this.me.av.root.position) < 25)) {
        if (view.type.kind === 'tree') sfx.chop(m.perfect);
        else if (view.type.kind === 'rock') sfx.mine(m.perfect);
      }
      if (pv?.isMe) {
        this.shakeAmt = Math.max(this.shakeAmt, m.perfect ? 0.35 : 0.14);
        this.floatText(top, m.perfect ? `PERFECT! -${m.dmg}` : `-${m.dmg}`, m.perfect ? 'perfect' : 'dmg');
        if (this.gather?.node === m.id) this.hud.rhythmResult(m.perfect);
      }
      this.hud.nodeBar(view);
    }, pv?.isMe ? 90 : 0);
    if (pv && !pv.isMe) {
      pv.av.hold(view.type.kind === 'tree' ? 'axe' : view.type.kind === 'rock' ? 'pick' : null);
      pv.av.play(view.type.kind === 'herb' ? 'pick' : 'swing');
    }
  }

  onNode(m) {
    const view = this.town.nodes.get(m.id);
    if (!view) return;
    if (m.alive) {
      view.respawn();
      this.hud.nodeBar(view);
      return;
    }
    const pv = this.players.get(m.by);
    const from = pv ? (pv.isMe ? this.me.local : pv) : { x: view.root.position.x + 1, z: view.root.position.z };
    setTimeout(() => {
      view.break(from);
      this.hud.nodeBar(view);
      const near = view.root.position.distanceTo(this.me.av.root.position) < 25;
      if (near) view.type.kind === 'tree' ? sfx.timber() : view.type.kind === 'rock' ? sfx.crumble() : null;
      if (view.type.kind === 'tree') view.onLand = () => near && (this.shakeAmt = Math.max(this.shakeAmt, 0.5));
    }, 120);
    if (this.gather?.node === m.id) setTimeout(() => this.stopGather(), 300);
  }

  onLoot(m) {
    const view = this.town.nodes.get(m.node);
    const base = (view ? view.root.position.clone() : this.me.av.root.position.clone()).setY(2.5);
    let i = 0;
    for (const [id, q] of Object.entries(m.loot)) {
      const rare = m.rare?.includes(id);
      setTimeout(() => this.floatText(base.clone().setY(2.5 + i * 0.01), `${ITEMS[id].icon} +${q} ${ITEMS[id].name}`, 'loot' + (rare ? ' rare' : '')), 350 + i++ * 260);
    }
    setTimeout(() => (m.rare?.length ? sfx.rare() : sfx.loot()), 350);
    this.hud.onXp(m.xp);
  }

  // ── Fishing ──────────────────────────────────────────────────────────
  cast(id) {
    if (this.fishing) this.endFishing(); // recasting: clear the old bobber first
    const node = STATIC.nodes.get(id);
    this.me.av.hold('rod');
    this.me.av.play('cast');
    this.me.av.setState('fish');
    this.sock
      .req('cast', { node: id })
      .then(() => {
        const bob = new THREE.Group();
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshToonMaterial({ color: '#e2574c' }));
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshToonMaterial({ color: '#ffffff' }));
        w.position.y = 0.02;
        bob.add(b, w);
        bob.position.set(node.x, -0.05, node.z);
        this.scene.add(bob);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#ffffff' }));
        line.frustumCulled = false;
        this.scene.add(line);
        this.fishing = { node: id, bob, line, state: 'wait', t: 0 };
        setTimeout(() => sfx.splash(), 250);
        this.rings.spawn(bob.position, { color: '#ffffff', size: 1.4, life: 0.8, y: 0 });
        this.hud.fishState('wait');
      })
      .catch((e) => {
        this.hud.toast(e.message, 'err');
        this.me.av.setState('idle');
        this.me.av.hold(null);
      });
  }

  onBite(m) {
    const f = this.fishing;
    if (!f) return;
    f.state = 'bite';
    f.bite = m;
    sfx.bite();
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    this.rings.spawn(f.bob.position, { color: '#ffffff', size: 2, life: 0.5, y: 0 });
    this.fx.burst(f.bob.position.clone().setY(0.1), { n: 10, color: ['#bfeaff', '#ffffff'], speed: 2, up: 3, size: 0.12, life: 0.6 });
    this.floatText(f.bob.position.clone().setY(1.5), m.fish.d >= 60 ? '‼️' : '❗', 'crit');
    this.hud.fishState('bite');
  }

  // Tap while waiting/biting: try to hook. A good hook starts the reel fight;
  // a bad one comes back as a fishResult. Always a request, so we hear back.
  reel() {
    const f = this.fishing;
    if (!f || f.state === 'fight' || f.state === 'hooking') return;
    this.me.av.play('reel');
    const was = f.state;
    f.state = 'hooking';
    this.hud.fishState(null);
    this.sock
      .req('reel')
      .then((r) => {
        if (this.fishing !== f) return;
        if (!r?.fight) {
          if (f.state === 'hooking') f.state = was; // server will send the fishResult
          return;
        }
        f.state = 'fight';
        f.splashT = 0;
        sfx.splash();
        this.hud.startFight(r.bite || f.bite, (toggles, end) => this.sock.send({ t: 'land', toggles, end }));
      })
      .catch(() => this.fishing === f && this.endFishing());
  }

  endFishing() {
    const f = this.fishing;
    this.hud.fishState(null);
    this.hud.endFight();
    if (!f) return;
    this.scene.remove(f.bob, f.line);
    this.fishing = null;
    this.hud.fishState(null);
    this.hud.endFight();
    setTimeout(() => {
      if (!this.fishing && this.me) {
        this.me.av.setState('idle');
        this.me.av.hold(null);
      }
    }, 500);
  }

  onFishResult(m) {
    const bob = this.fishing?.bob.position.clone();
    this.endFishing();
    const pos = this.me.av.root.position.clone().setY(3);
    if (m.ok) {
      const it = ITEMS[m.item];
      const big = it.rarity === 'epic' || it.rarity === 'legendary';
      if (bob) this.fx.burst(bob.setY(0.2), { n: 24, color: ['#bfeaff', '#ffffff', '#8fd8ff'], speed: 3, up: 6, size: 0.14, life: 0.9 });
      this.floatText(pos, `${it.icon} ${m.qty > 1 ? m.qty + '× ' : ''}${it.name} · ${m.kg} kg`, 'loot' + (big ? ' rare' : ''));
      big ? sfx.rare() : sfx.loot();
      if (big) this.hud.levelUp(`${it.name}!`, `${m.kg} kg — what a catch!`);
      this.hud.onXp(m.xp);
      this.me.av.play('cheer');
    } else if (!m.cancelled) {
      this.hud.toast(m.reason);
    }
  }

  // ── Buildings & monsters ─────────────────────────────────────────────
  goBuilding(id) {
    if (this.battle) return;
    if (id === 'gate') return this.walkTo(GATE.x, GATE.z - 6, true);
    const b = BUILDINGS.find((x) => x.id === id);
    const [dx, dz] = doorPoint(b);
    const L = this.me.local;
    const open = () => this.hud.openBuilding(b.action);
    if (Math.hypot(L.x - dx, L.z - dz) < 2.5) return open();
    this.stopGather();
    this.walkTo(dx, dz, true, open);
  }

  goMob(id) {
    const mv = this.mobs.get(id);
    if (!mv || mv.state === 'dead') return;
    const L = this.me.local;
    const engage = () => {
      const m = this.mobs.get(id);
      if (!m || m.state === 'dead') return;
      if (Math.hypot(L.x - m.x, L.z - m.z) > 5.5) return this.goMob(id); // it wandered; chase
      this.sock.req('engage', { mob: id }).catch((e) => this.hud.toast(e.message, 'err'));
    };
    if (Math.hypot(L.x - mv.x, L.z - mv.z) < 5) return engage();
    const dx = L.x - mv.x;
    const dz = L.z - mv.z;
    const d = Math.hypot(dx, dz) || 1;
    this.walkTo(mv.x + (dx / d) * 3.2, mv.z + (dz / d) * 3.2, true, engage);
  }

  onBattle(b) {
    const mv = this.mobs.get(b.mob);
    if (mv) this.#mobState(mv, 'battle');
    const mine = b.fighters.some((f) => f.id === this.myId);
    if (mine) {
      if (!this.battle) {
        this.stopGather();
        this.endFishing();
        this.me.local.path = null;
        this.intent = null;
        this.me.av.hold('weapon');
        this.me.av.setState('battle');
        this.hud.battleStart(b, MONSTERS[mv?.type]);
        sfx.bell();
      }
      this.battle = b;
      this.hud.battleUpdate(b);
    } else if (this.battle?.id === b.id) {
      // We fled (or were removed) — back to exploring.
      this.battle = null;
      this.me.av.setState('idle');
      this.me.av.hold(null);
      this.hud.battleEnd({ fled: true });
    }
    for (const f of b.fighters) {
      const pv = this.players.get(f.id);
      if (pv) {
        pv.av.hold('weapon');
        pv.av.setState(f.alive ? 'battle' : 'ko');
      }
    }
  }

  onBattleRound(m) {
    const mv = this.mobs.get(m.mob);
    let delay = 0;
    const mine = this.battle && this.battle.id === m.id;
    for (const ev of m.ev) {
      setTimeout(() => this.#playBattleEvent(ev, mv, mine), delay);
      delay += ev.k === 'hit' ? 520 : 260;
    }
    if (mine) this.hud.battleLog(m.ev, delay);
  }

  #playBattleEvent(ev, mv, mine) {
    const mobPos = mv ? mv.mob.root.position.clone().setY(MONSTERS[mv.type].boss ? 3.2 : 2) : null;
    const near = mv && mv.mob.root.position.distanceTo(this.me.av.root.position) < 30;
    if (ev.k === 'hit' && ev.to === 'mob') {
      const pv = this.players.get(ev.from);
      if (pv) {
        if (mv) pv.av.root.rotation.y = Math.atan2(mv.mob.root.position.x - pv.av.root.position.x, mv.mob.root.position.z - pv.av.root.position.z);
        pv.av.play(ev.skill ? 'skill' : 'attack');
      }
      setTimeout(() => {
        if (!mv) return;
        mv.mob.play('hurt');
        if (near) (ev.crit || ev.skill ? sfx.crit : sfx.hit)();
        this.floatText(mobPos, `${ev.crit ? 'CRIT ' : ''}${ev.skill ? '★ ' : ''}${ev.dmg}`, ev.crit || ev.skill ? 'crit' : 'dmg');
        this.fx.burst(mobPos, { n: ev.skill ? 26 : 12, color: ev.skill ? ['#c79bff', '#ffffff', '#ffd84a'] : ['#ffffff', '#ffe066', '#ff9f5a'], speed: 5, up: 4, size: 0.14, life: 0.6 });
        if (pv?.isMe) this.shakeAmt = Math.max(this.shakeAmt, ev.skill ? 0.5 : ev.crit ? 0.35 : 0.15);
      }, 260);
    } else if (ev.k === 'hit' && ev.from === 'mob') {
      const pv = this.players.get(ev.to);
      if (mv && pv) mv.mob.root.rotation.y = Math.atan2(pv.av.root.position.x - mv.mob.root.position.x, pv.av.root.position.z - mv.mob.root.position.z);
      mv?.mob.play('attack');
      setTimeout(() => {
        if (!pv) return;
        pv.av.play('hurt');
        const p = pv.av.root.position.clone().setY(2.6);
        this.floatText(p, ev.blocked ? `🛡️ ${ev.dmg}` : `${ev.dmg}`, 'dmg');
        this.fx.burst(p, { n: 8, color: ['#ff6b6b', '#ffffff'], speed: 4, up: 3, size: 0.12, life: 0.5 });
        if (pv.isMe) {
          sfx.hurt();
          this.shakeAmt = Math.max(this.shakeAmt, 0.3);
          if (navigator.vibrate) navigator.vibrate(30);
        }
      }, 300);
    } else if (ev.k === 'heal') {
      const pv = this.players.get(ev.who);
      if (pv) {
        this.floatText(pv.av.root.position.clone().setY(2.6), `+${ev.amt}`, 'heal');
        this.fx.burst(pv.av.root.position.clone().setY(1), { n: 14, color: ['#7dff8a', '#ffffff'], speed: 1.5, up: 4, gravity: -1, size: 0.12, life: 1 });
        if (pv.isMe) sfx.heal();
      }
    } else if (ev.k === 'defend') {
      const pv = this.players.get(ev.who);
      if (pv) this.rings.spawn(pv.av.root.position, { color: '#9fd8ff', size: 1.6, life: 0.6, y: 0.1 });
    } else if (ev.k === 'ko') {
      const pv = this.players.get(ev.who);
      pv?.av.setState('ko');
    } else if (ev.k === 'flee') {
      const pv = this.players.get(ev.who);
      if (pv) {
        pv.av.setState('idle');
        pv.av.hold(null);
      }
    } else if (ev.k === 'mobDown') {
      mv?.mob.play('die');
      if (mobPos) this.fx.burst(mobPos, { n: 40, color: ['#ffd84a', '#ffffff', '#ff9f5a'], speed: 7, up: 6, size: 0.16, life: 1 });
    }
  }

  onBattleEnd(m) {
    const mv = this.mobs.get(m.mob);
    const r = m.results?.[this.myId];
    for (const id of Object.keys(m.results || {})) {
      const pv = this.players.get(Number(id));
      if (pv && !pv.isMe) {
        pv.av.setState('idle');
        pv.av.hold(null);
        if (m.victory) pv.av.play('cheer');
      }
    }
    if (mv && !m.victory) this.#mobState(mv, 'roam');
    if (!r || !this.battle || this.battle.id !== m.id) return;
    setTimeout(() => {
      this.battle = null;
      this.me.av.setState('idle');
      this.me.av.hold(null);
      if (m.victory) this.me.av.play('cheer');
      this.hud.battleEnd(r);
    }, 900);
  }

  onEmote(m) {
    const pv = this.players.get(m.id);
    if (!pv) return;
    if (m.e === 'sit') pv.av.setState('sit');
    else pv.av.play(m.e);
    if (m.e === 'heart') this.floatText(pv.av.root.position.clone().setY(3.2), '💖', 'crit');
    if (pv.isMe) pv.local.path = null;
  }

  onChat(m) {
    this.hud.chatLine(m);
    if (!m.from) return;
    const pv = this.players.get(m.from);
    if (!pv) return;
    const wrap = pv.tag.querySelector('.bubbles');
    wrap.innerHTML = '';
    const b = h('div.bubble', m.text);
    wrap.append(b);
    clearTimeout(pv.bubbleT);
    pv.bubbleT = setTimeout(() => b.remove(), 6000);
    if (!pv.isMe) sfx.chat();
  }

  // ── Main loop ────────────────────────────────────────────────────────
  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.1, raw);
    this.moveDt = Math.min(0.25, raw);
    this.t += dt;
    this.update(dt);
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    r.clear();
    // 1) world  2) heroes hidden behind the world, as silhouettes  3) heroes
    r.render(this.scene, this.camera);
    this.camera.layers.set(1);
    this.scene.overrideMaterial = this.silMat;
    r.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    r.render(this.scene, this.camera);
    this.camera.layers.set(0);
  };

  update(dt) {
    const me = this.me;
    if (me) {
      const L = me.local;
      this.#keyboardMove();
      const moving = L.path ? stepPath(L, this.moveDt ?? dt) : false;
      if (!moving && this.intent) {
        const fn = this.intent.onArrive;
        this.intent = null;
        fn?.();
      }
      // Reconcile with the authoritative server position.
      const s = me.srv;
      const err = Math.hypot(s.x - L.x, s.z - L.z);
      if (err > 6) {
        // Way off (lag spike / tab was asleep): snap, but keep heading to the same place.
        L.x = s.x;
        L.z = s.z;
        if (L.path) {
          const [gx, gz] = L.path[L.path.length - 1];
          L.path = STATIC.nav.findPath(L.x, L.z, gx, gz);
        }
      } else if (!moving && s.act !== 'walk' && err > 0.05) {
        const k = Math.min(1, dt * 6);
        L.x += (s.x - L.x) * k;
        L.z += (s.z - L.z) * k;
      }
      me.av.root.position.set(L.x, 0, L.z);
      me.av.root.rotation.y = lerpAngle(me.av.root.rotation.y, this.battle ? this.#faceMob(me) : L.rot, Math.min(1, dt * 14));
      if (!this.gather && !this.fishing && !this.battle && me.av.state !== 'ko' && !(me.av.state === 'sit' && !moving)) me.av.setState(moving ? 'walk' : 'idle');
      if (moving && me.av.state === 'sit') me.av.setState('walk');
      me.av.update(dt, moving ? 6 : 0);
      if (this.marker.visible) {
        this.markerT += dt;
        this.marker.children[1].position.y = 1 + Math.sin(this.markerT * 8) * 0.2;
        this.marker.children[0].scale.setScalar(1 + Math.sin(this.markerT * 6) * 0.1);
        if (!L.path || this.markerT > 6) this.marker.visible = false;
      }
      if (this.gather) {
        const n = STATIC.nodes.get(this.gather.node);
        if (Math.hypot(n.x - L.x, n.z - L.z) > INTERACT_RANGE + 2.5) this.stopGather();
      }
      if (this.fishing) {
        const f = this.fishing;
        f.t += dt;
        if (f.state === 'fight') {
          const fight = this.hud.fight?.state;
          const node = STATIC.nodes.get(f.node);
          const pull = fight ? (fight.fishPos - 0.5) * 1.6 : 0;
          f.bob.position.x = node.x + Math.sin(f.t * 7) * 0.35 + pull * 0.3;
          f.bob.position.z = node.z + Math.cos(f.t * 5) * 0.35;
          f.bob.position.y = -0.3 + Math.sin(f.t * 18) * 0.1;
          f.splashT -= dt;
          if (f.splashT <= 0) {
            f.splashT = 0.25 + Math.random() * 0.35;
            this.fx.puff.burst(f.bob.position.clone().setY(0.05), { n: 4, color: ['#d9f3ff', '#ffffff'], speed: 1.5, up: 2.5, size: 0.2, life: 0.5, gravity: 8 });
            if (Math.random() < 0.3) this.rings.spawn(f.bob.position, { color: '#ffffff', size: 1.2, life: 0.5, y: 0 });
          }
          if (!me.av.oneShot) me.av.play('reel', 0.35);
        } else f.bob.position.y = f.state === 'bite' ? -0.25 + Math.sin(f.t * 30) * 0.08 : -0.05 + Math.sin(f.t * 3) * 0.04;
        const tip = me.av.held?.userData.tip;
        if (tip) {
          const a = new THREE.Vector3();
          tip.getWorldPosition(a);
          const arr = f.line.geometry.attributes.position;
          arr.setXYZ(0, a.x, a.y, a.z);
          arr.setXYZ(1, f.bob.position.x, f.bob.position.y + 0.1, f.bob.position.z);
          arr.needsUpdate = true;
        }
      }
    }
    for (const pv of this.players.values()) {
      if (pv.isMe) continue;
      const s = pv.body.sample();
      if (s) {
        pv.x = s.x;
        pv.z = s.z;
        pv.av.root.position.set(s.x, 0, s.z);
        pv.av.root.rotation.y = lerpAngle(pv.av.root.rotation.y, s.rot, Math.min(1, dt * 12));
        const st = pv.av.state;
        if (st !== 'ko' && !(st === 'sit' && s.act === 'idle')) pv.av.setState(s.act === 'walk' ? 'walk' : s.act === 'battle' ? 'battle' : s.act === 'fish' ? 'fish' : s.act === 'chop' || s.act === 'mine' ? 'gather' : 'idle');
      }
      pv.av.update(dt, 6);
    }
    for (const mv of this.mobs.values()) {
      const s = mv.body.sample();
      let moving = false;
      if (s) {
        moving = Math.hypot(s.x - mv.x, s.z - mv.z) > 0.002;
        mv.x = s.x;
        mv.z = s.z;
        mv.mob.root.position.set(s.x, 0, s.z);
        if (mv.state !== 'battle') mv.mob.root.rotation.y = lerpAngle(mv.mob.root.rotation.y, s.rot, Math.min(1, dt * 8));
      }
      mv.mob.update(dt, moving);
    }
    this.town.update(dt, this.t, this.camera);
    this.fx.update(dt);
    this.fx.puff.update(dt);
    this.rings.update(dt);
    this.#fadeOccluders(dt);
    this.#updateGuide(dt);
    this.#updateCamera(dt);
    this.#updateLabels();
    this.hud.frame(dt);
  }

  // Fade buildings that sit between the camera and your hero.
  #fadeOccluders(dt) {
    if (!this.me) return;
    const head = new THREE.Vector3(this.me.local.x, 1.4, this.me.local.z);
    const dir = head.clone().sub(this.camera.position);
    const len = dir.length();
    const ray = new THREE.Ray(this.camera.position, dir.normalize());
    const hit = new THREE.Vector3();
    for (const f of this.town.fades) {
      const blocks = ray.intersectBox(f.box, hit) && hit.distanceTo(this.camera.position) < len - 0.5 && !f.box.containsPoint(head);
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

  #faceMob(me) {
    const mv = this.mobs.get(this.battle.mob);
    if (!mv) return me.local.rot;
    return Math.atan2(mv.x - me.local.x, mv.z - me.local.z);
  }

  #keyboardMove() {
    const k = this.keys;
    if (this.battle || !k.size) return;
    let fx = 0;
    let fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (!fx && !fz) return;
    const now = performance.now();
    if (now - this.lastKeyMove < 140) return;
    this.lastKeyMove = now;
    this.stopGather();
    if (this.hud.fight) return;
    const y = this.cam.yaw;
    const dx = fx * Math.cos(y) + fz * Math.sin(y);
    const dz = -fx * Math.sin(y) + fz * Math.cos(y);
    const d = Math.hypot(dx, dz);
    const L = this.me.local;
    this.walkTo(L.x + (dx / d) * 2.2, L.z + (dz / d) * 2.2);
  }

  #updateCamera(dt) {
    const me = this.me;
    if (!me) return;
    const c = this.cam;
    let tx = me.local.x;
    let tz = me.local.z;
    let dist = c.dist;
    let pitch = c.pitch;
    let yaw = c.yaw;
    if (this.battle) {
      const mv = this.mobs.get(this.battle.mob);
      if (mv) {
        tx = (me.local.x + mv.x) / 2;
        tz = (me.local.z + mv.z) / 2;
        // Side-on view of the fight.
        yaw = Math.atan2(mv.x - me.local.x, mv.z - me.local.z) + Math.PI / 2 + 0.35;
        dist = MONSTERS[mv.type].boss ? 15 : 11.5;
        pitch = 0.55;
      }
    }
    c.target.x += (tx - c.target.x) * Math.min(1, dt * 7);
    c.target.z += (tz - c.target.z) * Math.min(1, dt * 7);
    c.curYaw = c.curYaw === undefined ? yaw : lerpAngle(c.curYaw, yaw, Math.min(1, dt * 4));
    c.curDist = c.curDist === undefined ? dist : c.curDist + (dist - c.curDist) * Math.min(1, dt * 4);
    c.curPitch = c.curPitch === undefined ? pitch : c.curPitch + (pitch - c.curPitch) * Math.min(1, dt * 4);
    const cam = this.camera;
    const hor = Math.cos(c.curPitch) * c.curDist;
    cam.position.set(c.target.x + Math.sin(c.curYaw) * hor, Math.sin(c.curPitch) * c.curDist + 1, c.target.z + Math.cos(c.curYaw) * hor);
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt;
    }
    cam.lookAt(c.target.x, 1.4, c.target.z);
    // Keep the shadow camera centred on the player.
    this.sun.position.set(c.target.x + 30, 50, c.target.z + 20);
    this.sun.target.position.set(c.target.x, 0, c.target.z);
  }

  #updateLabels() {
    const cam = this.camera.position;
    const tmp = {};
    const v = new THREE.Vector3();
    for (const pv of this.players.values()) {
      v.copy(pv.av.root.position).setY(2.85);
      this.project(v, tmp);
      const far = v.distanceTo(cam) > 70;
      pv.tag.style.display = tmp.vis && !far ? '' : 'none';
      if (tmp.vis) pv.tag.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, -100%)`;
    }
    for (const mv of this.mobs.values()) {
      v.copy(mv.mob.root.position).setY(mv.mob.height || 1.6);
      this.project(v, tmp);
      const show = tmp.vis && mv.mob.root.visible && (mv.state === 'battle' || Math.hypot(mv.x - this.me.local.x, mv.z - this.me.local.z) < 13);
      mv.tag.style.display = show ? '' : 'none';
      if (show) mv.tag.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, -100%)`;
    }
    for (const l of this.staticLabels) {
      this.project(l.pos, tmp);
      const d = l.pos.distanceTo(cam);
      const show = tmp.vis && d < (l.kind === 'zone' ? 75 : 95) && !this.battle;
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, ${l.kind === 'zone' ? '-50%' : '-100%'})`;
    }
  }

  // Helpers used by the HUD
  myPos() {
    return this.me ? { x: this.me.local.x, z: this.me.local.z } : { x: 0, z: 0 };
  }
  nodePos(id) {
    return STATIC.nodes.get(id);
  }
  nearestNode(type) {
    const p = this.myPos();
    let best = null;
    let bd = Infinity;
    for (const n of STATIC.nodes.values()) {
      if (n.type !== type || !this.town.nodes.get(n.id).alive) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  sendEmote(e) {
    if (this.battle) return;
    this.stopGather();
    this.sock.send({ t: 'emote', e });
  }

  destroy() {
    this.running = false;
    this.off?.forEach((f) => f());
    this.renderer.dispose();
    this.el.remove();
  }
}

export { STATIC, ZONES };
