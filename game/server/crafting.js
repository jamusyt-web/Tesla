import crypto from 'node:crypto';
import { ITEMS } from '../shared/items.js';
import { RECIPE_BY_ID } from '../shared/recipes.js';
import { levelFromXp } from '../shared/skills.js';
import { buildSpec, replayCraft, finalizeCraft, scoreOf, isFlawless, outcomeOf, batchCap, isStackable, CRAFT_TICK, CRAFT_MAX_TICKS, STATIONS } from '../shared/crafting.js';
import { spotsOf, inYard, nearestStation } from '../shared/stations.js';
import { townAt } from '../shared/places.js';
import { REGIONS } from '../shared/world.js';
import { tx, fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';

const SESSION_MS = 150_000; // a craft not finished by then settles as-is
const CANCEL_MS = 1500; // you can back out only right at the start
const QUICK_FEE = 0.04;
const QUICK_UNLOCK = 3; // hands-on sessions graded B or better before Quick unlocks

// Hands-on crafting, server side. A craft takes the materials into escrow,
// stores the step list it gave the client, and later replays the client's
// recorded inputs to grade it (shared/crafting.js). Only #settle grants
// anything, and only once per session.
export class Crafting {
  constructor(game, { rng = Math.random } = {}) {
    this.game = game;
    this.db = game.db;
    this.rng = rng;
    const p = (sql) => this.db.prepare(sql);
    this.q = {
      get: p('SELECT * FROM craft_sessions WHERE account_id = ?'),
      all: p('SELECT * FROM craft_sessions'),
      insert: p('INSERT INTO craft_sessions (account_id, sid, recipe, batch, station, spec, escrow, started_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)'),
      del: p('DELETE FROM craft_sessions WHERE account_id = ? AND sid = ?'),
      log: p('INSERT INTO craft_log (account_id, sid, recipe, batch, score, grade, item, qty, via, result, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)'),
      logged: p('SELECT result FROM craft_log WHERE account_id = ? AND sid = ?'),
      prune: p('DELETE FROM craft_log WHERE ts < ?'),
      mastery: p('SELECT recipe, n, best FROM craft_mastery WHERE account_id = ?'),
      masteryOne: p('SELECT n, best FROM craft_mastery WHERE account_id = ? AND recipe = ?'),
      masteryUp: p('INSERT INTO craft_mastery (account_id, recipe, n, best) VALUES (?,?,?,?) ON CONFLICT(account_id, recipe) DO UPDATE SET n = n + excluded.n, best = MAX(best, excluded.best)'),
    };
    // A restart interrupts every craft in progress: give the materials back.
    for (const row of this.q.all.all())
      tx(this.db, () => {
        for (const [id, n] of Object.entries(JSON.parse(row.escrow))) if (ITEMS[id]) this.game.heroes.addItem(row.account_id, id, n);
        this.q.del.run(row.account_id, row.sid);
        this.q.log.run(row.account_id, row.sid, row.recipe, row.batch, 0, '-', '-', 0, 'refunded', JSON.stringify({ refunded: true, sid: row.sid }), Date.now());
      });
    this.q.prune.run(Date.now() - 30 * 86_400_000);
  }

  #level(c) {
    return levelFromXp(c.hero.skills.crafting || 0);
  }

  // Which work spot at the nearest station of a kind is free (two main
  // spots, then the shared overflow). Spots are claimed per station prop, so
  // each town's anvil has its own.
  #claimSpot(c, kind) {
    const ch = c.ch;
    const prop = nearestStation(kind, c.ent.x, c.ent.z);
    if (!prop) fail(`There's no ${STATIONS[kind]?.label ?? kind} here.`);
    ch.spots ??= new Map();
    if (!ch.spots.has(prop.id)) ch.spots.set(prop.id, [null, null]);
    const taken = ch.spots.get(prop.id);
    const spots = spotsOf(prop);
    const free = [0, 1].filter((i) => !taken[i] || taken[i] === c.hero.id || !ch.players.has(taken[i]));
    const near = (i) => Math.hypot(spots[i].x - c.ent.x, spots[i].z - c.ent.z);
    const i = free.length ? free.sort((a, b) => near(a) - near(b))[0] : 2;
    if (i < 2) taken[i] = c.hero.id;
    return { ...spots[i], prop: prop.id };
  }
  releaseSpot(c, prop = c.craft?.spot?.prop) {
    const taken = prop && c.ch?.spots?.get(prop);
    if (taken) for (let i = 0; i < 2; i++) if (taken[i] === c.hero.id) taken[i] = null;
  }

  info(c) {
    const mastery = {};
    for (const r of this.q.mastery.all(c.hero.id)) mastery[r.recipe] = { n: r.n, best: r.best, quick: r.n >= QUICK_UNLOCK };
    const occupancy = {};
    for (const st of Object.keys(STATIONS)) {
      const taken = c.ch?.spots?.get(nearestStation(st, c.ent.x, c.ent.z)?.id) || [null, null];
      occupancy[st] = taken.map((id) => (id && c.ch.players.has(id) ? id : null));
    }
    return { mastery, occupancy, level: this.#level(c) };
  }

  start(c, { recipe, batch = 1 } = {}, now = Date.now()) {
    const r = RECIPE_BY_ID[recipe];
    if (!r) fail('Unknown recipe.');
    const lvl = this.#level(c);
    if (lvl < r.lvl) fail(`Requires Crafting level ${r.lvl}.`);
    // A town's own recipes are made only in its yard.
    if (r.town && townAt(c.ent.x, c.ent.z)?.id !== r.town) fail(`${ITEMS[r.out]?.name ?? 'That'} can only be made in ${REGIONS.find((t) => t.id === r.town)?.name ?? r.town}.`);
    if (c.craft) fail("You're already crafting.");
    if (c.battle) fail("You're in a battle!");
    if (c.room) fail("You're inside a shop.");
    batch = Number(batch);
    if (!Number.isInteger(batch) || batch < 1 || batch > batchCap(r, lvl)) fail('Bad batch size.');
    const H = this.game.heroes;
    const escrow = Object.fromEntries(Object.entries(r.in).map(([id, n]) => [id, n * batch]));
    for (const [id, n] of Object.entries(escrow)) if (H.count(c.hero.id, id) < n) fail(`Not enough ${ITEMS[id].name}.`);
    const spot = this.#claimSpot(c, r.station);
    if (Math.hypot(spot.x - c.ent.x, spot.z - c.ent.z) > 3.5) {
      this.releaseSpot(c, spot.prop);
      fail(`Walk up to the ${STATIONS[r.station].label} first.`);
    }
    const sid = crypto.randomBytes(6).toString('base64url');
    const spec = buildSpec(r, { lvl, batch, seed: crypto.randomInt(2 ** 31), sid });
    tx(this.db, () => {
      for (const [id, n] of Object.entries(escrow)) H.takeItem(c.hero.id, id, n);
      this.q.insert.run(c.hero.id, sid, r.id, batch, r.station, JSON.stringify(spec), JSON.stringify(escrow), now, now + SESSION_MS);
    });
    c.cancelFishing();
    const e = c.ent;
    e.path = [[spot.x, spot.z]];
    e.act = 'craft';
    c.craft = { sid, recipe: r.id, batch, station: r.station, spot, spec, escrow, startedAt: now, expiresAt: now + SESSION_MS };
    c.ch.broadcast({ t: 'craftStart', by: c.hero.id, station: r.station, spot, recipe: r.id, item: r.out }, c);
    c.pushInventory();
    return { sid, spec, station: r.station, spot, escrow };
  }

  finish(c, { sid, toggles, end, off, stop } = {}, now = Date.now()) {
    const cr = c.craft;
    if (!cr || cr.sid !== sid) {
      const done = this.q.logged.get(c.hero.id, String(sid));
      if (done) return JSON.parse(done.result); // a retried finish: same answer, nothing granted twice
      fail('That craft already ended.');
    }
    let tog = Array.isArray(toggles) ? toggles : null;
    end = Number(end);
    let ok = tog && tog.length <= 400 && Number.isInteger(end) && end >= 0 && end <= CRAFT_MAX_TICKS;
    if (ok) for (let i = 0; i < tog.length; i++) if (!Number.isInteger(tog[i]) || tog[i] < 0 || tog[i] > end || (i && tog[i] <= tog[i - 1])) ok = false;
    // Can't have played it faster than real time (same floor as fishing).
    const tooFast = ok && now - cr.startedAt < ((end * CRAFT_TICK) * 0.85) - 400;
    const o = Array.isArray(off) ? off.map((v) => Math.max(0, Math.min(8, Math.round(Number(v) || 0)))) : [0, 0];
    if (!ok || tooFast) {
      tog = [];
      end = CRAFT_MAX_TICKS;
    }
    const s = finalizeCraft(replayCraft(cr.spec, tog, end, [o[0] ?? 0, o[1] ?? 0]));
    return this.#settle(c, s, !ok || tooFast ? 'suspect' : stop ? 'stop' : 'play');
  }

  cancel(c, { sid } = {}, now = Date.now()) {
    const cr = c.craft;
    if (!cr || cr.sid !== sid) fail('That craft already ended.');
    if (now - cr.startedAt > CANCEL_MS) fail('Too late to stop now — finish it as it is.');
    tx(this.db, () => {
      if (this.q.del.run(c.hero.id, cr.sid).changes !== 1) fail('That craft already ended.');
      for (const [id, n] of Object.entries(cr.escrow)) this.game.heroes.addItem(c.hero.id, id, n);
    });
    this.#clear(c);
    c.ch.broadcast({ t: 'craftEnd', by: c.hero.id });
    c.pushInventory();
    return { refunded: cr.escrow };
  }

  // Ran out of time (tab asleep, wandered off): finish as-is.
  expire(c, now = Date.now()) {
    if (!c.craft || now <= c.craft.expiresAt) return;
    const s = finalizeCraft(replayCraft(c.craft.spec, [], CRAFT_MAX_TICKS));
    const res = this.#settle(c, s, 'timeout');
    c.send({ t: 'craftResult', ...res, reason: 'timeout' });
  }

  // Logging back in with a craft still in progress. A dropped connection on
  // the same tab carries on (the client still has its inputs); a reloaded tab
  // or another device can only "finish as-is". One that ran out of time while
  // you were gone is settled now.
  onConnect(c, now = Date.now()) {
    const row = this.q.get.get(c.hero.id);
    if (!row) return null;
    const spec = JSON.parse(row.spec);
    c.craft = { sid: row.sid, recipe: row.recipe, batch: row.batch, station: row.station, spot: null, spec, escrow: JSON.parse(row.escrow), startedAt: row.started_at, expiresAt: row.expires_at };
    if (now <= row.expires_at) return null;
    const s = finalizeCraft(replayCraft(spec, [], CRAFT_MAX_TICKS));
    return { ...this.#settle(c, s, 'offline', { quiet: true }), reason: 'offline' };
  }
  // Back in a channel with a live craft: take a work spot again.
  attach(c) {
    if (!c.craft || c.craft.spot) return;
    c.craft.spot = this.#claimSpot(c, c.craft.station);
    c.ent.act = 'craft';
  }
  publicState(c) {
    const cr = c.craft;
    return cr ? { sid: cr.sid, recipe: cr.recipe, batch: cr.batch, station: cr.station, spot: cr.spot, spec: cr.spec, escrow: cr.escrow, ageMs: Date.now() - cr.startedAt } : null;
  }

  #settle(c, s, via, { quiet = false } = {}) {
    const cr = c.craft;
    const r = RECIPE_BY_ID[cr.recipe];
    const H = this.game.heroes;
    const score = scoreOf(s);
    const flawless = isFlawless(s);
    const lvl = this.#level(c);
    if (!r) {
      // The recipe was removed in an update: give everything back.
      tx(this.db, () => {
        if (this.q.del.run(c.hero.id, cr.sid).changes !== 1) return;
        for (const [id, n] of Object.entries(cr.escrow)) if (ITEMS[id]) H.addItem(c.hero.id, id, n);
      });
      this.#clear(c);
      return { sid: cr.sid, refunded: cr.escrow, via };
    }
    const out = outcomeOf({ r, batch: cr.batch, score, flawless, over: lvl - r.lvl }, this.rng);
    const result = { sid: cr.sid, recipe: r.id, grade: out.grade, score, flawless, steps: s.res, out, via };
    const granted = tx(this.db, () => {
      if (this.q.del.run(c.hero.id, cr.sid).changes !== 1) return false;
      H.addItem(c.hero.id, out.item, out.qty, 'craft');
      this.q.log.run(c.hero.id, cr.sid, r.id, cr.batch, score, out.grade, out.item, out.qty, via, JSON.stringify(result), Date.now());
      return true;
    });
    if (!granted) {
      this.#clear(c);
      const done = this.q.logged.get(c.hero.id, cr.sid);
      return done ? JSON.parse(done.result) : result;
    }
    result.xp = H.addXp(c.hero, 'crafting', Math.round(r.xp * cr.batch * out.xpMult));
    if (via === 'play' || via === 'stop') this.q.masteryUp.run(c.hero.id, r.id, ['S', 'A', 'B'].includes(out.grade) ? 1 : 0, score);
    const m = this.q.masteryOne.get(c.hero.id, r.id);
    result.mastery = { n: m?.n || 0, best: m?.best || 0, quick: isStackable(r) && (m?.n || 0) >= QUICK_UNLOCK };
    // Patch the stored copy so a retried finish sees XP and mastery too.
    this.db.prepare('UPDATE craft_log SET result = ? WHERE account_id = ? AND sid = ?').run(JSON.stringify(result), c.hero.id, cr.sid);
    const station = cr.station;
    this.#clear(c);
    if (!quiet && c.ch) c.ch.broadcast({ t: 'crafted', by: c.hero.id, station, item: out.item, qty: out.qty, grade: out.grade, mw: out.mw });
    if (out.mw) this.game.announce(`🔨 ${c.hero.name} forged a ${ITEMS[out.item].name}!`);
    if (!quiet) c.pushInventory();
    emit(c, 'craft', { recipe: r.id, out: r.out, item: out.item, qty: out.qty, grade: out.grade, via });
    return result;
  }

  #clear(c) {
    this.releaseSpot(c);
    c.craft = null;
    if (c.ent.act === 'craft') c.ent.act = 'idle';
  }

  // Once you've mastered a refining or cooking recipe, batch it without the
  // minigame: plain yield, half XP, a small fee. Anywhere in the Workshop yard.
  quick(c, { recipe, times = 1 } = {}) {
    const r = RECIPE_BY_ID[recipe];
    if (!r) fail('Unknown recipe.');
    if (!isStackable(r)) fail('Tools and gear are always made by hand.');
    if (c.craft) fail("You're already crafting.");
    const lvl = this.#level(c);
    if (lvl < r.lvl) fail(`Requires Crafting level ${r.lvl}.`);
    if ((this.q.masteryOne.get(c.hero.id, r.id)?.n || 0) < QUICK_UNLOCK) fail(`Make it by hand ${QUICK_UNLOCK} times (grade B or better) to unlock Quick.`);
    if (!inYard(c.ent.x, c.ent.z)) fail('Quick crafting works in the Workshop yard.');
    times = Math.max(1, Math.min(50, Number(times) || 1));
    const H = this.game.heroes;
    const fee = Math.ceil(QUICK_FEE * r.qty * times * ITEMS[r.out].value);
    tx(this.db, () => {
      for (const [id, n] of Object.entries(r.in)) H.takeItem(c.hero.id, id, n * times);
      H.addGold(c.hero.id, -fee, 'craftFee');
      H.addItem(c.hero.id, r.out, r.qty * times, 'craft');
    });
    const xp = H.addXp(c.hero, 'crafting', Math.round(r.xp * times * 0.5));
    c.pushInventory();
    emit(c, 'craft', { recipe: r.id, out: r.out, item: r.out, qty: r.qty * times, grade: null, via: 'quick' });
    return { item: r.out, qty: r.qty * times, fee, xp };
  }
}

register('craft', () => fail('Crafting is hands-on now — pick a recipe and head to its station!'));
register('craft.info', (g, c) => g.crafting.info(c), { inRun: true });
register('craft.start', (g, c, a) => g.crafting.start(c, a));
register('craft.finish', (g, c, a) => g.crafting.finish(c, a));
register('craft.cancel', (g, c, a) => g.crafting.cancel(c, a));
register('craft.quick', (g, c, a) => g.crafting.quick(c, a));
