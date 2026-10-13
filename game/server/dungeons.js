// Dungeon runs: a private copy of a generated dungeon for one hero or a
// party (see shared/dungeon.js for the layout and the rules). A run is a
// Channel of its own, so moving, battles, snapshots, chat and emotes all work
// in it unchanged; what's different lives here: room fights (a pack fights as
// one, and everyone in the room joins), gates that open as rooms are cleared,
// the Bone Key and the Vault, rooms revealed as you explore, no health
// regeneration (Last Light, the Shrine and cleared rooms heal), spike traps,
// wipes, the boss, chests and the record of the clear.
import { Channel } from './channel.js';
import {
  generateDungeon, dungeonCol, dungeonWalkable, dungeonBounds, setGate, scaledDef, roomAt, linkAt, DUNGEONS, CELL, TIERS, MODIFIERS,
  TRAP, trapUp, ROOM_HEAL, KO_HP, MAX_WIPES, rollChest, USE_RANGE, RUN_MAX_MS, SEAT_GRACE_MS, MAX_RUN_HEROES, dayIndex, weekIndex, featuredKind, word,
} from '../shared/dungeon.js';
import { MONSTERS } from '../shared/monsters.js';
import { ITEMS } from '../shared/items.js';
import { NavGrid } from '../shared/world.js';
import { tx, fail } from './db.js';
import { emit } from './events.js';

