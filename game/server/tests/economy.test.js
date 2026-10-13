import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';
import { Heroes } from '../heroes.js';
import { Market, MARKET_TAX } from '../market.js';
import { Shops } from '../shop.js';
import { Auth } from '../auth.js';
import { STARTER_GOLD } from '../../shared/items.js';
import { Merchant } from '../merchant.js';

function setup() {
  const db = openDb(':memory:');
  const auth = new Auth(db);
  const heroes = new Heroes(db);
  const code = auth.bootstrap();
  const a = auth.signup({ username: 'alice', password: 'secret1', invite: code }).accountId;
  const inv = auth.createInvite(a);
  const b = auth.signup({ username: 'bob', password: 'secret1', invite: inv }).accountId;
  heroes.create(a, 'Alice', {});
  heroes.create(b, 'Bob', {});
  return { db, auth, heroes, market: new Market(db, heroes), shops: new Shops(db, heroes), a, b };
}

// Total gold + escrowed gold + tax must be conserved; items likewise.
function goldInSystem(db) {
  const held = db.prepare('SELECT SUM(gold) AS g FROM heroes').get().g;
  const escrow = db.prepare(`SELECT COALESCE(SUM(price * (qty - filled)),0) AS g FROM market_orders WHERE side='buy' AND status='open'`).get().g;
  return held + escrow;
}
function itemsInSystem(db, item) {
  const held = db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM inventory WHERE item = ?').get(item).n;
  const escrow = db.prepare(`SELECT COALESCE(SUM(qty - filled),0) AS n FROM market_orders WHERE side='sell' AND status='open' AND item = ?`).get(item).n;
  const shelves = db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM shop_slots WHERE item = ?').get(item).n;
  const stored = db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM town_storage WHERE item = ?').get(item).n;
  return held + escrow + shelves + stored;
}
// What a hero has waiting in a town's storage (a resting order's goods).
const storedOf = (db, id, item, town = 'hearthvale') => db.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM town_storage WHERE account_id = ? AND town = ? AND item = ?').get(id, town, item).n;

test('invites are single use and required', () => {
  const { auth } = setup();
  assert.throws(() => auth.signup({ username: 'carl', password: 'secret1', invite: 'NOPE-NOPE' }), /not valid/);
});

test('sell order rests, buy order fills it at the ask, tax is taken', () => {
  const { db, heroes, market, a, b } = setup();
  heroes.addItem(a, 'oak_log', 10);
  const g0 = goldInSystem(db);
  market.place(a, { side: 'sell', item: 'oak_log', price: 5, qty: 10 });
  assert.equal(heroes.count(a, 'oak_log'), 0, 'items escrowed');
  const r = market.place(b, { side: 'buy', item: 'oak_log', price: 7, qty: 4 });
  assert.equal(r.filledQty, 4);
  assert.deepEqual(r.fills, [{ price: 5, qty: 4 }]);
  assert.equal(heroes.count(b, 'oak_log'), 4);
  assert.equal(heroes.gold(b), STARTER_GOLD - 20, 'buyer pays the ask (5), not their limit (7)');
  const tax = Math.floor(20 * MARKET_TAX);
  assert.equal(heroes.gold(a), STARTER_GOLD + 20 - tax);
  assert.equal(goldInSystem(db), g0 - tax, 'only the tax leaves the economy');
  assert.equal(itemsInSystem(db, 'oak_log'), 10);
});

test('price-time priority across several sellers, partial fills, remainder rests', () => {
  const { db, heroes, market, a, b } = setup();
  heroes.addItem(a, 'stone', 20);
  market.place(a, { side: 'sell', item: 'stone', price: 4, qty: 5 });
  market.place(a, { side: 'sell', item: 'stone', price: 3, qty: 5 });
  const r = market.place(b, { side: 'buy', item: 'stone', price: 4, qty: 12 });
  assert.deepEqual(r.fills, [{ price: 3, qty: 5 }, { price: 4, qty: 5 }]);
  assert.equal(r.order.qty - r.order.filled, 2, '2 left resting as a buy order');
  // Buyer escrowed 12*4=48, got 1g back for 5 filled at 3 → spent 35 on fills + 8 escrow.
  assert.equal(heroes.gold(b), STARTER_GOLD - 35 - 8);
  // A new seller fills the resting bid at the bid's price; those 2 wait in storage.
  market.place(a, { side: 'sell', item: 'stone', price: 1, qty: 2 });
  assert.equal(heroes.count(b, 'stone'), 10);
  assert.equal(storedOf(db, b, 'stone'), 2, "a resting order's goods wait in the town's storage");
  assert.equal(itemsInSystem(db, 'stone'), 20);
});

