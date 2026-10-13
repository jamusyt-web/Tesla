import * as THREE from 'three';
import { Avatar } from './scene/avatar.js';
import { createRenderer, setupPasses, renderFrame, warm, warmModels, updateCamera, fadeOccluders, markShadows } from './scene/render.js';
import { ensureGroup, onGroup } from './scene/assets.js';
import { GROUPS } from './scene/manifest/index.js';
import { PROC_BUILDERS } from './scene/procprops.js';
import { Mood } from './scene/mood.js';
import { Mob } from './scene/mobs.js';
import { buildTown } from './scene/town.js';
import { Particles, Rings, setFocus } from './scene/fx.js';
import { Townsfolk } from './scene/townsfolk.js';
import { RoomView } from './room.js';
import { Labels } from './ui/labels.js';
import { DungeonView } from './scene/dungeon.js';
import { goCraft, craftDone, resumeCraft, goBuilding, goBoard, goStone, travelTo, ownerTeleport, goCrypt, enterCrypt, guideToCrypt, contextAction } from './world/services.js';
import { glyph } from './ui/glyphs.js';
import { stationPos } from '../../shared/stations.js';
import { h } from './util/dom.js';
import { sfx } from './util/sfx.js';
import { ITEMS } from '../../shared/items.js';
import { MONSTERS } from '../../shared/monsters.js';
import { SKILLS, levelFromXp } from '../../shared/skills.js';
import {
  NODES, buildColliders, NavGrid, stepPath, approachPoint, BUILDINGS, NODE_TYPES, INTERACT_RANGE, FISH_RANGE, ZONES, SWING_GATE, stoneById,
} from '../../shared/world.js';
import { USE_RANGE } from '../../shared/dungeon.js';

const INTERP_DELAY = 130; // ms behind real time we render other players
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const isTouch = matchMedia('(pointer: coarse)').matches;

// Shared static world data (same deterministic generation as the server).
const STATIC = (() => {
  const col = buildColliders();
  return { nodes: new Map(NODES.map((n) => [n.id, n])), col, nav: new NavGrid(col) };
})();

