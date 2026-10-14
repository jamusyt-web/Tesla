import './map.js'; // loads the world map first: everything below reads it
import { ITEMS, WORN } from '../shared/items.js';
import { effectsOf, perkNames } from '../shared/perks.js';
import { useBuffs, applyBoon, BOONS } from '../shared/buffs.js';
import { RECIPE_BY_ID } from '../shared/recipes.js';
import { levelFromXp } from '../shared/skills.js';
import { heroStats } from '../shared/monsters.js';
import { SPAWN, isWalkable, stoneById, ENTRANCES, entranceFront } from '../shared/world.js';
import { GameError, fail } from './db.js';
import { Heroes } from './heroes.js';
import { Market } from './market.js';
import { Shops } from './shop.js';
import { ShopRoom } from './rooms.js';
import { Crafting } from './crafting.js';
import { Jobs } from './jobs.js';
import { Merchant } from './merchant.js';
import { needTown } from './towns.js';
import { setOverrides } from '../shared/economy.js';
import { SHOP } from '../shared/shop.js';
import { Auth } from './auth.js';
import { Channel, q2 } from './channel.js';
import { Battle } from './battle.js';
import { DungeonRun } from './dungeons.js';
import { Parties } from './party.js';
import { DUNGEONS, TIERS, MODIFIERS, ENTRANCE_RANGE, MAX_RUN_HEROES, MAX_RUNS, READY_MS, ENTER_COOLDOWN_MS, ENGAGE_PATH, NIGHTMARE, NIGHTMARE_COMBAT, modifierFor, weeklySeed, weekIndex, dayIndex, nightmareKind, featuredKind, recFor, word } from '../shared/dungeon.js';
import { world, rebuildWorld } from './static.js';
import { register, dispatch, allowedInRun } from './rpc.js';
import { emit } from './events.js';
import { onMove } from './move.js';
import { GATHER_HANDLERS } from './gather.js';
import { attuneNearby } from './travel.js';
import { expireJobs, pushStorage } from './trade.js';
import './gear.js'; // these register their RPCs
import './perf.js';
import './perks.js'; // level-up unlocks, the level-40 choice, salvage
import { TUTORIAL } from './tutorial.js';
import { Quests } from './quests.js';
import { Orders } from './orders.js';
import { Almanac } from './almanac.js';
import { Notices } from './notices.js';
import { Journal } from './journal.js';
import { Explore } from './explore.js';
import { Landmarks, landmarksChanged } from './landmarks.js';
import { resetJournalCache } from '../shared/journal.js';
import { Digest, DIGEST_AFTER_MS } from './digest.js';
import { Engage } from './engage.js';
import './owner.js'; // the owner's Economy and Engagement reports
import './fieldguide.js'; // the Book's field guide (guide.get, guide.claim)
import * as rep from './rep.js';

