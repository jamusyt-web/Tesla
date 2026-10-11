import './map.js'; // loads the world map first: everything below reads it
import { ITEMS, isItem } from '../shared/items.js';
import { RECIPE_BY_ID } from '../shared/recipes.js';
import { levelFromXp, doubleChance } from '../shared/skills.js';
import { MONSTERS, heroStats, damage } from '../shared/monsters.js';
import {
  NODES, SPAWNS, buildColliders, NavGrid, NODE_TYPES, stepPath,
  INTERACT_RANGE, FISH_RANGE, SPAWN, isWalkable, WORLD_RADIUS, isDeepSpot, SWING_FLOOR, isPerfectSwing,
} from '../shared/world.js';
import { rollFish, fishingGear, fightRating, replayFight, FISH, FISH_MAX_TICKS } from '../shared/fishing.js';
import { GameError, fail } from './db.js';
import { Heroes } from './heroes.js';
import { Market } from './market.js';
import { Shops } from './shop.js';
import { ShopRoom } from './rooms.js';
import { Crafting } from './crafting.js';
import { SHOP } from '../shared/shop.js';
import { Auth } from './auth.js';

const GATHER_ACTS = new Set(['chop', 'mine', 'pick']);

export const CHANNEL_CAP = Number(process.env.CHANNEL_CAP || 40);
const TICK_MS = 50; // 20 Hz simulation
const SNAP_EVERY = 2; // 10 Hz snapshots
const ROUND_MS = 12000;
const MOB_SPEED = 2.2;
const NPC_SELL_RATE = 0.6; // instant-sell to the town merchant pays 60% of value
const CHAT_MAX = 140;

const STATIC = (() => {
  const col = buildColliders();
  return { nodes: NODES, col, nav: new NavGrid(col) };
})();

const rint = (a, b, rng = Math.random) => a + Math.floor(rng() * (b - a + 1));
const q2 = (v) => Math.round(v * 100) / 100;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Tutorial: the core loop in one session.
export const TUTORIAL = [
  { id: 'chop', text: 'Chop a tree in Whisperwood (west)', reward: 20 },
  { id: 'craft', text: 'Saw Oak Planks at the Workshop', reward: 30 },
  { id: 'fight', text: `Slay a ${MONSTERS.slime.name} beyond the Wilds Gate (north)`, reward: 50 },
  { id: 'stock', text: 'Put something on a display in Your Shop', reward: 60 },
];

// ─────────────────────────────────────────────────────────────────────────
// A Channel is one live copy of the town (like a lobby / server shard). All
// players in it see each other move in real time.
// ─────────────────────────────────────────────────────────────────────────
class Channel {
  constructor(game, id) {
    this.game = game;
    this.id = id;
    this.players = new Map(); // accountId → Client
    this.nodes = new Map(STATIC.nodes.map((n) => [n.id, { ...n, hp: NODE_TYPES[n.type].hp, alive: true, respawnAt: 0, hitters: new Set() }]));
    this.mobs = new Map();
    this.battles = new Map();
    this.tickNo = 0;
    this.seq = 0;
    // Monster camps come from the map; each monster roams around its own camp.
    for (const sp of SPAWNS)
      for (let i = 0; i < sp.count; i++) {
        const id = `m${this.mobs.size}`;
        const mob = { id, type: sp.monster, sp, x: 0, z: 0, rot: 0, path: null, state: 'roam', next: 0, respawnAt: 0, battle: null };
        this.#placeMob(mob);
        this.mobs.set(id, mob);
      }
  }