const QUARTER = Math.PI / 2;
// The next frame (so a veil is on screen), or 100 ms in a background tab where frames don't come.
const nextFrame = () => new Promise((r) => (requestAnimationFrame(() => setTimeout(r, 0)), setTimeout(r, 100)));
// A monster's battle stats as shown: its type, plus what the server says about
// this one (a dungeon's elites and bosses have their own name and level).
const defOf = (mv) => mv?.def ?? MONSTERS[mv?.type] ?? null;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// Name colour by how a monster's level compares with yours.
const conColor = (diff) => (diff <= -3 ? '#9a9a9a' : diff <= -1 ? '#7fc06a' : diff <= 1 ? '#e8d070' : diff <= 3 ? '#f08a3a' : '#e04a3a');

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
    this.craft = null; // the craft in progress (we're at a station)
    this.room = null; // RoomView while inside a shop
    this.lastRoom = null; // shop to step back into after a reconnect
    this.dungeon = null; // DungeonView while in a dungeon run
    this.run = null; // { id, layout, state } of that run
    this.battles = new Map(); // fights going on near you (id → state)

    const low = isTouch || Math.min(screen.width, screen.height) < 700;
    this.low = low;
    const renderer = createRenderer(low);
    this.renderer = renderer;
    this.el = h('div#game');
    this.el.append(renderer.domElement);
    this.el.append(h('div.vignette'));
    this.labels = new Labels(this);
    this.labelLayer = this.labels.layer;
    this.el.append(this.labelLayer);
    root.append(this.el);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#b8c4c8', 20, 100);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
    const hemi = new THREE.HemisphereLight('#c8d8ec', '#6b5a48', 1.3);
    hemi.layers.enableAll(); // lights must be on the hero layer too
    scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight('#ffe4bc', 2.7);
    sun.position.set(40, 34, 10);
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
    setupPasses(this);
    this.mood = new Mood(this);
    this.rings = new Rings(scene);
    this.town = buildTown(scene, this.fx, { low });
    this.folk = new Townsfolk(scene, STATIC.nav, { low });
    this.nodeLabels = new Map();
    this.labels.makeStatic();
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
    this.#prefetch();
  }

  // After the first frame: the shaders of everything loaded, then the model
  // groups the island will want soon (its monsters, the crypt's kit). A
  // monster that showed up before its model did is rebuilt with it.
  #prefetch() {
    // (Props drawn in code have their own materials: one of each kind joins in.)
    const procs = Object.entries(PROC_BUILDERS).flatMap(([slot, make]) => {
      try {
        return [make({ id: `warm:${slot}`, slot, x: 0, z: 0, rot: 0, r: 0 }, { fx: this.fx, animate: () => {} })];
      } catch {
        return [];
      }
    });
    warmModels(this, GROUPS.core, procs);
    warm(this); // the whole island too, off-screen parts included
    onGroup((id) => {
      if (!this.running) return;
      // Monsters with no model are drawn in code: warm those shaders with theirs.
      warmModels(this, GROUPS[id], id.startsWith('mobs:') ? Object.keys(MONSTERS).map((t) => new Mob(t).root) : []);
      for (const mv of [...this.mobs.values()]) if (!mv.mob.modelled && GROUPS[id].includes(`mob_${mv.type}`)) this.#rebuildMob(mv);
    });
    for (const id of ['mobs:hearthvale', 'kit:crypt']) ensureGroup(id);
  }
  #rebuildMob(mv) {
    const info = { ...mv.info, x: mv.x, z: mv.z, rot: mv.mob.root.rotation.y, state: mv.state };
    this.removeMob(mv.id);
    const nv = this.addMob(info);
    nv.body.push(info.x, info.z, info.rot, info.state);
  }

  resize() {
    const w = innerWidth;
    const hh = innerHeight;
    this.renderer.setSize(w, hh);
    this.camera.aspect = w / hh;
    this.camera.fov = w < hh ? 55 : 45;
    this.camera.updateProjectionMatrix();
    this.room?.resize();
  }

  // ── Town services (world/services.js) ───────────────────────────────
  goCraft(recipe, batch = 1) {
    return goCraft(this, recipe, batch);
  }
  goBuilding(id) {
    return goBuilding(this, id);
  }
  goBoard(id, point = null) {
    return goBoard(this, id, point);
  }
  goStone(id, opts) {
    return goStone(this, id, opts);
  }
  travelTo(id) {
    return travelTo(this, id);
  }
  ownerTeleport(x, z) {
    return ownerTeleport(this, x, z);
  }
  goCrypt(id) {
    return goCrypt(this, id);
  }
  enterCrypt(kind, opts) {
    return enterCrypt(this, kind, opts);
  }
  guideToCrypt(kind) {
    return guideToCrypt(this, kind);
  }
  contextAction() {
    return contextAction(this);
  }


  // ── Shops ────────────────────────────────────────────────────────────
  async enterShop(owner, { auto = false } = {}) {
    if (this.dungeon) return this.underground();
    if (this.battle) return this.hud.toast("You're in a battle!", 'err');
    if (this.hud.fight) return;
    if (this.fishing) this.endFishing();
    this.stopGather();
    try {
      const p = await this.sock.rpc('shop.enter', { owner }, { auto });
      this.openInterior(p);
    } catch (e) {
      this.hud.toast(auto ? "Couldn't get back into the shop." : e.message, 'err');
    }
  }
  openInterior(p) {
    this.fade();
    this.hud.worldMap.close();
    if (this.room) this.closeInterior({ quiet: true });
    if (this.me) this.me.local.path = null;
    this.intent = null;
    this.room = new RoomView(this, p);
    this.labelLayer.style.display = 'none';
    this.hud.setMode('room', { isOwner: this.room.isOwner });
    sfx.bell();
    if (this.room.isOwner && !p.slots.length) this.hud.toast('Tap a display to put something on it.');
  }
  async exitShop() {
    if (!this.room) return;
    this.lastRoom = null;
    try {
      await this.sock.rpc('shop.exit');
    } catch {}
    this.closeInterior();
  }
  closeInterior({ quiet = false } = {}) {
    if (!this.room) return;
    if (!quiet) this.fade();
    this.room.dispose();
    this.room = null;
    this.labelLayer.style.display = '';
    this.hud.setMode('town');
    this.hud.panels.close();
  }
  // A quick fade to black and back (entering a shop, travelling).
  fade() {
    const f = h('div.fade');
    this.el.append(f);
    setTimeout(() => f.remove(), 450);
  }
  // Players inside a shop are hidden from the town.
  #setHidden(pv, hidden) {
    pv.hidden = hidden;
    pv.av.root.visible = !hidden;
    if (!hidden) pv.body.buf = [];
  }

  // ── Labels (ui/labels.js) ─────────────────────────────────────────────
  project(v, out = {}) {
    return this.labels.project(v, out);
  }
  // Floating text at a world position (damage numbers, loot, PERFECT!).
  floatText(pos, text, cls = '') {
    this.labels.float(pos, text, cls);
  }
  get staticLabels() {
    return this.labels.static;
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
    // Out of the way while you're working the target (it drew through the tree).
    G.group.visible = !!tg && !this.gather;
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
      const path = Math.hypot(tg.x - L.x, tg.z - L.z) > 5 ? this.nav.findPath(L.x, L.z, tg.x, tg.z) : null;
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



  // ── Entities ─────────────────────────────────────────────────────────
  addPlayer(p, isMe = false) {
    if (this.players.has(p.id)) this.removePlayer(p.id);
    const av = new Avatar(p.avatar, { equip: p.equip, layer: 1 });
    av.root.position.set(p.x, 0, p.z);
    av.root.rotation.y = p.rot || 0;
    av.root.userData = { kind: 'player', id: p.id };
    av.root.traverse((o) => (o.userData.player = p.id));
    this.heroScene.add(av.root);
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
    if (!isMe && p.inside != null) this.#setHidden(pv, true);
    return pv;
  }
  removePlayer(id) {
    const pv = this.players.get(id);
    if (!pv) return;
    this.heroScene.remove(pv.av.root);
    pv.av.dispose();
    pv.tag.remove();
    this.players.delete(id);
  }
  #applyAct(pv, act) {
    pv.act = act;
    const hold = { chop: 'axe', mine: 'pick', fish: 'rod', battle: 'weapon', craft: 'pick' }[act] ?? null;
    if (pv.isMe && this.gather) pv.av.hold(this.gather.tool);
    else if (pv.isMe && this.fishing) pv.av.hold('rod');
    else if (pv.isMe && this.battle) pv.av.hold('weapon');
    else pv.av.hold(hold);
  }

  removeMob(id) {
    const mv = this.mobs.get(id);
    if (!mv) return;
    this.scene.remove(mv.mob.root);
    mv.tag.remove();
    this.mobs.delete(id);
  }
  addMob(m) {
    let mv = this.mobs.get(m.id);
    if (mv) return mv;
    const mob = new Mob(m.type);
    mob.root.position.set(m.x, 0, m.z);
    mob.root.userData = { kind: 'mob', id: m.id };
    mob.root.traverse((o) => (o.userData.mob = m.id));
    this.scene.add(mob.root);
    const d = m.d ? { ...MONSTERS[m.type], ...m.d } : MONSTERS[m.type];
    const nm = h('span.nm', d.name);
    const tag = h(
      'div.tag.mob' + (d.boss ? '.boss' : '') + (d.elite ? '.elite' : ''),
      h('span.engaged.hidden', glyph('swords')),
      h('div', d.boss ? glyph('skull') : d.key ? glyph('key') : null, h('span.lvl', d.lvl), nm),
      d.elite ? h('div.affix', d.affixes?.length ? 'Elite' : 'Elite') : null,
    );
    this.labelLayer.append(tag);
    if (d.elite) {
      // Elites: bigger, with a red ring at their feet.
      mob.root.scale.setScalar(1.25);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e0402e', transparent: true, opacity: 0.75, depthWrite: false }));
      ring.position.y = 0.04;
      mob.root.add(ring);
    }
    mv = { id: m.id, info: m, type: m.type, def: d, room: m.d?.room ?? null, mob, tag, nm, body: new RemoteBody(), state: m.state, x: m.x, z: m.z };
    nm.style.color = conColor(d.lvl - (this.hud.me.level || 1));
    mv.body.push(m.x, m.z, m.rot, m.state);
    this.mobs.set(m.id, mv);
    this.#mobState(mv, m.state);
    return mv;
  }
  // Recolour monster names when the hero's level changes (grey = trivial … red = deadly).
  tintMobs() {
    for (const mv of this.mobs.values()) mv.nm.style.color = conColor(defOf(mv).lvl - (this.hud.me.level || 1));
  }
  #mobState(mv, st) {
    const prev = mv.state;
    mv.state = st;
    mv.tag.querySelector('.engaged').classList.toggle('hidden', st !== 'battle');
    if (st === 'dead') {
      if (prev !== 'dead' && mv.mob.root.visible) {
        mv.mob.play('die');
        setTimeout(() => mv.state === 'dead' && (mv.mob.root.visible = false), 800);
      } else mv.mob.root.visible = false;
    } else if (prev === 'dead' || !mv.mob.root.visible) {
      mv.mob.revive();
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
        if (this.room) {
          this.lastRoom = this.room.owner;
          this.closeInterior({ quiet: true });
        }
      }),
      s.on('hide', (m) => {
        const pv = this.players.get(m.id);
        if (pv && !pv.isMe) this.#setHidden(pv, true);
      }),
      s.on('show', (m) => {
        const pv = this.players.get(m.p.id);
        if (!pv || pv.isMe) return;
        pv.body.buf = [];
        pv.body.push(m.p.x, m.p.z, m.p.rot, m.p.act);
        this.#setHidden(pv, false);
      }),
      s.on('craftResult', (m) => {
        craftDone(this, m, null);
        if (m.reason === 'timeout') this.hud.toast('Your craft ran out of time and was finished as it was.');
        else if (m.reason === 'offline') this.hud.toast(`While you were away your ${ITEMS[m.out?.item]?.name || 'craft'} was finished as it was.`);
      }),
      s.on('crafted', (m) => {
        const pv = this.players.get(m.by);
        const p = stationPos(m.station);
        if (!pv || pv.isMe || !p) return;
        pv.av.play('cheer');
        this.floatText(new THREE.Vector3(p.x, 2.8, p.z), `${m.grade} · ${m.qty}× ${ITEMS[m.item]?.name}`, m.mw || m.grade === 'S' ? 'loot rare' : 'loot');
      }),
      s.on('rjoin', (m) => this.room?.onJoin(m)),
      s.on('rleave', (m) => this.room?.onLeave(m)),
      s.on('rs', (m) => this.room?.onSnap(m)),
      s.on('rshelf', (m) => this.room?.onShelf(m)),
      s.on('rnpc', (m) => this.room?.onNpc(m)),
      s.on('rbuy', (m) => this.room?.onBuy(m)),
      s.on('join', (m) => {
        this.addPlayer(m.p);
        this.hud.setOnline(this.players.size);
        this.hud.chatLine({ sys: true, text: this.dungeon ? `${m.p.name} came down into the crypt.` : `${m.p.name} arrived in town.` });
      }),
      s.on('leave', (m) => {
        const pv = this.players.get(m.id);
        if (pv) this.hud.chatLine({ sys: true, text: this.dungeon ? `${pv.info.name} left the crypt.` : `${pv.info.name} left.` });
        this.removePlayer(m.id);
        this.hud.setOnline(this.players.size);
      }),
      s.on('s', (m) => this.onSnapshot(m)),
      s.on('tp', (m) => this.onTeleport(m)),
      s.on('attuned', (m) => this.onAttuned(m)),
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
      s.on('battle', (m) => this.onBattle(m.b, m.why)),
      s.on('bres', (m) => this.onBattleRound(m)),
      s.on('battleEnd', (m) => this.onBattleEnd(m)),
      // Dungeon runs (server/dungeons.js)
      s.on('dgate', (m) => this.onGates(m)),
      s.on('dreveal', (m) => {
        this.dungeon?.reveal(m.rooms);
        this.run?.state.revealed.push(...m.rooms);
      }),
      s.on('droom', (m) => this.onRoomCleared(m)),
      s.on('dkey', (m) => this.onKey(m)),
      s.on('dwipe', (m) => this.onWipe(m)),
      s.on('dshrine', (m) => this.onShrine(m)),
      s.on('dchest', (m) => this.onChestOpened(m)),
      s.on('dboss', (m) => this.onBossDown(m)),
      s.on('dtrap', (m) => this.onTrap(m)),
    ];
  }

  onWelcome(m) {
    const swap = m.dungeon ? this.dungeon?.runId !== m.dungeon.run : !!this.dungeon;
    if (!swap || this.swapping) return this.#welcome(m);
    // Into (or out of) a dungeon: cover the screen, build the new place while
    // incoming messages wait, warm up the shaders, then lift the veil.
    this.swapping = true;
    this.sock.pause();
    const veil = this.#veil(m.dungeon ? `Descending into ${m.dungeon.layout.name}…` : 'Back to the surface…');
    Promise.all([nextFrame(), m.dungeon ? ensureGroup('kit:crypt') : null])
      .then(() => this.#welcome(m))
      .catch((e) => console.error('scene swap failed', e))
      .finally(() => {
        this.swapping = false;
        this.sock.resume();
        warm(this).finally(() => veil.out());
      });
  }

  #veil(text) {
    const el = h('div.veil', h('div.veil-text', text));
    this.el.append(el);
    return { out: () => (el.classList.add('out'), setTimeout(() => el.remove(), 350)) };
  }

  #welcome(m) {
    // A fresh start: no battle screen survives it (the welcome lists any fight you're still in).
    if (this.hud.battleTop) this.hud.battleEnd({ fled: true, quiet: true });
    if (m.dungeon) this.#intoRun(m.dungeon);
    else if (this.dungeon) this.#outOfRun();
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.mobs.keys()]) this.removeMob(id);
    this.battle = null;
    this.battles.clear();
    this.gather = null;
    this.endFishing();
    this.hud.hideRhythm();
    if (!this.dungeon) this.town.focus(m.you.x, m.you.z, Infinity); // the world around you, before the loading screen goes
    this.addPlayer(m.you, true);
    for (const p of m.players) this.addPlayer(p);
    for (const mob of m.mobs) this.addMob(mob);
    if (this.dungeon) {
      this.channel = null;
      this.hud.onWelcome(m);
      this.hud.setOnline(this.players.size);
      for (const b of m.battles) this.onBattle(b);
      resumeCraft(this, m.you);
      return;
    }
    for (const n of this.town.nodes.values()) {
      if (!n.alive) n.respawn();
      else n.setHp(n.maxHp); // a different channel's damage must not linger
    }
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
    for (const [id, ws] of this.town.stones) ws.setAttuned((m.you.stones ?? []).includes(id));
    this.hud.onWelcome(m);
    resumeCraft(this, m.you);
    if (this.lastRoom != null) {
      // We dropped while inside a shop: step back in.
      const o = this.lastRoom;
      this.lastRoom = null;
      this.enterShop(o, { auto: true });
    }
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
    // Monsters come and go as they get near you (the server only sends those).
    if (m.full) for (const id of [...this.mobs.keys()]) if (!m.add?.some((a) => a.id === id)) this.removeMob(id);
    for (const id of m.rm ?? []) this.removeMob(id);
    for (const info of m.add ?? []) {
      const mv = this.addMob(info);
      mv.body.push(info.x, info.z, info.rot, info.state);
      if (info.state !== mv.state) this.#mobState(mv, info.state);
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
        if (this.room) {
          this.room.zoom(pinch.prev ? pinch.prev / d : 1);
          pinch.prev = d;
          return;
        }
        this.cam.dist = Math.max(9, Math.min(34, pinch.dist * (pinch.d / d)));
        return;
      }
      if (down) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 10) down.moved = true;
        if (down.moved && !this.battle && !this.room && this.dungeon) {
          // Underground the view turns in quarter turns (so the walls in
          // front of you can drop away): a firm sideways drag is one turn.
          const step = e.clientX - (down.stepX ?? down.x);
          if (Math.abs(step) > 60) {
            this.turn(step > 0 ? -1 : 1);
            down.stepX = e.clientX;
          }
          this.cam.pitch = Math.max(0.75, Math.min(1.15, down.pitch + dy * 0.004));
        } else if (down.moved && !this.battle && !this.room) {
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
      if (this.room) return this.room.zoom(1 + Math.sign(e.deltaY) * 0.08);
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
      if (k === 'm') return !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && this.hud.toggleMap();
      if (k === 'escape' && this.hud.worldMap.isOpen) return this.hud.worldMap.close();
      if (this.battle && /^[1-5]$/.test(k) && !e.repeat) return this.hud.battleKey(+k);
      if (this.dungeon && (k === 'q' || k === 'r')) return !e.repeat && this.turn(k === 'q' ? 1 : -1);
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
    const world = this.dungeon ? this.dungeon.pickables : [...this.town.pickables, ...this.folk.objects];
    const objs = [...world, ...[...this.players.values()].filter((p) => !p.isMe).map((p) => p.av.root), ...[...this.mobs.values()].filter((m) => m.mob.root.visible).map((m) => m.mob.root)];
    const hits = this.raycaster.intersectObjects(objs, true);
    let ground = null;
    outer: for (const hit of hits) {
      // three.js raycasts hidden meshes too: a felled tree must not catch taps.
      for (let o = hit.object; o; o = o.parent) if (!o.visible) continue outer;
      const u = hit.object.userData;
      if (u.mob) return { kind: 'mob', id: u.mob, point: hit.point };
      if (u.npc) return { kind: 'npc', npc: u.npc, point: hit.point };
      if (u.player) return { kind: 'player', id: u.player, point: hit.point };
      if (u.node) return { kind: 'node', id: u.node, point: hit.point };
      if (u.station) return { kind: 'station', id: u.station, point: hit.point };
      if (u.stone) return { kind: 'stone', id: u.stone, point: hit.point };
      if (u.crypt) return { kind: 'crypt', id: u.crypt, point: hit.point };
      if (u.dtap) return { kind: 'dtap', what: u.dtap, point: hit.point };
      if (u.tap) return { kind: 'tap', what: u.tap, point: hit.point };
      if (u.building) return { kind: 'building', id: u.building, point: hit.point };
      if ((u.ground || u.water) && !ground) ground = { kind: 'ground', point: hit.point };
    }
    return ground;
  }

  tap(x, y) {
    if (this.room) return this.room.tap(x, y);
    if (this.battle || this.craft) return;
    // While fishing or gathering, taps are the action itself.
    if (this.fishing) {
      this.reel();
      return;
    }
    const hit = this.pick(x, y);
    // Gathering: a tap on the node, or anywhere on/inside its timing ring, is
    // a swing — unless you clearly tapped something else (another tree, a
    // monster, a person).
    if (this.gather) {
      if (hit?.kind === 'node' && hit.id === this.gather.node) return this.swing();
      const other = hit && (hit.kind === 'node' || hit.kind === 'mob' || hit.kind === 'npc' || hit.kind === 'player');
      if (!other) {
        const n = STATIC.nodes.get(this.gather.node);
        const c = this.project(new THREE.Vector3(n.x, NODE_TYPES[n.type].kind === 'tree' ? 2.2 : 1.3, n.z));
        if (Math.hypot(x - c.x, y - c.y) <= 110) return this.swing();
      }
    }
    if (!hit) return;
    this.stopGather();
    if (hit.kind === 'ground') return this.walkTo(hit.point.x, hit.point.z, true);
    if (hit.kind === 'node') return this.goNode(hit.id);
    if (hit.kind === 'mob') return this.goMob(hit.id);
    if (hit.kind === 'player') return this.hud.openProfile(hit.id);
    if (hit.kind === 'station') return this.hud.panels.open('craft', { station: hit.id });
    if (hit.kind === 'stone') return this.goStone(hit.id, { openMap: true });
    if (hit.kind === 'crypt') return this.goCrypt(hit.id);
    if (hit.kind === 'dtap') return this.useThing(hit.what);
    if (hit.kind === 'tap' && hit.what === 'jobs') return this.goBoard(null, hit.point);
    if (hit.kind === 'npc') {
      const info = hit.npc.info;
      const line = info.lines[Math.floor(Math.random() * info.lines.length)];
      this.floatText(hit.npc.obj.position.clone().setY(info.kind === 'pet' ? 1.4 : 2.6), info.name ? `${info.name}: “${line}”` : line, 'loot');
      sfx.chat();
      return;
    }
    if (hit.kind === 'building') {
      const b = BUILDINGS.find((bb) => bb.id === hit.id);
      if (b && !b.deco) return this.goBuilding(b.id);
      return this.walkTo(hit.point.x, hit.point.z, true);
    }
  }

  actionKey() {
    if (this.room) return this.room.actionKey();
    if (this.fishing) return this.reel();
    if (this.gather) return this.swing();
    // Not busy: work the nearest tree / rock / herb / fishing spot in reach.
    const L = this.me?.local;
    if (!L || this.battle) return;
    if (this.dungeon) return this.contextAction()?.fn();
    let best = null;
    for (const n of STATIC.nodes.values()) {
      const t = NODE_TYPES[n.type];
      const reach = t.kind === 'fish' ? FISH_RANGE - 0.5 : INTERACT_RANGE + t.r * n.s + 0.6;
      const d = Math.hypot(n.x - L.x, n.z - L.z);
      if (d <= reach && this.town.nodes.get(n.id)?.alive && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) this.goNode(best.id);
  }

  walkTo(x, z, marker = false, onArrive = null) {
    if (this.hud.fight) return false; // mid reel-fight: stay put
    if (this.craft) return false; // working at a station
    if (this.travelling) return false; // about to vanish to another waystone
    if (this.fishing) this.endFishing(); // the server cancels too when it gets the move
    const L = this.me.local;
    const path = this.nav.findPath(L.x, L.z, x, z);
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
    // Say what's needed now, rather than after the walk over.
    const need = this.#gatherBlocker(t);
    if (need) {
      this.hud.toast(need, 'err');
      this.hud.ring?.(view);
      return;
    }
    const L = this.me.local;
    const range = t.kind === 'fish' ? FISH_RANGE - 0.5 : INTERACT_RANGE + t.r * node.s;
    const arrive = () => this.startNodeAction(id);
    // Already in reach and standing still: start right away. (While walking,
    // finish at the stand-point instead, so client and server stop together.)
    if (!L.path && Math.hypot(L.x - node.x, L.z - node.z) <= range && STATIC.nav.clear(L.x, L.z, node.x + (L.x - node.x) * 0.5, node.z + (L.z - node.z) * 0.5)) return arrive();
    const ap = approachPoint(node, L.x, L.z, STATIC.col, STATIC.nav);
    if (!ap || !this.walkTo(ap[0], ap[1], false, arrive)) this.hud.toast("Can't reach that.");
    this.hud.ring?.(view);
  }

  // Why you can't work this node yet (level / tool), or null.
  #gatherBlocker(t) {
    const me = this.hud.me;
    if (!me || t.kind === 'fish') return null;
    const lvl = levelFromXp(me.skills?.[t.skill] || 0);
    if (lvl < t.lvl) return `${t.name} needs ${SKILLS[t.skill].name} level ${t.lvl} (you're ${lvl}).`;
    if (t.tool) {
      const tool = ITEMS[me.equip?.[t.tool]];
      const name = t.tool === 'axe' ? 'axe' : 'pickaxe';
      if (!tool || !(me.inv?.[me.equip[t.tool]] > 0)) return `You need ${t.tool === 'axe' ? 'an axe' : 'a pickaxe'}. Craft one at the Workshop!`;
      if (tool.tier < t.tier) return `${t.name} needs a better ${name} (tier ${t.tier}).`;
    }
    return null;
  }

  startNodeAction(id) {
    const node = STATIC.nodes.get(id);
    const t = NODE_TYPES[node.type];
    const L = this.me.local;
    // The server stops you where you are when you start working, so do the same.
    L.path = null;
    this.intent = null;
    L.rot = Math.atan2(node.x - L.x, node.z - L.z);
    if (!this.town.nodes.get(id)?.alive) return this.hud.toast(`This ${t.name} is regrowing…`);
    if (t.kind === 'herb') {
      this.me.av.play('pick');
      this.sock
        .req('hit', { node: id })
        .then((r) => !r?.tooFast && !r?.gone && sfx.pick())
        .catch((e) => this.hud.toast(e.message, 'err'));
      return;
    }
    if (t.kind === 'fish') return this.cast(id);
    const need = this.#gatherBlocker(t);
    if (need) return this.hud.toast(need, 'err');
    const tool = ITEMS[this.hud.me.equip[t.tool]];
    this.gather = { node: id, tool: t.tool, period: tool.speed, last: 0, queued: false, kind: t.kind, dead: false };
    if (this.hud.goal.lock?.kind === 'tree' && t.kind === 'tree') this.hud.goal.lock = { kind: 'tree', id }; // the guide follows your choice
    this.me.av.hold(t.tool);
    this.me.av.setState('gather');
    this.hud.showRhythm(this.gather);
    this.swing();
  }

  swing() {
    const g = this.gather;
    if (!g) return;
    if (g.dead || !this.town.nodes.get(g.node)?.alive) return; // it just fell
    const now = performance.now();
    const since = now - g.last;
    if (g.last && since < g.period * SWING_GATE) {
      // Too early: buffer one tap so mashing still swings at max speed.
      if (!g.queued) {
        g.queued = true;
        setTimeout(() => {
          if (this.gather === g) {
            g.queued = false;
            this.swing();
          }
        }, g.period * SWING_GATE - since + 5);
      }
      return;
    }
    const prev = g.last;
    g.last = now;
    this.me.av.play('swing', Math.min(0.42, g.period / 1000 * 0.62));
    const node = STATIC.nodes.get(g.node);
    this.me.local.rot = Math.atan2(node.x - this.me.local.x, node.z - this.me.local.z);
    if (navigator.vibrate) navigator.vibrate(12);
    this.hud.rhythmSwing(now);
    this.sock
      .req('hit', { node: g.node })
      .then((r) => {
        if (this.gather !== g) return;
        if (r?.gone) return this.stopGather(); // it fell just before this swing landed
        if (r?.tooFast) {
          // Network jitter made two swings arrive too close together: keep the
          // ring in step with the server and send this one again shortly.
          g.last = prev;
          setTimeout(() => this.gather === g && this.swing(), (r.wait || 60) + 15);
        }
      })
      .catch((e) => {
        const dead = !this.town.nodes.get(g.node)?.alive;
        if (!dead) this.hud.toast(e.message, 'err');
        if (this.gather === g) this.stopGather();
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
      if (pv?.isMe && view.type.kind !== 'herb') {
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
    markShadows(this, m.alive ? 1 : 3); // it grows back, or falls
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
    if (this.gather?.node === m.id) {
      const g = this.gather;
      g.dead = true; // no more swings at it; the ring lingers a moment for the fall
      setTimeout(() => this.gather === g && this.stopGather(), 300);
    }
  }

  onLoot(m) {
    const view = this.town.nodes.get(m.node);
    const base = (view ? view.root.position.clone() : this.me.av.root.position.clone()).setY(2.7);
    let i = 0;
    for (const [id, q] of Object.entries(m.loot)) {
      const rare = m.rare?.includes(id);
      setTimeout(() => this.floatText(base.clone().setY(2.7 + i * 0.01), `${ITEMS[id].icon} +${q} ${ITEMS[id].name}`, 'loot' + (rare ? ' rare' : '')), 350 + i++ * 260);
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


  // Someone travelled by waystone: they vanish in a flash and reappear.
  onTeleport(m) {
    const pv = this.players.get(m.id);
    if (!pv) return;
    const flash = (x, z) => {
      const p = new THREE.Vector3(x, 1.2, z);
      this.fx.puff.burst(p, { n: 18, color: ['#bff4ff', '#7fe0ff', '#ffffff'], speed: 2.2, up: 2.5, gravity: -1, size: 0.3, life: 0.9, drag: 0.8 });
      this.rings.spawn({ x, z }, { color: '#8fe8ff', size: 2.2, life: 0.7 });
    };
    if (m.from) flash(m.from.x, m.from.z);
    if (pv.isMe) {
      const L = this.me.local;
      this.stopGather();
      if (this.fishing) this.endFishing();
      Object.assign(L, { x: m.x, z: m.z, rot: m.rot, path: null });
      pv.srv = { x: m.x, z: m.z, act: 'idle' };
      this.intent = null;
      this.marker.visible = false;
      this.cam.target.set(m.x, 0, m.z);
      if (!this.dungeon) this.cam.yaw = m.rot; // look back at you, with the waystone behind
      this.cam.curYaw = this.cam.yaw;
      this.me.av.root.position.set(m.x, 0, m.z);
      this.me.av.root.rotation.y = m.rot;
      if (!this.dungeon) this.town.focus(m.x, m.z, Infinity); // build where you land before the fade clears
      this.fade();
      if (!this.dungeon) sfx.warp();
    } else {
      pv.body.buf = [];
      pv.body.push(m.x, m.z, m.rot, 'idle');
      pv.x = m.x;
      pv.z = m.z;
      pv.av.root.position.set(m.x, 0, m.z);
    }
    flash(m.x, m.z);
  }
  onAttuned(m) {
    const me = this.hud.me;
    me.stones = [...new Set([...(me.stones ?? []), m.id])];
    this.town.stones.get(m.id)?.setAttuned(true);
    const st = stoneById(m.id);
    if (st) {
      this.floatText(new THREE.Vector3(st.x, 4.6, st.z), `Waystone attuned: ${m.name}`, 'loot rare');
      this.rings.spawn({ x: st.x, z: st.z }, { color: '#8fe8ff', size: 3, life: 0.9 });
    }
    sfx.rare();
    if (me.stones.length > 1) this.hud.toast(`You can now fast-travel to ${m.name} from any waystone.`, 'good');
    this.hud.worldMap.refresh();
  }

  onBattle(b, why = null) {
    this.battles.set(b.id, b);
    const mv = this.mobs.get(b.mob);
    if (mv) this.#mobState(mv, 'battle');
    for (const id of b.queue ?? []) {
      const q = this.mobs.get(id);
      if (q) this.#mobState(q, 'battle');
    }
    const mine = b.fighters.some((f) => f.id === this.myId);
    if (mine) {
      if (!this.battle) {
        this.stopGather();
        this.endFishing();
        this.me.local.path = null;
        this.intent = null;
        this.me.av.hold('weapon');
        this.me.av.setState('battle');
        this.hud.battleStart(b, defOf(mv) ?? MONSTERS.slime);
        sfx.bell();
      } else if (this.battle.mob !== b.mob) this.hud.battleNext(defOf(mv) ?? MONSTERS.slime); // the next of the pack steps in
      this.battle = b;
      this.hud.battleUpdate(b);
    } else if (this.battle?.id === b.id) {
      // We fled (or were removed) — back to exploring.
      this.battle = null;
      this.me.av.setState('idle');
      this.me.av.hold(null);
      this.hud.battleEnd({ fled: true, quiet: why === 'closed' });
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
    const step = m.ev.length > 6 ? 360 : 520; // a big group's round plays a little faster
    let prev = null;
    for (const ev of m.ev) {
      setTimeout(() => this.#playBattleEvent(ev, mv, mine), delay);
      // An area attack lands on everyone at once.
      delay += ev.k === 'hit' ? (ev.aoe && prev?.aoe ? 0 : step) : 260;
      prev = ev;
    }
    if (mine) this.hud.battleLog(m.ev, delay);
  }

  #playBattleEvent(ev, mv, mine) {
    const mobPos = mv ? mv.mob.root.position.clone().setY(defOf(mv).boss ? 3.2 : 2) : null;
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
        this.floatText(mobPos, `${ev.crit ? 'CRIT ' : ''}${ev.skill ? '' : ''}${ev.dmg}`, ev.crit || ev.skill ? 'crit' : 'dmg');
        this.fx.burst(mobPos, { n: ev.skill ? 26 : 12, color: ev.skill ? ['#c79bff', '#ffffff', '#ffd84a'] : ['#ffffff', '#ffe066', '#ff9f5a'], speed: 5, up: 4, size: 0.14, life: 0.6 });
        if (pv?.isMe) this.shakeAmt = Math.max(this.shakeAmt, ev.skill ? 0.5 : ev.crit ? 0.35 : 0.15);
      }, 260);
    } else if (ev.k === 'hit' && ev.from === 'mob') {
      const pv = this.players.get(ev.to);
      if (mv && pv) mv.mob.root.rotation.y = Math.atan2(pv.av.root.position.x - mv.mob.root.position.x, pv.av.root.position.z - mv.mob.root.position.z);
      mv?.mob.play('attack');
      if (ev.aoe && mv && !this.aoeT) {
        // One sweep for the whole area attack (it hits every hero at once).
        this.aoeT = setTimeout(() => (this.aoeT = null), 300);
        this.rings.spawn(mv.mob.root.position, { color: '#ff4a5a', size: 7, life: 0.7, y: 0.1 });
      }
      setTimeout(() => {
        if (!pv) return;
        pv.av.play('hurt');
        const p = pv.av.root.position.clone().setY(2.7);
        this.floatText(p, ev.blocked ? `${ev.dmg}` : `${ev.dmg}`, 'dmg');
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
        this.floatText(pv.av.root.position.clone().setY(2.7), `+${ev.amt}`, 'heal');
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
    } else if (ev.k === 'revive') {
      const pv = this.players.get(ev.who);
      if (pv) {
        pv.av.setState(pv.isMe ? 'battle' : 'battle');
        this.floatText(pv.av.root.position.clone().setY(2.7), `Back up! +${ev.amt}`, 'heal');
        this.fx.burst(pv.av.root.position.clone().setY(1), { n: 22, color: ['#7dff8a', '#ffffff', '#ffe066'], speed: 2, up: 5, gravity: -1, size: 0.14, life: 1.1 });
        sfx.heal();
      }
    } else if (ev.k === 'thorns') {
      const pv = this.players.get(ev.to);
      if (pv) this.floatText(pv.av.root.position.clone().setY(2.7), `${ev.dmg} thorns`, 'dmg');
    } else if (ev.k === 'mobHeal') {
      if (mobPos) this.floatText(mobPos, `+${ev.amt}`, 'heal');
    } else if (ev.k === 'warn') {
      if (mine) this.hud.battleWarn(ev.move, defOf(mv)?.name);
      if (mobPos) this.fx.burst(mobPos, { n: 30, color: ['#b0203a', '#ff5a6a', '#3a0a14'], speed: 2, up: 2, gravity: -0.5, size: 0.3, life: 1.4, drag: 1 });
    } else if (ev.k === 'next') {
      const nx = this.mobs.get(ev.mob);
      if (nx) this.floatText(nx.mob.root.position.clone().setY(2.6), `${defOf(nx).name} steps in!`, 'loot');
    }
  }

  onBattleEnd(m) {
    this.battles.delete(m.id);
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
    if (!r && this.battle?.id === m.id) {
      // It ended without us (we'd already left it): never leave the battle screen up.
      this.battle = null;
      this.me.av.setState('idle');
      this.me.av.hold(null);
      this.hud.battleEnd({ fled: true });
      return;
    }
    if (!r || !this.battle || this.battle.id !== m.id) return;
    setTimeout(() => {
      this.battle = null;
      this.me.av.setState('idle');
      this.me.av.hold(null);
      if (m.victory) this.me.av.play('cheer');
      this.hud.battleEnd({ ...r, inRun: !!m.inRun });
    }, 900);
  }

  onEmote(m) {
    if (this.room) return this.room.onEmote(m);
    const pv = this.players.get(m.id);
    if (!pv) return;
    if (m.e === 'sit') pv.av.setState('sit');
    else pv.av.play(m.e);
    if (m.e === 'heart') this.floatText(pv.av.root.position.clone().setY(3.3), '💖', 'crit');
    if (pv.isMe) pv.local.path = null;
  }

  onChat(m) {
    this.hud.chatLine(m);
    if (!m.from) return;
    if (this.room?.bubble(m.from, m.text)) return;
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


  // ── Dungeons ─────────────────────────────────────────────────────────
  // The game swaps worlds in the same scene: the island hides, the crypt is
  // built at its own far-off spot, and paths, taps, the camera, the light and
  // the HUD follow whichever world you're in.
  get nav() {
    return this.dungeon?.nav ?? STATIC.nav;
  }
  // A quarter turn of the camera (underground the view only turns in steps).
  turn(dir) {
    this.cam.yaw = Math.round(this.cam.yaw / QUARTER) * QUARTER + dir * QUARTER;
  }
  underground() {
    this.hud.toast("Not down here. Leave the crypt first.", 'err');
  }

  #intoRun(d) {
    if (this.dungeon?.runId === d.run) return this.#syncRun(d.state); // back after a dropped connection
    if (this.dungeon) this.#disposeRun();
    if (this.room) this.closeInterior({ quiet: true });
    this.lastRoom = null;
    this.hud.worldMap.close();
    this.hud.panels.close();
    this.stopGather();
    this.endFishing();
    const view = new DungeonView(this.scene, d.layout, { low: this.low, fx: this.fx });
    view.runId = d.run;
    this.dungeon = view;
    this.run = { id: d.run, layout: d.layout, state: d.state, done: null };
    this.battles.clear();
    // The island leaves the scene while you're underground (nothing walks it).
    this.scene.remove(this.town.root, this.folk.root);
    this.setGuide(null);
    this.guide.dots.count = 0;
    this.labels.showStatic(false);
    this.labels.makeDungeon(view);
    this.mood.setCrypt(true);
    Object.assign(this.cam, { yaw: 0, curYaw: 0, pitch: 0.95, curPitch: 0.95, dist: isTouch ? 15 : 16 });
    this.#syncRun(d.state, false);
    this.hud.setMode('dungeon');
  }
  #outOfRun() {
    this.hud.panels.close(); // the crypt's map, a chest's loot… belong to the run
    this.#disposeRun();
    this.battles.clear();
    this.scene.add(this.town.root, this.folk.root);
    this.labels.showStatic(true);
    this.mood.setCrypt(false);
    Object.assign(this.cam, { pitch: 0.8, dist: isTouch ? 16 : 18 });
    this.hud.setMode('town');
  }
  #disposeRun() {
    this.labels.removeDungeon(this.dungeon);
    this.dungeon.dispose();
    this.dungeon = null;
    this.run = null;
  }
  // Bring the crypt up to date with the server (on arrival and reconnects).
  #syncRun(st, animate = true) {
    const v = this.dungeon;
    this.run.state = st;
    v.reveal(st.revealed);
    v.openGates(st.open, animate);
    v.setKey(st.key);
    if (st.boss) v.showBossChest(false);
    if (st.vaultOpened) v.openChest('vault');
    if (st.lastLight) v.usedFire('rest');
    if (st.shrine) v.usedFire('shrine');
    this.labels.refreshDungeon();
    this.hud.runUpdate();
  }
  // The room you're standing in (corridors count as the room they lead to).
  myRoom() {
    const L = this.me?.local;
    return L && this.dungeon ? this.dungeon.roomOfPoint(L.x, L.z) : null;
  }

  onGates(m) {
    this.run?.state.open.push(...m.open);
    if (!this.dungeon?.openGates(m.open)) return;
    markShadows(this, 1.5);
    sfx.crumble();
    this.shakeAmt = Math.max(this.shakeAmt, 0.18);
    for (const id of m.open) {
      const g = this.dungeon.gates.get(id)?.g;
      if (g && this.dungeon.isRevealed(g.from)) this.rings.spawn({ x: g.x, z: g.z }, { color: '#ffe8a8', size: 2.6, life: 0.8 });
    }
  }
  onRoomCleared(m) {
    if (!this.run) return;
    if (!this.run.state.cleared.includes(m.room)) this.run.state.cleared.push(m.room);
    if (this.myRoom() === m.room && this.me) {
      this.floatText(this.me.av.root.position.clone().setY(3), `Room clear · +${m.heal}% HP`, 'heal');
      this.fx.burst(this.me.av.root.position.clone().setY(1), { n: 14, color: ['#7dff8a', '#ffffff'], speed: 1.5, up: 4, gravity: -1, size: 0.12, life: 1 });
      sfx.heal();
    }
    this.hud.runUpdate();
  }
  onKey(m) {
    if (!this.run) return;
    this.run.state.key = true;
    this.dungeon.setKey(true);
    this.labels.refreshDungeon();
    this.hud.showBanner('The Bone Key!', `${m.by.join(' & ')} took it from the elite. The Vault can be opened.`);
    sfx.rare();
    this.hud.runUpdate();
  }
  onWipe(m) {
    if (!this.run) return;
    this.run.state.wipes = m.wipes;
    const me = m.names.includes(this.hud.myName);
    if (me) {
      this.hud.showBanner('Knocked out', m.over ? 'The dead have had enough of you…' : `You wake in the Entry Hall · ${m.left} more and the crypt throws you out`);
      this.shakeAmt = 0.6;
    } else this.hud.toast(`${m.names.join(' & ')} ${m.names.length > 1 ? 'were' : 'was'} knocked out and woke in the Entry Hall.`, 'err');
    this.hud.runUpdate();
  }
  onShrine(m) {
    if (!this.run) return;
    this.run.state.shrine = true;
    this.dungeon.usedFire('shrine');
    for (const pv of this.players.values()) this.fx.burst(pv.av.root.position.clone().setY(1), { n: 18, color: ['#8fc4ff', '#ffffff'], speed: 1.5, up: 5, gravity: -1, size: 0.14, life: 1.2 });
    this.hud.toast(`${m.by} prayed at the Shrine: everyone is healed!`, 'good');
    sfx.heal();
  }
  onChestOpened(m) {
    if (!this.run) return;
    this.run.state.vaultOpened = true;
    this.dungeon.openChest('vault');
    if (m.by !== this.hud.myName) this.hud.toast(`${m.by} opened the Vault. Your share is in your bag (tap the Vault to see it).`, 'gold');
    sfx.coin();
  }
  onBossDown(m) {
    if (!this.run) return;
    this.run.state.boss = true;
    this.run.done = m.seconds;
    this.dungeon.showBossChest(true);
    this.labels.refreshDungeon();
    setTimeout(() => {
      this.hud.showBanner('Victory!', `${this.run?.layout.name ?? 'The crypt'} conquered in ${fmtTime(m.seconds)}${m.best ? ' · a new record!' : ''}`);
      this.hud.confetti(60);
      sfx.victory();
    }, 1200);
    this.hud.runUpdate();
  }
  onTrap(m) {
    const pv = this.players.get(m.who);
    if (!pv) return;
    const p = pv.av.root.position.clone().setY(2.6);
    this.floatText(p, `-${m.dmg} spikes!`, 'dmg');
    this.fx.burst(p.setY(0.6), { n: 10, color: ['#ff6b6b', '#ffffff'], speed: 3, up: 4, size: 0.12, life: 0.5 });
    pv.av.play('hurt');
    if (pv.isMe) {
      this.hud.setMe({ hp: m.hp });
      sfx.hurt();
      this.shakeAmt = Math.max(this.shakeAmt, 0.35);
      if (navigator.vibrate) navigator.vibrate(40);
    }
  }

  // Tap something in the crypt: walk up to it, then use it.
  useThing(what) {
    const v = this.dungeon;
    if (!v || this.battle || !this.me) return;
    if (what.startsWith('gate:')) return this.#gateInfo(what.slice(5));
    const l = v.label(what);
    if (!l || l.hidden) return;
    this.#walkUp(l.x, l.z, what === 'exit' ? 0.8 : 1.4, () => (what === 'exit' ? this.hud.panels.open('dleave') : this.#use(what)));
  }
  #walkUp(x, z, r, fn) {
    const L = this.me.local;
    if (Math.hypot(L.x - x, L.z - z) <= USE_RANGE - 0.5) return fn();
    // Stand in front of it, on the side you're coming from.
    const a0 = Math.atan2(L.x - x, L.z - z);
    for (let k = 0; k < 12; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      if (this.walkTo(x + Math.sin(a) * (r + 1), z + Math.cos(a) * (r + 1), true, fn)) return;
    }
    this.hud.toast("Can't get there from here.", 'err');
  }
  async #use(what) {
    try {
      const r = await this.sock.rpc('dungeon.use', { what });
      if (!this.run || !this.dungeon) return; // thrown out while we waited
      if (what === 'rest') {
        this.run.state.lastLight = true;
        this.dungeon.usedFire('rest');
        this.floatText(this.me.av.root.position.clone().setY(3), 'Last Light: fully healed', 'heal');
        this.fx.burst(this.me.av.root.position.clone().setY(1), { n: 26, color: ['#ffd27a', '#ffffff', '#ff9a3c'], speed: 2, up: 5, gravity: -1, size: 0.14, life: 1.2 });
        sfx.heal();
      } else if (what === 'vault') {
        this.dungeon.openChest('vault');
        this.run.vaultLoot = r;
        this.hud.panels.open('dloot', { ...r, title: 'The Vault' });
      } else if (what === 'boss') {
        this.dungeon.openChest('boss');
        this.hud.panels.open('drun', { ...r, name: this.run?.layout.name, tier: this.run?.state.tier, vault: this.run?.vaultLoot ?? this.run?.state.grants?.vault ?? null });
      }
    } catch (e) {
      this.hud.toast(e.message, 'err');
    }
  }
  #gateInfo(id) {
    const gv = this.dungeon.gates.get(id);
    if (!gv) return;
    if (gv.open) return this.walkTo(gv.g.x, gv.g.z, true);
    if (gv.g.key && !this.run?.state.key) return this.hud.toast('The Vault is locked. The Bone Key is somewhere in the crypt (an elite carries it).');
    const left = [...this.mobs.values()].filter((m) => m.room === gv.g.from && m.state !== 'dead').length;
    this.hud.toast(left ? `${left} ${left === 1 ? 'monster still guards' : 'monsters still guard'} this room. The gate opens when it's clear.` : 'The gate opens when the room is clear.');
  }
  leaveRun() {
    if (this.battle) return this.hud.toast('Finish (or flee) your battle first.', 'err');
    this.sock.rpc('dungeon.leave').catch((e) => this.hud.toast(e.message, 'err'));
  }



  // ── Main loop ────────────────────────────────────────────────────────
  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.1, raw);
    this.moveDt = Math.min(0.25, raw);
    this.t += dt;
    const r = this.renderer;
    if (this.room) {
      // Inside a shop: the town is paused for us (the server keeps it running).
      this.#keyboardMove();
      this.room.update(dt);
      this.room.render(r);
      return;
    }
    this.update(dt);
    renderFrame(this);
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
        if (L.path && s.act === 'walk') {
          const [gx, gz] = L.path[L.path.length - 1];
          L.path = this.nav.findPath(L.x, L.z, gx, gz);
        } else L.path = null; // the server isn't walking: neither are we
      } else if (!moving && s.act !== 'walk' && err > 0.05) {
        const k = Math.min(1, dt * 6);
        L.x += (s.x - L.x) * k;
        L.z += (s.z - L.z) * k;
      }
      me.av.root.position.set(L.x, 0, L.z);
      me.av.root.rotation.y = lerpAngle(me.av.root.rotation.y, this.battle ? this.#faceMob(me) : L.rot, Math.min(1, dt * 14));
      if (!this.gather && !this.fishing && !this.battle && !(this.craft && !moving) && me.av.state !== 'ko' && !(me.av.state === 'sit' && !moving)) me.av.setState(moving ? 'walk' : 'idle');
      if (this.craft && !moving) {
        const sp = this.craft.spot;
        if (sp) L.rot = sp.rot;
        me.av.setState('gather');
      }
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
    const camPos = this.camera.position;
    for (const pv of this.players.values()) {
      if (pv.isMe) continue;
      // Far heroes lose their ink lines, then aren't drawn at all.
      pv.av.root.visible = !pv.hidden && pv.av.setDetail(pv.av.root.position.distanceTo(camPos));
      const s = pv.body.sample();
      if (s) {
        pv.x = s.x;
        pv.z = s.z;
        pv.av.root.position.set(s.x, 0, s.z);
        pv.av.root.rotation.y = lerpAngle(pv.av.root.rotation.y, s.rot, Math.min(1, dt * 12));
        const st = pv.av.state;
        if (st !== 'ko' && !(st === 'sit' && s.act === 'idle')) pv.av.setState(s.act === 'walk' ? 'walk' : s.act === 'battle' ? 'battle' : s.act === 'fish' ? 'fish' : s.act === 'chop' || s.act === 'mine' || s.act === 'craft' ? 'gather' : 'idle');
        // Others at a crafting station: working away.
        if (s.act === 'craft' && !pv.av.oneShot && Math.random() < dt * 1.4) pv.av.play('swing', 0.35);
      }
      pv.av.update(dt, 6);
    }
    for (const mv of this.mobs.values()) {
      // Underground, monsters in rooms nobody has seen yet stay hidden.
      if (this.dungeon && mv.room != null && !this.dungeon.isRevealed(mv.room)) {
        mv.mob.root.visible = false;
        mv.fogged = true;
        continue;
      }
      if (mv.fogged) {
        mv.fogged = false;
        if (mv.state !== 'dead') mv.mob.root.visible = true;
      }
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
    if (this.dungeon) {
      this.dungeon.setCamSide(DungeonView.sideOfYaw(this.cam.yaw));
      this.dungeon.update(dt, this.t, this.sock.serverNow() - (this.run?.state.startedAt ?? 0), me?.local);
    } else {
      this.town.update(dt, this.t, this.camera);
      this.folk.update(dt, this.cam.target);
    }
    fadeOccluders(this, dt);
    this.fx.update(dt);
    this.fx.puff.update(dt);
    this.rings.update(dt);
    this.#updateGuide(dt);
    updateCamera(this, dt);
    setFocus(this.cam.target.x, this.cam.target.z);
    this.mood.update();
    this.labels.update();
    this.hud.frame(dt);
  }


  #faceMob(me) {
    const mv = this.mobs.get(this.battle.mob);
    if (!mv) return me.local.rot;
    return Math.atan2(mv.x - me.local.x, mv.z - me.local.z);
  }

  #keyboardMove() {
    const k = this.keys;
    if (this.room) return this.room.keyboard(k);
    if (this.battle || this.craft || !k.size || this.hud.worldMap.isOpen) return;
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
