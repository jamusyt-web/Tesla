// Engagement telemetry and the owner's tabs (Phase 2, E7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knob } from '../../shared/economy.js';
import { harness } from './harness.js';

test('goals.log adds up per hero and per source; dead air shows as a share of time played', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Gale');
    game.auth.setAdmin(c.id, true);
    const t0 = Date.now();
    c.engage = { at: t0 - 120_000, secs: 0 };
    game.engage.log(c, { shown: { quest: 10, upgrade: 4 }, taken: { quest: 2 }, done: { quest: 1 }, dead: 6 }, t0);
    game.engage.log(c, { shown: { quest: 5, 'bad src!': 99 }, taken: {}, done: {}, dead: 500 }, t0 + 60_000);
    const day = game.db.prepare('SELECT * FROM engage_day WHERE account_id = ?').get(c.id);
    assert.equal(day.sessions, 1);
    assert.equal(day.minutes, 3, 'two minutes before, then one');
    assert.equal(day.goals_shown, 19);
    assert.equal(day.dead_air_s, 6 + 90, 'clamped to 90 s a minute');
    const q = game.db.prepare("SELECT * FROM goal_log WHERE src = 'quest'").get();
    assert.deepEqual([q.shown, q.taken, q.done], [15, 2, 1]);
    assert.ok(!game.db.prepare("SELECT * FROM goal_log WHERE src = 'bad src!'").get());
    // Only server owners see the reports.
    const other = hero('Nope');
    assert.match(call(other, 'owner.engage', {}).err, /server owners/);
    const r = call(c, 'owner.engage', {});
    assert.ok(r.ok, r.err);
    assert.ok(r.data.sources.find((s) => s.src === 'quest').takeRate > 13);
    assert.ok(r.data.deadPct > 0);
  } finally {
    done();
  }
});

test('the Economy tab: faucets against sinks (transfers left out), and knobs the owner sets', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Owen');
    game.auth.setAdmin(c.id, true);
    game.heroes.addGold(c.id, 300, 'quest');
    game.heroes.addGold(c.id, -100, 'travel');
    game.heroes.addGold(c.id, -50, 'marketEscrow');
    const r = call(c, 'owner.econ', {});
    assert.ok(r.ok, r.err);
    assert.ok(r.data.faucet >= 300);
    assert.equal(r.data.sink, 100, 'escrow is a transfer, not a sink');
    assert.ok(Array.isArray(r.data.cpi) && Array.isArray(r.data.pools));
    // A knob, read through knob(), sent to everyone online.
    const s = call(c, 'owner.econ.set', { key: 'supply.markup', value: 1.5 });
    assert.ok(s.ok, s.err);
    assert.equal(knob('supply.markup', 1.35), 1.5);
    assert.ok(c.sent.some((m) => m.t === 'econ' && m.overrides['supply.markup'] === 1.5));
    call(c, 'owner.econ.set', { key: 'supply.markup', value: null });
    assert.equal(knob('supply.markup', 1.35), 1.35, 'cleared');
    assert.match(call(c, 'owner.econ.set', { key: 'x; DROP', value: 1 }).err, /not a knob/);
  } finally {
    done();
  }
});
