import * as THREE from 'three';
import { Avatar } from './scene/avatar.js';
import { buildInterior } from './scene/interior.js';
import * as assets from './scene/assets.js';
import { h, fmt } from './util/dom.js';
import { sfx } from './util/sfx.js';
import { ITEMS, RARITY } from '../../shared/items.js';
import { ROOM, customersOf, roomNav } from '../../shared/shop.js';
import { stepPath } from '../../shared/world.js';

// What you see while inside a player shop: the interior, everyone in it,
// NPC customers replaying the sales the server already made, price tags.
// The town keeps running underneath; GameClient just renders this instead.
export class RoomView {
  constructor(game, p) {
    this.game = game;
    this.hud = game.hud;
    this.owner = p.owner;
    this.isOwner = p.owner === game.myId;
    this.name = p.name;
    this.open = p.open;
    this.till = p.till ?? 0;
    this.demand = p.demand || {};
    this.town = p.town ?? 'hearthvale'; // its customers are that town's
    this.slots = new Map(p.slots.map((s) => [s.slot, s]));
    this.room = buildInterior({ low: game.low });
    this.scene = this.room.scene;
    this.camera = this.room.camera;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();
    this.labels = h('div.labels.room-labels');
    game.el.append(this.labels);
    this.occ = new Map();
    this.walkers = [];
    this.t = 0;
    this.lastMove = 0;
    // Me.
    const me = game.me.info;
    this.me = this.#addBody({ id: game.myId, name: me.name, level: me.level, avatar: game.hud.me?.avatar || me.avatar, equip: game.hud.me?.equip || me.equip, ...p.you }, true);
    this.me.local = { x: p.you.x, z: p.you.z, rot: p.you.rot, path: null };
    this.me.srv = { x: p.you.x, z: p.you.z, act: 'idle' };
    for (const o of p.occ) this.#addBody(o);
    // Shopkeeper behind the counter while the owner is out.
    if (assets.has('npc_villager')) {
      this.clerk = assets.make('npc_villager', { variant: 4 });
      this.clerk.object.position.set(ROOM.clerk.x, 0, ROOM.clerk.z);
      this.clerk.object.rotation.y = ROOM.clerk.rot;
      assets.findClip(this.clerk.actions, 'idle')?.play();
      this.scene.add(this.clerk.object);
    }
    // Displays + price tags.
    this.tags = ROOM.fixtures.map((f) => {
      const el = h('div.pricetag');
      this.labels.append(el);
      return el;
    });
    for (let i = 0; i < ROOM.fixtures.length; i++) this.#refreshDisplay(i);
    this.#updateClerk();
    this.resize();
  }