export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export class DungeonRun extends Channel {
  koHp = KO_HP;

  // size: how many heroes the rooms are built for. mode: 'random' or 'weekly'.
  constructor(game, { id, kind, tier = 1, mode = 'random', mod = 'still', seed, size, partyId = null }) {
    super(game, id, { town: false });
    this.isRun = true;
    this.regen = 0; // no health regeneration in a dungeon
    this.kind = kind;
    this.def = DUNGEONS[kind];
    this.tier = tier;
    this.mode = mode;
    this.mod = mod;
    this.partyId = partyId;
    this.partySize = size;
    this.layout = generateDungeon(seed, { kind, party: size, tier, mod });
    this.dcol = dungeonCol(this.layout);
    this.navGrid = new NavGrid(this.dcol, { bounds: dungeonBounds(this.layout), walkable: dungeonWalkable });
    this.startedAt = Date.now();
    this.cleared = new Set();
    this.revealed = new Set();
    this.hasKey = false;
    this.bossDown = false;
    this.finishedAt = null;
    this.shrineUsed = false;
    this.lastLight = new Set(); // heroes who've used the brazier's one full heal
    this.wipes = 0;
    this.kills = 0;
    this.ended = false;
    this.warned = false;
    this.members = new Map(); // heroId → { name, townPos, channel, hp, goneAt }
    this.everSeated = new Set();
    this.grants = new Map(); // heroId → { vault?, boss? } chest loot already given
    this.vaultOpened = false;
    this.layout.spawns.forEach((s, i) => {
      this.mobs.set(`d${i}`, {
        id: `d${i}`, type: s.monster, room: s.room, elite: !!s.elite, affixes: s.affixes ?? [], boss: !!s.boss, key: !!s.key,
        sp: { x: s.x, z: s.z, r: s.boss ? 0.01 : 1.4 }, x: s.x, z: s.z, rot: Math.PI, path: null, state: 'roam',
        next: Date.now() + 1000 + Math.random() * 4000, respawnAt: Infinity, battle: null,
      });
    });
    for (const m of this.mobs.values()) m.def = this.monsterDef(m, 1);
    for (const r of this.layout.rooms) if (!this.#packOf(r.id).length) this.cleared.add(r.id);
    this.revealed.add(0);
    this.#openGates(true);
  }

  // ── The space ─────────────────────────────────────────────────────────
  get col() {
    return this.dcol;
  }
  get nav() {
    return this.navGrid;
  }
  walkable(x, z) {
    return dungeonWalkable(x, z, this.dcol);
  }
  inBounds(x, z) {
    const b = dungeonBounds(this.layout);
    return x >= b.x0 && z >= b.z0 && x <= b.x1 && z <= b.z1;
  }
  roomOf(c) {
    return roomAt(this.layout, c.ent.x, c.ent.z);
  }

  // ── Monsters and fights ───────────────────────────────────────────────
  #packOf(room) {
    return [...this.mobs.values()].filter((m) => m.room === room && m.state !== 'dead');
  }
  monsterDef(mob, n) {
    return scaledDef(MONSTERS[mob.type], n, { elite: mob.elite, affixes: mob.affixes, tier: this.tier, mod: this.mod });
  }
  // A room's pack fights as one: the rest wait their turn (the boss last).
  packFor(mob) {
    return this.#packOf(mob.room)
      .filter((m) => m !== mob)
      .sort((a, b) => a.boss - b.boss || Math.hypot(a.x - mob.x, a.z - mob.z) - Math.hypot(b.x - mob.x, b.z - mob.z));
  }
  // Everyone else in the room is pulled into the fight.
  battleStarted(b, c) {
    const room = roomAt(this.layout, b.mob.x, b.mob.z);
    for (const o of this.players.values()) {
      if (o === c || o.battle || b.fighters.size >= 4) continue;
      if (roomAt(this.layout, o.ent.x, o.ent.z)?.id !== room?.id) continue;
      try {
        b.join(o);
        o.send({ t: 'toast', kind: 'err', text: `${c.hero.name} started a fight: you're in it!` });
      } catch {}
    }
  }
  mobInfo(m) {
    return { ...super.mobInfo(m), d: { name: m.def.name, lvl: m.def.lvl, elite: m.elite || undefined, boss: m.boss || undefined, key: m.key || undefined, affixes: m.affixes.length ? m.affixes : undefined, room: m.room } };
  }

  mobFell(b, mob) {
    mob.state = 'dead';
    mob.respawnAt = Infinity;
    if (this.ended) return; // a failed run counts nothing more
    this.kills++;
    if (mob.key && !this.hasKey) {
      this.hasKey = true;
      this.broadcast({ t: 'dkey', by: [...b.fighters.values()].map((f) => f.c.hero.name) });
    }
    if (!this.#packOf(mob.room).length) this.#roomCleared(mob.room);
    if (mob.boss) this.#bossDown(b);
    this.#openGates();
  }

  battleOver(b, victory) {
    super.battleOver(b, victory);
    // (Everyone fled: no harm done, the pack just goes back to waiting.)
    if (victory || this.ended || !b.fighters.size) return;
    // A wipe: everyone in the fight wakes in the Entry Hall. Four ends the run.
    this.wipes++;
    const names = [...b.fighters.values()].map((f) => f.c.hero.name);
    if (this.wipes > MAX_WIPES) {
      this.broadcast({ t: 'dwipe', names, wipes: this.wipes, over: true });
      this.game.failRun(this);
      return;
    }
    for (const f of b.fighters.values()) if (this.players.get(f.c.hero.id) === f.c) this.toEntry(f.c);
    this.broadcast({ t: 'dwipe', names, wipes: this.wipes, left: MAX_WIPES - this.wipes + 1 });
  }

  #roomCleared(room) {
    if (this.cleared.has(room)) return;
    this.cleared.add(room);
    // A breather for the heroes who fought here.
    for (const c of this.players.values()) {
      if (roomAt(this.layout, c.ent.x, c.ent.z)?.id !== room) continue;
      // Still in the fight that just ended: heal the fighter (the battle
      // hands its health back to the hero when it closes).
      const f = c.battle?.fighters.get(c.hero.id);
      if (f) {
        if (f.alive) f.hp = Math.min(f.max, f.hp + f.max * ROOM_HEAL);
        continue;
      }
      if (c.battle) continue;
      c.ent.hp = Math.min(c.ent.maxHp, c.ent.hp + c.ent.maxHp * ROOM_HEAL);
      c.send({ t: 'me', hp: Math.round(c.ent.hp), maxHp: c.ent.maxHp });
    }
    this.broadcast({ t: 'droom', room, heal: Math.round(ROOM_HEAL * 100), left: this.layout.rooms.filter((r) => !this.cleared.has(r.id)).length });
  }

  #openGates(quiet = false) {
    const open = [];
    for (const g of this.layout.gates) {
      if (!this.dcol.closed.has(g.id) || !this.cleared.has(g.from) || (g.key && !this.hasKey)) continue;
      setGate(this.dcol, g.id, true);
      open.push(g.id);
    }
    if (!open.length) return;
    this.navGrid.invalidate();
    this.#reveal(quiet);
    if (!quiet) this.broadcast({ t: 'dgate', open });
  }

  // Rooms you can see: where anyone has been, and rooms joined to those by an
  // open doorway (so a cleared room shows the next pack through the arch).
  #reveal(quiet = false) {
    const add = [];
    const mark = (id) => {
      if (this.revealed.has(id)) return;
      this.revealed.add(id);
      add.push(id);
    };
    for (const c of this.players.values()) {
      const r = this.roomOf(c);
      if (r) mark(r.id);
      const l = linkAt(this.layout, c.ent.x, c.ent.z);
      if (l) mark(l.a), mark(l.b);
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const g of this.layout.gates) {
        if (this.dcol.closed.has(g.id) || !this.revealed.has(g.from) || this.revealed.has(g.to)) continue;
        mark(g.to);
        grew = true;
      }
    }
    if (add.length && !quiet) this.broadcast({ t: 'dreveal', rooms: add });
  }

  #bossDown() {
    this.bossDown = true;
    this.finishedAt = Date.now();
    const seconds = Math.round((this.finishedAt - this.startedAt) / 1000);
    const db = this.game.db;
    // Everyone with a seat when he falls (a dropped connection too) gets the boss chest.
    const seated = [...this.members.entries()].filter(([, m]) => !m.goneAt || this.finishedAt - m.goneAt < SEAT_GRACE_MS);
    const ids = seated.map(([id]) => id);
    const names = seated.map(([, m]) => m.name);
    const day = dayIndex(this.finishedAt);
    // The record's party size: everyone who went in (leaving before the boss doesn't make a duo's run a solo record).
    const bracket = Math.max(this.partySize, this.everSeated.size);
    let best = false;
    try {
      tx(db, () => {
        const prev = db.prepare('SELECT MIN(seconds) AS s FROM dungeon_runs WHERE kind = ? AND tier = ? AND mode = ? AND party = ? AND (mode = ? OR week = ?)').get(this.kind, this.tier, this.mode, bracket, 'random', weekIndex(this.finishedAt))?.s;
        best = prev == null || seconds < prev;
        db.prepare('INSERT INTO dungeon_runs (kind, tier, mode, week, party, heroes, hero_ids, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)').run(this.kind, this.tier, this.mode, weekIndex(this.finishedAt), bracket, JSON.stringify(names), JSON.stringify(ids), seconds, this.finishedAt);
        for (const id of ids) {
          // The first clear of this kind today (any tier) pays the bonus.
          const firstToday = this.game.firstClearToday(id, this.kind);
          const loot = rollChest(this.kind, 'boss', { party: ids.length, tier: this.tier, mod: this.mod, firstToday, featured: featuredKind() === this.kind });
          this.#give(id, loot);
          this.#grant(id, 'boss', { ...loot, firstToday });
          if (firstToday) db.prepare('INSERT INTO dungeon_daily (account_id, kind, tier, day) VALUES (?,?,?,?) ON CONFLICT(account_id, kind, tier) DO UPDATE SET day = excluded.day').run(id, this.kind, this.tier, day);
        }
      });
    } catch (e) {
      console.error('dungeon clear failed', e);
    }
    for (const id of ids) this.game.online.get(id)?.pushInventory();
    for (const id of ids) emit(this.game.online.get(id) ?? null, 'dungeon', { kind: this.kind, tier: this.tier, seconds, party: ids.length, heroId: id });
    this.broadcast({ t: 'dboss', seconds, best, chest: this.layout.bossChest });
    this.game.announce(`${names.join(', ')} conquered ${this.def.name} (${TIERS[this.tier].name}) in ${fmtTime(seconds)}${best ? '. A new record!' : ''}`);
    this.#announceFinds(ids, 'boss');
  }

  #give(id, loot) {
    const H = this.game.heroes;
    H.addGold(id, loot.gold, 'dungeon');
    for (const [it, n] of Object.entries(loot.items)) H.addItem(id, it, n, 'chest');
  }
  #grant(id, chest, loot) {
    const g = this.grants.get(id) ?? {};
    g[chest] = loot;
    this.grants.set(id, g);
  }
  #announceFinds(ids, chest) {
    for (const id of ids) {
      const loot = this.grants.get(id)?.[chest];
      const name = this.members.get(id)?.name;
      for (const it of Object.keys(loot?.items ?? {})) if (ITEMS[it]?.cat === 'gear') this.game.announce(`${name} found a ${ITEMS[it].name} in ${this.def.name}!`);
    }
  }

  // ── Heroes ────────────────────────────────────────────────────────────
  // Arriving (or coming back): a 'welcome' like the town's, with the dungeon.
  welcome(c) {
    return {
      t: 'welcome',
      channel: null,
      dungeon: { run: this.id, layout: this.layout, state: this.state(c), serverNow: Date.now() },
      you: c.publicSelf(),
      players: [...this.players.values()].filter((o) => o !== c).map((o) => o.publicInfo()),
      nodes: [],
      mobs: this.nearMobs(c),
      battles: [...this.battles.values()].map((b) => b.publicState()),
    };
  }
  state(c = null) {
    return {
      cleared: [...this.cleared],
      revealed: [...this.revealed],
      open: this.layout.gates.filter((g) => !this.dcol.closed.has(g.id)).map((g) => g.id),
      key: this.hasKey,
      boss: this.bossDown,
      shrine: this.shrineUsed,
      lastLight: c ? this.lastLight.has(c.hero.id) : false,
      grants: c ? (this.grants.get(c.hero.id) ?? {}) : {},
      vaultOpened: this.vaultOpened,
      startedAt: this.startedAt,
      kills: this.kills,
      wipes: this.wipes,
      maxWipes: MAX_WIPES,
      size: this.partySize,
      tier: this.tier,
      mode: this.mode,
      mod: this.mod,
    };
  }

  // Bring a hero in at the Entry Hall (at full health; coming back after a
  // dropped connection, with the health they had).
  enter(c, { townPos, channel }) {
    const prev = this.members.get(c.hero.id);
    const m = { name: c.hero.name, townPos: prev?.townPos ?? townPos, channel: prev?.channel ?? channel, hp: prev?.hp ?? null, goneAt: null };
    this.members.set(c.hero.id, m);
    this.everSeated.add(c.hero.id);
    c.townPos = m.townPos;
    c.ent.maxHp = c.stats().hp;
    c.ent.hp = m.hp != null ? Math.min(m.hp, c.ent.maxHp) : c.ent.maxHp;
    Object.assign(c.ent, { x: this.layout.entry.x, z: this.layout.entry.z, path: null, act: 'idle', rot: Math.PI });
    this.add(c);
    this.#reveal();
  }
  // Leaving for good, or (a dropped connection) keeping your seat a while.
  depart(c, { keepSeat = false } = {}) {
    const m = this.members.get(c.hero.id);
    if (this.players.get(c.hero.id) === c) this.remove(c);
    if (!m) return null;
    m.hp = c.ent.hp;
    if (keepSeat && !this.ended) m.goneAt = Date.now();
    else this.members.delete(c.hero.id);
    return m;
  }
  seatFor(heroId, now = Date.now()) {
    const m = this.members.get(heroId);
    return m && m.goneAt && now - m.goneAt < SEAT_GRACE_MS && !this.ended ? m : null;
  }
  // Heroes with a place in the run: inside now, or dropped a moment ago.
  seats(now = Date.now()) {
    let n = 0;
    for (const m of this.members.values()) if (!m.goneAt || now - m.goneAt < SEAT_GRACE_MS) n++;
    return n;
  }
  // Party members who haven't been in yet may join until the boss falls.
  canJoin(heroId) {
    return !this.ended && !this.bossDown && !this.everSeated.has(heroId) && !this.full;
  }
  get full() {
    return this.seats() >= MAX_RUN_HEROES;
  }

  toEntry(c) {
    const e = c.ent;
    const from = { x: e.x, z: e.z };
    [e.x, e.z] = this.freeSpot(this.layout.entry.x, this.layout.entry.z, c, (x, z) => this.nav.clear(this.layout.entry.x, this.layout.entry.z, x, z));
    Object.assign(e, { path: null, act: 'idle' });
    this.teleported(c, from);
    c.send({ t: 'me', hp: Math.round(e.hp), maxHp: e.maxHp });
  }

  // ── Things to use: the brazier, the shrine, chests ────────────────────
  #near(c, p) {
    return p && Math.hypot(c.ent.x - p.x, c.ent.z - p.z) <= USE_RANGE;
  }
  use(c, what) {
    if (this.ended) fail(`The ${word(this.kind)} is closing.`);
    if (c.battle) fail("You're in a battle!");
    const prop = (u) => this.layout.props.find((p) => p.use === u);
    if (what === 'rest') {
      if (!this.#near(c, prop('rest'))) fail('Walk up to the brazier first.');
      if (this.lastLight.has(c.hero.id)) fail("You've had your Last Light this run.");
      if (this.battles.size) fail("You can't rest while your party is fighting.");
      this.lastLight.add(c.hero.id);
      c.ent.hp = c.ent.maxHp;
      c.send({ t: 'me', hp: Math.round(c.ent.hp), maxHp: c.ent.maxHp });
      return { healed: true };
    }
    if (what === 'shrine') {
      if (!this.#near(c, prop('shrine'))) fail('Walk up to the shrine first.');
      if (this.shrineUsed) fail("The shrine's light has faded.");
      if (this.battles.size) fail("You can't pray while your party is fighting.");
      this.shrineUsed = true;
      for (const o of this.players.values()) {
        o.ent.hp = o.ent.maxHp;
        o.send({ t: 'me', hp: Math.round(o.ent.hp), maxHp: o.ent.maxHp });
      }
      this.broadcast({ t: 'dshrine', by: c.hero.name });
      return { healed: true };
    }
    if (what === 'vault') {
      if (!this.#near(c, prop('vault'))) fail('Walk up to the chest first.');
      if (!this.hasKey) fail(`The Vault is locked. The Bone Key is somewhere in the ${word(this.kind)}.`);
      if (!this.vaultOpened) {
        // The first to open it opens it for everyone seated.
        this.vaultOpened = true;
        const ids = [...this.members.entries()].filter(([, m]) => !m.goneAt).map(([id]) => id);
        tx(this.game.db, () => {
          for (const id of ids) {
            const loot = rollChest(this.kind, 'vault', { party: ids.length, tier: this.tier, mod: this.mod });
            this.#give(id, loot);
            this.#grant(id, 'vault', loot);
          }
        });
        for (const id of ids) this.game.online.get(id)?.pushInventory();
        this.broadcast({ t: 'dchest', chest: 'vault', by: c.hero.name });
      }
      const loot = this.grants.get(c.hero.id)?.vault;
      if (!loot) fail('The Vault was emptied before you arrived.');
      return { chest: 'vault', ...loot };
    }
    if (what === 'boss') {
      if (!this.bossDown) fail('The Pale Count still guards his chest.');
      if (!this.#near(c, this.layout.bossChest)) fail('Walk up to the chest first.');
      const loot = this.grants.get(c.hero.id)?.boss;
      if (!loot) fail("You weren't here when the Pale Count fell.");
      return { chest: 'boss', ...loot, seconds: Math.round((this.finishedAt - this.startedAt) / 1000), kills: this.kills };
    }
    fail('Nothing to use there.');
  }

  // ── Tick ──────────────────────────────────────────────────────────────
  tick(now, dt) {
    super.tick(now, dt);
    if (this.ended) return;
    // Spike traps: raised spikes hurt whoever stands on them, once per rise.
    for (const t of this.layout.traps) {
      if (!trapUp(t, now - this.startedAt)) {
        t.hit = null;
        continue;
      }
      t.hit ??= new Set();
      for (const c of this.players.values()) {
        if (c.battle || t.hit.has(c.hero.id)) continue;
        if (Math.abs(c.ent.x - t.x) > CELL / 2 - 0.3 || Math.abs(c.ent.z - t.z) > CELL / 2 - 0.3) continue;
        t.hit.add(c.hero.id);
        const dmg = Math.max(1, Math.round(c.ent.maxHp * TRAP.damage));
        c.ent.hp = Math.max(1, c.ent.hp - dmg);
        this.broadcast({ t: 'dtrap', trap: t.id, who: c.hero.id, dmg, hp: Math.round(c.ent.hp) });
        c.send({ t: 'me', hp: Math.round(c.ent.hp), maxHp: c.ent.maxHp });
      }
    }
    if (this.tickNo % 5 === 0) this.#reveal();
    if (!this.warned && now - this.startedAt > RUN_MAX_MS - 5 * 60_000) {
      this.warned = true;
      this.broadcast({ t: 'toast', kind: 'err', text: `${this.def.name} will close in 5 minutes.` });
    }
  }

  // Should this run be closed? (empty with no held seats, or too old)
  expired(now = Date.now()) {
    if (this.ended || now - this.startedAt > RUN_MAX_MS) return true;
    if (this.players.size) return false;
    for (const m of this.members.values()) if (m.goneAt && now - m.goneAt < SEAT_GRACE_MS) return false;
    return true;
  }
}

export { MODIFIERS };