  #placeMob(mob) {
    const sp = mob.sp;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * sp.r;
      const x = sp.x + Math.cos(a) * d;
      const z = sp.z + Math.sin(a) * d;
      if (isWalkable(x, z, STATIC.col)) {
        mob.x = x;
        mob.z = z;
        return;
      }
    }
    mob.x = sp.x;
    mob.z = sp.z;
  }

  get size() {
    return this.players.size;
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const c of this.players.values()) if (c !== except) c.sendRaw(data);
  }

  add(c) {
    // Don't materialise inside another hero.
    const e = c.ent;
    const crowded = (x, z) => [...this.players.values()].some((o) => !o.room && Math.hypot(o.ent.x - x, o.ent.z - z) < 1.3);
    for (let k = 0; k < 40 && crowded(e.x, e.z); k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.5 + Math.random() * 3.5;
      const x = e.x + Math.cos(a) * d;
      const z = e.z + Math.sin(a) * d;
      if (isWalkable(x, z, STATIC.col) && !crowded(x, z)) {
        e.x = x;
        e.z = z;
      }
    }
    e.path = null;
    this.players.set(c.hero.id, c);
    c.ch = this;
    this.game.crafting.attach(c);
    c.send({
      t: 'welcome',
      channel: this.id,
      you: c.publicSelf(),
      players: [...this.players.values()].filter((o) => o !== c).map((o) => o.publicInfo()),
      nodes: [...this.nodes.values()].filter((n) => !n.alive || n.hp < NODE_TYPES[n.type].hp).map((n) => ({ id: n.id, hp: n.hp, alive: n.alive, respawnIn: n.alive ? 0 : Math.max(0, n.respawnAt - Date.now()) })),
      mobs: [...this.mobs.values()].map((m) => this.mobInfo(m)),
      battles: [...this.battles.values()].map((b) => b.publicState()),
    });
    this.broadcast({ t: 'join', p: c.publicInfo() }, c);
  }

  remove(c) {
    if (c.battle) c.battle.leave(c, 'left');
    this.game.crafting.releaseSpot(c);
    if (c.craft) c.craft.spot = null;
    this.players.delete(c.hero.id);
    this.broadcast({ t: 'leave', id: c.hero.id });
  }

  mobInfo(m) {
    return { id: m.id, type: m.type, x: q2(m.x), z: q2(m.z), rot: q2(m.rot), state: m.state };
  }

  tick(now, dt) {
    this.tickNo++;
    for (const c of this.players.values()) {
      const e = c.ent;
      if (e.path) {
        stepPath(e, dt);
        if (!e.path && e.act === 'walk') e.act = 'idle';
      }
      if (!c.battle && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 4 * dt);
      if (GATHER_ACTS.has(e.act) && now - e.lastSwing > 2500) e.act = 'idle'; // stopped swinging
      if (c.craft) {
        this.game.crafting.expire(c, now);
        if (c.craft?.spot && !e.path) e.rot = c.craft.spot.rot; // face the station while working
      }
      const f = e.fishing;
      if (f && f.state === 'wait' && now >= f.biteAt) {
        // Decide what bit now; the client needs the fight parameters to play it.
        f.state = 'bite';
        const rod = ITEMS[c.hero.equip.rod];
        const lvl = levelFromXp(c.hero.skills.fishing || 0);
        f.fish = rollFish(Math.random, rod?.tier || 1, lvl, isDeepSpot(this.nodes.get(f.node)));
        f.gear = fishingGear(rod?.tier || 1, lvl, rod?.rodZone || 0);
        const { d, behavior, seed } = f.fish;
        c.send({ t: 'bite', window: f.window, fish: { d, behavior, seed }, gear: f.gear, rating: fightRating(d, f.gear) });
      }
      if (f && f.state === 'bite' && now > f.biteAt + f.window + 600) {
        e.fishing = null;
        e.act = 'idle';
        c.send({ t: 'fishResult', ok: false, reason: 'It got away…' });
      }
      if (f && f.state === 'fight' && now > f.fightAt + (FISH_MAX_TICKS / 60) * 1000 + 8000) {
        e.fishing = null;
        e.act = 'idle';
        c.send({ t: 'fishResult', ok: false, reason: 'The line went slack — it got away.' });
      }
    }
    for (const n of this.nodes.values()) {
      if (!n.alive && now >= n.respawnAt) {
        n.alive = true;
        n.hp = NODE_TYPES[n.type].hp;
        n.hitters.clear();
        this.broadcast({ t: 'node', id: n.id, alive: true, hp: n.hp });
      }
    }
    for (const m of this.mobs.values()) {
      if (m.state === 'dead') {
        if (now >= m.respawnAt) {
          m.state = 'roam';
          this.#placeMob(m);
          m.next = now + 2000;
        }
        continue;
      }
      if (m.state !== 'roam') continue;
      if (m.path) stepPath(m, dt, MOB_SPEED);
      else if (now >= m.next) {
        m.next = now + 2500 + Math.random() * 5000;
        const sp = m.sp;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * sp.r;
        const tx = sp.x + Math.cos(a) * d;
        const tz = sp.z + Math.sin(a) * d;
        if (isWalkable(tx, tz, STATIC.col) && STATIC.nav.clear(m.x, m.z, tx, tz)) m.path = [[tx, tz]];
      }
    }
    for (const b of this.battles.values()) b.tick(now);
    if (this.tickNo % SNAP_EVERY === 0) this.snapshot();
  }

  // Delta snapshot: only entities whose quantized state changed, plus a full
  // refresh every 3 s so late packets can't leave anyone stuck.
  snapshot() {
    const full = this.tickNo % 60 === 0;
    const p = [];
    for (const c of this.players.values()) {
      if (c.room) continue; // inside a shop: not in the town
      const e = c.ent;
      const row = [c.hero.id, q2(e.x), q2(e.z), q2(e.rot), e.act];
      const key = row.join(',');
      if (full || key !== e.lastSnap) {
        e.lastSnap = key;
        p.push(row);
      }
    }
    const m = [];
    for (const mob of this.mobs.values()) {
      const row = [mob.id, q2(mob.x), q2(mob.z), q2(mob.rot), mob.state];
      const key = row.join(',');
      if (full || key !== mob.lastSnap) {
        mob.lastSnap = key;
        m.push(row);
      }
    }
    if (p.length || m.length) this.#townOnly({ t: 's', p, m });
  }

  // Everything about the town, for someone stepping back out of a shop.
  fullSnapshot() {
    const p = [...this.players.values()].filter((c) => !c.room).map((c) => [c.hero.id, q2(c.ent.x), q2(c.ent.z), q2(c.ent.rot), c.ent.act]);
    const m = [...this.mobs.values()].map((mob) => [mob.id, q2(mob.x), q2(mob.z), q2(mob.rot), mob.state]);
    return { t: 's', p, m, full: true };
  }

  #townOnly(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.players.values()) if (!c.room) c.sendRaw(data);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Turn-based co-op battle, fought *in the world* where the monster stands.
// Up to 4 heroes; anyone nearby can tap the monster to join mid-fight.
// ─────────────────────────────────────────────────────────────────────────
class Battle {
  constructor(ch, mob) {
    this.ch = ch;
    this.id = `b${++ch.seq}`;
    this.mob = mob;
    this.def = MONSTERS[mob.type];
    this.mobMax = this.def.hp;
    this.mobHp = this.def.hp;
    this.fighters = new Map(); // id → {c, hp, max, atk, def, charge, choice, alive}
    this.round = 1;
    this.deadline = Date.now() + ROUND_MS;
    this.over = false;
    mob.state = 'battle';
    mob.path = null;
    mob.battle = this;
  }

  publicState() {
    return {
      id: this.id,
      mob: this.mob.id,
      mobHp: this.mobHp,
      mobMax: this.mobMax,
      round: this.round,
      endsIn: Math.max(0, this.deadline - Date.now()),
      fighters: [...this.fighters.entries()].map(([id, f]) => ({ id, name: f.c.hero.name, hp: Math.round(f.hp), max: f.max, charge: f.charge, alive: f.alive, ready: !!f.choice })),
    };
  }

  push(extra = {}) {
    this.ch.broadcast({ t: 'battle', b: this.publicState(), ...extra });
  }

  join(c) {
    if (this.over) fail('That battle just ended.');
    if (this.fighters.size >= 4) fail('This battle is full (4 heroes).');
    const st = c.stats();
    this.fighters.set(c.hero.id, { c, hp: Math.max(1, Math.min(c.ent.hp, st.hp)), max: st.hp, atk: st.atk, def: st.def, charge: 0, choice: null, alive: true });
    c.cancelFishing();
    c.battle = this;
    c.ent.act = 'battle';
    // Line up facing the monster in a little arc.
    const n = this.fighters.size - 1;
    const ang = Math.atan2(c.ent.x - this.mob.x, c.ent.z - this.mob.z);
    const spread = [0, 0.55, -0.55, 1.1][n];
    const tx = this.mob.x + Math.sin(ang + spread) * 3.4;
    const tz = this.mob.z + Math.cos(ang + spread) * 3.4;
    c.ent.path = isWalkable(tx, tz, STATIC.col) ? [[tx, tz]] : null;
    this.mob.rot = Math.atan2(c.ent.x - this.mob.x, c.ent.z - this.mob.z);
    this.push({ joined: c.hero.id });
  }

