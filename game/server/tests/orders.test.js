// Town orders, the Big Order and reputation (Phase 2, E5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedOrders, orderOf, templateOf, SLOTS, bigOrderOf } from '../../shared/orders.js';
import { dayIndex } from '../../shared/dungeon.js';
import { emit } from '../events.js';
import { harness } from './harness.js';

const DAY = 86_400_000;
const T = 'hearthvale';

test('the board: the same four for everyone, each hero fills their own copy', () => {
  const { game, hero, done } = harness();
  try {
    const a = hero('Ada');
    const b = hero('Bob');
    const now = Date.now();
    const va = game.orders.view(a, T, now);
    const vb = game.orders.view(b, T, now);
    assert.equal(va.slots.length, SLOTS);
    assert.deepEqual(va.slots.map((s) => s.key), seedOrders(T, dayIndex(now)));
    assert.deepEqual(vb.slots.map((s) => s.key), va.slots.map((s) => s.key), 'same seed for everyone');
    // Ada fills a goods order; Bo's copy is untouched.
    const s = va.slots.find((x) => x.kind !== 'hunt');
    game.heroes.addItem(a.id, s.item, s.qty);
    const gold0 = game.heroes.gold(a.id);
    const half = Math.floor(s.qty / 2) || 1;
    const r1 = game.orders.deliver(a, T, s.slot, half, now);
    assert.ok(r1.paid > 0 && !r1.done || s.qty === 1, 'paid as you go');
    const r2 = s.qty > 1 ? game.orders.deliver(a, T, s.slot, s.qty, now) : r1;
    assert.equal(r2.done, true);
    assert.equal(game.heroes.gold(a.id) - gold0, s.pay, 'the whole order pays exactly its price');
    assert.equal(game.db.prepare("SELECT points FROM town_rep WHERE account_id = ? AND town = ?").get(a.id, T).points, s.rep);
    assert.ok(game.db.prepare("SELECT amount FROM gold_flow WHERE reason = 'order'").get().amount >= s.pay, 'paid with a reason');
    assert.equal(game.orders.view(b, T, now).slots.find((x) => x.slot === s.slot).got, 0, "Bo's copy is his own");
    // Done today: the slot stays empty until tomorrow, then today's board fills it.
    assert.equal(game.orders.view(a, T, now).slots.find((x) => x.slot === s.slot).state, 'done');
    const tomorrow = game.orders.view(a, T, now + DAY).slots.find((x) => x.slot === s.slot);
    assert.equal(tomorrow.state, 'open');
    assert.equal(tomorrow.day, dayIndex(now) + 1);
  } finally {
    done();
  }
});

test('orders last three days, then expire with a notice; a new day fills only empty slots', () => {
  const { game, hero, done } = harness();
  try {
    const a = hero('Cal');
    const now = Date.now();
    const keys0 = game.orders.view(a, T, now).slots.map((s) => s.key);
    const d2 = game.orders.view(a, T, now + 2 * DAY);
    assert.deepEqual(d2.slots.map((s) => s.key), keys0, 'still open on day 3: nothing replaced');
    assert.ok(d2.slots.every((s) => s.state === 'open'));
    const d3 = game.orders.view(a, T, now + 3 * DAY);
    assert.deepEqual(d3.slots.map((s) => s.day), Array(SLOTS).fill(dayIndex(now) + 3), 'expired ones replaced by that day\'s');
    const n = game.notices.unseen(a.id).filter((x) => x.kind === 'order');
    assert.equal(n.length, SLOTS, 'one notice per expired order');
  } finally {
    done();
  }
});

test('hunts count your kills and pay when turned in; the order event moves hv_intro on', () => {
  const { game, hero, done } = harness();
  try {
    const a = hero('Dax');
    const now = Date.now();
    // Find a day whose board has a hunt.
    let day = dayIndex(now);
    while (!seedOrders(T, day).some((k) => templateOf(T, k).kind === 'hunt')) day++;
    const t = (day - dayIndex(now)) * DAY + now;
    const s = game.orders.view(a, T, t).slots.find((x) => x.kind === 'hunt');
    assert.throws(() => game.orders.deliver(a, T, s.slot, 1, t), /Thin out/);
    for (let k = 0; k < s.qty; k++) emit(a, 'kill', { monster: s.monster });
    emit(a, 'kill', { monster: s.monster }); // one too many: capped
    assert.equal(game.orders.view(a, T, t).slots.find((x) => x.slot === s.slot).got, s.qty);
    assert.deepEqual(game.orders.ready(a.id, T).map((r) => r.slot), [s.slot]);
    game.quests.skipTo(a, 'hv_intro', 7);
    const r = game.orders.deliver(a, T, s.slot, 1, t);
    assert.equal(r.done, true);
    assert.equal(r.paid, s.pay);
    assert.equal(a.quests.get('hv_intro|0').step, 8, 'Fill an order: done');
  } finally {
    done();
  }
});

test('the Big Order: everyone gives, it pays per unit, and filling it makes the town Festive', () => {
  const { game, hero, done } = harness();
  try {
    const a = hero('Eve');
    const b = hero('Fen');
    const now = Date.now();
    const big = bigOrderOf(T, dayIndex(now));
    game.heroes.addItem(a.id, big.item, big.need);
    game.heroes.addItem(b.id, big.item, 5);
    const g0 = game.heroes.gold(b.id);
    const rb = game.orders.giveBig(b, T, 5, now);
    assert.equal(rb.paid, 5 * big.unit);
    assert.equal(game.heroes.gold(b.id) - g0, 5 * big.unit);
    const ra = game.orders.giveBig(a, T, big.need, now);
    assert.equal(ra.qty, big.need - 5, 'only what is still wanted is taken');
    assert.equal(ra.big.done, true);
    assert.equal(game.heroes.count(a.id, big.item), 5);
    assert.throws(() => game.orders.giveBig(a, T, 1, now), /already filled/);
    for (const c of [a, b]) {
      assert.equal(c.hero.buffs.boon?.boon, 'festive', 'Festive for everyone in town');
      assert.ok(c.effects().xpPct >= 0.1);
      assert.ok(c.sent.some((m) => m.t === 'banner' && m.kind === 'big'));
    }
    assert.equal(game.db.prepare('SELECT points FROM town_rep WHERE account_id = ? AND town = ?').get(b.id, T).points, 25);
    // Festive adds 10% to xp.
    const xp = game.heroes.addXp(a.hero, 'foraging', 100);
    assert.equal(xp.amount, 110);
  } finally {
    done();
  }
});

test('order sizes follow the tier table; specials are small and pay 1.5x', () => {
  const o = orderOf(templateOf(T, 'hv_oak'));
  assert.equal(o.qty, Math.round(150 / 4));
  assert.equal(o.pay, Math.round(o.qty * 4 * 1.15));
  const k = orderOf(templateOf(T, 'hv_koi'));
  assert.equal(k.qty, 1);
  assert.equal(k.pay, Math.round(90 * 1.5));
});