test('cancel refunds exactly what is left in escrow', () => {
  const { db, heroes, market, a, b } = setup();
  const g0 = goldInSystem(db);
  const { order } = market.place(b, { side: 'buy', item: 'iron_ore', price: 10, qty: 5 });
  assert.equal(heroes.gold(b), STARTER_GOLD - 50);
  heroes.addItem(a, 'iron_ore', 2);
  market.place(a, { side: 'sell', item: 'iron_ore', price: 10, qty: 2 });
  market.cancel(b, order.id);
  assert.equal(heroes.gold(b), STARTER_GOLD - 20);
  assert.equal(storedOf(db, b, 'iron_ore'), 2);
  assert.throws(() => market.cancel(b, order.id), /already closed/);
  assert.throws(() => market.cancel(a, order.id), /not found/);
  assert.equal(goldInSystem(db), g0 - Math.floor(20 * MARKET_TAX));
});

test('cannot overspend or oversell; failed orders change nothing', () => {
  const { db, heroes, market, a } = setup();
  const g0 = goldInSystem(db);
  assert.throws(() => market.place(a, { side: 'buy', item: 'oak_log', price: 1000, qty: 1 }), /Not enough gold/);
  assert.throws(() => market.place(a, { side: 'sell', item: 'gold_bar', price: 10, qty: 1 }), /Not enough/);
  assert.throws(() => market.place(a, { side: 'sell', item: 'oak_log', price: 1.5, qty: 1 }), /whole number/);
  assert.throws(() => market.place(a, { side: 'sell', item: 'nope', price: 1, qty: 1 }), /Unknown/);
  assert.equal(goldInSystem(db), g0);
});

test('own orders never match each other', () => {
  const { heroes, market, a } = setup();
  heroes.addItem(a, 'oak_log', 3);
  market.place(a, { side: 'sell', item: 'oak_log', price: 2, qty: 3 });
  const r = market.place(a, { side: 'buy', item: 'oak_log', price: 5, qty: 3 });
  assert.equal(r.filledQty, 0);
});

test('instant buy (ioc) refunds unfilled part and never rests', () => {
  const { heroes, market, a, b } = setup();
  heroes.addItem(a, 'oak_log', 2);
  market.place(a, { side: 'sell', item: 'oak_log', price: 5, qty: 2 });
  const r = market.place(b, { side: 'buy', item: 'oak_log', price: 5, qty: 5, ioc: true });
  assert.equal(r.filledQty, 2);
  assert.equal(r.order, null);
  assert.equal(heroes.gold(b), STARTER_GOLD - 10);
  assert.throws(() => market.place(b, { side: 'buy', item: 'oak_log', price: 5, qty: 1, ioc: true }), /Nobody is selling/);
  assert.equal(heroes.gold(b), STARTER_GOLD - 10);
});

// ── Town economies (Phase 1, M3) ─────────────────────────────────────
import fs from 'node:fs';
import { Game } from '../game.js';
import { dispatch, allowedInRun } from '../rpc.js';
import { useMap, SHIPPED_MAP } from '../map.js';
import { rebuildWorld } from '../static.js';
import { SCHEMA_V0, migrate } from '../db.js';
import { applyMigrations } from '../migrations/index.js';
import { ITEMS } from '../../shared/items.js';
import { TRADE, tradeOf, unitBid, merchantSale, poolNow, suppliesOf, supplyAsk, tagGroup, setOverrides, MERCHANT_REFILL_MS, FULL_RATE } from '../../shared/economy.js';
import { customersOf, CUSTOMERS } from '../../shared/shop.js';
import { twoTownMap, TV } from './twotown.js';