  leave(c, why) {
    const f = this.fighters.get(c.hero.id);
    if (!f) return;
    c.ent.hp = Math.max(1, f.hp);
    this.fighters.delete(c.hero.id);
    c.battle = null;
    c.ent.act = 'idle';
    if (!this.over && ![...this.fighters.values()].some((x) => x.alive)) this.end(false);
    else this.push({ left: c.hero.id, why });
  }

  choose(c, a, itemId) {
    const f = this.fighters.get(c.hero.id);
    if (!f || !f.alive || this.over) return;
    if (!['attack', 'skill', 'defend', 'potion', 'flee'].includes(a)) return;
    if (a === 'skill' && f.charge < 3) fail('Your special is not charged yet.');
    if (a === 'potion') {
      if (!isItem(itemId) || !ITEMS[itemId].heal) fail('Pick a healing item.');
      if (this.ch.game.heroes.count(c.hero.id, itemId) < 1) fail(`No ${ITEMS[itemId].name} left.`);
    }
    if (a === 'flee') {
      this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev: [{ k: 'flee', who: c.hero.id }] });
      this.leave(c, 'fled');
      return;
    }
    f.choice = { a, itemId };
    const alive = [...this.fighters.values()].filter((x) => x.alive);
    if (alive.every((x) => x.choice)) this.deadline = Math.min(this.deadline, Date.now() + 250);
    else this.push();
  }

  tick(now) {
    if (!this.over && now >= this.deadline) this.resolve();
  }

  resolve() {
    const ev = [];
    const H = this.ch.game.heroes;
    for (const [id, f] of this.fighters) {
      if (!f.alive) continue;
      const ch = f.choice || { a: 'attack' }; // idle heroes auto-attack so nobody stalls the party
      f.defending = false;
      if (ch.a === 'attack' || ch.a === 'skill') {
        const skill = ch.a === 'skill' && f.charge >= 3;
        const crit = Math.random() < 0.12;
        let dmg = damage(f.atk, this.def.def, skill ? 2.4 : 1);
        if (crit) dmg = Math.round(dmg * 1.6);
        this.mobHp = Math.max(0, this.mobHp - dmg);
        f.charge = skill ? 0 : Math.min(3, f.charge + 1);
        ev.push({ k: 'hit', from: id, to: 'mob', dmg, crit, skill });
        if (this.mobHp <= 0) break;
      } else if (ch.a === 'defend') {
        f.defending = true;
        f.charge = Math.min(3, f.charge + 1);
        ev.push({ k: 'defend', who: id });
      } else if (ch.a === 'potion') {
        try {
          H.takeItem(id, ch.itemId, 1);
          const heal = Math.min(f.max - f.hp, ITEMS[ch.itemId].heal);
          f.hp += heal;
          ev.push({ k: 'heal', who: id, amt: Math.round(heal), item: ch.itemId });
          f.c.pushInventory();
        } catch {
          ev.push({ k: 'defend', who: id });
          f.defending = true;
        }
      }
    }
    if (this.mobHp <= 0) {
      ev.push({ k: 'mobDown' });
      this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev });
      this.end(true);
      return;
    }
    // Monster's turn.
    const move = this.def.moves[Math.floor(Math.random() * this.def.moves.length)];
    const alive = [...this.fighters.entries()].filter(([, f]) => f.alive);
    const targets = move.aoe ? alive : [alive[Math.floor(Math.random() * alive.length)]];
    for (const [id, f] of targets) {
      let dmg = damage(this.def.atk, f.def, move.mult * (move.aoe ? 0.7 : 1));
      if (f.defending) dmg = Math.max(1, Math.round(dmg * 0.35));
      f.hp = Math.max(0, f.hp - dmg);
      ev.push({ k: 'hit', from: 'mob', to: id, dmg, move: move.name, blocked: !!f.defending });
      if (f.hp <= 0) {
        f.alive = false;
        ev.push({ k: 'ko', who: id });
      }
    }
    for (const f of this.fighters.values()) f.choice = null;
    this.round++;
    this.deadline = Date.now() + ROUND_MS;
    this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev });
    if (![...this.fighters.values()].some((f) => f.alive)) this.end(false);
    else this.push();
  }

  end(victory) {
    if (this.over) return;
    this.over = true;
    const g = this.ch.game;
    const results = {};
    for (const [id, f] of this.fighters) {
      const c = f.c;
      c.battle = null;
      c.ent.act = 'idle';
      c.ent.hp = f.alive ? Math.max(1, f.hp) : Math.round(f.max * 0.3);
      if (!victory) {
        results[id] = { victory: false };
        continue;
      }
      const gold = rint(...this.def.gold);
      const loot = {};
      for (const d of this.def.drops) if (Math.random() < d.p) loot[d.id] = (loot[d.id] || 0) + rint(d.min, d.max);
      try {
        g.heroes.addGold(id, gold);
        for (const [it, n] of Object.entries(loot)) g.heroes.addItem(id, it, n);
      } catch (e) {
        console.error('battle reward failed', e);
      }
      const xp = g.heroes.addXp(c.hero, 'combat', this.def.xp);
      results[id] = { victory: true, gold, loot, xp };
      c.pushInventory();
      c.advanceTutorial('fight');
    }
    this.mob.battle = null;
    if (victory) {
      this.mob.state = 'dead';
      this.mob.respawnAt = Date.now() + (this.def.boss ? 90_000 : 25_000);
      if (this.def.boss) g.announce(`${[...this.fighters.values()].map((f) => f.c.hero.name).join(', ')} defeated the ${this.def.name}!`);
    } else {
      this.mob.state = 'roam';
    }
    this.ch.battles.delete(this.id);
    this.ch.broadcast({ t: 'battleEnd', id: this.id, mob: this.mob.id, victory, results });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// One connected player.
// ─────────────────────────────────────────────────────────────────────────
class Client {
  // Stop fishing for any reason other than a finished catch, and tell the
  // client so its bobber/fight UI never gets left behind.
  cancelFishing(reason = 'You reeled your line in.') {
    if (!this.ent.fishing) return;
    this.ent.fishing = null;
    if (this.ent.act === 'fish') this.ent.act = 'idle';
    this.send({ t: 'fishResult', ok: false, cancelled: true, reason });
  }

  constructor(game, ws, hero) {
    this.game = game;
    this.ws = ws;
    this.hero = hero;
    this.ch = null;
    this.battle = null;
    this.room = null; // the ShopRoom we're inside, if any
    this.rent = null; // our body inside it
    this.roomAt = 0;
    this.lastInput = Date.now(); // real player input (shop presence)
    this.lastChat = 0;
    this.bucket = { t: Date.now(), n: 0 };
    const st = this.stats();
    this.ent = { x: hero.x, z: hero.z, rot: 0, path: null, act: 'idle', hp: st.hp, maxHp: st.hp, lastSwing: 0, lastNode: null, fishing: null, lastSnap: '' };
    if (!isWalkable(this.ent.x, this.ent.z, STATIC.col)) Object.assign(this.ent, { x: SPAWN.x, z: SPAWN.z });
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }
  sendRaw(data) {
    if (this.ws.readyState === 1) this.ws.send(data);
  }

  stats() {
    const h = this.hero;
    const gear = ['weapon', 'armor', 'trinket'].map((s) => ITEMS[h.equip[s]]);
    return heroStats(h.level, levelFromXp(h.skills.combat || 0), gear);
  }

  publicInfo() {
    const e = this.ent;
    return { id: this.hero.id, name: this.hero.name, avatar: this.hero.avatar, level: this.hero.level, equip: this.hero.equip, x: q2(e.x), z: q2(e.z), rot: q2(e.rot), act: e.act, inside: this.room?.owner ?? null, craft: this.craft?.spot ? { station: this.craft.station, spot: this.craft.spot, item: RECIPE_BY_ID[this.craft.recipe]?.out } : null };
  }
  roomInfo() {
    const e = this.rent;
    return { id: this.hero.id, name: this.hero.name, avatar: this.hero.avatar, level: this.hero.level, equip: this.hero.equip, x: q2(e.x), z: q2(e.z), rot: q2(e.rot), act: e.act };
  }
  publicSelf() {
    const shop = this.game.shops.info(this.hero.id);
    return { ...this.publicInfo(), gold: this.game.heroes.gold(this.hero.id), skills: this.hero.skills, inv: this.game.heroes.inventory(this.hero.id), hp: Math.round(this.ent.hp), maxHp: this.ent.maxHp, stats: this.stats(), tutorial: this.hero.tutorial, shop: { till: shop?.till || 0, open: shop ? !!shop.open : true }, craft: this.game.crafting.publicState(this) };
  }

  pushInventory() {
    const H = this.game.heroes;
    const st = this.stats();
    this.ent.maxHp = st.hp;
    this.send({ t: 'me', gold: H.gold(this.hero.id), inv: H.inventory(this.hero.id), skills: this.hero.skills, level: this.hero.level, equip: this.hero.equip, stats: st, hp: Math.round(this.ent.hp), maxHp: st.hp });
  }

  advanceTutorial(stepId) {
    const i = this.hero.tutorial;
    if (i >= TUTORIAL.length || TUTORIAL[i].id !== stepId) return;
    const step = TUTORIAL[i];
    this.game.heroes.addGold(this.hero.id, step.reward);
    this.game.heroes.setTutorial(this.hero, i + 1);
    this.send({ t: 'tutorial', step: i + 1, done: step.id, reward: step.reward });
    this.pushInventory();
  }
}

// ─────────────────────────────────────────────────────────────────────────
export class Game {
  // opts.shopSim = false turns off the shop simulation timer (tests drive it by hand).
  constructor(db, opts = {}) {
    this.db = db;
    this.opts = { shopSim: true, ...opts };
    this.heroes = new Heroes(db);
    this.market = new Market(db, this.heroes);
    this.shops = new Shops(db, this.heroes);
    this.crafting = new Crafting(this);
    this.auth = new Auth(db);
    this.channels = [];
    this.online = new Map(); // accountId → Client
    this.rooms = new Map(); // shop owner → ShopRoom (only while someone is inside)
    this.lastActive = this.heroes.loadActive();
    this.buyNonces = new Map(); // buyer → Map(nonce → result): a retried purchase can't buy twice
    this.seq = 0;
    this.last = Date.now();
    this.timer = null;
    this.shopTimer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tickShops(); // catch up on sales made while the server was down
    if (this.opts.shopSim) this.shopTimer = setInterval(() => this.tickShops(), SHOP.SIM_STEP_MS);
    this.saveTimer = setInterval(() => this.savePositions(), 30000);
  }
  stop() {
    clearInterval(this.timer);
    clearInterval(this.shopTimer);
    clearInterval(this.saveTimer);
    this.savePositions();
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.last) / 1000);
    this.last = now;
    for (const ch of this.channels) {
      try {
        ch.tick(now, dt);
      } catch (e) {
        console.error('channel tick error', e);
      }
    }
    for (const r of [...this.rooms.values()]) {
      try {
        r.tick(now, dt);
      } catch (e) {
        console.error('room tick error', e);
      }
    }
  }

  savePositions() {
    for (const c of this.online.values()) {
      this.heroes.savePos(c.hero.id, c.ent.x, c.ent.z);
      this.heroes.saveActive(c.hero.id, c.lastInput);
    }
  }

  // ── Shops ──────────────────────────────────────────────────────────
  // How present a shop owner is, for NPC footfall: here (input in the last
  // 10 min) and inside, online, offline, or away (no input for 12 h).
  presenceOf(owner, t) {
    const c = this.online.get(owner);
    if (c && t - c.lastInput < SHOP.ACTIVE_MS) return c.room?.owner === owner ? 'inside' : 'online';
    const last = c ? c.lastInput : (this.lastActive.get(owner) ?? 0);
    return t - last > SHOP.AWAY_MS ? 'away' : 'offline';
  }

  tickShops(now = Date.now(), rng = Math.random) {
    let r;
    try {
      r = this.shops.simulate(now, (o, t) => this.presenceOf(o, t), rng);
    } catch (e) {
      console.error('shop sim error', e);
      return null;
    }
    const byOwner = new Map();
    for (const ev of r.events) {
      this.rooms.get(ev.owner)?.npcVisit(ev);
      if (ev.sale) {
        if (!byOwner.has(ev.owner)) byOwner.set(ev.owner, []);
        byOwner.get(ev.owner).push(ev.sale);
      }
    }
    for (const [owner, sales] of byOwner) this.online.get(owner)?.send({ t: 'shopSale', sales, till: this.shops.till(owner), upto: Math.max(...sales.map((x) => x.id)) });
    if (r.skipped > 0) console.log(`shop sim: skipped ${Math.round(r.skipped / 60000)} min of downtime`);
    return r;
  }

  enterShop(c, owner, now = Date.now()) {
    owner = Number(owner);
    if (!Number.isInteger(owner)) fail('No such shop.');
    if (owner === c.hero.id) this.shops.ensure(owner);
    const info = this.shops.info(owner);
    if (!info) fail('No such shop.');
    if (c.battle) fail("You're in a battle!");
    if (c.craft) fail('Finish your craft first.');
    if (c.room?.owner === owner) return c.room.payload(c); // already here (e.g. reconnecting)
    if (now - c.roomAt < SHOP.ENTER_COOLDOWN_MS) fail('Slow down a little!');
    const isOwner = owner === c.hero.id;
    if (!info.open && !isOwner) fail('That shop is closed right now.');
    const existing = this.rooms.get(owner);
    if (existing && existing.visitors >= SHOP.ROOM_CAP && !isOwner) fail('This shop is full right now.');
    // Your town body waits where you stood; you come back out there.
    c.cancelFishing();
    c.ent.path = null;
    c.ent.act = 'idle';
    if (c.room) c.room.remove(c, 'hop');
    else c.ch.broadcast({ t: 'hide', id: c.hero.id }, c);
    let room = this.rooms.get(owner);
    if (!room) this.rooms.set(owner, (room = new ShopRoom(this, owner)));
    c.roomAt = now;
    return room.add(c);
  }

  exitShop(c, why = 'left') {
    if (!c.room) fail("You're not in a shop.");
    c.room.remove(c, why);
    c.ch.broadcast({ t: 'show', p: c.publicInfo() }, c);
    c.send(c.ch.fullSnapshot());
    return { x: q2(c.ent.x), z: q2(c.ent.z) };
  }

  // Everyone who can see/hear c: their channel plus whoever is in their shop room.
  audience(c) {
    const out = new Set(c.ch ? c.ch.players.values() : []);
    if (c.room) for (const o of c.room.occ.values()) out.add(o);
    return out;
  }
  tellAudience(c, msg) {
    const data = JSON.stringify(msg);
    for (const o of this.audience(c)) o.sendRaw(data);
  }

  // Fill-first: join the busiest channel that still has room, so the town
  // always feels populated instead of spreading friends thin.
  pickChannel(preferId) {
    const pref = this.channels.find((c) => c.id === preferId && c.size < CHANNEL_CAP);
    if (pref) return pref;
    const visible = (ch) => [...ch.players.values()].filter((c) => !c.room).length;
    const open = this.channels.filter((c) => c.size < CHANNEL_CAP).sort((a, b) => visible(b) - visible(a));
    if (open.length) return open[0];
    const ch = new Channel(this, this.channels.length + 1);
    this.channels.push(ch);
    return ch;
  }

  announce(text) {
    const msg = JSON.stringify({ t: 'chat', from: null, text, sys: true });
    for (const c of this.online.values()) c.sendRaw(msg);
  }

  connect(ws, accountId) {
    const hero = this.heroes.load(accountId);
    if (!hero) {
      ws.send(JSON.stringify({ t: 'needHero' }));
      ws.close(4001, 'no hero');
      return;
    }
    const prev = this.online.get(accountId);
    if (prev) {
      prev.send({ t: 'kicked', reason: 'You logged in somewhere else.' });
      this.disconnect(prev);
      prev.ws.close(4002, 'replaced');
    }
    const c = new Client(this, ws, hero);
    this.online.set(accountId, c);
    const leftover = this.crafting.onConnect(c);
    this.pickChannel().add(c);
    if (leftover) {
      c.send({ t: 'craftResult', ...leftover });
      c.pushInventory();
    }
    const away = this.shops.awaySummary(accountId, Date.now(), this.lastActive.get(accountId));
    if (away) c.send({ t: 'awaySales', ...away });
    this.shops.prune(accountId);
    ws.on('message', (buf) => this.onMessage(c, buf));
    ws.on('close', () => this.disconnect(c));
    return c;
  }

  disconnect(c) {
    if (this.online.get(c.hero.id) !== c) return;
    this.online.delete(c.hero.id);
    c.room?.remove(c, 'left');
    this.heroes.savePos(c.hero.id, c.ent.x, c.ent.z);
    this.heroes.saveActive(c.hero.id, c.lastInput);
    this.lastActive.set(c.hero.id, c.lastInput);
    c.ch?.remove(c);
  }

  onMessage(c, buf) {
    const now = Date.now();
    // Simple flood guard: 40 msgs/sec.
    if (now - c.bucket.t > 1000) c.bucket = { t: now, n: 0 };
    if (++c.bucket.n > 40) return;
    let m;
    try {
      m = JSON.parse(buf);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    if (m.t !== 'ping' && !m.auto) c.lastInput = now; // automatic messages don't count as being here
    try {
      const h = HANDLERS[m.t];
      if (!h) return;
      const res = h(this, c, m, now);
      if (m.rid) c.send({ t: 'res', rid: m.rid, ok: true, data: res ?? null });
    } catch (e) {
      const msg = e instanceof GameError ? e.message : 'Something went wrong.';
      if (!(e instanceof GameError)) console.error('handler error', m.t, e);
      if (m.rid) c.send({ t: 'res', rid: m.rid, ok: false, err: msg });
      else c.send({ t: 'toast', kind: 'err', text: msg });
    }
  }

  // ── Gathering ──────────────────────────────────────────────────────
  hitNode(c, nodeId, now) {
    const ch = c.ch;
    const n = ch.nodes.get(nodeId);
    if (!n) fail('Nothing there.');
    const t = NODE_TYPES[n.type];
    if (t.kind === 'fish') fail('Cast your rod to fish here.');
    if (c.room) fail("You're inside a shop.");
    if (c.craft) fail('Finish your craft first.');
    if (!n.alive) {
      // A swing that was already in flight when it fell (yours or a co-op
      // partner's) isn't an error, just too late.
      if (now - (n.brokeAt || 0) < 2000) return { gone: true };
      fail(`This ${t.name} is regrowing.`);
    }
    if (c.battle) fail("You're in a battle!");
    const e = c.ent;
    if (Math.hypot(e.x - n.x, e.z - n.z) > INTERACT_RANGE + t.r * n.s + 0.4) fail('Get closer first.');
    const lvl = levelFromXp(c.hero.skills[t.skill] || 0);
    if (lvl < t.lvl) fail(`Requires ${t.skill[0].toUpperCase() + t.skill.slice(1)} level ${t.lvl}.`);
    let power = 1;
    let period = 450;
    if (t.tool) {
      const tool = ITEMS[c.hero.equip[t.tool]];
      if (!tool || this.heroes.count(c.hero.id, c.hero.equip[t.tool]) < 1) fail(`You need ${t.tool === 'axe' ? 'an axe' : 'a pickaxe'}.`);
      if (tool.tier < t.tier) fail(`Needs a tier ${t.tier} ${t.tool === 'axe' ? 'axe' : 'pickaxe'} or better.`);
      power = tool.power;
      period = tool.speed;
    }
    const since = now - e.lastSwing;
    if (since < period * SWING_FLOOR) return { tooFast: true, wait: Math.ceil(period * SWING_FLOOR - since) }; // swing still in progress
    // Rhythm bonus: swing again right as the timing ring closes = PERFECT (2x).
    const perfect = !!t.tool && e.lastNode === n.id && isPerfectSwing(since, period);
    e.lastSwing = now;
    e.lastNode = n.id;
    e.act = t.kind === 'tree' ? 'chop' : t.kind === 'rock' ? 'mine' : 'pick';
    e.path = null;
    e.rot = Math.atan2(n.x - e.x, n.z - e.z);
    const dmg = power * (perfect ? 2 : 1);
    n.hp = Math.max(0, n.hp - dmg);
    n.hitters.add(c.hero.id);
    ch.broadcast({ t: 'nh', id: n.id, by: c.hero.id, hp: n.hp, dmg, perfect, rot: q2(e.rot) });
    if (n.hp > 0) return { hp: n.hp, perfect };

    // Broken! Everyone who helped gets a full roll (co-op friendly).
    n.alive = false;
    n.brokeAt = now;
    n.respawnAt = now + t.respawn * 1000;
    // Everyone working it puts their tool away (others saw them frozen mid-chop).
    for (const pid of n.hitters) {
      const pe = ch.players.get(pid)?.ent;
      if (pe && pe.lastNode === n.id && GATHER_ACTS.has(pe.act)) pe.act = 'idle';
    }
    ch.broadcast({ t: 'node', id: n.id, alive: false, hp: 0, by: c.hero.id, respawnIn: t.respawn * 1000 });
    for (const pid of n.hitters) {
      const pc = ch.players.get(pid);
      if (pc) this.grantGather(pc, t, n, pc === c);
    }
    n.hitters.clear();
    return { broke: true, perfect };
  }

  grantGather(c, t, n, finisher) {
    const lvl = levelFromXp(c.hero.skills[t.skill] || 0);
    const loot = {};
    for (const d of t.drops) {
      let q = rint(d.min, d.max);
      if (q && Math.random() < doubleChance(lvl)) q *= 2;
      if (q) loot[d.id] = (loot[d.id] || 0) + q;
    }
    const rares = [];
    for (const r of t.rare)
      if (Math.random() < r.p * (finisher ? 1.5 : 1)) {
        loot[r.id] = (loot[r.id] || 0) + 1;
        rares.push(r.id);
      }
    for (const [id, q] of Object.entries(loot)) this.heroes.addItem(c.hero.id, id, q);
    const xp = this.heroes.addXp(c.hero, t.skill, t.xp);
    c.send({ t: 'loot', node: n.id, loot, xp, rare: rares });
    for (const r of rares) this.announce(`${c.hero.name} found a ${ITEMS[r].name}!`);
    c.pushInventory();
    if (t.kind === 'tree') c.advanceTutorial('chop');
  }

  cast(c, nodeId, now) {
    const n = c.ch.nodes.get(nodeId);
    if (!n || NODE_TYPES[n.type].kind !== 'fish') fail('Not a fishing spot.');
    if (c.battle) fail("You're in a battle!");
    if (c.room) fail("You're inside a shop.");
    if (c.craft) fail('Finish your craft first.');
    const rod = ITEMS[c.hero.equip.rod];
    if (!rod || this.heroes.count(c.hero.id, c.hero.equip.rod) < 1) fail('You need a fishing rod.');
    const e = c.ent;
    if (Math.hypot(e.x - n.x, e.z - n.z) > FISH_RANGE) fail('Get closer to the water.');
    e.path = null;
    e.rot = Math.atan2(n.x - e.x, n.z - e.z);
    e.act = 'fish';
    const window = 900 + rod.tier * 200;
    e.fishing = { node: n.id, state: 'wait', biteAt: now + 1800 + Math.random() * 4200, window };
    c.ch.broadcast({ t: 'cast', by: c.hero.id, node: n.id, rot: q2(e.rot) });
    return { ok: true };
  }

  // Tap when it bites to hook the fish; then the reel fight starts.
  reel(c, now) {
    const f = c.ent.fishing;
    if (!f || f.state === 'fight') return { ok: false };
    c.ch.broadcast({ t: 'reel', by: c.hero.id });
    const lost = (reason) => {
      c.ent.fishing = null;
      c.ent.act = 'idle';
      c.send({ t: 'fishResult', ok: false, reason });
      return { ok: false };
    };
    if (f.state === 'wait') return lost('Too early! The fish swam off.');
    if (now > f.biteAt + f.window + 450) return lost('Too slow — it got away!');
    f.state = 'fight';
    f.fightAt = now;
    const { d, behavior, seed } = f.fish;
    return { ok: true, fight: true, bite: { fish: { d, behavior, seed }, gear: f.gear, rating: fightRating(d, f.gear) } };
  }

  // The client reports the ticks at which the reel button toggled; the
  // server replays the exact same deterministic fight to decide the outcome.
  land(c, toggles, endTick, now) {
    const f = c.ent.fishing;
    if (!f || f.state !== 'fight') {
      // Always answer, so the client can never be left showing a dead fight.
      c.send({ t: 'fishResult', ok: false, cancelled: true, reason: 'The line went slack.' });
      return { ok: false };
    }
    c.ent.fishing = null;
    c.ent.act = 'idle';
    const end = Math.floor(Number(endTick));
    const ok =
      Array.isArray(toggles) &&
      toggles.length <= FISH_MAX_TICKS &&
      toggles.every((t, i) => Number.isInteger(t) && t >= 0 && t <= FISH_MAX_TICKS && (i === 0 || t > toggles[i - 1])) &&
      Number.isInteger(end) &&
      end > 0 &&
      end <= FISH_MAX_TICKS;
    // You can't finish a fight faster than it takes to play it.
    const tooFast = (now - f.fightAt) < (end / 60) * 1000 * 0.85 - 400;
    const result = ok && !tooFast ? replayFight(f.fish, f.gear, toggles, end) : null;
    c.ch.broadcast({ t: 'landed', by: c.hero.id, ok: result?.done === 'caught', item: result?.done === 'caught' ? f.fish.id : null });
    if (!result || result.done !== 'caught') {
      c.send({ t: 'fishResult', ok: false, reason: result?.done === 'escaped' || !result ? 'It broke free!' : 'It slipped the hook!' });
      return { ok: false };
    }
    const fish = f.fish;
    const lvl = levelFromXp(c.hero.skills.fishing || 0);
    const qty = Math.random() < doubleChance(lvl) && fish.id !== 'old_boot' && fish.id !== 'lake_king' ? 2 : 1;
    this.heroes.addItem(c.hero.id, fish.id, qty);
    const xp = this.heroes.addXp(c.hero, 'fishing', Math.round(FISH[fish.id].xp * (1 + fish.d / 200)));
    c.send({ t: 'fishResult', ok: true, item: fish.id, qty, kg: fish.kg, xp });
    const rarity = ITEMS[fish.id].rarity;
    if (rarity === 'epic' || rarity === 'legendary') this.announce(`${c.hero.name} landed a ${fish.kg} kg ${ITEMS[fish.id].name}!`);
    c.pushInventory();
    return { ok: true };
  }

  // ── Crafting / NPC merchant / gear ─────────────────────────────────
  npcSell(c, item, qty) {
    qty = Number(qty);
    if (!isItem(item) || !Number.isInteger(qty) || qty < 1) fail('Bad sale.');
    const equipped = Object.values(c.hero.equip).includes(item);
    if (equipped && this.heroes.count(c.hero.id, item) - qty < 1) fail("Keep one — it's equipped.");
    const gold = Math.max(1, Math.floor(ITEMS[item].value * NPC_SELL_RATE)) * qty;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.heroes.takeItem(c.hero.id, item, qty);
      this.heroes.addGold(c.hero.id, gold);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    c.pushInventory();
    return { gold };
  }

  equip(c, item) {
    const it = ITEMS[item];
    if (!it) fail('Unknown item.');
    if (this.heroes.count(c.hero.id, item) < 1) fail("You don't have that.");
    const slot = it.cat === 'tool' ? it.tool : it.slot;
    if (!slot) fail("That can't be equipped.");
    this.heroes.setEquip(c.hero, slot, item);
    c.pushInventory();
    this.tellAudience(c, { t: 'equip', id: c.hero.id, equip: c.hero.equip });
    return { slot };
  }
}

