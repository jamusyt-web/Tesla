// Coming back (Phase 2, E4): the digest after 12 h, the Hearth Rest pool,
// and notices kept for heroes who were offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restPerHour, restCap } from '../digest.js';
import { harness } from './harness.js';

const H = 3600_000;

function comeBack(game, hero, c, awayMs) {
  game.disconnect(c);
  game.lastActive.set(c.id, Date.now() - awayMs);
  return hero.reconnect(c.id);
}

function setup() {
  const h = harness();
  const { game } = h;
  h.hero.reconnect = (id) => {
    const sent = [];
    const c = game.connect({ readyState: 1, send: (d) => sent.push(JSON.parse(d)), on() {}, close() {} }, id);
    return Object.assign(c, { id, sent });
  };
  return h;
}

test('after 12 hours away: a digest of what happened; after less, none', () => {
  const { game, hero, done } = setup();
  try {
    let c = hero('Rhea');
    game.disconnect(c);
    game.notices.add(c.id, 'job', {}, 'Ruu delivered 5× Oak Log for your job.'); // while away
    game.lastActive.set(c.id, Date.now() - 2 * H);
    c = hero.reconnect(c.id);
    assert.ok(!c.sent.some((m) => m.t === 'digest'), 'two hours: no digest');
    assert.ok(c.sent.some((m) => m.t === 'notice' && /Ruu delivered/.test(m.text)), 'but what waited is shown');
    assert.equal(game.notices.unseen(c.id).length, 0, 'and marked seen');
    game.notices.add(c.id, 'order', {}, 'Shown live: online, so seen at once.');
    assert.equal(game.notices.unseen(c.id).length, 0);
    game.disconnect(c);
    game.notices.add(c.id, 'order', {}, 'An order in Hearthvale ran out of time: 38× Oak Log.');
    c = comeBack(game, hero, c, 13 * H);
    const d = c.sent.find((m) => m.t === 'digest');
    assert.ok(d, 'thirteen hours: a digest');
    assert.ok(d.lines.some((l) => /ran out of time/.test(l.text)));
    assert.ok(d.today.twist.name);
    game.digest.ack(c, d.upto);
    assert.equal(game.notices.unseen(c.id).length, 0, 'seen once acknowledged');
  } finally {
    done();
  }
});

test('Hearth Rest: hours away × (20 + 10 × level), at most 48 h; xp pays +50% from it', () => {
  const { game, hero, done } = setup();
  try {
    let c = hero('Sol');
    c = comeBack(game, hero, c, 5 * H + 1000);
    const L = c.hero.level;
    assert.equal(c.hero.rested, 5 * restPerHour(L));
    c = comeBack(game, hero, c, 100 * H);
    assert.equal(c.hero.rested, restCap(L), 'capped at 48 hours');
    const pool = c.hero.rested;
    const xp = game.heroes.addXp(c.hero, 'mining', 100);
    assert.equal(xp.amount, 150);
    assert.equal(xp.bonus, 50);
    assert.equal(c.hero.rested, pool - 50);
    assert.equal(game.heroes.load(c.id).rested, pool - 50, 'saved');
    // Drain it: the bonus stops when the pool is empty.
    c.hero.rested = 10;
    assert.equal(game.heroes.addXp(c.hero, 'mining', 100).amount, 110);
    assert.equal(game.heroes.addXp(c.hero, 'mining', 100).amount, 100);
  } finally {
    done();
  }
});

test('offline notices: a job delivered while the poster was away is kept for them', () => {
  const { game, hero, call, done } = setup();
  try {
    const poster = hero('Pia');
    const runner = hero('Ruu');
    game.heroes.addGold(poster.id, 500, 'test');
    Object.assign(poster.ent, { x: 0, z: 0 });
    Object.assign(runner.ent, { x: 0, z: 0 });
    const j = call(poster, 'jobs.post', { item: 'oak_log', qty: 5, per: 6, hours: 24 });
    assert.ok(j.ok, j.err);
    game.disconnect(poster);
    game.heroes.addItem(runner.id, 'oak_log', 5);
    const r = call(runner, 'jobs.deliver', { id: j.data.id, qty: 5 });
    assert.ok(r.ok, r.err);
    const n = game.notices.unseen(poster.id);
    assert.equal(n.length, 1);
    assert.equal(n[0].kind, 'job');
    assert.match(n[0].text, /Ruu delivered 5× Oak Log/);
  } finally {
    done();
  }
});