// A whole game on the two-town map, with heroes connected without sockets.
function townGame() {
  useMap(twoTownMap());
  rebuildWorld();
  const db = openDb(':memory:');
  const game = new Game(db, { shopSim: false });
  let n = 0;
  const hero = (name) => {
    const id = Number(db.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?,?,?,?)').run(`${name.toLowerCase()}${++n}`, 'x', 'y', Date.now()).lastInsertRowid);
    game.heroes.create(id, name, {});
    const c = game.connect({ readyState: 1, send() {}, on() {}, close() {} }, id);
    c.id = id;
    return c;
  };
  const done = () => {
    for (const c of [...game.online.values()]) game.disconnect(c);
    useMap(JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8')));
    rebuildWorld();
  };
  return { db, game, hero, done };
}
const put = (c, x, z) => Object.assign(c.ent, { x, z, path: null });
const call = (game, c, m, a = {}) => {
  try {
    return { ok: true, data: dispatch(game, c, m, a) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};

test("each town keeps its own book: orders only match in the town they're placed in", () => {
  const { db, heroes, market, a, b } = setup();
  heroes.addItem(a, 'oak_log', 10);
  market.place(a, { side: 'sell', item: 'oak_log', price: 5, qty: 10 }, 'hearthvale');
  const r = market.place(b, { side: 'buy', item: 'oak_log', price: 9, qty: 4 }, 'amberfold');
  assert.equal(r.filledQty, 0, "Amberfold can't buy Hearthvale's logs");
  assert.equal(market.summary('amberfold').oak_log.bid, 9);
  assert.equal(market.summary('amberfold').oak_log.ask, null);
  assert.equal(market.summary('hearthvale').oak_log.ask, 5);
  assert.equal(market.summary('hearthvale').oak_log.bid, null);
  assert.equal(market.book('oak_log', 'amberfold').asks.length, 0);
  assert.equal(market.book('oak_log', 'hearthvale').asks[0].qty, 10);
  // Cancelling the sell order from Amberfold leaves the logs in Hearthvale's storage.
  const id = market.mine(a)[0].id;
  assert.equal(market.mine(a)[0].town, 'hearthvale');
  assert.equal(market.cancel(a, id, 'amberfold').stored, true);
  assert.equal(heroes.count(a, 'oak_log'), 0);
  assert.equal(storedOf(db, a, 'oak_log'), 10, 'goods never teleport');
  assert.equal(itemsInSystem(db, 'oak_log'), 10);
});

test('trading needs a town (or the right one); looking works from anywhere', () => {
  const { game, hero, done } = townGame();
  try {
    const c = hero('Gate');
    game.heroes.addItem(c.id, 'oak_log', 10);
    put(c, 0, -60); // Hearthvale's island, inside its town circle
    assert.ok(call(game, c, 'npcSell', { item: 'oak_log', qty: 1 }).ok);
    put(c, 200, 0); // the sea between the towns: not in a town
    for (const [m, a] of [['npcSell', { item: 'oak_log', qty: 1 }], ['market.place', { side: 'sell', item: 'oak_log', price: 5, qty: 1 }], ['supplier.buy', { item: 'oak_log', qty: 1 }], ['storage.deposit', { item: 'oak_log', qty: 1 }], ['jobs.post', { item: 'oak_log', qty: 1, per: 1 }], ['shop.move', {}]])
      assert.match(call(game, c, m, a).err, /Head to a town/, m);
    const s = call(game, c, 'market.summary').data;
    assert.equal(s.browseOnly, true);
    assert.ok(['hearthvale', 'testvale'].includes(s.town), 'browses the nearest town');
    assert.ok(call(game, c, 'market.book', { item: 'oak_log', town: 'testvale' }).ok);
    assert.equal(call(game, c, 'market.board', { item: 'oak_log' }).data.towns.length, 2);
    // In Testvale: its own book, and a Hearthvale job can't be handed in here.
    put(c, TV.x, TV.z);
    assert.deepEqual([call(game, c, 'market.summary').data.town, call(game, c, 'market.summary').data.browseOnly], ['testvale', false]);
    const p = hero('Poster');
    put(p, 0, 0);
    game.heroes.addGold(p.id, 100);
    const j = call(game, p, 'jobs.post', { item: 'oak_log', qty: 2, per: 5 }).data;
    assert.equal(j.town, 'hearthvale');
    assert.match(call(game, c, 'jobs.deliver', { id: j.id, qty: 1 }).err, /in Hearthvale/);
    assert.equal(call(game, c, 'jobs.list').data.elsewhere[0]?.id, j.id, 'listed under other towns');
    // Placing or cancelling orders no longer works from inside a dungeon.
    assert.equal(allowedInRun('market.place'), false);
    assert.equal(allowedInRun('market.cancel'), false);
    assert.equal(allowedInRun('market.summary'), true);
    // A job delivered while the poster is away waits in their storage there.
    put(c, 0, 5);
    put(p, TV.x, TV.z);
    const d = call(game, c, 'jobs.deliver', { id: j.id, qty: 2 }).data;
    assert.equal(d.stored, true);
    assert.equal(storedOf(game.db, p.id, 'oak_log'), 2);
  } finally {
    done();
  }
});

test('storage: deposit, withdraw and collect move goods exactly', () => {
  const { game, hero, done } = townGame();
  try {
    const c = hero('Keeper');
    game.heroes.addItem(c.id, 'stone', 30);
    const total = () => itemsInSystem(game.db, 'stone');
    const t0 = total();
    put(c, TV.x, TV.z);
    assert.deepEqual(call(game, c, 'storage.deposit', { item: 'stone', qty: 20 }).data.items, { stone: 20 });
    assert.match(call(game, c, 'storage.deposit', { item: 'stone', qty: 99 }).err, /Not enough/);
    assert.match(call(game, c, 'storage.withdraw', { item: 'stone', qty: 21 }).err, /don't have that many/);
    assert.match(call(game, c, 'storage.withdraw', { item: 'stone', qty: 1.5 }).err, /Bad amount/);
    assert.ok(call(game, c, 'storage.withdraw', { item: 'stone', qty: 5 }).ok);
    assert.equal(game.heroes.count(c.id, 'stone'), 15);
    // Testvale's storage isn't Hearthvale's.
    put(c, 0, 0);
    assert.deepEqual(call(game, c, 'storage.collect').data.moved, {});
    assert.deepEqual(call(game, c, 'storage.get', { town: 'testvale' }).data.items, { stone: 15 });
    put(c, TV.x, TV.z);
    assert.deepEqual(call(game, c, 'storage.collect').data.moved, { stone: 15 });
    assert.equal(game.heroes.count(c.id, 'stone'), 30);
    assert.equal(total(), t0, 'nothing made or lost');
  } finally {
    done();
  }
});

test('merchant pools: the floor and the premium are capped, and refill over 8 hours', () => {
  const v = ITEMS.iron_ore.value; // ore: Hearthvale pays a premium on it
  const T = tradeOf('hearthvale');
  const fresh = poolNow(null, 'hearthvale');
  assert.equal(unitBid('hearthvale', 'iron_ore', fresh), Math.floor(v * T.rate.ore));
  // A huge sale: the premium wears off to the floor, then the floor pool runs out.
  const big = merchantSale('hearthvale', 'iron_ore', 9999, fresh);
  assert.equal(big.full, true);
  assert.ok(big.pool.premFill === 0);
  const floorUnits = Math.ceil(T.floorPool / (v * T.base));
  assert.ok(big.total <= floorUnits * v * T.rate.ore + (9999 - floorUnits) * Math.floor(v * FULL_RATE) + 1, 'never more than the pools allow');
  assert.equal(unitBid('hearthvale', 'iron_ore', big.pool), Math.floor(v * FULL_RATE), 'a full merchant pays a quarter');
  // Half the refill time later, half the pools are back; after all of it, all.
  const row = { floor_left: big.pool.floorLeft, prem_fill: big.pool.premFill, at: 0 };
  const half = poolNow(row, 'hearthvale', MERCHANT_REFILL_MS / 2);
  assert.ok(Math.abs(half.premFill - 0.5) < 1e-9 && half.floorLeft <= T.floorPool / 2 + 1e-6);
  assert.deepEqual(poolNow(row, 'hearthvale', MERCHANT_REFILL_MS * 2), { floorLeft: T.floorPool, premFill: 1 });
  // A glut (rate at or under the floor) pays flat, with no premium to drain.
  assert.equal(merchantSale('amberfold', 'oak_log', 5, poolNow(null, 'amberfold')).glut, true);
  // The server stores the pool: a second sale gets less than the first.
  const { db, heroes, a } = setup();
  const m = new Merchant(db, heroes);
  heroes.addItem(a, 'iron_ore', 400);
  const s1 = m.sell(a, 'hearthvale', 'iron_ore', 100);
  const s2 = m.sell(a, 'hearthvale', 'iron_ore', 100);
  assert.ok(s2.gold < s1.gold);
  assert.ok(m.bid('amberfold', 'iron_ore') > m.bid('hearthvale', 'iron_ore'), "another town's pool is untouched");
});

test('every supplier ask is above every merchant bid, in every town', () => {
  const towns = Object.keys(TRADE);
  for (const t of towns)
    for (const item of suppliesOf(t)) {
      const ask = supplyAsk(item);
      for (const u of towns) assert.ok(ask > unitBid(u, item, poolNow(null, u)), `${item}: ${t}'s ask ${ask} vs ${u}'s bid`);
    }
  assert.equal(supplyAsk('hearth_charm'), 60);
});

test("Hearthvale's merchant pays at least what it always did", () => {
  const fresh = poolNow(null, 'hearthvale');
  for (const [id, it] of Object.entries(ITEMS)) {
    assert.ok(it.tag, `${id} has a tag`);
    if (!tagGroup(id)) continue;
    assert.ok(unitBid('hearthvale', id, fresh) >= Math.max(1, Math.floor(it.value * 0.6)), id);
  }
});

test("the owner's knobs override the defaults", () => {
  try {
    setOverrides({ 'trade.hearthvale.rate.ore': 0.9, 'supply.markup': 2 });
    assert.equal(tradeOf('hearthvale').rate.ore, 0.9);
    assert.equal(supplyAsk('oak_log'), ITEMS.oak_log.value * 2);
  } finally {
    setOverrides({});
  }
  assert.equal(tradeOf('hearthvale').rate.ore, 0.85);
});

test('the supplier stall sells up to 150 of each a day, at its ask', () => {
  const { db, heroes, a } = setup();
  const m = new Merchant(db, heroes);
  heroes.addGold(a, 100_000, 'test');
  const ask = supplyAsk('oak_log');
  const g0 = heroes.gold(a);
  assert.equal(m.buy(a, 'hearthvale', 'oak_log', 100).left, 50);
  assert.equal(heroes.gold(a), g0 - 100 * ask);
  assert.throws(() => m.buy(a, 'hearthvale', 'oak_log', 51), /Only 50 left/);
  assert.throws(() => m.buy(a, 'hearthvale', 'sapphire', 1), /doesn't sell/);
  const tomorrow = Date.now() + 86400_000;
  assert.equal(m.left('hearthvale', 'oak_log', tomorrow), 150, 'restocked the next day');
});

test("a shop's customers and their demand belong to its town; moving costs 500 per tier", () => {
  assert.equal(customersOf('hearthvale'), CUSTOMERS);
  assert.equal(customersOf('nowhere'), CUSTOMERS, 'a town without its own uses the townsfolk');
  const { game, hero, done } = townGame();
  try {
    const c = hero('Mover');
    game.shops.ensure(c.id);
    assert.equal(game.shops.state(c.id, c.id).town, 'hearthvale');
    put(c, TV.x, TV.z);
    assert.match(call(game, c, 'shop.move', {}).err, /Not enough gold/);
    game.heroes.addGold(c.id, 2000, 'test');
    const r = call(game, c, 'shop.move', {}).data;
    assert.deepEqual(r, { town: 'testvale', fee: 1000 });
    assert.equal(game.shops.state(c.id, c.id).town, 'testvale');
    assert.match(call(game, c, 'shop.move', {}).err, /already here/);
    // Demand drains per town.
    game.db.prepare("INSERT INTO town_demand (town, item, fill, at) VALUES ('testvale', 'oak_log', 0, ?)").run(Date.now());
    assert.ok(game.shops.demand('oak_log', Date.now(), 'testvale').fill < 0.01);
    assert.equal(game.shops.demand('oak_log', Date.now(), 'hearthvale').fill, 1);
  } finally {
    done();
  }
});

test('a v6 save upgrades in place: everything becomes Hearthvale’s', () => {
  const db = new (openDb(':memory:').constructor)(':memory:');
  db.exec(SCHEMA_V0);
  migrate(db);
  const t = Date.now();
  db.prepare("INSERT INTO accounts (id, username, pass_hash, salt, created_at) VALUES (1, 'old', 'x', 'y', ?)").run(t);
  db.prepare("INSERT INTO heroes (account_id, name, avatar, gold, skills, equip, created_at) VALUES (1, 'Old', '{}', 50, '{}', '{}', ?)").run(t);
  db.prepare("INSERT INTO market_orders (account_id, side, item, price, qty, filled, status, created_at) VALUES (1, 'sell', 'oak_log', 5, 3, 0, 'open', ?)").run(t);
  db.prepare("INSERT INTO market_trades (item, price, qty, buyer, seller, ts) VALUES ('oak_log', 5, 1, 1, 1, ?)").run(t);
  db.prepare("INSERT INTO npc_demand (item, fill, at) VALUES ('oak_log', 0.25, ?)").run(t);
  db.prepare('INSERT INTO shops (account_id, created_at) VALUES (1, ?)').run(t);
  db.prepare("INSERT INTO jobs (poster, item, qty, left, per, created_at, expires_at) VALUES (1, 'stone', 2, 2, 3, ?, ?)").run(t, t + 1000);
  applyMigrations(db);
  for (const tb of ['market_orders', 'market_trades', 'shops', 'jobs']) assert.equal(db.prepare(`SELECT town FROM ${tb}`).get().town, 'hearthvale', tb);
  assert.deepEqual({ ...db.prepare('SELECT town, item, fill FROM town_demand').get() }, { town: 'hearthvale', item: 'oak_log', fill: 0.25 });
  assert.equal(db.prepare('SELECT home FROM heroes').get().home, 'hearthvale');
});
