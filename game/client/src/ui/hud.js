import * as THREE from 'three';
import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { portrait } from './portrait.js';
import { ITEMS } from '../../../shared/items.js';
import { SKILLS, levelProgress } from '../../../shared/skills.js';
import { BUILDINGS, ZONES, LAKES, DOCKS, PLAZAS, LANDS, EXTENT, SPAWNS, pathSegments, doorPoint, GATE, NODE_TYPES, isPerfectSwing } from '../../../shared/world.js';
import { MONSTERS } from '../../../shared/monsters.js';
import { Panels } from './panels.js';
import { glyph, coin } from './glyphs.js';
import { newFight, stepFight, FISH_TICK } from '../../../shared/fishing.js';

const RATING = { easy: ['Easy', '#437a36'], fair: ['Fair', '#8a6a2a'], tough: ['Tough', '#a8551e'], brutal: ['Brutal', '#a63a2e'] };
const sizeHint = (d) => (d < 20 ? 'A light tug' : d < 45 ? 'A steady pull' : d < 70 ? 'A heavy line' : 'The line screams — something massive');

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

const TUTORIAL_TEXT = [
  { text: 'Fell an oak in Whisperwood', hint: 'Tap a tree, then strike as the ring closes.', target: 'tree' },
  { text: 'Saw oak planks at the Workshop', hint: 'Tap Craft, choose Oak Plank at the workbench, then saw in time.', target: 'workshop' },
  { text: `Slay a ${MONSTERS.slime.name}`, hint: 'Beyond the Wilds Gate, to the north.', target: 'slime' },
  { text: 'Stock a display in your shop', hint: 'Tap Shop, then tap an empty display and set a price.', target: 'shop' },
];

export class Hud {
  constructor(root, sock) {
    this.root = root;
    this.sock = sock;
    this.me = { gold: 0, inv: {}, skills: {}, equip: {}, level: 1, hp: 100, maxHp: 100 };
    this.game = null;
    this.el = h('div.hud');
    root.append(this.el);
    this.panels = new Panels(this);
    this.#build();
    this.#bindNet();
  }

  attach(game) {
    this.game = game;
  }

