import './map.js'; // loads the world map first: everything below reads it
import { ITEMS, isItem } from '../shared/items.js';
import { RECIPE_BY_ID } from '../shared/recipes.js';
import { levelFromXp, doubleChance } from '../shared/skills.js';
import { MONSTERS, heroStats, damage } from '../shared/monsters.js';
import {
  NODES, SPAWNS, buildColliders, NavGrid, NODE_TYPES, stepPath,
  INTERACT_RANGE, FISH_RANGE, SPAWN, isWalkable, WORLD_RADIUS, isDeepSpot, SWING_FLOOR, isPerfectSwing,
  stoneById, stoneNear, stoneFront, travelFee, STONE_RANGE, landDistance, ENTRANCES, entranceFront,
} from '../shared/world.js';
import { rollFish, fishingGear, fightRating, replayFight, FISH, FISH_MAX_TICKS } from '../shared/fishing.js';
import { GameError, fail } from './db.js';
import { Heroes } from './heroes.js';
import { Market } from './market.js';
import { Shops } from './shop.js';
import { ShopRoom } from './rooms.js';
import { Crafting } from './crafting.js';
import { Jobs, jobText } from './jobs.js';
import { SHOP } from '../shared/shop.js';
import { Auth } from './auth.js';
import { Channel, Battle, rint, q2 } from './channel.js';
import { DungeonRun } from './dungeons.js';
import { Parties } from './party.js';
import { DUNGEONS, TIERS, MODIFIERS, ENTRANCE_RANGE, MAX_RUN_HEROES, MAX_RUNS, READY_MS, ENTER_COOLDOWN_MS, ENGAGE_PATH, modifierFor, weeklySeed, weekIndex, dayIndex } from '../shared/dungeon.js';
import { world, rebuildWorld } from './static.js';

const GATHER_ACTS = new Set(['chop', 'mine', 'pick']);

export const CHANNEL_CAP = Number(process.env.CHANNEL_CAP || 40);
const TICK_MS = 50; // 20 Hz simulation
const NPC_SELL_RATE = 0.6; // instant-sell to the town merchant pays 60% of value
const CHAT_MAX = 140;
const TRAVEL_COOLDOWN_MS = 3000;


