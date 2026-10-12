// Channels (live copies of the town, and dungeon runs, which extend them)
// and the turn-based battles fought in them.
import { ITEMS, isItem } from '../shared/items.js';
import { MONSTERS, damage } from '../shared/monsters.js';
import { NODE_TYPES, SPAWNS, stepPath, isWalkable, WORLD_RADIUS, isDeepSpot } from '../shared/world.js';
import { levelFromXp } from '../shared/skills.js';
import { rollFish, fishingGear, fightRating, FISH_MAX_TICKS } from '../shared/fishing.js';
import { fail } from './db.js';
import { world } from './static.js';

const SNAP_EVERY = 2; // 10 Hz snapshots
export const ROUND_MS = 12000;
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
    for (const c of this.players.values()) {
      const e = c.ent;
      if (attune && !c.room && !this.isRun) c.attuneNearby();
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

// ─────────────────────────────────────────────────────────────────────────
// Turn-based co-op battle, fought *in the world* where the monster stands.
// Up to 4 heroes; anyone nearby can tap the monster to join mid-fight.
// ─────────────────────────────────────────────────────────────────────────
export class Battle {
  // A fight against one monster, or (in a dungeon) a room's whole pack: the
  // others wait their turn and step in one after another (`queue`).
  constructor(ch, mob) {
    this.ch = ch;
    this.id = `b${++ch.seq}`;
    this.mob = mob;
    this.queue = (ch.packFor?.(mob) ?? []).filter((m) => m !== mob && m.state !== 'dead' && !m.battle);
    for (const m of [mob, ...this.queue]) {
      m.state = 'battle';
      m.path = null;
      m.battle = this;
    }
    this.def = ch.monsterDef(mob, 1);
    this.mobMax = this.def.hp;
    this.mobHp = this.def.hp;
    this.fighters = new Map(); // id → {c, hp, max, atk, def, charge, need, mend, choice, alive}
    this.spoils = new Map(); // id → {gold, loot, xp} won so far (paid as each monster falls)
    this.peak = 0;
    this.round = 1;
    this.deadline = Date.now() + ROUND_MS;
    this.over = false;
    this.pending = null; // a telegraphed move landing next round
  }

  publicState() {
    return {
      id: this.id,
      mob: this.mob.id,
      mobHp: this.mobHp,
      mobMax: this.mobMax,
      queue: this.queue.map((m) => m.id),
      warn: this.pending ? this.pending.name : null,
      round: this.round,
      endsIn: Math.max(0, this.deadline - Date.now()),
      fighters: [...this.fighters.entries()].map(([id, f]) => ({ id, name: f.c.hero.name, hp: Math.round(f.hp), max: f.max, charge: f.charge, need: f.need, alive: f.alive, ready: !!f.choice })),
    };
  }

  push(extra = {}) {
    this.ch.broadcast({ t: 'battle', b: this.publicState(), ...extra });
  }

  // The monster's stats for the heroes fighting it now (more heroes, more
  // HP; the wound it already has stays in proportion).
  #rescale() {
    const n = this.fighters.size;
    if (n <= this.peak) return;
    this.peak = n;
    const def = this.ch.monsterDef(this.mob, n);
    const frac = this.mobHp / this.mobMax;
    this.def = def;
    this.mobMax = def.hp;
    this.mobHp = Math.max(1, Math.round(def.hp * frac));
  }

  join(c) {
    if (this.over) fail('That battle just ended.');
    if (this.fighters.size >= 4) fail('This battle is full (4 heroes).');
    const st = c.stats();
    const perks = c.perks?.() ?? new Set();
    this.fighters.set(c.hero.id, { c, hp: Math.max(1, Math.min(c.ent.hp, st.hp)), max: st.hp, atk: st.atk, def: st.def, charge: 0, need: perks.has('quickSpecial') ? 2 : 3, mend: perks.has('mender') ? 1.4 : 1, choice: null, alive: true });
    c.cancelFishing();
    c.battle = this;
    c.ent.act = 'battle';
    this.#rescale();
    // Line up facing the monster in a little arc.
    const n = this.fighters.size - 1;
    const ang = Math.atan2(c.ent.x - this.mob.x, c.ent.z - this.mob.z);
    const spread = [0, 0.55, -0.55, 1.1][n];
    const tx = this.mob.x + Math.sin(ang + spread) * 3.4;
    const tz = this.mob.z + Math.cos(ang + spread) * 3.4;
    c.ent.path = this.ch.walkable(tx, tz) && this.ch.nav.clear(c.ent.x, c.ent.z, tx, tz) ? [[tx, tz]] : null;
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
    // Tell everyone (the leaver too, so their battle screen closes) before
    // the battle possibly ends for lack of fighters.
    this.push({ left: c.hero.id, why });
    c.pushInventory();
    if (!this.over && ![...this.fighters.values()].some((x) => x.alive)) this.end(false);
  }

  // `to`: with a potion, a knocked-out ally to help back up.
  choose(c, a, itemId, to = null) {
    const f = this.fighters.get(c.hero.id);
    if (!f || !f.alive || this.over) return;
    if (!['attack', 'skill', 'defend', 'potion', 'flee'].includes(a)) return;
    if (a === 'skill' && f.charge < f.need) fail('Your special is not charged yet.');
    if (a === 'potion') {
      if (!isItem(itemId) || !ITEMS[itemId].heal) fail('Pick a healing item.');
      if (this.ch.game.heroes.count(c.hero.id, itemId) < 1) fail(`No ${ITEMS[itemId].name} left.`);
      if (to != null) {
        const t = this.fighters.get(Number(to));
        if (!t || t.alive) fail('They are still standing.');
      }
    }
    if (a === 'flee') {
      this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev: [{ k: 'flee', who: c.hero.id }] });
      this.leave(c, 'fled');
      return;
    }
    f.choice = { a, itemId, to: to == null ? null : Number(to) };
    const alive = [...this.fighters.values()].filter((x) => x.alive);
    if (alive.every((x) => x.choice)) this.deadline = Math.min(this.deadline, Date.now() + 250);
    else this.push();
  }

  tick(now) {
    if (!this.over && now >= this.deadline) this.resolve();
  }

  // Pay every hero in the fight for the monster that just fell.
  #reward(def) {
    const g = this.ch.game;
    for (const [id, f] of this.fighters) {
      const s = this.spoils.get(id) ?? { gold: 0, loot: {}, xp: null };
      const gold = rint(...def.gold);
      const loot = {};
      for (const d of def.drops) if (Math.random() < d.p) loot[d.id] = (loot[d.id] || 0) + rint(d.min, d.max);
      try {
        g.heroes.addGold(id, gold);
        for (const [it, n] of Object.entries(loot)) g.heroes.addItem(id, it, n);
      } catch (e) {
        console.error('battle reward failed', e);
      }
      const xp = g.heroes.addXp(f.c.hero, 'combat', def.xp);
      s.gold += gold;
      for (const [it, n] of Object.entries(loot)) s.loot[it] = (s.loot[it] || 0) + n;
      s.xp = s.xp ? { ...xp, amount: s.xp.amount + xp.amount, leveled: s.xp.leveled || xp.leveled } : xp;
      this.spoils.set(id, s);
      f.c.pushInventory();
    }
  }

  resolve() {
    const ev = [];
    const H = this.ch.game.heroes;
    for (const [id, f] of this.fighters) {
      if (!f.alive) continue;
      const ch = f.choice || { a: 'attack' }; // idle heroes auto-attack so nobody stalls the party
      f.defending = false;
      if (ch.a === 'attack' || ch.a === 'skill') {
        const skill = ch.a === 'skill' && f.charge >= f.need;
        const crit = Math.random() < 0.12;
        let dmg = damage(f.atk, this.def.def, skill ? 2.4 : 1);
        if (crit) dmg = Math.round(dmg * 1.6);
        this.mobHp = Math.max(0, this.mobHp - dmg);
        f.charge = skill ? 0 : Math.min(f.need, f.charge + 1);
        ev.push({ k: 'hit', from: id, to: 'mob', dmg, crit, skill });
        // Thorns: hitting it hurts back.
        if (this.def.thorns && this.mobHp > 0) {
          const back = Math.max(1, Math.round(dmg * this.def.thorns));
          f.hp = Math.max(0, f.hp - back);
          ev.push({ k: 'thorns', to: id, dmg: back });
          if (f.hp <= 0) {
            f.alive = false;
            ev.push({ k: 'ko', who: id });
          }
        }
        if (this.mobHp <= 0) break;
      } else if (ch.a === 'defend') {
        f.defending = true;
        f.charge = Math.min(f.need, f.charge + 1);
        ev.push({ k: 'defend', who: id });
      } else if (ch.a === 'potion') {
        try {
          H.takeItem(id, ch.itemId, 1);
          const t = ch.to != null ? this.fighters.get(ch.to) : null;
          if (t && !t.alive) {
            // Help a fallen ally up.
            t.alive = true;
            t.hp = Math.min(t.max, Math.max(Math.round(t.max * 0.25), Math.round(ITEMS[ch.itemId].heal * f.mend)));
            ev.push({ k: 'revive', who: ch.to, by: id, amt: Math.round(t.hp), item: ch.itemId });
          } else {
            const heal = Math.min(f.max - f.hp, ITEMS[ch.itemId].heal * f.mend);
            f.hp += heal;
            ev.push({ k: 'heal', who: id, amt: Math.round(heal), item: ch.itemId });
          }
          f.c.pushInventory();
        } catch {
          ev.push({ k: 'defend', who: id });
          f.defending = true;
        }
      }
    }
    if (this.mobHp <= 0) {
      const fallen = this.mob;
      ev.push({ k: 'mobDown', mob: fallen.id });
      this.#reward(this.def);
      fallen.battle = null;
      this.ch.mobFell(this, fallen);
      const next = this.queue.shift();
      if (!next || ![...this.fighters.values()].some((f) => f.alive)) {
        this.ch.broadcast({ t: 'bres', id: this.id, mob: fallen.id, ev });
        this.end(true);
        return;
      }
      // The next of the pack steps in; it gets its turn next round.
      next.x = fallen.x + (next.x - fallen.x) * 0.25;
      next.z = fallen.z + (next.z - fallen.z) * 0.25;
      this.mob = next;
      this.peak = 0;
      this.def = this.ch.monsterDef(next, 1);
      this.mobMax = this.mobHp = this.def.hp;
      this.#rescale();
      this.pending = null;
      ev.push({ k: 'next', mob: next.id });
      for (const f of this.fighters.values()) f.choice = null;
      this.round++;
      this.deadline = Date.now() + ROUND_MS;
      this.ch.broadcast({ t: 'bres', id: this.id, mob: fallen.id, ev });
      this.push();
      return;
    }
    this.#monsterTurn(ev);
    for (const f of this.fighters.values()) f.choice = null;
    this.round++;
    this.deadline = Date.now() + ROUND_MS;
    // A big move is announced a round ahead (Defend!).
    const tg = this.def.telegraph;
    if (tg && this.round >= tg.start && (this.round - tg.start) % tg.every === 0) {
      this.pending = tg.move;
      ev.push({ k: 'warn', mob: this.mob.id, move: tg.move.name });
    }
    this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev });
    if (![...this.fighters.values()].some((f) => f.alive)) this.end(false);
    else this.push();
  }

  // The monster's turn. Town monsters act once; dungeon monsters act once per
  // hero still standing (at different heroes where they can). An area move
  // takes the whole turn; a frenzied monster gets one more action when hurt.
  #monsterTurn(ev) {
    const d = this.def;
    const aliveCount = () => [...this.fighters.values()].filter((f) => f.alive).length;
    let actions = d.perFighter ? aliveCount() : 1;
    if (d.frenzy && this.mobHp < this.mobMax / 2) actions++;
    const hitThisRound = new Set();
    for (let a = 0; a < actions; a++) {
      const alive = [...this.fighters.entries()].filter(([, f]) => f.alive);
      if (!alive.length) break;
      let move;
      if (this.pending && a === 0) {
        move = this.pending; // the announced move lands, and takes the whole turn
        this.pending = null;
      } else {
        // An area move needs the whole turn, so only the first action can be one.
        const pool = a > 0 ? d.moves.filter((m) => !m.aoe) : d.moves;
        move = pool[Math.floor(Math.random() * pool.length)] ?? d.moves[0];
      }
      const fresh = alive.filter(([id]) => !hitThisRound.has(id));
      const pool = fresh.length ? fresh : alive;
      const targets = move.aoe ? alive : [pool[Math.floor(Math.random() * pool.length)]];
      let dealt = 0;
      for (const [id, f] of targets) {
        hitThisRound.add(id);
        let dmg = damage(d.atk, f.def, move.mult * (move.aoe && !move.full ? 0.7 : 1));
        if (f.defending) dmg = Math.max(1, Math.round(dmg * 0.35));
        f.hp = Math.max(0, f.hp - dmg);
        dealt += dmg;
        ev.push({ k: 'hit', from: 'mob', to: id, dmg, move: move.name, aoe: !!move.aoe || undefined, blocked: !!f.defending });
        if (f.hp <= 0) {
          f.alive = false;
          ev.push({ k: 'ko', who: id });
        }
      }
      const drain = move.drain ?? d.drain ?? 0;
      if (drain && dealt) {
        const heal = Math.min(this.mobMax - this.mobHp, Math.round(dealt * drain));
        if (heal > 0) {
          this.mobHp += heal;
          ev.push({ k: 'mobHeal', amt: heal });
        }
      }
      if (move.aoe) break;
    }
  }

  end(victory) {
    if (this.over) return;
    this.over = true;
    const results = {};
    for (const [id, f] of this.fighters) {
      const c = f.c;
      c.battle = null;
      c.ent.act = 'idle';
      c.ent.hp = f.alive ? Math.max(1, f.hp) : Math.round(f.max * this.ch.koHp);
      const s = this.spoils.get(id);
      results[id] = { victory, gold: s?.gold ?? 0, loot: s?.loot ?? {}, xp: s?.xp ?? null };
      c.pushInventory(); // the HUD shows the HP you're left with
      if (victory) c.advanceTutorial('fight');
    }
    for (const m of [this.mob, ...this.queue]) if (m.battle === this) m.battle = null;
    this.ch.battles.delete(this.id);
    this.ch.broadcast({ t: 'battleEnd', id: this.id, mob: this.mob.id, victory, results, inRun: !!this.ch.isRun || undefined });
    this.ch.battleOver(this, victory);
  }
}