  #build() {
    this.face = h('div.face');
    this.lv = h('span.lv', '1');
    this.nameEl = h('div.nm', '');
    this.hpFill = h('i', { style: { width: '100%' } });
    const chip = h('div.hero-chip', { on: { click: () => this.panels.open('bag') } }, h('div', { style: { position: 'relative' } }, this.face, this.lv), h('div', this.nameEl, h('div.hpbar', this.hpFill)));
    this.goldEl = h('b', '0');
    const gold = h('div.pill', coin(), this.goldEl);
    this.onlineEl = h('span', '1');
    const online = h('div.pill.online', { on: { click: () => this.panels.open('townhall', { tab: 'online' }) } }, h('span.dot'), this.onlineEl, ' here');
    this.chanEl = h('span.muted', '');
    this.mm = h('canvas', { width: 256, height: 256 });
    const minimap = h('div.minimap', this.mm);
    const muteIcon = () => this.muteBtn.replaceChildren(glyph(sfx.muted ? 'mute' : 'sound', '20px'));
    this.muteBtn = h('button.pill', { 'aria-label': 'Sound on/off', style: { padding: '8px 10px', color: 'var(--gold)' }, on: { click: () => (sfx.toggle(), muteIcon()) } });
    muteIcon();
    this.el.append(h('div.topbar', chip, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' } }, gold, online), h('div.spacer'), this.muteBtn, minimap));

    this.questEl = h('div.quest.hidden');
    this.arrowIcon = h('div.ga-icon', h('i'));
    this.arrowLabel = h('div.ga-label');
    this.arrow = h('div.guide-arrow.hidden', this.arrowIcon, this.arrowLabel);
    this.el.append(this.questEl, this.arrow);

    const dockBtn = (ic, label, fn, badge) => h('button', { 'aria-label': label, on: { click: () => (sfx.tap(), fn()) } }, glyph(ic), h('span', label), badge);
    this.shopBadge = h('i.badge.hidden', '0');
    this.dock = h(
      'div.dock',
      dockBtn('bag', 'Bag', () => this.panels.open('bag')),
      dockBtn('anvil', 'Craft', () => this.travel('workshop')),
      dockBtn('scales', 'Market', () => this.travel('market')),
      dockBtn('shop', 'Shop', () => this.game?.enterShop(this.myId), this.shopBadge),
      dockBtn('castle', 'Town', () => this.travel('townhall')),
    );
    // Inside a shop the dock changes: leave, bag, the ledger (yours), other shops.
    this.ledgerBtn = dockBtn('scroll', 'Ledger', () => this.panels.open('ledger'));
    this.roomDock = h(
      'div.dock.hidden',
      dockBtn('door', 'Leave', () => this.game?.exitShop()),
      dockBtn('bag', 'Bag', () => this.panels.open('bag')),
      this.ledgerBtn,
      dockBtn('village', 'Shops', () => this.panels.open('shops')),
    );
    this.el.append(this.dock, this.roomDock);

    this.log = h('div.log');
    this.input = h('input', { placeholder: 'Say something…', maxLength: 140, enterKeyHint: 'send' });
    const form = h('form', { on: { submit: (e) => this.#sendChat(e) } }, this.input, h('button.btn.small.blue', { type: 'submit' }, 'Send'));
    // Emotes tuck away behind one button so the HUD stays clean.
    const emotes = h('div.emotes');
    const toggle = h('button.toggle', { 'aria-label': 'Emotes', title: 'Emotes', on: { click: () => toggle.classList.toggle('on', emotes.classList.toggle('open')) } }, glyph('talk'));
    const pick = h('div.pick', ...[['wave', '👋'], ['dance', '💃'], ['cheer', '🙌'], ['heart', '💖'], ['sit', '🪑']].map(([e, ic]) => h('button', { title: e, 'aria-label': e, on: { click: () => (this.game?.sendEmote(e), emotes.classList.remove('open'), toggle.classList.remove('on')) } }, ic)));
    emotes.append(toggle, pick);
    this.chat = h('div.chat', this.log, emotes, form);
    this.el.append(this.chat);
    this.input.addEventListener('focus', () => this.chat.classList.remove('collapsed'));

    this.toasts = h('div.toasts');
    this.el.append(this.toasts);

    this.rhythm = h('div.rhythm.hidden', h('div.target'), h('div.ring'), h('div.hint', 'Strike in rhythm'));
    this.nodebar = h('div.nodebar.hidden');
    this.el.append(this.rhythm, this.nodebar);
    this.fishBtn = h('div.fishcall.hidden', h('button.btn.red.big', { on: { click: (e) => (e.stopPropagation(), this.game?.reel()) } }, 'Strike!'));
    this.fishWait = h('div.fishcall.hidden', h('div.waiting', 'Waiting for a bite… strike too early and it’s gone'));
    this.el.append(this.fishBtn, this.fishWait);
  }

  #bindNet() {
    const s = this.sock;
    s.on('me', (m) => this.setMe(m));
    s.on('toast', (m) => this.toast(m.text, m.kind));
    s.on('tutorial', (m) => {
      this.me.tutorial = m.step;
      this.toast(`Quest complete! +${m.reward} 🪙`, 'gold');
      sfx.coin();
      this.#renderQuest();
    });
    s.on('shopSale', (m) => this.#onShopSale(m));
    s.on('awaySales', (m) => {
      this.setTill(m.till);
      if (m.awayMs < 10 * 60_000) {
        // Just a quick tab switch: one line is enough.
        setTimeout(() => this.toast(`Your shop made ${m.count} sale${m.count === 1 ? '' : 's'} (+${fmt(m.net)} 🪙)`, 'gold'), 1200);
        this.sock.rpc('shop.ack', { upto: m.upto }, { auto: true }).catch(() => {});
      } else setTimeout(() => this.panels.open('away', m), 1200);
    });
    s.on('rexit', (m) => {
      this.game?.closeInterior();
      this.toast(m.why === 'closed' ? `${m.name || 'The shop'} just closed.` : 'You wandered out of the shop.');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.saleBuffer?.length) return;
      const b = this.saleBuffer;
      this.saleBuffer = [];
      const gold = b.reduce((a, x) => a + x.net, 0);
      this.toast(`${b.length} sale${b.length === 1 ? '' : 's'} while you were away from the tab (+${fmt(gold)} 🪙)`, 'gold');
      this.sock.rpc('shop.ack', { upto: Math.max(...b.map((x) => x.id)) }, { auto: true }).catch(() => {});
    });
    s.on('kicked', (m) => this.toast(m.reason, 'err'));
  }

  onWelcome(m) {
    const y = m.you;
    this.myId = y.id;
    this.myName = y.name;
    this.myAvatar = y.avatar;
    this.nameEl.textContent = y.name;
    this.chanEl.textContent = `Ch ${m.channel}`;
    this.channel = m.channel;
    this.setMe(y);
    this.setTill(y.shop?.till || 0);
    this.#renderFace();
    this.#renderQuest();
    this.#drawMapBase();
    this.chatLine({ sys: true, text: `Welcome to Hearthvale — Channel ${m.channel}. ${m.players.length ? `${m.players.length} other ${m.players.length === 1 ? 'hero is' : 'heroes are'} here!` : 'Invite friends from the Town Hall!'}` });
  }

  #renderFace() {
    clear(this.face).append(h('img', { src: portrait(this.myAvatar), style: { width: '100%', height: '100%' } }));
  }

  setAvatar(a) {
    this.myAvatar = a;
    this.#renderFace();
  }

  setMe(m) {
    const prevLevel = this.me.level;
    const prevGold = this.me.gold;
    Object.assign(this.me, m);
    if (m.level && prevLevel && m.level > prevLevel) this.levelUp(`Hero Level ${m.level}!`, 'You feel stronger.');
    if (m.level && m.level !== prevLevel) this.game?.tintMobs();
    this.goldEl.textContent = fmt(this.me.gold);
    if (prevGold !== undefined && m.gold > prevGold && prevGold !== 0) {
      this.goldEl.parentElement.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300 });
    }
    this.lv.textContent = this.me.level;
    this.hpFill.style.width = `${Math.round((100 * this.me.hp) / this.me.maxHp)}%`;
    if (m.equip && this.game?.me) this.game.me.av.setEquip(m.equip);
    this.panels.refresh();
  }