export { TUTORIAL };
export const CHANNEL_CAP = Number(process.env.CHANNEL_CAP || 40);
const TICK_MS = 50; // 20 Hz simulation
const CHAT_MAX = 140;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

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

  // opts.low: a phone (it's told about fewer, nearer monsters).
  constructor(game, ws, hero, { low = false } = {}) {
    this.game = game;
    this.ws = ws;
    this.low = low;
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
    this.ent = { x: hero.x, z: hero.z, rot: 0, path: null, act: 'idle', hp: st.hp, maxHp: st.hp, lastSwing: 0, lastNode: null, fishing: null, lastSnap: '', speedMul: 1 };
    if (!isWalkable(this.ent.x, this.ent.z, world().col)) Object.assign(this.ent, { x: SPAWN.x, z: SPAWN.z });
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }
  // Walk faster or slower (a buff, a road, a mount…): 1 is normal.
  setSpeed(mul) {
    this.ent.speedMul = mul;
    this.send({ t: 'speed', mul });
  }
  sendRaw(data) {
    if (this.ws.readyState === 1) this.ws.send(data);
  }

  // Everything the hero's gear, sets, charm, milestones and buffs do (shared/perks.js).
  // Cached for a second; anything that changes them (equip, buffs, a
  // level) clears the cache with fxChanged().
  effects(now = Date.now()) {
    if (!this.fx || now - this.fx.at > 1000) this.fx = { at: now, E: effectsOf(this.hero, now) };
    return this.fx.E;
  }
  fxChanged() {
    this.fx = null;
  }
  // The gear perks in force (e.g. Wraithsteel's quick special).
  perks() {
    return perkNames(this.effects());
  }

  stats() {
    const h = this.hero;
    const gear = WORN.map((s) => ITEMS[h.equip[s]]);
    return heroStats(h.level, levelFromXp(h.skills.combat || 0), gear, this.effects());
  }

  // One use of a buff's kind ('swing', 'gather', 'cast', 'battle', 'craft').
  useBuffs(per) {
    const r = useBuffs(this.hero.buffs, per);
    if (!r.changed) return;
    this.hero.buffs = r.buffs;
    this.fxChanged();
    this.game.heroes.saveBuffs(this.hero);
    this.send({ t: 'buffs', buffs: r.buffs });
    for (const id of r.ended) this.send({ t: 'toast', text: `Your ${ITEMS[id]?.name ?? BOONS[id]?.name ?? 'buff'} wore off.` });
  }
  // A blessing from the world (Festive, a shrine's blessing): the boon slot.
  giveBoon(id) {
    const b = applyBoon(this.hero.buffs, id);
    if (!b) return;
    this.hero.buffs = b;
    this.fxChanged();
    this.game.heroes.saveBuffs(this.hero);
    this.send({ t: 'buffs', buffs: b });
    this.syncSpeed();
  }
  // Walk speed out of battle (a charm or a travel buff).
  syncSpeed() {
    const mul = 1 + (this.effects().moveSpeed || 0);
    if (mul !== this.ent.speedMul) this.setSpeed(mul);
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
    return { ...this.publicInfo(), admin: this.game.auth.isAdmin(this.hero.id), gold: this.game.heroes.gold(this.hero.id), skills: this.hero.skills, inv: this.game.heroes.inventory(this.hero.id), hp: Math.round(this.ent.hp), maxHp: this.ent.maxHp, stats: this.stats(), tutorial: this.hero.tutorial, speedMul: this.ent.speedMul, home: this.hero.home, charm: this.hero.equip.charm ?? null, title: this.hero.title, perks: this.hero.perks, buffs: this.hero.buffs, stones: this.hero.stones.filter((id) => stoneById(id)), quests: this.game.quests.list(this), shop: { till: shop?.till || 0, open: shop ? !!shop.open : true }, craft: this.game.crafting.publicState(this) };
  }

  pushInventory() {
    const H = this.game.heroes;
    const st = this.stats();
    this.ent.maxHp = st.hp;
    this.send({ t: 'me', gold: H.gold(this.hero.id), inv: H.inventory(this.hero.id), skills: this.hero.skills, level: this.hero.level, equip: this.hero.equip, stats: st, hp: Math.round(this.ent.hp), maxHp: st.hp });
  }

  // Standing at a waystone you haven't been to: attune to it (server/travel.js).
  attuneNearby() {
    attuneNearby(this);
  }
}