const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Tutorial: the core loop in one session.
export const TUTORIAL = [
  { id: 'chop', text: 'Chop a tree in Whisperwood (west)', reward: 20 },
  { id: 'craft', text: 'Saw Oak Planks at the Workshop', reward: 30 },
  { id: 'fight', text: `Slay a ${MONSTERS.slime.name} beyond the Wilds Gate (north)`, reward: 50 },
  { id: 'stock', text: 'Put something on a display in Your Shop', reward: 60 },
];

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
    if (!isWalkable(this.ent.x, this.ent.z, world().col)) Object.assign(this.ent, { x: SPAWN.x, z: SPAWN.z });
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }
  sendRaw(data) {
    if (this.ws.readyState === 1) this.ws.send(data);
  }

  // Special abilities from equipped gear (e.g. Wraithsteel's quick special).
  perks() {
    return new Set(['weapon', 'armor', 'trinket'].map((s) => ITEMS[this.hero.equip[s]]?.perk).filter(Boolean));
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
    return { ...this.publicInfo(), admin: this.game.auth.isAdmin(this.hero.id), gold: this.game.heroes.gold(this.hero.id), skills: this.hero.skills, inv: this.game.heroes.inventory(this.hero.id), hp: Math.round(this.ent.hp), maxHp: this.ent.maxHp, stats: this.stats(), tutorial: this.hero.tutorial, stones: this.hero.stones.filter((id) => stoneById(id)), shop: { till: shop?.till || 0, open: shop ? !!shop.open : true }, craft: this.game.crafting.publicState(this) };
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

  // Standing at a waystone you haven't been to: attune to it.
  attuneNearby() {
    const st = stoneNear(this.ent.x, this.ent.z);
    if (!st || !this.game.heroes.attune(this.hero, st.id)) return;
    this.send({ t: 'attuned', id: st.id, name: st.name });
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
    this.jobs = new Jobs(db, this.heroes);
    this.parties = new Parties(this);
    this.runs = new Map(); // dungeon runs (id → DungeonRun)
    this.runSeq = 0;
    this.auth = new Auth(db);
    this.channels = [];
    this.online = new Map(); // accountId → Client
    this.rooms = new Map(); // shop owner → ShopRoom (only while someone is inside)
    this.lastActive = this.heroes.loadActive();
    this.buyNonces = new Map(); // buyer → Map(nonce → result): a retried purchase can't buy twice
    this.seq = 0;
    this.last = Date.now();
    this.tickNo = 0;
    this.timer = null;
    this.shopTimer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tickShops(); // catch up on sales made while the server was down
    if (this.opts.shopSim) this.shopTimer = setInterval(() => this.tickShops(), SHOP.SIM_STEP_MS);
    this.saveTimer = setInterval(() => this.savePositions(), 30000);
    this.expireJobs();
    this.jobTimer = setInterval(() => this.expireJobs(), 60000);
  }
  // Bulletin board jobs past their time: refund what's left, tell the poster.
  expireJobs(now = Date.now()) {
    try {
      for (const r of this.jobs.expire(now)) {
        const o = this.online.get(r.poster);
        if (!o) continue;
        o.pushInventory();
        o.send({ t: 'toast', kind: 'gold', text: `Your job for ${ITEMS[r.item]?.name ?? r.item} ran out${r.refund ? `: ${r.refund} 🪙 back` : ''}.` });
      }
    } catch (e) {
      console.error('job expiry error', e);
    }
  }
  stop() {
    clearInterval(this.timer);
    clearInterval(this.shopTimer);
    clearInterval(this.saveTimer);
    clearInterval(this.jobTimer);
    this.endAllRuns();
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
    for (const run of [...this.runs.values()]) {
      try {
        run.tick(now, dt);
        if (run.expired(now)) this.closeRun(run);
      } catch (e) {
        console.error('dungeon tick error', e);
      }
    }
    if (++this.tickNo % 40 === 0) {
      this.parties.sweep(now);
      for (const p of this.parties.parties.values()) if (p.ready) this.#checkReady(p, now);
      // Party frames show each other's health in a dungeon.
      for (const p of this.parties.parties.values()) if (p.members.some((id) => this.online.get(id)?.ch?.isRun)) this.parties.push(p);
    }
  }

  savePositions() {
    for (const c of this.online.values()) {
      const p = this.townPos(c);
      this.heroes.savePos(c.hero.id, p.x, p.z);
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
    if (c.ch?.isRun) fail('Leave the dungeon first.');
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
    c.send(c.ch.fullSnapshot(c));
    return { x: q2(c.ent.x), z: q2(c.ent.z) };
  }

  // ── Fast travel ────────────────────────────────────────────────────
  // From the waystone you're standing at to another you've attuned to, for a fee.
  travel(c, to, now = Date.now()) {
    if (c.room) fail('Leave the shop first.');
    if (c.ch?.isRun) fail("Waystones don't work underground. Leave the dungeon first.");
    if (c.battle) fail("You can't travel in the middle of a battle!");
    if (c.craft) fail('Finish your craft first.');
    const dest = stoneById(to);
    if (!dest) fail('No such waystone.');
    const here = stoneNear(c.ent.x, c.ent.z);
    if (!here) fail('Walk up to a waystone first.');
    c.attuneNearby(); // just arrived and travelling straight on
    if (here.id === dest.id) fail("You're already here.");
    if (!c.hero.stones.includes(dest.id)) fail(`You haven't been to ${dest.name} yet. Walk there once to attune to it.`);
    if (now - (c.lastTravel || 0) < TRAVEL_COOLDOWN_MS) fail('The stone is still humming. Try again in a moment.');
    const fee = travelFee(here, dest);
    if (this.heroes.gold(c.hero.id) < fee) fail(`Travelling to ${dest.name} costs ${fee} gold.`);
    const [fx, fz] = stoneFront(dest);
    const open = isWalkable(fx, fz, world().col) ? [fx, fz] : world().nav.nearestOpen(fx, fz);
    if (!open || Math.hypot(open[0] - dest.x, open[1] - dest.z) > STONE_RANGE) fail("That waystone's way is blocked.");
    this.heroes.addGold(c.hero.id, -fee);
    c.cancelFishing();
    const e = c.ent;
    const from = { x: e.x, z: e.z };
    // Make room if someone's standing there, but stay at the stone, on this side of any wall.
    [e.x, e.z] = c.ch.freeSpot(open[0], open[1], c, (nx, nz) => Math.hypot(nx - dest.x, nz - dest.z) <= STONE_RANGE - 1 && world().nav.clear(open[0], open[1], nx, nz));
    Object.assign(e, { path: null, act: 'idle', rot: dest.rot ?? 0 });
    c.lastTravel = now;
    this.heroes.savePos(c.hero.id, e.x, e.z);
    c.ch.teleported(c, from);
    c.pushInventory();
    return { to: dest.id, fee, x: q2(e.x), z: q2(e.z) };
  }

  // Server owners can jump anywhere on land (to check their building), free.
  ownerTeleport(c, x, z) {
    if (!this.auth.isAdmin(c.hero.id)) fail('Only server owners can do that.');
    if (c.room) fail('Leave the shop first.');
    if (c.ch?.isRun) fail('Leave the dungeon first.');
    if (c.battle) fail("You can't travel in the middle of a battle!");
    if (c.craft) fail('Finish your craft first.');
    x = Number(x);
    z = Number(z);
    if (!Number.isFinite(x) || !Number.isFinite(z) || landDistance(x, z) > 0) fail("That's not on land.");
    const open = isWalkable(x, z, world().col) ? [x, z] : world().nav.nearestOpen(x, z);
    if (!open) fail("There's no room to stand there.");
    c.cancelFishing();
    const e = c.ent;
    const from = { x: e.x, z: e.z };
    [e.x, e.z] = c.ch.freeSpot(open[0], open[1], c);
    Object.assign(e, { path: null, act: 'idle' });
    this.heroes.savePos(c.hero.id, e.x, e.z);
    c.ch.teleported(c, from);
    return { x: q2(e.x), z: q2(e.z) };
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

  // A new world map is in place (saved from the editor). Rebuild collision and
  // navigation, then send everyone back in: their clients reload to build the
  // new world, and they rejoin fresh channels (nodes and monsters reset).
  reloadWorld() {
    this.endAllRuns(); // runs never outlive the map they were built under
    rebuildWorld();
    for (const c of [...this.online.values()]) {
      c.send({ t: 'kicked', reason: 'The world was updated.' });
      this.disconnect(c);
      c.ws.close(4003, 'world updated');
    }
    this.channels = [];
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
    // Dropped out of a dungeon a moment ago? Back into the same run.
    const seat = [...this.runs.values()].map((run) => [run, run.seatFor(accountId)]).find(([, m]) => m);
    if (seat) seat[0].enter(c, seat[1]);
    else this.pickChannel().add(c);
    this.parties.online(c);
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
    const p = this.townPos(c);
    this.heroes.savePos(c.hero.id, p.x, p.z);
    this.heroes.saveActive(c.hero.id, c.lastInput);
    this.lastActive.set(c.hero.id, c.lastInput);
    if (c.ch?.isRun) c.ch.depart(c, { keepSeat: true }); // you can reconnect into the run for a while
    else c.ch?.remove(c);
    this.parties.offline(c.hero.id);
  }

  // Where a hero is in the overworld (inside a dungeon: where they went in).
  townPos(c) {
    return c.ch?.isRun && c.townPos ? c.townPos : { x: c.ent.x, z: c.ent.z };
  }

  // ── Dungeons ───────────────────────────────────────────────────────
  // (server/dungeons.js runs them; shared/dungeon.js has the rules.)
  runForParty(partyId) {
    for (const r of this.runs.values()) if (partyId && r.partyId === partyId && !r.ended) return r;
    return null;
  }
  #notBusy(c, who = 'You') {
    const you = who === 'You';
    if (c.battle) fail(you ? "You're in a battle!" : `${who} is in a battle.`);
    if (c.room) fail(you ? 'Leave the shop first.' : `${who} is in a shop.`);
    if (c.craft) fail(you ? 'Finish your craft first.' : `${who} is crafting.`);
    if (c.ch?.isRun) fail(you ? "You're already in a dungeon." : `${who} is already in a dungeon.`);
  }
  // The highest tier a hero has cleared (unlocks the next).
  bestTier(heroId, kind) {
    return this.db.prepare('SELECT MAX(r.tier) AS t FROM dungeon_runs r, json_each(r.hero_ids) j WHERE r.kind = ? AND j.value = ?').get(kind, heroId)?.t ?? 0;
  }
  #checkEntry(c, kind, tier, mode) {
    if (!DUNGEONS[kind]) fail('No such dungeon.');
    if (!TIERS[tier]) fail('No such tier.');
    if (mode !== 'random' && mode !== 'weekly') fail('Bad mode.');
    this.#notBusy(c);
    if (!ENTRANCES.some((e) => e.kind === kind && Math.hypot(c.ent.x - e.x, c.ent.z - e.z) <= ENTRANCE_RANGE + 4)) fail('Walk up to the crypt door first.');
    if (tier > 1 && this.bestTier(c.hero.id, kind) < tier - 1) fail(`Clear ${TIERS[tier - 1].name} first.`);
    if (Date.now() - (c.lastRunAt || 0) < ENTER_COOLDOWN_MS) fail('Catch your breath a moment first.');
    if ([...this.runs.values()].filter((r) => !r.ended).length >= MAX_RUNS) fail('The crypt is crowded right now. Try again in a minute.');
  }
  #newRun(kind, tier, mode, size, partyId) {
    const now = Date.now();
    const seed = mode === 'weekly' ? weeklySeed(kind, tier, now) : (Math.random() * 2 ** 32) >>> 0;
    const run = new DungeonRun(this, { id: `r${++this.runSeq}`, kind, tier, mode, mod: modifierFor(now), seed, size, partyId });
    this.runs.set(run.id, run);
    return run;
  }
  // Go in alone; or (the party leader) start a ready check: everyone who says
  // yes in time goes in together.
  enterDungeon(c, kind, { tier = 1, mode = 'random', party = false } = {}) {
    tier = Number(tier) || 1;
    this.#checkEntry(c, kind, tier, mode);
    if (!party) {
      const run = this.#newRun(kind, tier, mode, 1, null);
      c.lastRunAt = Date.now();
      this.#intoRun(c, run);
      return { run: run.id };
    }
    const p = this.parties.get(c.hero.id);
    if (!p) fail("You're not in a party.");
    if (p.leader !== c.hero.id) fail('Only the party leader can lead the party in.');
    if (this.runForParty(p.id)) fail('Your party is already inside: join them.');
    if (p.ready) fail('A ready check is already running.');
    for (const id of p.members) {
      if (id === c.hero.id) continue;
      const o = this.online.get(id);
      if (o && tier > 1 && this.bestTier(id, kind) < tier - 1) fail(`${o.hero.name} hasn't cleared ${TIERS[tier - 1].name} yet.`);
    }
    p.ready = { kind, tier, mode, leader: c.hero.id, yes: new Set([c.hero.id]), no: new Set(), until: Date.now() + READY_MS };
    for (const id of p.members) if (id !== c.hero.id) this.online.get(id)?.send({ t: 'dready', from: c.hero.name, kind, tier, mode, expiresIn: READY_MS });
    this.parties.push(p);
    this.#checkReady(p);
    return { ready: true, expiresIn: READY_MS };
  }
  readyAnswer(c, yes) {
    const p = this.parties.get(c.hero.id);
    if (!p?.ready) fail('There is no ready check right now.');
    if (yes) {
      this.#notBusy(c);
      p.ready.yes.add(c.hero.id);
    } else p.ready.no.add(c.hero.id);
    this.#checkReady(p);
    return { ok: true };
  }
  // When everyone online has answered (or time's up), in they go.
  #checkReady(p, now = Date.now()) {
    const R = p.ready;
    if (!R) return;
    const online = p.members.filter((id) => this.online.has(id));
    const answered = online.every((id) => R.yes.has(id) || R.no.has(id));
    if (!answered && now < R.until) return;
    p.ready = null;
    const leader = this.online.get(R.leader);
    const going = [...R.yes].map((id) => this.online.get(id)).filter((o) => o && !o.battle && !o.room && !o.craft && !o.ch?.isRun);
    if (!leader || !going.includes(leader)) {
      for (const id of online) this.online.get(id)?.send({ t: 'toast', kind: 'err', text: 'The ready check was called off.' });
      this.parties.push(p);
      return;
    }
    const run = this.#newRun(R.kind, R.tier, R.mode, Math.min(MAX_RUN_HEROES, going.length), p.id);
    leader.lastRunAt = Date.now();
    for (const o of going.slice(0, MAX_RUN_HEROES)) this.#intoRun(o, run);
    for (const id of R.no) this.online.get(id)?.send({ t: 'toast', text: 'Your party went in without you. You can still join them from the Party panel.' });
    this.parties.push(p);
  }
  // Join your party's run late (from anywhere), until the boss falls.
  joinRun(c, runId) {
    const run = this.runs.get(String(runId));
    if (!run || run.ended) fail('That run is over.');
    const p = this.parties.get(c.hero.id);
    if (!run.partyId || p?.id !== run.partyId) fail("That isn't your party's run.");
    this.#notBusy(c);
    if (!run.canJoin(c.hero.id)) fail(run.bossDown ? 'They have already beaten the boss.' : run.full ? 'That run is full.' : "You can't rejoin a run you left.");
    this.#intoRun(c, run);
    this.parties.push(p);
    return { run: run.id };
  }
  #intoRun(c, run) {
    c.cancelFishing();
    const townPos = { x: c.ent.x, z: c.ent.z };
    const channel = c.ch?.isRun ? null : (c.ch?.id ?? null);
    this.heroes.savePos(c.hero.id, townPos.x, townPos.z); // a crash inside never strands you underground
    c.ch?.remove(c);
    run.enter(c, { townPos, channel });
  }
  // Leave a run: back where you were before you went in.
  leaveRun(c) {
    const run = c.ch?.isRun ? c.ch : null;
    if (!run) fail("You're not in a dungeon.");
    if (c.battle) fail('Finish (or flee) your battle first.');
    const m = run.depart(c);
    this.#outOfRun(c, run, m);
    const p = this.parties.get(c.hero.id);
    if (p) this.parties.push(p);
    return { left: true };
  }
  #outOfRun(c, run, m) {
    const door = ENTRANCES.find((e) => e.kind === run.kind);
    const pos = m?.townPos && isWalkable(m.townPos.x, m.townPos.z, world().col) ? m.townPos : door ? { x: entranceFront(door)[0], z: entranceFront(door)[1] } : SPAWN;
    Object.assign(c.ent, { x: pos.x, z: pos.z, path: null, act: 'idle' });
    c.ent.hp = Math.max(1, Math.min(c.ent.hp, c.ent.maxHp));
    c.townPos = null;
    // Friends come back out together: to the party leader's channel if we can.
    const p = run.partyId && this.parties.parties.get(run.partyId);
    const lead = p ? this.online.get(p.leader) : null;
    this.pickChannel(lead?.ch && !lead.ch.isRun ? lead.ch.id : m?.channel).add(c);
  }
  // The fourth wipe: the crypt throws you out (you keep what you won).
  failRun(run) {
    run.ended = true;
    setImmediate(() => this.closeRun(run, `The dead of ${run.def.name} have had enough of you. You keep what you found; the chests stay shut.`));
  }
  closeRun(run, text = `${run.def.name} closes behind you.`) {
    run.ended = true;
    for (const c of [...run.players.values()]) {
      if (c.battle) {
        const b = c.battle;
        b.fighters.delete(c.hero.id);
        c.battle = null;
        if (!b.fighters.size) b.over = true;
      }
      const m = run.depart(c);
      c.send({ t: 'toast', kind: 'err', text });
      this.#outOfRun(c, run, m);
    }
    this.runs.delete(run.id);
    const p = run.partyId && this.parties.parties.get(run.partyId);
    if (p) this.parties.push(p);
  }
  endAllRuns() {
    for (const run of [...this.runs.values()]) this.closeRun(run, 'The crypt is being rebuilt. Back to the surface!');
  }
  dungeonInfo(c, kind) {
    const K = DUNGEONS[kind];
    if (!K) fail('No such dungeon.');
    const now = Date.now();
    const db = this.db;
    const tierRows = Object.keys(TIERS).map(Number).map((t) => ({
      tier: t,
      ...TIERS[t],
      unlocked: t === 1 || this.bestTier(c.hero.id, kind) >= t - 1,
      best: db.prepare("SELECT party, MIN(seconds) AS seconds FROM dungeon_runs WHERE kind = ? AND tier = ? AND mode = 'random' GROUP BY party").all(kind, t),
      weekly: db.prepare("SELECT party, heroes, seconds FROM dungeon_runs WHERE kind = ? AND tier = ? AND mode = 'weekly' AND week = ? ORDER BY seconds LIMIT 5").all(kind, t, weekIndex(now)).map((r) => ({ ...r, heroes: JSON.parse(r.heroes) })),
      firstToday: db.prepare('SELECT day FROM dungeon_daily WHERE account_id = ? AND kind = ? AND tier = ?').get(c.hero.id, kind, t)?.day !== dayIndex(now),
    }));
    const p = this.parties.get(c.hero.id);
    const run = p ? this.runForParty(p.id) : null;
    const mod = modifierFor(now);
    return {
      kind,
      name: K.name,
      blurb: K.blurb,
      tiers: tierRows,
      mod: { id: mod, ...MODIFIERS[mod] },
      party: p ? this.parties.view(p) : null,
      partyRun: run ? { id: run.id, inside: run.players.size, tier: run.tier, canJoin: run.canJoin(c.hero.id) } : null,
      nextWeekIn: (weekIndex(now) + 1) * 7 * 86_400_000 - 3 * 86_400_000 - now,
    };
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
      // Inside a dungeon only some things make sense (no fishing, travel, shops…).
      if (c.ch?.isRun && !RUN_OK.has(m.t) && !(m.t === 'rpc' && RUN_RPC_OK(String(m.m)))) fail('Not inside the crypt.');
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
    if (!c.ch.inBounds(x, z)) return;
    const path = c.ch.nav.findPath(c.ent.x, c.ent.z, x, z);
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
    if (c.ch.isRun) {
      // No fighting through bars: you must be able to walk to it.
      const path = c.ch.nav.findPath(c.ent.x, c.ent.z, mob.x, mob.z);
      let len = 0;
      let [px, pz] = [c.ent.x, c.ent.z];
      for (const [x, z] of path ?? []) (len += Math.hypot(x - px, z - pz)), ([px, pz] = [x, z]);
      if (!path || len > ENGAGE_PATH) fail("You can't reach it from here.");
    }
    let b = mob.battle;
    const fresh = !b;
    if (!b) {
      b = new Battle(c.ch, mob);
      c.ch.battles.set(b.id, b);
    }
    b.join(c);
    if (fresh) c.ch.battleStarted?.(b, c); // in a dungeon, everyone in the room joins the fight
  },

  bact(g, c, m) {
    if (!c.battle) return;
    c.battle.choose(c, String(m.a), m.item ? String(m.item) : null, m.to ?? null);
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

const RUN_OK = new Set(['ping', 'move', 'engage', 'bact', 'chat', 'emote']);
const RUN_RPC_OK = (name) =>
  /^(dungeon|party|market)\./.test(name) ||
  ['equip', 'avatar', 'profile', 'town.info', 'jobs.list', 'drink', 'craft.info', 'invite.create', 'tutorialSkip', 'shop.state', 'shop.ledger', 'shop.collect', 'shop.ack', 'shop.directory'].includes(name);

const RPC = {
  craft: () => fail('Crafting is hands-on now — pick a recipe and head to its station!'),
  'craft.info': (g, c) => g.crafting.info(c),
  'craft.start': (g, c, a) => g.crafting.start(c, a),
  'craft.finish': (g, c, a) => g.crafting.finish(c, a),
  'craft.cancel': (g, c, a) => g.crafting.cancel(c, a),
  'craft.quick': (g, c, a) => g.crafting.quick(c, a),
  npcSell: (g, c, a) => g.npcSell(c, a.item, a.qty),
  // Drink a healing item outside a battle (in a dungeon nothing heals on its own).
  drink(g, c, a) {
    const it = ITEMS[a.item];
    if (!it?.heal) fail('Pick a healing item.');
    if (c.battle) fail('Use it from the battle menu.');
    if (c.ent.hp >= c.ent.maxHp) fail("You're already at full health.");
    g.heroes.takeItem(c.hero.id, String(a.item), 1);
    const heal = Math.min(c.ent.maxHp - c.ent.hp, Math.round(it.heal * (c.perks().has('mender') ? 1.4 : 1)));
    c.ent.hp += heal;
    c.pushInventory();
    return { heal, hp: Math.round(c.ent.hp) };
  },
  travel: (g, c, a) => g.travel(c, String(a.to ?? '')),
  'owner.teleport': (g, c, a) => g.ownerTeleport(c, a.x, a.z),
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
    const party = g.parties.get(h.id);
    const mine = g.parties.get(c.hero.id);
    return { id: h.id, name: h.name, avatar: h.avatar, level: h.level, skills: h.skills, equip: h.equip, online: !!on, channel: on?.ch?.isRun ? null : (on?.ch?.id ?? null), dungeon: on?.ch?.isRun ? on.ch.def.name : null, shop: g.shops.slots(h.id).length, shopOpen: shop ? !!shop.open : false, inside: on?.room?.owner ?? null, inParty: !!party, sameParty: !!party && party === mine, canInvite: !!on && h.id !== c.hero.id && !party && (!mine || (mine.leader === c.hero.id && mine.members.length < 4)) };
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
      online: [...g.online.values()].map((o) => ({ id: o.hero.id, name: o.hero.name, level: o.hero.level, channel: o.ch?.isRun ? null : o.ch?.id, dungeon: o.ch?.isRun ? o.ch.def.name : null, party: g.parties.get(o.hero.id)?.id ?? null })),
      rich,
      levels,
      invites: g.auth.myInvites(c.hero.id),
      heroes: g.db.prepare('SELECT COUNT(*) AS n FROM heroes').get().n,
    };
  },
  'invite.create': (g, c) => ({ code: g.auth.createInvite(c.hero.id) }),

  // Dungeons (server/dungeons.js) and parties (server/party.js)
  'dungeon.info': (g, c, a) => g.dungeonInfo(c, String(a.kind ?? 'hollow_crypt')),
  'dungeon.enter': (g, c, a) => g.enterDungeon(c, String(a.kind ?? ''), { tier: a.tier, mode: a.mode === 'weekly' ? 'weekly' : 'random', party: !!a.party }),
  'dungeon.ready': (g, c, a) => g.readyAnswer(c, !!a.yes),
  'dungeon.join': (g, c, a) => g.joinRun(c, a.run),
  'dungeon.leave': (g, c) => g.leaveRun(c),
  'dungeon.use'(g, c, a) {
    if (!c.ch?.isRun) fail("You're not in a dungeon.");
    return c.ch.use(c, String(a.what ?? ''));
  },
  'party.get': (g, c) => {
    const p = g.parties.get(c.hero.id);
    return p ? g.parties.view(p) : null;
  },
  'party.invite': (g, c, a) => g.parties.invite(c, a.id),
  'party.answer': (g, c, a) => g.parties.answer(c, !!a.accept),
  'party.leave': (g, c) => g.parties.leave(c.hero.id, 'left'),
  'party.kick': (g, c, a) => g.parties.kick(c, a.id),
  'party.promote': (g, c, a) => g.parties.promote(c, a.id),

  // Bulletin board (server/jobs.js)
  'jobs.list': (g, c) => ({ open: g.jobs.list(), mine: g.jobs.mine(c.hero.id), now: Date.now() }),
  'jobs.post'(g, c, a) {
    const j = g.jobs.post(c.hero.id, a);
    c.pushInventory();
    g.announce(`${c.hero.name} posted a job on the board: ${jobText(j)} at ${j.per} 🪙 each.`);
    return j;
  },
  'jobs.deliver'(g, c, a) {
    const r = g.jobs.deliver(c.hero.id, a.id, a.qty);
    c.pushInventory();
    const o = g.online.get(r.poster);
    if (o) {
      o.pushInventory();
      o.send({ t: 'toast', kind: 'good', text: `${c.hero.name} delivered ${r.qty}× ${ITEMS[r.item].name} for your job${r.left ? ` (${r.left} still wanted)` : '. Job done!'}` });
    }
    return r;
  },
  'jobs.cancel'(g, c, a) {
    const r = g.jobs.cancel(c.hero.id, a.id);
    c.pushInventory();
    return r;
  },
  'channel.switch'(g, c, a) {
    const target = g.channels.find((ch) => ch.id === Number(a.id));
    if (!target) fail('No such channel.');
    if (target === c.ch) fail("You're already here.");
    if (c.ch?.isRun) fail('Leave the dungeon first.');
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

