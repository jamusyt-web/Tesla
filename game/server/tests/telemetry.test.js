import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { Heroes } from '../heroes.js';
import { Market } from '../market.js';
import { Auth } from '../auth.js';
import { perfSample, perfReport } from '../telemetry.js';
import { dispatch } from '../rpc.js';
import '../perf.js';

function setup() {
  const db = openDb(':memory:');
  const auth = new Auth(db);
  const heroes = new Heroes(db);
  const code = auth.bootstrap();
  const a = auth.signup({ username: 'alice', password: 'secret1', invite: code }).accountId;
  const b = auth.signup({ username: 'bob', password: 'secret1', invite: auth.createInvite(a) }).accountId;
  heroes.create(a, 'Alice', {});
  heroes.create(b, 'Bob', {});
  return { db, auth, heroes, market: new Market(db, heroes), a, b };
}
const flowSum = (db) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS g FROM gold_flow').get().g;
const purses = (db) => db.prepare('SELECT SUM(gold) AS g FROM heroes').get().g;

test('every coin in a purse is accounted for in gold_flow, labelled', () => {
  const { db, heroes, market, a, b } = setup();
  assert.equal(flowSum(db), purses(db), 'starting purses are counted');
  heroes.addGold(a, 40, 'loot');
  heroes.addGold(b, -10, 'travel');
  heroes.addItem(a, 'oak_log', 10, 'gather');
  market.place(a, { side: 'sell', item: 'oak_log', price: 5, qty: 10 });
  market.place(b, { side: 'buy', item: 'oak_log', price: 7, qty: 4 }); // escrow, sale, tax, refund
  assert.throws(() => heroes.addGold(b, -1e9, 'travel'), /Not enough gold/);
  const escrow = db.prepare(`SELECT COALESCE(SUM(price * (qty - filled)), 0) AS g FROM market_orders WHERE side = 'buy' AND status = 'open'`).get().g;
  assert.equal(flowSum(db), purses(db), `purses ${purses(db)} (+${escrow} in escrow) match the books`);
  const reasons = db.prepare('SELECT DISTINCT reason FROM gold_flow').all().map((r) => r.reason);
  assert.ok(!reasons.includes('other'), `every flow has a reason (${reasons})`);
  for (const r of ['start', 'loot', 'travel', 'marketEscrow', 'marketSale']) assert.ok(reasons.includes(r), `${r} is recorded`);
  assert.equal(db.prepare(`SELECT qty FROM item_flow WHERE item = 'oak_log' AND kind = 'gather'`).get().qty, 10);
});

test('no gold changes hands without a reason (every addGold call names one)', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\baddGold\(([^;]*)\);/g)) {
      if (f === 'heroes.js' && m[0].includes('reason')) continue;
      assert.match(m[1], /,\s*'[a-zA-Z]+'\s*\)?\s*$/, `${f}: addGold(${m[1]}) needs a reason`);
    }
  }
});

test('phones report once a minute; the owner sees a summary', () => {
  const { db, auth, a, b } = setup();
  const g = { db, auth };
  const c = { hero: { id: b } };
  const sample = { device: 'abc123-low', region: 'hearthvale', fps50: 41, fps5: 22, draws95: 140, tris95: 120000, loadMs: 5200 };
  dispatch(g, c, 'perf.sample', sample);
  assert.throws(() => dispatch(g, c, 'perf.sample', sample), /Too soon/);
  perfSample(db, { ...sample, fps50: 35, fps5: 18, device: 'abc123-low' });
  perfSample(db, { ...sample, device: 'ff00-high', region: 'wild<script>', fps50: 9999 });
  const rows = perfReport(db);
  const phone = rows.find((r) => r.device === 'abc123-low');
  assert.equal(phone.n, 2);
  assert.equal(phone.fps50, 38);
  assert.equal(phone.fps5min, 18);
  assert.throws(() => dispatch(g, c, 'owner.perf', {}), /owners/);
  const owner = { hero: { id: a } }; // the first account is the server owner
  assert.ok(dispatch(g, owner, 'owner.perf', {}).rows.length >= 2);
  // What a client sends is cleaned up.
  dispatch(g, { hero: { id: a } }, 'perf.sample', { ...sample, device: 'x"; DROP TABLE heroes', fps50: 1e9 });
  const odd = db.prepare(`SELECT device, fps_p50 FROM perf_samples ORDER BY id DESC LIMIT 1`).get();
  assert.equal(odd.device, 'xDROPTABLEheroes');
  assert.equal(odd.fps_p50, 240);
});
