import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA_V0 } from '../db.js';
import { Heroes } from '../heroes.js';
import { Shops } from '../shop.js';
import { Auth } from '../auth.js';
import { ITEMS } from '../../shared/items.js';
import { SHOP, demandCap } from '../../shared/shop.js';

function setup() {
  const db = openDb(':memory:');
  const auth = new Auth(db);
  const heroes = new Heroes(db);
  const code = auth.bootstrap();
  const a = auth.signup({ username: 'alice', password: 'secret1', invite: code }).accountId;
  const b = auth.signup({ username: 'bob', password: 'secret1', invite: auth.createInvite(a) }).accountId;
  heroes.create(a, 'Alice', {});
  heroes.create(b, 'Bob', {});
  heroes.addGold(b, 1000);
  return { db, heroes, shops: new Shops(db, heroes), a, b };
}
const tills = (db) => db.prepare('SELECT COALESCE(SUM(till), 0) AS t FROM shops').get().t;
const fees = (db) => db.prepare('SELECT COALESCE(SUM(fee), 0) AS f FROM shop_log').get().f;
const setClock = (db, t) => db.prepare("UPDATE meta SET value = ? WHERE key = 'shop_sim_at'").run(String(t));

test('players buy at the shown price; the seller is paid into the till minus 4%; gold is conserved', () => {
  const { db, heroes, shops, a, b } = setup();
  heroes.addItem(a, 'oak_plank', 50);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 50, price: 12 });
  assert.equal(heroes.count(a, 'oak_plank'), 0);
  const before = heroes.gold(a) + heroes.gold(b);
  const { sale, s } = shops.buy(b, 'Bob', a, { slot: 0, qty: 25, price: 12, item: 'oak_plank' });
  assert.equal(sale.gross, 300);
  assert.equal(sale.fee, 12); // 4% of 300
  assert.equal(s.qty, 25);
  assert.equal(heroes.count(b, 'oak_plank'), 25);
  assert.equal(shops.till(a), 288);
  assert.equal(heroes.gold(a) + heroes.gold(b) + tills(db) + fees(db), before, 'buyer gold = till + fee');
  // Price changed under the buyer: refused, nothing moves.
  shops.setPrice(a, 0, 15);
  assert.throws(() => shops.buy(b, 'Bob', a, { slot: 0, qty: 1, price: 12, item: 'oak_plank' }), /price just changed/);
  assert.throws(() => shops.buy(b, 'Bob', a, { slot: 0, qty: 99, price: 15, item: 'oak_plank' }), /Only 25 left/);
  assert.throws(() => shops.buy(a, 'Alice', a, { slot: 0, qty: 1, price: 15, item: 'oak_plank' }), /own shop/);
  shops.setup(a, { open: false });
  assert.throws(() => shops.buy(b, 'Bob', a, { slot: 0, qty: 1, price: 15, item: 'oak_plank' }), /closed/);
  // Collect the till.
  const g = heroes.gold(a);
  assert.equal(shops.collect(a).gold, 288);
  assert.equal(heroes.gold(a), g + 288);
  assert.throws(() => shops.collect(a), /Nothing in the till/);
});

test("small sales can't dodge the fee: the fractional part carries over", () => {
  const { db, heroes, shops, a, b } = setup();
  heroes.addItem(a, 'oak_plank', 10);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 10, price: 12 });
  for (let i = 0; i < 10; i++) shops.buy(b, 'Bob', a, { slot: 0, qty: 1, price: 12, item: 'oak_plank' });
  assert.equal(fees(db), 4); // 10 × 0.48 = 4.8 → 4 so far, 0.8 carried
});

test("you can't shelve (or sell) the last copy of something you have equipped", () => {
  const { heroes, shops, a } = setup();
  const axe = Object.keys(ITEMS).find((id) => ITEMS[id].tool === 'axe' && heroes.count(a, id) === 1);
  assert.ok(axe, 'starter axe');
  assert.throws(() => shops.stock(a, { slot: 0, item: axe, qty: 1, price: 10 }), /equipped/);
});