// ── Message handlers ───────────────────────────────────────────────────
const num = (v) => (Number.isFinite(+v) ? +v : 0);

const HANDLERS = {
  ping: (g, c, m) => c.send({ t: 'pong', c: m.c, s: Date.now() }),

  move(g, c, m, now) {
    if (c.battle || c.craft) return;
    if ((m.v === 'room') !== !!c.room) return; // a stale move from the other view
    if (now - (c.lastMove || 0) < 80) return; // pathfinding is the expensive bit; cap it
    c.lastMove = now;
    const x = num(m.x);
    const z = num(m.z);
    if (c.room) return c.room.move(c, x, z);
    if (Math.hypot(x, z) > WORLD_RADIUS + 10) return;
    const path = STATIC.nav.findPath(c.ent.x, c.ent.z, x, z);
    c.cancelFishing();
    if (path) {
      c.ent.path = path;
      c.ent.act = 'walk';
    }
  },

  hit: (g, c, m, now) => g.hitNode(c, String(m.node), now),
  cast: (g, c, m, now) => g.cast(c, String(m.node), now),
  reel: (g, c, m, now) => g.reel(c, now),
  land: (g, c, m, now) => g.land(c, m.toggles, m.end, now),

  engage(g, c, m) {
    if (c.room) fail("You're inside a shop.");
    if (c.craft) fail('Finish your craft first.');
    const mob = c.ch.mobs.get(String(m.mob));
    if (!mob || mob.state === 'dead') fail('It ran off.');
    if (c.battle) fail('Already fighting!');
    if (dist(c.ent, mob) > 6) fail('Get closer first.');
    let b = mob.battle;
    if (!b) {
      b = new Battle(c.ch, mob);
      c.ch.battles.set(b.id, b);
    }
    b.join(c);
  },

  bact(g, c, m) {
    if (!c.battle) return;
    c.battle.choose(c, String(m.a), m.item ? String(m.item) : null);
  },

  chat(g, c, m, now) {
    const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return;
    if (now - c.lastChat < 700) fail('Slow down a little!');
    c.lastChat = now;
    g.tellAudience(c, { t: 'chat', from: c.hero.id, name: c.hero.name, text, room: c.room?.owner ?? null });
  },

  emote(g, c, m) {
    const e = String(m.e);
    if (!['wave', 'dance', 'cheer', 'sit', 'heart'].includes(e)) return;
    if (c.battle) return;
    if (c.room) {
      c.rent.path = null;
      return c.room.broadcast({ t: 'emote', id: c.hero.id, e });
    }
    c.ent.path = null;
    c.ch.broadcast({ t: 'emote', id: c.hero.id, e });
  },

  rpc(g, c, m) {
    const fn = RPC[m.m];
    if (!fn) fail('Unknown action.');
    return fn(g, c, m.a || {});
  },
};

