// Channels: live copies of the town, and dungeon runs, which extend them.
// (The battles fought in them are in battle.js.)
import { MONSTERS, eliteDef } from '../shared/monsters.js';
import { NODE_TYPES, SPAWNS, stepPath, isWalkable, WORLD_RADIUS, isDeepSpot, MOVE_SPEED } from '../shared/world.js';
import { fightRating, FISH_MAX_TICKS } from '../shared/fishing.js';
import { biteFor } from './gather.js';
import { world } from './static.js';
import { emit, listening } from './events.js';
import { tickNodeStates, stateOf } from './nodestates.js';

const SNAP_EVERY = 2; // 10 Hz snapshots
const MOB_SPEED = 2.2;
const GATHER_ACTS = new Set(['chop', 'mine', 'pick']);
// Each hero is only told about monsters this close (and forgets them past
// INTEREST_DROP), so a big world doesn't flood every client with every mob.
const INTEREST = 100;
const INTEREST_DROP = 125;
// Phones are told about fewer: within 50 m (forgotten past 60), the nearest 20.
const LOW_INTEREST = 50;
const LOW_DROP = 60;
const LOW_MAX = 20;
// The town's monsters and nodes are filed in 128 m cells; a cell with no hero
// within 150 m sleeps (its monsters stand still, its nodes don't regrow) and
// catches up when someone comes near (respawns are timed, so nothing is lost).
const SLEEP_CELL = 128;
const WAKE = 150;
const cellKey = (x, z) => `${Math.floor(x / SLEEP_CELL)},${Math.floor(z / SLEEP_CELL)}`;

