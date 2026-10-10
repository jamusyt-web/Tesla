import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';
import { Heroes } from '../heroes.js';
import { Market, MARKET_TAX } from '../market.js';
import { Shops } from '../shop.js';
import { Auth } from '../auth.js';
import { STARTER_GOLD } from '../../shared/items.js';

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
  return held + escrow + shelves;
}

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
  // A new seller fills the resting bid at the bid's price.
  market.place(a, { side: 'sell', item: 'stone', price: 1, qty: 2 });
  assert.equal(heroes.count(b, 'stone'), 12);
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
  assert.equal(heroes.count(b, 'iron_ore'), 2);
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

test('player shop: stock, buy from another player, unstock', () => {
  const { db, heroes, shops, a, b } = setup();
  heroes.addItem(a, 'oak_plank', 5);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 5, price: 12 });
  assert.equal(heroes.count(a, 'oak_plank'), 0);
  const sale = shops.buyFromPlayer(b, 'Bob', a, 0, 2);
  assert.equal(sale.gold, 24);
  assert.equal(heroes.gold(a), STARTER_GOLD + 24);
  assert.equal(heroes.gold(b), STARTER_GOLD - 24);
  assert.throws(() => shops.buyFromPlayer(b, 'Bob', a, 0, 4), /Only 3 left/);
  assert.throws(() => shops.buyFromPlayer(a, 'Alice', a, 0, 1), /own shop/);
  shops.unstock(a, 0);
  assert.equal(heroes.count(a, 'oak_plank'), 3);
  assert.equal(itemsInSystem(db, 'oak_plank'), 5);
});

test('idle NPC shoppers buy fairly priced goods, ignore greedy ones', () => {
  const { heroes, shops, a } = setup();
  heroes.addItem(a, 'oak_plank', 200);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 100, price: 10 });
  shops.stock(a, { slot: 1, item: 'oak_plank', qty: 100, price: 100 });
  let fair = 0;
  let greedy = 0;
  for (let i = 0; i < 400; i++)
    for (const { sale } of shops.idleTick()) sale.gold === 10 ? fair++ : greedy++;
  assert.ok(fair > 10, `fair sales ${fair}`);
  assert.equal(greedy, 0);
});