const RPC = {
  craft: () => fail('Crafting is hands-on now — pick a recipe and head to its station!'),
  'craft.info': (g, c) => g.crafting.info(c),
  'craft.start': (g, c, a) => g.crafting.start(c, a),
  'craft.finish': (g, c, a) => g.crafting.finish(c, a),
  'craft.cancel': (g, c, a) => g.crafting.cancel(c, a),
  'craft.quick': (g, c, a) => g.crafting.quick(c, a),
  npcSell: (g, c, a) => g.npcSell(c, a.item, a.qty),
  equip: (g, c, a) => g.equip(c, a.item),
  avatar(g, c, a) {
    g.heroes.setAvatar(c.hero, a.avatar);
    g.tellAudience(c, { t: 'avatar', id: c.hero.id, avatar: c.hero.avatar });
  },
  profile(g, c, a) {
    const h = g.heroes.load(Number(a.id));
    if (!h) fail('No such hero.');
    const on = g.online.get(h.id);
    const shop = g.shops.info(h.id);
    return { id: h.id, name: h.name, avatar: h.avatar, level: h.level, skills: h.skills, equip: h.equip, online: !!on, channel: on?.ch?.id ?? null, shop: g.shops.slots(h.id).length, shopOpen: shop ? !!shop.open : false, inside: on?.room?.owner ?? null };
  },

  // Market
  'market.summary': (g) => g.market.summary(),
  'market.book': (g, c, a) => g.market.book(a.item),
  'market.mine': (g, c) => g.market.mine(c.hero.id),
  'market.place'(g, c, a) {
    const r = g.market.place(c.hero.id, a);
    for (const id of r.notify) {
      const o = g.online.get(id);
      if (!o) continue;
      o.pushInventory();
      if (id !== c.hero.id) o.send({ t: 'toast', kind: 'good', text: `Your ${a.side === 'buy' ? 'sell' : 'buy'} order for ${ITEMS[a.item].name} was filled!` });
    }
    return { order: r.order, fills: r.fills, filledQty: r.filledQty };
  },
  'market.cancel'(g, c, a) {
    g.market.cancel(c.hero.id, a.id);
    c.pushInventory();
  },

  // Player shops (see server/shop.js and shared/shop.js)
  'shop.enter': (g, c, a) => g.enterShop(c, a.owner),
  'shop.exit': (g, c) => g.exitShop(c, 'left'),
  'shop.state'(g, c, a) {
    const owner = a.owner == null ? c.hero.id : Number(a.owner);
    const st = g.shops.state(owner, c.hero.id);
    if (owner === c.hero.id) st.presence = g.presenceOf(owner, Date.now());
    return st;
  },
  'shop.stock'(g, c, a) {
    const s = g.shops.stock(c.hero.id, a);
    c.pushInventory();
    c.advanceTutorial('stock');
    g.rooms.get(c.hero.id)?.shelf(s.slot, 'owner');
    return { s };
  },
  'shop.unstock'(g, c, a) {
    const slot = Number(a.slot);
    const s = g.shops.unstock(c.hero.id, slot, a.qty ?? null);
    c.pushInventory();
    g.rooms.get(c.hero.id)?.shelf(slot, 'owner');
    return { s };
  },
  'shop.price'(g, c, a) {
    const s = g.shops.setPrice(c.hero.id, a.slot, a.price);
    g.rooms.get(c.hero.id)?.shelf(s.slot, 'owner');
    return { s };
  },
  'shop.setup'(g, c, a) {
    const info = g.shops.setup(c.hero.id, { name: a.name, open: a.open });
    const room = g.rooms.get(c.hero.id);
    if (room && !info.open)
      for (const o of [...room.occ.values()])
        if (o !== c) {
          g.exitShop(o, 'closed');
          o.send({ t: 'rexit', why: 'closed', name: g.shops.displayName(info) });
        }
    return g.shops.state(c.hero.id, c.hero.id);
  },
  'shop.collect'(g, c) {
    const r = g.shops.collect(c.hero.id);
    c.pushInventory();
    return r;
  },
  'shop.ledger': (g, c, a) => g.shops.ledger(c.hero.id, a.before),
  'shop.ack': (g, c, a) => g.shops.ack(c.hero.id, a.upto),
  'shop.buy'(g, c, a) {
    const owner = Number(a.owner);
    if (c.room?.owner !== owner) fail('Walk into that shop first.');
    const nonce = typeof a.nonce === 'string' ? a.nonce.slice(0, 32) : null;
    const mine = g.buyNonces.get(c.hero.id) || new Map();
    if (nonce && mine.has(nonce)) return mine.get(nonce); // a retry of a purchase that already went through
    const { sale, s } = g.shops.buy(c.hero.id, c.hero.name, owner, a);
    const res = { sale: { item: sale.item, qty: sale.qty, gross: sale.gross }, s };
    if (nonce) {
      mine.set(nonce, res);
      while (mine.size > 20) mine.delete(mine.keys().next().value);
      g.buyNonces.set(c.hero.id, mine);
    }
    c.pushInventory();
    c.room.broadcast({ t: 'rshelf', slot: sale.slot, s, by: 'player' });
    c.room.broadcast({ t: 'rbuy', by: c.hero.id, name: c.hero.name, slot: sale.slot, qty: sale.qty });
    g.online.get(owner)?.send({ t: 'shopSale', sales: [sale], till: g.shops.till(owner), upto: sale.id });
    return res;
  },
  'shop.directory': (g, c) =>
    g.shops.directory(c.hero.id, (owner) => ({ online: g.online.has(owner), visitors: g.rooms.get(owner)?.visitors || 0 })).sort((x, y) => y.online - x.online || (y.lastSaleAt || 0) - (x.lastSaleAt || 0)),

  // Town hall
  'town.info'(g, c) {
    const rich = g.db.prepare('SELECT name, gold, skills FROM heroes ORDER BY gold DESC LIMIT 10').all().map((r) => ({ name: r.name, gold: r.gold }));
    const levels = g.db
      .prepare('SELECT name, skills FROM heroes')
      .all()
      .map((r) => {
        const s = JSON.parse(r.skills);
        return { name: r.name, total: Object.values(s).reduce((a, b) => a + b, 0) };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    return {
      channels: g.channels.map((ch) => ({ id: ch.id, players: ch.size, cap: CHANNEL_CAP })),
      online: [...g.online.values()].map((o) => ({ id: o.hero.id, name: o.hero.name, level: o.hero.level, channel: o.ch?.id })),
      rich,
      levels,
      invites: g.auth.myInvites(c.hero.id),
      heroes: g.db.prepare('SELECT COUNT(*) AS n FROM heroes').get().n,
    };
  },
  'invite.create': (g, c) => ({ code: g.auth.createInvite(c.hero.id) }),
  'channel.switch'(g, c, a) {
    const target = g.channels.find((ch) => ch.id === Number(a.id));
    if (!target) fail('No such channel.');
    if (target === c.ch) fail("You're already here.");
    if (target.size >= CHANNEL_CAP) fail('That channel is full.');
    if (c.battle) fail('Finish your battle first.');
    if (c.room) fail('Leave the shop first.');
    if (c.craft) fail('Finish your craft first.');
    c.ch.remove(c);
    target.add(c);
  },
  tutorialSkip(g, c) {
    g.heroes.setTutorial(c.hero, TUTORIAL.length);
  },
};

export { STATIC };