export const rint = (a, b, rng = Math.random) => a + Math.floor(rng() * (b - a + 1));
export const q2 = (v) => Math.round(v * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────
// A Channel is one live copy of the town (like a lobby / server shard). All
// players in it see each other move in real time.
// ─────────────────────────────────────────────────────────────────────────
export class Channel {
  // opts.town = false: an empty space (a dungeon run fills in its own monsters).
  constructor(game, id, { town = true } = {}) {
    this.game = game;
    this.id = id;
    this.players = new Map(); // accountId → Client
    this.nodes = new Map(town ? world().nodes.map((n) => [n.id, { ...n, hp: NODE_TYPES[n.type].hp, alive: true, respawnAt: 0, hitters: new Set() }]) : []);
    this.mobs = new Map();
    this.battles = new Map();
    this.tickNo = 0;
    this.seq = 0;
    this.regen = 4; // HP per second out of battle
    this.sleeps = town; // (a dungeon run is small and always awake)
    this.cells = new Map(); // cell key → { nodes: [], mobs: [] }
    this.awake = new Set(); // cell keys with a hero near
    this.extraMobs = 0;
    for (const n of this.nodes.values()) this.#file('nodes', n, n.x, n.z);
    // Monster camps come from the map; each monster roams around its own camp.
    for (const sp of town ? SPAWNS : [])
      for (let i = 0; i < sp.count; i++) {
        const id = `m${this.mobs.size}`;
        const mob = { id, type: sp.monster, sp, x: 0, z: 0, rot: 0, path: null, state: 'roam', next: 0, respawnAt: 0, battle: null };
        this.#placeMob(mob);
        this.mobs.set(id, mob);
        this.#file('mobs', mob, sp.x, sp.z);
      }
  }

  #file(kind, e, x, z) {
    const k = cellKey(x, z);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = { nodes: [], mobs: [] }));
    c[kind].push(e);
    e.cell = k;
  }

  // A monster that isn't from a camp (an elite, an event): it roams within r
  // of `at` and doesn't come back once beaten. def: a monster definition (or
  // a MONSTERS id). Returns the monster.
  addMob(def, at, { r = 4 } = {}) {
    const id = `x${++this.extraMobs}`;
    const type = typeof def === 'string' ? def : def.id;
    const mob = { id, type, def: typeof def === 'string' ? undefined : def, sp: { x: at.x, z: at.z, r }, x: at.x, z: at.z, rot: 0, path: null, state: 'roam', next: 0, respawnAt: Infinity, battle: null, once: true };
    this.mobs.set(id, mob);
    this.#file('mobs', mob, at.x, at.z);
    return mob;
  }
  // Take a monster out of the world (heroes nearby see it go). Not mid-battle.
  removeMob(id) {
    const mob = this.mobs.get(id);
    if (!mob || mob.state === 'battle') return false;
    this.mobs.delete(id);
    const list = this.cells.get(mob.cell)?.mobs;
    if (list) list.splice(list.indexOf(mob), 1);
    return true;
  }

  // Which cells have a hero within WAKE of them (every half second).
  #wake() {
    const awake = new Set();
    const r = Math.ceil(WAKE / SLEEP_CELL);
    for (const c of this.players.values()) {
      if (c.room) continue;
      const { x, z } = c.ent;
      const ci = Math.floor(x / SLEEP_CELL);
      const cj = Math.floor(z / SLEEP_CELL);
      for (let i = ci - r; i <= ci + r; i++)
        for (let j = cj - r; j <= cj + r; j++) {
          const gap = Math.hypot(Math.max(0, i * SLEEP_CELL - x, x - (i + 1) * SLEEP_CELL), Math.max(0, j * SLEEP_CELL - z, z - (j + 1) * SLEEP_CELL));
          if (gap <= WAKE) awake.add(`${i},${j}`);
        }
    }
    this.awake = awake;
  }
  // What to tick: everything in a run; in town, what's in awake cells.
  *#live(kind) {
    if (!this.sleeps) {
      yield* (kind === 'nodes' ? this.nodes : this.mobs).values();
      return;
    }
    for (const k of this.awake) {
      const c = this.cells.get(k);
      if (c) yield* c[kind];
    }
  }

  #placeMob(mob) {
    const sp = mob.sp;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * sp.r;
      const x = sp.x + Math.cos(a) * d;
      const z = sp.z + Math.sin(a) * d;
      if (this.walkable(x, z)) {
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

  // The space this channel's heroes walk in (a dungeon run has its own).
  get col() {
    return world().col;
  }
  get nav() {
    return world().nav;
  }
  walkable(x, z) {
    return isWalkable(x, z, this.col);
  }
  inBounds(x, z) {
    return Math.hypot(x, z) <= WORLD_RADIUS + 10;
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const c of this.players.values()) if (c !== except) c.sendRaw(data);
  }

  // A free spot at or near (x, z), so nobody materialises inside another hero.
  // `ok` can veto candidate spots (the original spot is always allowed).
  freeSpot(x, z, except = null, ok = () => true) {
    const crowded = (px, pz) => [...this.players.values()].some((o) => o !== except && !o.room && Math.hypot(o.ent.x - px, o.ent.z - pz) < 1.3);
    for (let k = 0; k < 40 && crowded(x, z); k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.5 + Math.random() * 3.5;
      const nx = x + Math.cos(a) * d;
      const nz = z + Math.sin(a) * d;
      if (this.walkable(nx, nz) && !crowded(nx, nz) && ok(nx, nz)) [x, z] = [nx, nz];
    }
    return [x, z];
  }

  add(c) {
    const e = c.ent;
    [e.x, e.z] = this.freeSpot(e.x, e.z, c);
    e.path = null;
    this.players.set(c.hero.id, c);
    c.ch = this;
    this.game.crafting.attach(c);
    c.send(this.welcome(c));
    this.broadcast({ t: 'join', p: c.publicInfo() }, c);
  }

  // Everything a hero needs on arriving here.
  welcome(c) {
    return {
      t: 'welcome',
      channel: this.id,
      you: c.publicSelf(),
      players: [...this.players.values()].filter((o) => o !== c).map((o) => o.publicInfo()),
      nodes: [...this.nodes.values()].filter((n) => !n.alive || n.hp < NODE_TYPES[n.type].hp || stateOf(n)).map((n) => ({ id: n.id, hp: n.hp, alive: n.alive, respawnIn: n.alive ? 0 : Math.max(0, n.respawnAt - Date.now()), ...(stateOf(n) ? { st: stateOf(n) } : {}) })),
      mobs: this.nearMobs(c),
      battles: [...this.battles.values()].map((b) => b.publicState()),
    };
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
  #mobRow(m) {
    return [m.id, q2(m.x), q2(m.z), q2(m.rot), m.state];
  }
  // Start a hero's view of the monsters afresh: everything within range.
  nearMobs(c) {
    c.mobSeen = new Map();
    const near = [];
    for (const m of this.mobs.values()) {
      const d = Math.hypot(m.x - c.ent.x, m.z - c.ent.z);
      if (d < (c.low ? LOW_INTEREST : INTEREST)) near.push([m, d]);
    }
    if (c.low && near.length > LOW_MAX) near.sort((a, b) => a[1] - b[1]).length = LOW_MAX;
    return near.map(([m]) => {
      c.mobSeen.set(m.id, this.#mobRow(m).join(','));
      return this.mobInfo(m);
    });
  }

  tick(now, dt) {
    this.tickNo++;
    if (this.sleeps && this.tickNo % 10 === 1) this.#wake();
    if (!this.isRun && this.tickNo % 20 === 0) tickNodeStates(this, now);
    const attune = this.tickNo % 10 === 0; // twice a second is plenty
    const pos = this.tickNo % 20 === 0 && listening('pos'); // once a second, for whoever tracks where heroes go
    for (const c of this.players.values()) {
      const e = c.ent;
      if (attune && !c.room && !this.isRun) c.attuneNearby();
      if (pos && !c.room) emit(c, 'pos', { x: e.x, z: e.z, run: !!this.isRun });
      if (e.path) {
        stepPath(e, dt, MOVE_SPEED * (e.speedMul ?? 1));
        if (!e.path && e.act === 'walk') e.act = 'idle';
      }
      if (!c.battle && e.hp < e.maxHp && this.regen) e.hp = Math.min(e.maxHp, e.hp + (this.regen + (c.effects?.().regenOut || 0)) * dt);
      if (GATHER_ACTS.has(e.act) && now - e.lastSwing > 2500) e.act = 'idle'; // stopped swinging
      if (c.craft) {
        this.game.crafting.expire(c, now);
        if (c.craft?.spot && !e.path) e.rot = c.craft.spot.rot; // face the station while working
      }
      const f = e.fishing;
      if (f && f.state === 'wait' && now >= f.biteAt) {
        // Decide what bit now; the client needs the fight parameters to play it.
        f.state = 'bite';
        const spot = this.nodes.get(f.node);
        Object.assign(f, biteFor(c, spot, isDeepSpot(spot), now));
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
    for (const n of this.#live('nodes')) {
      if (!n.alive && now >= n.respawnAt) {
        n.alive = true;
        n.hp = NODE_TYPES[n.type].hp;
        n.hitters.clear();
        this.broadcast({ t: 'node', id: n.id, alive: true, hp: n.hp, ...(stateOf(n) ? { st: stateOf(n) } : {}) });
      }
    }
    for (const m of this.#live('mobs')) {
      if (m.state === 'dead') {
        if (now >= m.respawnAt) {
          m.state = 'roam';
          this.#placeMob(m);
          m.next = now + 2000;
        }
        continue;
      }
      if (m.state !== 'roam') continue;
      if (m.path) stepPath(m, dt, MOB_SPEED * (m.speedMul ?? 1));
      else if (now >= m.next) {
        m.next = now + 2500 + Math.random() * 5000;
        const sp = m.sp;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * sp.r;
        const tx = sp.x + Math.cos(a) * d;
        const tz = sp.z + Math.sin(a) * d;
        if (this.walkable(tx, tz) && this.nav.clear(m.x, m.z, tx, tz)) m.path = [[tx, tz]];
      }
    }
    for (const b of this.battles.values()) b.tick(now);
    if (this.tickNo % SNAP_EVERY === 0) this.snapshot();
  }

  // Delta snapshot: only entities whose quantized state changed, plus a full
  // refresh every 3 s so late packets can't leave anyone stuck. Every hero
  // sees every other hero; monsters only near them (add / rm as they come
  // into and out of range).
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
    // Each monster's row and key once, however many heroes see it.
    const rows = [];
    for (const mob of this.mobs.values()) {
      const row = this.#mobRow(mob);
      rows.push([mob, row, row.join(',')]);
    }
    for (const c of this.players.values()) {
      if (c.room) continue;
      const seen = (c.mobSeen ??= new Map());
      const [inR, dropR] = c.low ? [LOW_INTEREST, LOW_DROP] : [INTEREST, INTEREST_DROP];
      const near = [];
      for (const r of rows) {
        const d = Math.hypot(r[0].x - c.ent.x, r[0].z - c.ent.z);
        if (seen.has(r[0].id) ? d < dropR : d < inR) near.push([r, d]);
      }
      if (c.low && near.length > LOW_MAX) near.sort((a, b) => a[1] - b[1]).length = LOW_MAX;
      const m = [];
      const add = [];
      const rm = [];
      const keep = new Set();
      for (const [[mob, row, key]] of near) {
        keep.add(mob.id);
        if (!seen.has(mob.id)) add.push(this.mobInfo(mob));
        else if (full || seen.get(mob.id) !== key) m.push(row);
        seen.set(mob.id, key);
      }
      for (const id of seen.keys()) if (!keep.has(id)) seen.delete(id), rm.push(id); // out of range, or gone
      if (p.length || m.length || add.length || rm.length) c.send({ t: 's', p, m, ...(add.length ? { add } : {}), ...(rm.length ? { rm } : {}) });
    }
  }

  // Battle hooks (a dungeon run overrides these).
  koHp = 0.3; // knocked-out heroes get up with this share of their health
  // An elite camp (spawn flag `elite`, with its own `lvl`) restats its
  // monster to that level, with hp for the heroes fighting it.
  monsterDef(mob, fighters = 1) {
    if (mob.sp?.elite) return eliteDef(mob.type, mob.sp.lvl ?? MONSTERS[mob.type].lvl, fighters, mob.sp.name);
    return mob.def ?? MONSTERS[mob.type];
  }
  // A monster fell: it respawns later.
  mobFell(b, mob) {
    if (mob.once) return void (mob.state = 'dead', this.removeMob(mob.id));
    mob.state = 'dead';
    mob.respawnAt = Date.now() + (b.def.boss ? 90_000 : 25_000);
    if (b.def.boss) this.game.announce(`${[...b.fighters.values()].map((f) => f.c.hero.name).join(', ')} defeated the ${b.def.name}!`);
  }
  // A battle finished; a monster that won goes back to roaming.
  battleOver(b, victory) {
    if (!victory) for (const m of [b.mob, ...b.queue]) if (m.state === 'battle') m.state = 'roam';
  }

  // c was moved by fast travel: everyone sees them vanish and reappear (no
  // sliding across the map), and they get a fresh view of where they are now.
  teleported(c, from) {
    const e = c.ent;
    e.lastSnap = '';
    this.#townOnly({ t: 'tp', id: c.hero.id, x: q2(e.x), z: q2(e.z), rot: q2(e.rot), from: { x: q2(from.x), z: q2(from.z) } });
    c.send(this.fullSnapshot(c));
  }

  // Everything about the town, for someone stepping back out of a shop.
  fullSnapshot(c) {
    const p = [...this.players.values()].filter((o) => !o.room).map((o) => [o.hero.id, q2(o.ent.x), q2(o.ent.z), q2(o.ent.rot), o.ent.act]);
    return { t: 's', p, m: [], add: this.nearMobs(c), full: true };
  }

  #townOnly(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.players.values()) if (!c.room) c.sendRaw(data);
  }
}