// ─────────────────────────────────────────────────────────────────────────
export class Game {
  // opts.shopSim = false turns off the shop simulation timer (tests drive it by hand).
  // opts.wilds = false: nodes regrow plain (shared/wilds.js variants off); it's
  // off under the test runner, so tests see the nodes they expect.
  constructor(db, opts = {}) {
    this.db = db;
    this.opts = { shopSim: true, wilds: !process.env.NODE_TEST_CONTEXT, ...opts };
    this.heroes = new Heroes(db);
    this.market = new Market(db, this.heroes);
    this.shops = new Shops(db, this.heroes);
    this.crafting = new Crafting(this);
    this.jobs = new Jobs(db, this.heroes);
    this.merchant = new Merchant(db, this.heroes);
    rep.useDb(db);
    this.quests = new Quests(this);
    this.orders = new Orders(this);
    this.almanac = new Almanac(this);
    this.notices = new Notices(this);
    this.journal = new Journal(this);
    this.explore = new Explore(this);
    this.landmarks = new Landmarks(this);
    this.digest = new Digest(this);
    this.engage = new Engage(this);
    // Festive and Hearth Rest add to every xp grant.
    this.heroes.xpBonus = (hero, skill, amount) => {
      const c = this.online.get(hero.id);
      return Math.round(amount * (c?.effects().xpPct || 0)) + this.heroes.restTake(hero, amount);
    };
    // Every xp grant, as an event for whoever earned it (quests, level-up unlocks).
    this.heroes.onXp = (hero, xp) => {
      const c = this.online.get(hero.id);
      if (c) emit(c, 'xp', xp);
    };
    // The owner's economy knobs (SPEC §6.5), read through knob().
    try {
      setOverrides(JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'econ_overrides'").get()?.value ?? '{}'));
    } catch {
      setOverrides({});
    }
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
  // Bulletin board jobs past their time (server/trade.js).
  expireJobs(now = Date.now()) {
    expireJobs(this, now);
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
        if (run.expired(now)) this.closeRun(run, run.closeText);
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
      this.explore.save(c);
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
    resetJournalCache();
    landmarksChanged();
    this.explore.worldChanged();
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

  connect(ws, accountId, opts = {}) {
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
    const c = new Client(this, ws, hero, opts);
    this.online.set(accountId, c);
    this.quests.load(c);
    const leftover = this.crafting.onConnect(c);
    // Dropped out of a dungeon a moment ago? Back into the same run.
    const seat = [...this.runs.values()].map((run) => [run, run.seatFor(accountId)]).find(([, m]) => m);
    if (seat) seat[0].enter(c, seat[1]);
    else this.pickChannel().add(c);
    c.syncSpeed(); // a charm or buff that quickens your step
    this.parties.online(c);
    if (leftover) {
      c.send({ t: 'craftResult', ...leftover });
      c.pushInventory();
    }
    const lastSeen = this.lastActive.get(accountId);
    const digestDue = lastSeen != null && Date.now() - lastSeen >= DIGEST_AFTER_MS;
    const away = this.shops.awaySummary(accountId, Date.now(), lastSeen);
    if (away && !digestDue) c.send({ t: 'awaySales', ...away }); // (after 12 h the digest says it)
    this.digest.onConnect(c, lastSeen != null ? Date.now() - lastSeen : 0);
    if (!digestDue) this.notices.showWaiting(c); // (after 12 h the digest lists them)
    pushStorage(this, c); // goods waiting in storage, per town
    this.explore.load(c); // the cells walked and places found
    this.engage.onConnect(c);
    this.quests.ensure(c); // a new hero's first quest, and any chain that has opened up
    this.almanac.ensure(c); // today's dailies and this week's errand
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
    this.explore.save(c);
    this.engage.onDisconnect(c);
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
  // Why a hero can't go into a tier, or null. Tiers 2–3 and Deep open as the
  // one before is cleared; the week's Nightmare needs Tier 3 and Combat 40.
  tierLock(heroId, kind, tier, now = Date.now()) {
    if (tier === NIGHTMARE) {
      if (nightmareKind(now) !== kind) return `This week's Nightmare is in ${DUNGEONS[nightmareKind(now)]?.name ?? 'another dungeon'}.`;
      if (this.bestTier(heroId, kind) < 3) return `Clear ${TIERS[3].name} first.`;
      const h = this.online.get(heroId)?.hero ?? this.heroes.load(heroId);
      if (levelFromXp(h?.skills?.combat || 0) < NIGHTMARE_COMBAT) return `The Nightmare needs Combat ${NIGHTMARE_COMBAT}.`;
      return null;
    }
    if (tier > 1 && this.bestTier(heroId, kind) < tier - 1) return `Clear ${TIERS[tier - 1].name} first.`;
    return null;
  }
  #checkEntry(c, kind, tier, mode) {
    if (!DUNGEONS[kind]) fail('No such dungeon.');
    if (!TIERS[tier]) fail('No such tier.');
    if (mode !== 'random' && mode !== 'weekly') fail('Bad mode.');
    this.#notBusy(c);
    if (!ENTRANCES.some((e) => e.kind === kind && Math.hypot(c.ent.x - e.x, c.ent.z - e.z) <= ENTRANCE_RANGE + 4)) fail(`Walk up to the ${word(kind)} door first.`);
    const lock = this.tierLock(c.hero.id, kind, tier);
    if (lock) fail(lock);
    if (Date.now() - (c.lastRunAt || 0) < ENTER_COOLDOWN_MS) fail('Catch your breath a moment first.');
    if ([...this.runs.values()].filter((r) => !r.ended).length >= MAX_RUNS) fail(`The ${word(kind)} is crowded right now. Try again in a minute.`);
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
      if (o && this.tierLock(id, kind, tier)) fail(`${o.hero.name} can't go in yet: ${this.tierLock(id, kind, tier)}`);
    }
    p.ready = { kind, tier, mode, leader: c.hero.id, yes: new Set([c.hero.id]), no: new Set(), asked: new Set(p.members.filter((id) => this.online.has(id))), until: Date.now() + READY_MS };
    for (const id of p.members) if (id !== c.hero.id) this.online.get(id)?.send({ t: 'dready', from: c.hero.name, kind, tier, mode, expiresIn: READY_MS });
    this.parties.push(p);
    this.#checkReady(p);
    return { ready: true, expiresIn: READY_MS };
  }
  #tierOk(heroId, kind, tier) {
    return !this.tierLock(heroId, kind, tier);
  }
  readyAnswer(c, yes) {
    const p = this.parties.get(c.hero.id);
    if (!p?.ready) fail('There is no ready check right now.');
    if (yes) {
      this.#notBusy(c);
      if (!this.#tierOk(c.hero.id, p.ready.kind, p.ready.tier)) fail(this.tierLock(c.hero.id, p.ready.kind, p.ready.tier));
      p.ready.yes.add(c.hero.id);
    } else p.ready.no.add(c.hero.id);
    this.#checkReady(p);
    return { ok: true };
  }
  // When everyone online has answered (or time's up), in they go.
  #checkReady(p, now = Date.now()) {
    const R = p.ready;
    if (!R) return;
    // Wait only for those it asked who are still here and in the party.
    const online = p.members.filter((id) => this.online.has(id));
    const answered = [...R.asked].filter((id) => online.includes(id)).every((id) => R.yes.has(id) || R.no.has(id));
    if (!answered && now < R.until) return;
    p.ready = null;
    const leader = this.online.get(R.leader);
    const going = [...R.yes].map((id) => this.online.get(id)).filter((o) => o && p.members.includes(o.hero.id) && !o.battle && !o.room && !o.craft && !o.ch?.isRun && this.#tierOk(o.hero.id, R.kind, R.tier));
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
    if (!this.#tierOk(c.hero.id, run.kind, run.tier)) fail(this.tierLock(c.hero.id, run.kind, run.tier));
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
  // (The next tick closes it: an ended run does nothing more meanwhile.)
  failRun(run) {
    run.ended = true;
    run.closeText = `The dead of ${run.def.name} have had enough of you. You keep what you found; the chests stay shut.`;
  }
  closeRun(run, text = `${run.def.name} closes behind you.`) {
    run.ended = true;
    for (const c of [...run.players.values()]) {
      // Out of any fight properly (health carried over, battle screens closed).
      c.battle?.leave(c, 'closed');
      const m = run.depart(c);
      c.send({ t: 'toast', kind: 'err', text });
      this.#outOfRun(c, run, m);
    }
    this.runs.delete(run.id);
    const p = run.partyId && this.parties.parties.get(run.partyId);
    if (p) this.parties.push(p);
  }
  // The day's first clear of a kind pays the bonus (once per hero and kind per day, any tier).
  firstClearToday(heroId, kind, now = Date.now()) {
    return this.db.prepare('SELECT MAX(day) AS day FROM dungeon_daily WHERE account_id = ? AND kind = ?').get(heroId, kind)?.day !== dayIndex(now);
  }
  endAllRuns() {
    for (const run of [...this.runs.values()]) this.closeRun(run, `The ${word(run.kind)} is being rebuilt. Back to the surface!`);
  }
  dungeonInfo(c, kind) {
    const K = DUNGEONS[kind];
    if (!K) fail('No such dungeon.');
    const now = Date.now();
    const db = this.db;
    const firstToday = this.firstClearToday(c.hero.id, kind, now);
    // The Nightmare shows only in the week it's here.
    const tiers = Object.keys(TIERS).map(Number).filter((t) => t !== NIGHTMARE || nightmareKind(now) === kind);
    const tierRows = tiers.map((t) => ({
      tier: t,
      ...TIERS[t],
      rec: recFor(kind, t),
      unlocked: !this.tierLock(c.hero.id, kind, t, now),
      lock: this.tierLock(c.hero.id, kind, t, now),
      best: db.prepare("SELECT party, MIN(seconds) AS seconds FROM dungeon_runs WHERE kind = ? AND tier = ? AND mode = 'random' GROUP BY party").all(kind, t),
      weekly: db.prepare("SELECT party, heroes, seconds FROM dungeon_runs WHERE kind = ? AND tier = ? AND mode = 'weekly' AND week = ? ORDER BY seconds LIMIT 5").all(kind, t, weekIndex(now)).map((r) => ({ ...r, heroes: JSON.parse(r.heroes) })),
      firstToday,
    }));
    const p = this.parties.get(c.hero.id);
    const run = p ? this.runForParty(p.id) : null;
    const mod = modifierFor(now);
    return {
      kind,
      name: K.name,
      word: word(kind),
      blurb: K.blurb,
      tiers: tierRows,
      featured: featuredKind(now) === kind,
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
      if (c.ch?.isRun && !RUN_OK.has(m.t) && !(m.t === 'rpc' && allowedInRun(String(m.m)))) fail(`Not inside the ${word(c.ch.kind)}.`);
      const res = h(this, c, m, now);
      if (m.rid) c.send({ t: 'res', rid: m.rid, ok: true, data: res ?? null });
    } catch (e) {
      const msg = e instanceof GameError ? e.message : 'Something went wrong.';
      if (!(e instanceof GameError)) console.error('handler error', m.t, e);
      if (m.rid) c.send({ t: 'res', rid: m.rid, ok: false, err: msg });
      else c.send({ t: 'toast', kind: 'err', text: msg });
    }
  }

}

// ── Message handlers ───────────────────────────────────────────────────
const HANDLERS = {
  ping: (g, c, m) => c.send({ t: 'pong', c: m.c, s: Date.now() }),

  move: onMove,
  ...GATHER_HANDLERS,

  engage(g, c, m) {
    if (c.room) fail("You're inside a shop.");
    if (c.craft) fail('Finish your craft first.');
    const mob = c.ch.mobs.get(String(m.mob));
    if (!mob || mob.state === 'dead') fail('It ran off.');
    if (c.battle) fail('Already fighting!');
    if (dist(c.ent, mob) > 6) fail('Get closer first.');
    if (c.ch.isRun && c.ch.ended) fail(`The ${word(c.ch.kind)} is closing.`);
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

  rpc: (g, c, m) => dispatch(g, c, String(m.m), m.a),
};

const RUN_OK = new Set(['ping', 'move', 'engage', 'bact', 'chat', 'emote']);
// The hub's own RPCs: shops, the town hall, dungeons and parties. (Feature
// modules register theirs in their own files: trade.js, travel.js, gear.js,
// crafting.js, tutorial.js.)
const RPC = {
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
    emit(c, 'stock', { slot: s.slot, item: s.item, qty: s.qty });
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
  // Move your shop to the town you're standing in (its customers come from there).
  'shop.move'(g, c, a) {
    const town = needTown(g, c, typeof a.town === 'string' && a.town ? a.town : null);
    const r = g.shops.move(c.hero.id, town);
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
};

// Allowed inside a dungeon run: everything about dungeons and parties, and
// things that make sense from anywhere.
const IN_RUN = new Set(['town.info', 'invite.create', 'shop.state', 'shop.ledger', 'shop.collect', 'shop.ack', 'shop.directory']);
for (const [name, fn] of Object.entries(RPC)) register(name, fn, { inRun: IN_RUN.has(name) || /^(dungeon|party)\./.test(name) });