  // ── People ─────────────────────────────────────────────────────────
  #addBody(p, isMe = false) {
    this.#removeBody(p.id);
    const av = new Avatar(p.avatar, { equip: p.equip });
    av.root.position.set(p.x, 0, p.z);
    av.root.rotation.y = p.rot || 0;
    av.root.traverse((o) => (o.userData.player = p.id));
    this.scene.add(av.root);
    const tag = h('div.tag' + (isMe ? '.me' : ''), h('div.bubbles'), h('div', h('span.lvl', p.level), h('span.nm', p.name)));
    this.labels.append(tag);
    const b = { id: p.id, name: p.name, av, tag, x: p.x, z: p.z, rot: p.rot || 0, tx: p.x, tz: p.z, trot: p.rot || 0, act: p.act || 'idle', isMe };
    this.occ.set(p.id, b);
    if (p.id === this.owner) this.#updateClerk();
    return b;
  }
  #removeBody(id) {
    const b = this.occ.get(id);
    if (!b) return;
    this.scene.remove(b.av.root);
    b.av.dispose();
    b.tag.remove();
    this.occ.delete(id);
    if (id === this.owner) this.#updateClerk();
  }
  #updateClerk() {
    if (this.clerk) this.clerk.object.visible = !this.occ.has(this.owner);
  }

  // ── Server messages ────────────────────────────────────────────────
  onJoin(m) {
    this.#addBody(m.p);
    if (m.p.id !== this.game.myId) this.hud.chatLine({ sys: true, text: `🚪 ${m.p.name} came into the shop.` });
  }
  onLeave(m) {
    const b = this.occ.get(m.id);
    if (b && !b.isMe) this.hud.chatLine({ sys: true, text: `🚪 ${b.name} left the shop.` });
    if (!b?.isMe) this.#removeBody(m.id);
  }
  onSnap(m) {
    for (const [id, x, z, rot, act] of m.p) {
      const b = this.occ.get(id);
      if (!b) continue;
      if (b.isMe) {
        b.srv = { x, z, act };
        continue;
      }
      Object.assign(b, { tx: x, tz: z, trot: rot, act });
    }
  }
  onShelf(m) {
    if (m.s) this.slots.set(m.slot, m.s);
    else this.slots.delete(m.slot);
    // NPC sales show up when their walker reaches the display; anything else right away.
    if (m.by !== 'npc') this.#refreshDisplay(m.slot);
    else this.pendingShelf = { ...(this.pendingShelf || {}), [m.slot]: true };
    this.game.hud.panels.refresh();
  }
  onBuy(m) {
    const b = this.occ.get(m.by);
    const it = ITEMS[this.slots.get(m.slot)?.item];
    if (b && !b.isMe) {
      b.av.play('cheer');
      this.#float(b.av.root.position.clone().setY(2.6), `🪙 bought ${m.qty}×`, 'loot');
    }
    if (this.isOwner && it) sfx.coin();
  }
  onEmote(m) {
    const b = this.occ.get(m.id);
    if (!b) return;
    if (m.e === 'sit') b.av.setState('sit');
    else b.av.play(m.e);
  }
  bubble(id, text) {
    const b = this.occ.get(id);
    if (!b) return false;
    const wrap = b.tag.querySelector('.bubbles');
    wrap.innerHTML = '';
    const el = h('div.bubble', text);
    wrap.append(el);
    clearTimeout(b.bubbleT);
    b.bubbleT = setTimeout(() => el.remove(), 6000);
    return true;
  }
  setTill(v) {
    this.till = v;
  }

  // An NPC customer: walk in, look at the display, maybe pay at the counter, leave.
  onNpc(m) {
    const delay = Math.random() * 6000;
    setTimeout(() => {
      if (this.disposed) return;
      if (this.walkers.length >= 4) {
        if (m.slot != null) this.#refreshDisplay(m.slot);
        return;
      }
      this.#spawnWalker(m);
    }, delay);
  }
  #spawnWalker(m) {
    const custs = customersOf(this.town);
    const cust = custs[m.cust] || custs[0];
    if (!assets.has('npc_villager')) return m.slot != null && this.#refreshDisplay(m.slot);
    const made = assets.make('npc_villager', { variant: cust.v });
    const nav = roomNav();
    const legs = [];
    let at = [ROOM.mat.x, ROOM.mat.z];
    legs.push({ path: [at], pause: 0 }); // in through the door (outside the walkable room)
    const go = (to, pause = 0, then = null) => {
      const path = nav.findPath(at[0], at[1], to.x, to.z) || [[to.x, to.z]];
      legs.push({ path, pause, then });
      at = [to.x, to.z];
    };
    const f = m.slot != null ? ROOM.fixtures[m.slot] : null;
    if (f) go({ x: f.stand[0], z: f.stand[1] }, 1.6, () => this.#refreshDisplay(m.slot));
    else go({ x: (Math.random() - 0.5) * 4, z: 1.5 }, 1.2);
    if (m.buy)
      go(ROOM.pay, 1.0, () => {
        this.#float(new THREE.Vector3(ROOM.pay.x, 2.4, ROOM.pay.z), `+${m.buy.gold} 🪙`, 'loot');
        if (this.isOwner) sfx.coin();
      });
    else if (f) legs[legs.length - 1].think = true;
    go(ROOM.mat);
    legs.push({ path: [[ROOM.npcDoor.x, ROOM.npcDoor.z]], pause: 0 }); // and back out
    const o = made.object;
    o.position.set(ROOM.npcDoor.x, 0, ROOM.npcDoor.z);
    o.traverse((c) => (c.userData.npc = cust));
    this.scene.add(o);
    const w = { o, made, legs, leg: 0, pause: 0, walk: assets.findClip(made.actions, 'walk'), idle: assets.findClip(made.actions, 'idle'), cust, buy: m.buy, slot: m.slot, e: { x: o.position.x, z: o.position.z, rot: 0, path: null } };
    w.e.path = legs[0].path.slice();
    this.walkers.push(w);
    sfx.bell?.();
  }
  #stepWalkers(dt) {
    for (const w of [...this.walkers]) {
      const e = w.e;
      if (w.pause > 0) {
        w.pause -= dt;
        if (w.pause <= 0) this.#nextLeg(w);
      } else if (!stepPath(e, dt, 1.7)) {
        const leg = w.legs[w.leg];
        leg.then?.();
        if (leg.think) this.#float(w.o.position.clone().setY(2.5), '💭 too pricey…', '');
        w.pause = leg.pause || 0.001;
      }
      w.o.position.set(e.x, 0, e.z);
      w.o.rotation.y = e.rot;
      const moving = !!e.path && w.pause <= 0;
      const want = moving ? w.walk : w.idle;
      if (want && w.cur !== want) {
        want.reset().fadeIn(0.2).play();
        w.cur?.fadeOut(0.2);
        w.cur = want;
      }
      w.made.mixer?.update(dt);
    }
  }
  #nextLeg(w) {
    w.leg++;
    if (w.leg >= w.legs.length) {
      this.scene.remove(w.o);
      this.walkers.splice(this.walkers.indexOf(w), 1);
      return;
    }
    w.e.path = w.legs[w.leg].path.slice();
  }

  // ── Displays ───────────────────────────────────────────────────────
  #refreshDisplay(slot) {
    const s = this.slots.get(slot) || null;
    this.room.setDisplay(slot, s);
    const tag = this.tags[slot];
    tag.className = 'pricetag';
    if (s) {
      const it = ITEMS[s.item];
      tag.style.borderColor = RARITY[it.rarity]?.color || '';
      tag.replaceChildren(h('b', `${fmt(s.price)} 🪙`), h('span', ` ×${fmt(s.qty)}`));
    } else if (this.isOwner) {
      tag.classList.add('empty');
      tag.replaceChildren('＋ Stock');
    } else tag.classList.add('none');
  }

  // ── Input ──────────────────────────────────────────────────────────
  #pick(x, y) {
    const v = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const objs = [...this.room.pickables, ...[...this.occ.values()].filter((b) => !b.isMe).map((b) => b.av.root), ...this.walkers.map((w) => w.o)];
    for (const hit of this.raycaster.intersectObjects(objs, true)) {
      const u = hit.object.userData;
      if (u.player != null) return { kind: 'player', id: u.player };
      if (u.npc) return { kind: 'npc', cust: u.npc };
      if (u.fixture != null) return { kind: 'fixture', slot: u.fixture };
      if (u.till) return { kind: 'till' };
      if (u.door) return { kind: 'door' };
      if (u.floor) return { kind: 'floor', point: hit.point };
    }
    return null;
  }

  tap(x, y) {
    let hit = this.#pick(x, y);
    // Small targets on phones: a tap close to a display counts as tapping it.
    if (!hit || hit.kind === 'floor') {
      const reach = hit ? 40 : 56;
      let best = null;
      for (const f of ROOM.fixtures) {
        const s = this.#project(new THREE.Vector3(f.x, 1.0, f.z));
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < reach && (!best || d < best.d)) best = { d, slot: f.slot };
      }
      if (best) hit = { kind: 'fixture', slot: best.slot };
    }
    if (!hit) return;
    if (hit.kind === 'floor') return this.walkTo(hit.point.x, hit.point.z);
    if (hit.kind === 'door') return this.game.exitShop();
    if (hit.kind === 'player') return this.hud.openProfile(hit.id);
    if (hit.kind === 'npc') return this.#float(new THREE.Vector3(ROOM.pay.x, 2.4, ROOM.pay.z), `${hit.cust.name} is browsing.`, '');
    if (hit.kind === 'till') {
      return this.walkTo(ROOM.pay.x, ROOM.pay.z, () => (this.isOwner ? this.hud.panels.open('ledger') : this.#float(new THREE.Vector3(ROOM.till.x, 2, ROOM.till.z), 'The till is locked.', '')));
    }
    if (hit.kind === 'fixture') return this.useFixture(hit.slot);
  }

  useFixture(slot) {
    const f = ROOM.fixtures[slot];
    const s = this.slots.get(slot);
    if (!s && !this.isOwner) return this.hud.toast('Nothing on this display yet.');
    this.walkTo(f.stand[0], f.stand[1], () => this.hud.panels.open(this.isOwner ? 'display' : 'buy', { slot, room: this }));
  }

  walkTo(x, z, onArrive = null) {
    const L = this.me.local;
    const path = roomNav().findPath(L.x, L.z, x, z);
    if (!path) return;
    L.path = path;
    this.intent = onArrive;
    this.game.sock.send({ t: 'move', x, z, v: 'room' });
    sfx.tap();
  }

  keyboard(keys) {
    let fx = 0;
    let fz = 0;
    if (keys.has('w') || keys.has('arrowup')) fz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) fz += 1;
    if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
    if (keys.has('d') || keys.has('arrowright')) fx += 1;
    if (!fx && !fz) return;
    const now = performance.now();
    if (now - this.lastMove < 120) return;
    this.lastMove = now;
    const L = this.me.local;
    const d = Math.hypot(fx, fz);
    const tx = L.x + (fx / d) * 1.2;
    const tz = L.z + (fz / d) * 1.2;
    const path = roomNav().findPath(L.x, L.z, tx, tz);
    if (!path) return;
    L.path = path;
    this.intent = null;
    this.game.sock.send({ t: 'move', x: tx, z: tz, v: 'room' });
  }

  actionKey() {
    const L = this.me.local;
    let best = null;
    for (const f of ROOM.fixtures) {
      const d = Math.hypot(f.stand[0] - L.x, f.stand[1] - L.z);
      if (d < 1.8 && (!best || d < best.d)) best = { d, slot: f.slot };
    }
    if (best) this.useFixture(best.slot);
    else if (Math.hypot(ROOM.mat.x - L.x, ROOM.mat.z - L.z) < 1.6) this.game.exitShop();
  }

  zoom(f) {
    this.room.setZoom(this.room.zoom * f);
  }

  // ── Frame ──────────────────────────────────────────────────────────
  update(dt) {
    this.t += dt;
    const me = this.me;
    const L = me.local;
    const moving = L.path ? stepPath(L, dt, ROOM.speed) : false;
    if (!moving && this.intent) {
      const fn = this.intent;
      this.intent = null;
      fn();
    }
    const s = me.srv;
    const err = Math.hypot(s.x - L.x, s.z - L.z);
    if (err > 3) {
      L.x = s.x;
      L.z = s.z;
      L.path = null;
    } else if (!moving && s.act !== 'walk' && err > 0.05) {
      const k = Math.min(1, dt * 6);
      L.x += (s.x - L.x) * k;
      L.z += (s.z - L.z) * k;
    }
    me.av.root.position.set(L.x, 0, L.z);
    me.av.root.rotation.y = lerp(me.av.root.rotation.y, L.rot, Math.min(1, dt * 14));
    if (!(me.av.state === 'sit' && !moving)) me.av.setState(moving ? 'walk' : 'idle');
    me.av.update(dt, moving ? 6 : 0);
    for (const b of this.occ.values()) {
      if (b.isMe) continue;
      const k = Math.min(1, dt * 10);
      const dx = b.tx - b.x;
      const dz = b.tz - b.z;
      b.x += dx * k;
      b.z += dz * k;
      b.rot = lerp(b.rot, b.trot, Math.min(1, dt * 12));
      const walking = b.act === 'walk' || Math.hypot(dx, dz) > 0.05;
      b.av.root.position.set(b.x, 0, b.z);
      b.av.root.rotation.y = b.rot;
      if (!(b.av.state === 'sit' && !walking)) b.av.setState(walking ? 'walk' : 'idle');
      b.av.update(dt, walking ? 6 : 0);
    }
    this.#stepWalkers(dt);
    this.clerk?.mixer?.update(dt);
    this.room.update(dt);
    this.room.aim(L.x);
    this.#updateLabels();
  }

  #project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) * 0.5 * innerWidth, y: (1 - p.y) * 0.5 * innerHeight, vis: p.z < 1 };
  }
  #float(pos, text, cls) {
    const s = this.#project(pos);
    const el = h('div.float' + (cls ? '.' + cls : ''), text);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    this.labels.append(el);
    setTimeout(() => el.remove(), 1700);
  }
  #updateLabels() {
    this.camera.updateMatrixWorld();
    for (const b of this.occ.values()) {
      const s = this.#project(b.av.root.position.clone().setY(2.75));
      b.tag.style.transform = `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -100%)`;
    }
    for (const f of this.room.fixtures) {
      const s = this.#project(new THREE.Vector3(f.x, f.top, f.z));
      this.tags[f.slot].style.transform = `translate3d(${s.x}px, ${s.y}px, 0) translate(-50%, -100%)`;
    }
  }

  resize() {
    this.room.resize(innerWidth, innerHeight);
  }

  render(renderer) {
    renderer.shadowMap.needsUpdate = true;
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  // (Model geometry is shared with the town's copies, so it isn't disposed here.)
  dispose() {
    this.disposed = true;
    for (const b of this.occ.values()) b.av.dispose();
    this.labels.remove();
  }
}

function lerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