  setOnline(n) {
    this.onlineEl.textContent = n;
  }

  onXp(xp) {
    if (!xp) return;
    const sk = SKILLS[xp.skill];
    this.toast(`${sk.icon} +${xp.amount} ${sk.name} XP`);
    if (xp.leveled) {
      this.levelUp(`${sk.name} ${xp.level}!`, sk.perk);
    }
  }

  levelUp(big, small) {
    sfx.level();
    const el = h('div.levelup', h('div.big', '' + big), h('div.sm', small || ''));
    this.el.append(el);
    setTimeout(() => el.remove(), 2700);
    this.confetti(40);
  }

  confetti(n = 60) {
    const wrap = h('div.confetti');
    // Drifting gold dust rather than party confetti.
    const cols = ['#e0b048', '#f3d589', '#c9773a'];
    n = Math.min(n, 30);
    for (let i = 0; i < n; i++) {
      const col = cols[i % cols.length];
      const c = h('i', { style: { left: Math.random() * 100 + '%', background: col, color: col, animationDuration: 2.4 + Math.random() * 0.8 + 's', animationDelay: Math.random() * 0.5 + 's' } });
      wrap.append(c);
    }
    this.el.append(wrap);
    setTimeout(() => wrap.remove(), 3800);
  }

  // Sales from your shop (NPCs and players): one toast per batch, player
  // purchases and sell-outs called out, the till badge kept current.
  #onShopSale(m) {
    this.setTill(m.till);
    this.game?.room?.setTill(m.till);
    this.panels.refresh();
    if (document.visibilityState !== 'visible') {
      (this.saleBuffer ||= []).push(...m.sales);
      return;
    }
    const npc = m.sales.filter((x) => x.kind !== 'player');
    for (const x of m.sales.filter((x) => x.kind === 'player')) this.toast(`${x.buyer} bought ${x.qty}× ${ITEMS[x.item].name} (+${fmt(x.net)} 🪙)`, 'gold');
    if (npc.length === 1) this.toast(`Sold ${npc[0].qty}× ${ITEMS[npc[0].item].name} (+${fmt(npc[0].net)} 🪙)`, 'gold');
    else if (npc.length > 1) this.toast(`${npc.length} sales (+${fmt(npc.reduce((a, x) => a + x.net, 0))} 🪙)`, 'gold');
    for (const x of m.sales) if (x.left === 0) this.toast(`Your ${ITEMS[x.item].name} sold out!`, 'good');
    sfx.coin();
    this.sock.rpc('shop.ack', { upto: m.upto }, { auto: true }).catch(() => {});
  }
  setTill(v) {
    this.till = v || 0;
    this.shopBadge.textContent = this.till >= 1000 ? `${(this.till / 1000).toFixed(this.till >= 10000 ? 0 : 1)}k` : String(this.till);
    this.shopBadge.classList.toggle('hidden', !this.till);
  }
  // Town vs inside a shop: swap the dock, hide the town-only bits.
  setMode(mode, { isOwner = false } = {}) {
    const room = mode === 'room';
    this.dock.classList.toggle('hidden', room);
    this.roomDock.classList.toggle('hidden', !room);
    this.ledgerBtn.style.display = isOwner ? '' : 'none';
    this.el.classList.toggle('in-room', room);
  }

  toast(text, kind = '') {
    const el = h('div.toast' + (kind ? '.' + kind : ''), text);
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  // ── Chat ───────────────────────────────────────────────────────────
  #sendChat(e) {
    e.preventDefault();
    const text = this.input.value.trim();
    if (!text) return;
    this.sock.send({ t: 'chat', text });
    this.input.value = '';
    this.input.blur();
  }
  chatLine(m) {
    const line = h('div.line' + (m.sys ? '.sys' : '') + (m.from === this.myId ? '.me' : ''), m.sys ? m.text : [h('b', m.name + ': '), m.text]);
    this.log.append(line);
    while (this.log.children.length > 60) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  // ── Travel ─────────────────────────────────────────────────────────
  travel(id) {
    const g = this.game;
    if (!g) return;
    if (g.battle) return this.toast("You're in a battle!", 'err');
    const b = BUILDINGS.find((x) => x.id === id);
    const [dx, dz] = doorPoint(b);
    const p = g.myPos();
    if (Math.hypot(p.x - dx, p.z - dz) > 3) this.toast(`Walking to ${b.label}…`);
    g.goBuilding(id);
  }

  openBuilding(action) {
    this.panels.open(action);
  }
  openProfile(id) {
    this.panels.open('profile', { id });
  }

  // ── Quest / guide ──────────────────────────────────────────────────
  #renderQuest() {
    const step = this.me.tutorial ?? 0;
    const q = TUTORIAL_TEXT[step];
    if (!q) {
      this.questEl.classList.add('hidden');
      this.arrow.classList.add('hidden');
      return;
    }
    clear(this.questEl).append(
      h('b', `Quest ${step + 1}/${TUTORIAL_TEXT.length}`),
      h('div', { style: { fontWeight: 600 } }, q.text),
      h('div.muted', q.hint),
      h('button.btn.small.green', { style: { marginTop: '6px' }, on: { click: () => this.#questTarget()?.go() } }, glyph('compass'), 'Take me there'),
      h('br'),
      h('button.skip', { on: { click: () => (this.sock.rpc('tutorialSkip'), (this.me.tutorial = 99), this.#renderQuest()) } }, 'skip tutorial'),
    );
    this.questEl.classList.remove('hidden');
  }

  // Where the current quest wants you to go. Targets are *locked* (one tree,
  // one slime) until done, so the guide never flips between candidates.
  #questTarget() {
    const step = this.me.tutorial ?? 0;
    const q = TUTORIAL_TEXT[step];
    const g = this.game;
    if (!q || !g) return null;
    const p = g.myPos();
    if (q.target === 'tree') {
      const lock = this.questLock?.kind === 'tree' ? g.town.nodes.get(this.questLock.id) : null;
      if (!lock || !lock.alive) {
        const n = g.nearestNode('tree_oak');
        this.questLock = n ? { kind: 'tree', id: n.id } : null;
      }
      if (!this.questLock) return null;
      const n = g.nodePos(this.questLock.id);
      return { x: n.x, z: n.z, y: 5.4, label: 'Oak tree', go: () => g.goNode(n.id) };
    }
    if (q.target === 'slime') {
      if (p.z > GATE.z - 1) return { x: GATE.x, z: GATE.z, y: 8.5, label: 'Wilds Gate', go: () => g.walkTo(GATE.x, GATE.z - 6, true) };
      let mv = this.questLock?.kind === 'slime' ? g.mobs.get(this.questLock.id) : null;
      if (!mv || mv.state === 'dead') {
        mv = null;
        for (const m of g.mobs.values()) if (m.type === 'slime' && m.state !== 'dead' && (!mv || Math.hypot(m.x - p.x, m.z - p.z) < Math.hypot(mv.x - p.x, mv.z - p.z))) mv = m;
        this.questLock = mv ? { kind: 'slime', id: mv.id } : null;
      }
      if (!mv) {
        // None in sight: head for the nearest slime camp on the map.
        const camp = SPAWNS.filter((sp) => sp.monster === 'slime').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        return camp ? { x: camp.x, z: camp.z, y: 2.6, label: MONSTERS.slime.name, go: () => g.walkTo(camp.x, camp.z, true) } : null;
      }
      const id = mv.id;
      return { x: mv.x, z: mv.z, y: 2.6, label: MONSTERS.slime.name, go: () => g.goMob(id) };
    }
    const b = BUILDINGS.find((x) => x.id === q.target);
    const [dx, dz] = doorPoint(b);
    return { x: dx, z: dz, y: 3.2, label: b.label, go: () => this.travel(b.id) };
  }

  frame(dt) {
    this.t = (this.t || 0) + dt;
    this.mapT = (this.mapT || 0) + dt;
    if (this.mapT > 0.15) {
      this.mapT = 0;
      this.#drawMap();
    }
    // Quest guide: in-world beacon + path trail, and an edge arrow when off-screen.
    const tg = this.game && !this.game.battle && !this.game.fishing ? this.#questTarget() : null;
    this.game?.setGuide(tg);
    if (tg) {
      const p = this.game.myPos();
      const dist = Math.hypot(tg.x - p.x, tg.z - p.z);
      const s = this.game.project(new THREE.Vector3(tg.x, tg.y, tg.z));
      const m = 50;
      const onScreen = s.vis && s.x > m && s.x < innerWidth - m && s.y > 110 && s.y < innerHeight - 130;
      const hideNear = dist < 3.5 || !!this.game.gather;
      this.arrow.classList.toggle('hidden', hideNear);
      this.arrowLabel.textContent = `${tg.label} · ${Math.round(dist)}m`;
      if (onScreen) {
        this.arrow.classList.add('over');
        this.arrow.style.transform = `translate(${s.x}px, ${s.y - 40 + Math.sin(this.t * 6) * 7}px)`;
      } else {
        // Direction relative to where the camera is looking (works even when
        // the target is behind you). The arrow orbits your hero, so it never
        // covers menus and always reads as "go this way".
        this.arrow.classList.remove('over');
        const yaw = this.game.cam.curYaw ?? this.game.cam.yaw;
        const dx = tg.x - p.x;
        const dz = tg.z - p.z;
        const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        const fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
        const ang = Math.atan2(-fwd, right);
        const me = this.game.project(new THREE.Vector3(p.x, 1.1, p.z));
        const r = Math.min(115, Math.min(innerWidth, innerHeight) * 0.22);
        this.arrow.style.transform = `translate(${me.x + Math.cos(ang) * r}px, ${me.y + Math.sin(ang) * r}px)`;
        this.arrowIcon.style.transform = `rotate(${ang}rad)`;
      }
    } else this.arrow.classList.add('hidden');
    // Rhythm ring follows the node on screen.
    if (this.rhythmState && this.game) {
      const g = this.rhythmState;
      const n = this.game.nodePos(g.node);
      const s = this.game.project(new THREE.Vector3(n.x, NODE_TYPES[n.type].kind === 'tree' ? 2.2 : 1.3, n.z));
      this.rhythm.style.transform = `translate(${s.x}px, ${s.y}px)`;
      const since = performance.now() - (g.last || 0);
      const k = g.last ? Math.min(1, since / g.period) : 1;
      const ring = this.rhythm.querySelector('.ring');
      const size = 64 + (1 - k) * 110;
      ring.style.width = ring.style.height = size + 'px';
      ring.style.opacity = g.last ? (since > g.period * 1.3 ? 0.35 : 1) : 0.35;
      this.rhythm.classList.toggle('now', !!g.last && isPerfectSwing(since, g.period));
      this.nodebar.style.transform = `translate(${s.x}px, ${s.y - 70}px) translate(-50%, -100%)`;
    }
  }

  // ── Gathering UI ───────────────────────────────────────────────────
  showRhythm(g) {
    this.rhythmState = g;
    this.rhythm.classList.remove('hidden');
    const kind = NODE_TYPES[this.game.nodePos(g.node).type].kind;
    this.rhythm.querySelector('.hint').textContent = (kind === 'tree' ? '🪓' : '⛏️') + ' Tap when the ring meets the circle!';
    this.nodeBar(this.game.town.nodes.get(g.node));
    this.nodebar.classList.remove('hidden');
  }
  hideRhythm() {
    this.rhythmState = null;
    this.rhythm.classList.add('hidden');
    this.nodebar.classList.add('hidden');
  }
  rhythmSwing(t) {
    if (this.rhythmState) this.rhythmState.last = t;
  }
  rhythmResult(perfect) {
    if (!perfect) return;
    this.rhythm.querySelector('.target').animate([{ transform: 'translate(-50%,-50%) scale(1.5)' }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 250 });
  }
  nodeBar(view) {
    if (!this.rhythmState || !view || view.node.id !== this.rhythmState.node) return;
    const max = view.maxHp;
    clear(this.nodebar);
    this.nodebar.classList.toggle('wide', max > 12);
    for (let i = 0; i < max; i++) this.nodebar.append(h('i' + (i >= view.hp ? '.off' : '')));
  }

  fishState(s) {
    this.fishWait.classList.toggle('hidden', s !== 'wait');
    this.fishBtn.classList.toggle('hidden', s !== 'bite');
  }

  // ── Reel fight (Stardew-style) ─────────────────────────────────────
  // Runs the shared deterministic sim at a fixed 60 Hz and records the ticks
  // where the button toggled; the server replays those to confirm the catch.
  startFight(bite, onDone) {
    this.endFight();
    const state = newFight(bite.fish, bite.gear);
    const toggles = [];
    let input = false;
    let held = false;
    let acc = 0;
    let last = performance.now();
    let sent = false;
    let clickT = 0;
    const zone = h('div.fz', { style: { height: `${bite.gear.zone * 100}%` } });
    const fish = h('div.ff', bite.fish.d >= 70 ? '🐋' : bite.fish.d >= 45 ? '🦈' : '🐟');
    const meter = h('i');
    const [label, color] = RATING[bite.rating] || RATING.fair;
    const status = h('div.fight-status', 'Hold to reel!');
    const giveUp = h('button.btn.plain.small', { on: { pointerdown: (e) => e.stopPropagation(), click: (e) => (e.stopPropagation(), finish()) } }, 'Cut line');
    const box = h(
      'div.fight',
      h('div.fight-head', h('b', sizeHint(bite.fish.d)), h('span.rating', { style: { background: color } }, label)),
      h('div.fight-body', h('div.ftrack', h('div.fwater'), zone, fish), h('div.fmeter', meter)),
      status,
      h('div.muted', { style: { textAlign: 'center' } }, isTouchDevice() ? 'Hold anywhere to lift the green bar' : 'Hold mouse or Space to lift the green bar'),
      giveUp,
    );
    const scrim = h('div.fight-scrim', box);
    const press = (on) => (e) => {
      if (e?.cancelable) e.preventDefault();
      input = on;
    };
    scrim.addEventListener('pointerdown', press(true));
    scrim.addEventListener('pointerup', press(false));
    scrim.addEventListener('pointercancel', press(false));
    scrim.addEventListener('pointerleave', press(false));
    scrim.addEventListener('contextmenu', (e) => e.preventDefault());
    const key = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      input = e.type === 'keydown';
    };
    addEventListener('keydown', key, true);
    addEventListener('keyup', key, true);
    this.el.append(scrim);
    const finish = () => {
      if (sent) return;
      sent = true;
      status.textContent = state.done === 'caught' ? 'Got it!' : '…';
      onDone(toggles, Math.max(1, state.tick));
    };
    const loop = () => {
      if (this.fight?.state !== state) return;
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= FISH_TICK && !state.done) {
        if (input !== held) {
          toggles.push(state.tick);
          held = input;
        }
        const wasIn = state.inZone;
        stepFight(state, held);
        if (wasIn && !state.inZone && navigator.vibrate) navigator.vibrate(15);
        acc -= FISH_TICK;
      }
      zone.style.bottom = `${state.zonePos * 100}%`;
      zone.classList.toggle('on', state.inZone);
      fish.style.bottom = `${state.fishPos * 100}%`;
      fish.classList.toggle('free', !state.inZone);
      meter.style.height = `${state.progress * 100}%`;
      meter.style.background = state.progress > 0.7 ? '#5cbf5a' : state.progress > 0.35 ? '#f7b928' : '#ea5a4f';
      status.textContent = state.inZone ? (held ? 'Reeling in' : 'On the line') : 'Keep tension in the band';
      if (held && now - clickT > 110) {
        clickT = now;
        sfx.tap();
      }
      if (state.done) return finish();
      requestAnimationFrame(loop);
    };
    this.fight = { state, scrim, off: () => (removeEventListener('keydown', key, true), removeEventListener('keyup', key, true)) };
    requestAnimationFrame(loop);
  }

  endFight() {
    if (!this.fight) return;
    this.fight.off();
    this.fight.scrim.remove();
    this.fight = null;
  }

  // ── Minimap ────────────────────────────────────────────────────────
  // The whole world drawn once (up to 2 px per metre); the minimap shows a
  // window of it around you.
  #drawMapBase() {
    const E = EXTENT;
    const span = Math.max(E.x1 - E.x0, E.z1 - E.z0) + 16;
    const S = Math.min(2, 2048 / span);
    const W = Math.ceil(span * S);
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const x = c.getContext('2d');
    const ox = E.x0 - 8;
    const oz = E.z0 - 8;
    const PX = (v) => (v - ox) * S;
    const PZ = (v) => (v - oz) * S;
    const disc = (col, o, r = o.r) => {
      x.fillStyle = col;
      x.beginPath();
      x.arc(PX(o.x), PZ(o.z), r * S, 0, Math.PI * 2);
      x.fill();
    };
    x.fillStyle = '#3f7090';
    x.fillRect(0, 0, W, W);
    for (const l of LANDS) disc('#d6bd8a', l, l.r + 3);
    for (const l of LANDS) disc('#74a04c', l);
    x.globalAlpha = 0.8;
    for (const z of ZONES) disc(z.ground, z);
    x.globalAlpha = 1;
    x.strokeStyle = '#b89b6e';
    x.lineCap = 'round';
    for (const [ax, az, bx, bz, w] of pathSegments()) {
      x.lineWidth = Math.max(1, w * 2 * S);
      x.beginPath();
      x.moveTo(PX(ax), PZ(az));
      x.lineTo(PX(bx), PZ(bz));
      x.stroke();
    }
    for (const l of LAKES) disc('#4b88a6', l);
    for (const p of PLAZAS) disc('#a89a82', p);
    for (const b of BUILDINGS) {
      x.fillStyle = b.deco ? '#c9a374' : b.roof;
      x.fillRect(PX(b.x - b.w / 2), PZ(b.z - b.d / 2), b.w * S, b.d * S);
    }
    x.fillStyle = '#a87c4f';
    for (const d of DOCKS) x.fillRect(PX(d.x - d.w / 2), PZ(d.z - d.d / 2), d.w * S, d.d * S);
    this.mapBase = c;
    this.mapS = S;
    this.mapO = [ox, oz];
  }
  #drawMap() {
    if (!this.mapBase || !this.game?.me) return;
    const x = this.mm.getContext('2d');
    const S = this.mapS;
    const [ox, oz] = this.mapO;
    const me = this.game.myPos();
    // A window about 90 m across, centred on the player.
    const zoom = 256 / (90 * S);
    x.save();
    x.clearRect(0, 0, 256, 256);
    x.translate(128, 128);
    x.scale(zoom, zoom);
    x.translate(-(me.x - ox) * S, -(me.z - oz) * S);
    x.drawImage(this.mapBase, 0, 0);
    const dot = (wx, wz, col, r) => {
      x.fillStyle = col;
      x.beginPath();
      x.arc((wx - ox) * S, (wz - oz) * S, r / zoom, 0, Math.PI * 2);
      x.fill();
    };
    for (const mv of this.game.mobs.values()) if (mv.state !== 'dead') dot(mv.x, mv.z, MONSTERS[mv.type].boss ? '#a868e0' : '#e2574c', 5);
    for (const pv of this.game.players.values()) if (!pv.isMe) dot(pv.x, pv.z, '#ffffff', 7), dot(pv.x, pv.z, '#3b82c4', 5);
    x.restore();
    // Player arrow in the centre, pointing where the camera faces.
    x.save();
    x.translate(128, 128);
    x.rotate(-this.game.cam.yaw + Math.PI);
    x.fillStyle = '#ffd84a';
    x.strokeStyle = '#7a3f1c';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(0, -16);
    x.lineTo(11, 12);
    x.lineTo(0, 6);
    x.lineTo(-11, 12);
    x.closePath();
    x.fill();
    x.stroke();
    x.restore();
  }

  // ── Battle UI ──────────────────────────────────────────────────────
  battleStart(b, def) {
    this.battleDef = def;
    this.dock.classList.add('hidden');
    this.chat.classList.add('hidden');
    this.questEl.style.visibility = 'hidden';
    this.mobName = h('div.nm');
    this.mobHp = h('i');
    this.timerFill = h('i');
    this.battleTop = h('div.battle-top', h('div.mobbar', this.mobName, h('div.hp', this.mobHp), h('div.timer', this.timerFill)));
    this.partyEl = h('div.party');
    this.waitEl = h('div.waiting.hidden', 'Waiting for your party…');
    const act = (a, e, label, cls) => h('button.btn.' + cls, { on: { click: () => this.#battleAct(a) } }, h('span.e', glyph(e)), label);
    this.skillBtn = act('skill', 'spark', 'Special', 'purple');
    this.actionsEl = h('div.actions', act('attack', 'swords', 'Attack', 'red'), this.skillBtn, act('defend', 'shield', 'Defend', 'blue'), act('potion', 'flask', 'Item', 'green'), act('flee', 'run', 'Flee', 'plain'));
    this.battleUi = h('div.battle-ui', this.partyEl, this.waitEl, this.actionsEl);
    this.el.append(this.battleTop, this.battleUi);
    const splash = h('div.levelup', h('div.big', def.name), h('div.sm', `Level ${def.lvl}${def.boss ? ' · Boss' : ''}`));
    this.el.append(splash);
    setTimeout(() => splash.remove(), 1800);
  }

  battleUpdate(b) {
    if (!this.battleTop) return;
    this.battleState = b;
    this.battleDeadline = performance.now() + b.endsIn;
    this.battleRoundMs = 12000;
    this.mobName.textContent = `${this.battleDef.name} — ${b.mobHp}/${b.mobMax}`;
    this.mobHp.style.width = `${(100 * b.mobHp) / b.mobMax}%`;
    clear(this.partyEl);
    const mine = b.fighters.find((f) => f.id === this.myId);
    for (const f of b.fighters) {
      this.partyEl.append(
        h(
          'div.pcard' + (f.id === this.myId ? '.me' : '') + (f.alive ? '' : '.ko'),
          h('div', f.name, f.ready ? ' ✅' : '', h('span.pips', ...[0, 1, 2].map((i) => h('i' + (i < f.charge ? '.on' : ''))))),
          h('div.hpbar', h('i', { style: { width: `${(100 * f.hp) / f.max}%` } })),
          h('div.muted', `${f.hp}/${f.max}`),
        ),
      );
    }
    if (mine) {
      this.me.hp = mine.hp;
      this.hpFill.style.width = `${(100 * mine.hp) / mine.max}%`;
      const waiting = mine.ready || !mine.alive;
      this.actionsEl.classList.toggle('hidden', waiting);
      this.waitEl.classList.toggle('hidden', !waiting);
      this.waitEl.textContent = mine.alive ? 'Waiting for your party…' : 'Knocked out — your party fights on!';
      this.skillBtn.disabled = mine.charge < 3;
    }
    clearInterval(this.timerInt);
    this.timerInt = setInterval(() => {
      const left = Math.max(0, this.battleDeadline - performance.now());
      if (this.timerFill) this.timerFill.style.width = `${(100 * left) / this.battleRoundMs}%`;
    }, 100);
  }

  battleLog() {}

  #battleAct(a) {
    sfx.tap();
    if (a === 'potion') {
      const heals = Object.entries(this.me.inv).filter(([id, n]) => n > 0 && ITEMS[id]?.heal);
      if (!heals.length) return this.toast('No healing items! Craft potions or grilled fish.', 'err');
      heals.sort((x, y) => ITEMS[x[0]].heal - ITEMS[y[0]].heal);
      const [id] = heals.find(([hid]) => ITEMS[hid].heal >= this.me.maxHp - this.me.hp) || heals[heals.length - 1];
      this.sock.send({ t: 'bact', a, item: id });
    } else this.sock.send({ t: 'bact', a });
    if (a !== 'flee') {
      this.actionsEl.classList.add('hidden');
      this.waitEl.classList.remove('hidden');
    }
  }

  battleEnd(r) {
    clearInterval(this.timerInt);
    this.battleTop?.remove();
    this.battleUi?.remove();
    this.battleTop = this.battleUi = null;
    this.dock.classList.remove('hidden');
    this.chat.classList.remove('hidden');
    this.questEl.style.visibility = '';
    if (r.fled) return this.toast('You got away safely.');
    if (r.victory) {
      sfx.victory();
      this.confetti(80);
      this.panels.open('result', r);
      if (r.xp?.leveled) setTimeout(() => this.levelUp(`Combat ${r.xp.level}!`, SKILLS.combat.perk), 600);
    } else {
      sfx.defeat();
      this.panels.open('result', r);
    }
  }
}
