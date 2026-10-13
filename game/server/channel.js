// Channels: live copies of the town, and dungeon runs, which extend them.
// (The battles fought in them are in battle.js.)
import { ITEMS } from '../shared/items.js';
import { MONSTERS } from '../shared/monsters.js';
import { NODE_TYPES, SPAWNS, stepPath, isWalkable, WORLD_RADIUS, isDeepSpot } from '../shared/world.js';
import { levelFromXp } from '../shared/skills.js';
import { rollFish, fishingGear, fightRating, FISH_MAX_TICKS } from '../shared/fishing.js';
import { world } from './static.js';
import { emit, listening } from './events.js';

const SNAP_EVERY = 2; // 10 Hz snapshots
const MOB_SPEED = 2.2;
const GATHER_ACTS = new Set(['chop', 'mine', 'pick']);
// Each hero is only told about monsters this close (and forgets them past
// INTEREST_DROP), so a big world doesn't flood every client with every mob.
const INTEREST = 100;
const INTEREST_DROP = 125;

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
    // Monster camps come from the map; each monster roams around its own camp.
    for (const sp of town ? SPAWNS : [])
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
      nodes: [...this.nodes.values()].filter((n) => !n.alive || n.hp < NODE_TYPES[n.type].hp).map((n) => ({ id: n.id, hp: n.hp, alive: n.alive, respawnIn: n.alive ? 0 : Math.max(0, n.respawnAt - Date.now()) })),
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
    const out = [];
    for (const m of this.mobs.values())
      if (Math.hypot(m.x - c.ent.x, m.z - c.ent.z) < INTEREST) {
        c.mobSeen.set(m.id, this.#mobRow(m).join(','));
        out.push(this.mobInfo(m));
      }
    return out;
  }

  tick(now, dt) {
    this.tickNo++;
    const attune = this.tickNo % 10 === 0; // twice a second is plenty
    const pos = this.tickNo % 20 === 0 && listening('pos'); // once a second, for whoever tracks where heroes go
    for (const c of this.players.values()) {
      const e = c.ent;
      if (attune && !c.room && !this.isRun) c.attuneNearby();
      if (pos && !c.room) emit(c, 'pos', { x: e.x, z: e.z, run: !!this.isRun });
      if (e.path) {
        stepPath(e, dt);
        if (!e.path && e.act === 'walk') e.act = 'idle';
      }
      if (!c.battle && e.hp < e.maxHp && this.regen) e.hp = Math.min(e.maxHp, e.hp + this.regen * dt);
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
    const rows = [...this.mobs.values()].map((mob) => [mob, this.#mobRow(mob)]);
    for (const c of this.players.values()) {
      if (c.room) continue;
      const seen = (c.mobSeen ??= new Map());
      const m = [];
      const add = [];
      const rm = [];
      for (const [mob, row] of rows) {
        const d = Math.hypot(mob.x - c.ent.x, mob.z - c.ent.z);
        const key = row.join(',');
        if (seen.has(mob.id) ? d < INTEREST_DROP : d < INTEREST) {
          if (!seen.has(mob.id)) add.push(this.mobInfo(mob));
          else if (full || seen.get(mob.id) !== key) m.push(row);
          seen.set(mob.id, key);
        } else if (seen.delete(mob.id)) rm.push(mob.id);
      }
      if (p.length || m.length || add.length || rm.length) c.send({ t: 's', p, m, ...(add.length ? { add } : {}), ...(rm.length ? { rm } : {}) });
    }
  }

  // Battle hooks (a dungeon run overrides these).
  koHp = 0.3; // knocked-out heroes get up with this share of their health
  monsterDef(mob) {
    return mob.def ?? MONSTERS[mob.type];
  }
  // A monster fell: it respawns later.
  mobFell(b, mob) {
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