test('NPC customers: fair prices sell, greedy ones never do, and town demand caps the gold faucet', () => {
  const { db, heroes, shops, a } = setup();
  heroes.addItem(a, 'oak_plank', 2000);
  heroes.addItem(a, 'stone', 999);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 999, price: 10 }); // fair (value 10)
  shops.stock(a, { slot: 1, item: 'oak_plank', qty: 999, price: 9 }); // cheaper twin: customers go here first
  shops.stock(a, { slot: 2, item: 'stone', qty: 999, price: 100 }); // way over 1.5× value: never sells
  let seed = 42;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const t0 = Date.UTC(2026, 0, 1);
  setClock(db, t0);
  let sold = { 0: 0, 1: 0, 2: 0 };
  const hours = 24;
  for (let t = t0 + 600_000; t <= t0 + hours * 3600_000; t += 600_000)
    for (const ev of shops.simulate(t, () => 'inside', rng).events) if (ev.sale) sold[ev.sale.slot] += ev.sale.qty;
  assert.equal(sold[2], 0, 'greedy price never sells');
  assert.ok(sold[1] > 0, 'fair price sells');
  const cap = demandCap(ITEMS.oak_plank.value);
  assert.ok(sold[0] + sold[1] <= cap * (1 + hours / 8) + 1, `NPC volume ${sold[0] + sold[1]} within the demand pool bound ${cap * (1 + hours / 8)}`);
  assert.ok(sold[1] >= sold[0], 'customers prefer the cheaper display');
  // The same moment again does nothing: no interval is simulated twice.
  assert.equal(shops.simulate(t0 + hours * 3600_000, () => 'inside', rng).events.length, 0);
});

test('away summary lists unseen sales until acknowledged; an owner away 12h+ gets no NPC customers', () => {
  const { db, heroes, shops, a } = setup();
  heroes.addItem(a, 'oak_plank', 200);
  shops.stock(a, { slot: 0, item: 'oak_plank', qty: 200, price: 9 });
  const t0 = Date.UTC(2026, 0, 2);
  setClock(db, t0);
  let rngSeed = 7;
  const rng = () => ((rngSeed = (rngSeed * 16807) % 2147483647) / 2147483647);
  let n = 0;
  for (let t = t0 + 600_000; t <= t0 + 3 * 3600_000; t += 600_000) n += shops.simulate(t, () => 'away', rng).events.length;
  assert.equal(n, 0, 'nobody visits an abandoned shop');
  for (let t = t0 + 3 * 3600_000 + 600_000; t <= t0 + 5 * 3600_000; t += 600_000) shops.simulate(t, () => 'offline', rng);
  const sum = shops.awaySummary(a, t0 + 5 * 3600_000, t0);
  assert.ok(sum && sum.count > 0 && sum.net > 0 && sum.net <= sum.gross);
  assert.equal(sum.top[0].item, 'oak_plank');
  shops.ack(a, sum.upto);
  assert.equal(shops.awaySummary(a, t0 + 5 * 3600_000, t0), null);
});

test('an old save upgrades in place: shelves kept, old history counts as seen', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hv-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(SCHEMA_V0);
  old.prepare("INSERT INTO accounts (id, username, pass_hash, salt, created_at) VALUES (1, 'old', 'x', 'y', 1)").run();
  old.prepare("INSERT INTO heroes (account_id, name, avatar, gold, created_at) VALUES (1, 'Oldie', '{}', 50, 1)").run();
  old.prepare("INSERT INTO shop_slots (account_id, slot, item, qty, price) VALUES (1, 3, 'oak_plank', 7, 11)").run();
  old.prepare("INSERT INTO shop_log (account_id, item, qty, price, buyer, ts) VALUES (1, 'oak_plank', 1, 11, 'Bram', 1)").run();
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  const shops = new Shops(db, new Heroes(db));
  assert.deepEqual({ ...shops.slots(1)[0] }, { slot: 3, item: 'oak_plank', qty: 7, price: 11 });
  assert.equal(shops.awaySummary(1, Date.now(), 0), null);
  assert.equal(shops.info(1).open, 1);
  db.close();
  assert.equal(openDb(file).prepare('PRAGMA user_version').get().user_version, 1, 'migrations run once');
});

test('shop constants stay sane', () => {
  assert.ok(SHOP.P2P_FEE_PM === 40 && SHOP.NPC_FEE_PM > SHOP.P2P_FEE_PM);
  for (const id of Object.keys(ITEMS)) assert.ok(demandCap(ITEMS[id].value) >= SHOP.DEMAND_CAP_MIN);
});
