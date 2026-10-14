// Quests (Phase 2, E1): event matching, rewards paid by the server only,
// the tutorial carried over into hv_intro, chains opening up, letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_V0, migrate } from '../db.js';
import { MIGRATIONS, applyMigrations } from '../migrations/index.js';
import { QUESTS, stepGain, matches, canStart, addQuests } from '../../shared/quests.js';
import { emit } from '../events.js';
import { harness } from './harness.js';

test('matching: items, tags, grades, tiers and where it happened', () => {
  const gather = { type: 'tree_oak', kind: 'tree', loot: { oak_log: 3, acorn: 1 } };
  assert.equal(stepGain({ ev: 'gather', match: { item: 'oak_log' }, n: 10 }, 'gather', gather), 3, 'counts the logs, not the swing');
  assert.equal(stepGain({ ev: 'gather', match: { type: 'tree_oak' } }, 'gather', gather), 1);
  assert.equal(stepGain({ ev: 'gather', match: { item: 'stone' } }, 'gather', gather), 0);
  assert.equal(stepGain({ ev: 'gather', match: { tag: 'wood' } }, 'gather', gather), 3);
  assert.equal(stepGain({ ev: 'craft', match: { item: 'sword_copper' } }, 'craft', { out: 'sword_copper', item: 'sword_copper_fine', qty: 1 }), 1, 'a fine copy counts as its recipe');
  assert.equal(stepGain({ ev: 'craft', match: { minGrade: 'B' } }, 'craft', { out: 'oak_plank', grade: 'C', qty: 2 }), 0);
  assert.equal(stepGain({ ev: 'craft', match: { minGrade: 'B' } }, 'craft', { out: 'oak_plank', grade: 'A', qty: 2 }), 2);
  assert.equal(stepGain({ ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 2 } }, 'dungeon', { kind: 'hollow_crypt', tier: 1 }), 0);
  assert.equal(stepGain({ ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 2 } }, 'dungeon', { kind: 'hollow_crypt', tier: 4 }), 1, 'a harder tier counts');
  assert.ok(matches({ town: 'hearthvale' }, 'order', {}, { town: 'hearthvale' }), 'where it happened comes from the hero');
  assert.ok(!matches({ town: 'amberfold' }, 'order', { town: 'hearthvale' }));
  assert.equal(stepGain({ ev: 'kill', match: {} }, 'fish', {}), 0, 'another event never counts');
});

test('every quest step names a real event, and every intro step a target for the Compass', () => {
  const EVENTS = new Set(['gather', 'fish', 'kill', 'craft', 'stock', 'sell', 'supply', 'trade', 'deliver', 'travel', 'attune', 'discover', 'landmark', 'dungeon', 'order', 'big', 'passage', 'use']);
  for (const q of Object.values(QUESTS))
    for (const s of q.steps) {
      assert.ok(EVENTS.has(s.ev), `${q.id}: ${s.ev}`);
      assert.ok(s.text && s.target?.kind, `${q.id}: "${s.text}" needs text and a target`);
    }
});

test('the hv_intro chain: steps advance from events, the server pays, chains open up', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Quill');
    assert.equal(c.quests.get('hv_intro|0')?.step, 0, 'a new hero starts hv_intro');
    const gold0 = game.heroes.gold(c.id);
    emit(c, 'gather', { type: 'tree_oak', kind: 'tree', loot: { oak_log: 2 } });
    assert.equal(c.quests.get('hv_intro|0').step, 1);
    assert.equal(game.heroes.gold(c.id) - gold0, 20, 'step 1 paid 20 g');
    const msg = c.sent.filter((m) => m.t === 'quest' && m.id === 'hv_intro').pop();
    assert.equal(msg.stepDone, 0);
    assert.equal(msg.reward.gold, 20);
    // The quarry chain opens after step 1, the garden after step 2.
    assert.ok(c.quests.has('hv_quarry|0'));
    assert.ok(!c.quests.has('hv_garden|0'));
    emit(c, 'craft', { out: 'oak_plank', item: 'oak_plank', qty: 2, grade: 'C' });
    assert.ok(c.quests.has('hv_garden|0'));
    // Counting steps: 10 stone from three swings.
    for (const n of [4, 4, 4]) emit(c, 'gather', { type: 'rock_stone', kind: 'rock', loot: { stone: n } });
    assert.equal(c.quests.get('hv_quarry|0').step, 1, 'Stone by Stone: on to the bricks');
    // The whole intro: the rest of the steps in order.
    emit(c, 'kill', { monster: 'slime' });
    emit(c, 'stock', { item: 'oak_plank', qty: 1 });
    emit(c, 'craft', { out: 'pick_copper', item: 'pick_copper', qty: 1 });
    emit(c, 'attune', { id: 'stone_wildwatch' });
    emit(c, 'fish', { item: 'minnow', qty: 1 });
    emit(c, 'order', { town: 'hearthvale', key: 'x' });
    const before = game.heroes.gold(c.id);
    emit(c, 'dungeon', { kind: 'hollow_crypt', tier: 1 });
    assert.equal(game.heroes.gold(c.id) - before, 150);
    assert.equal(c.quests.get('hv_intro|0').step, 9, 'step 10: the West Gate road');
    emit(c, 'attune', { id: 'stone_westmarch' });
    assert.ok(!c.quests.has('hv_intro|0'), 'done');
    assert.ok(c.questsDone.has('hv_intro'));
    assert.equal(c.hero.tutorial, 4, 'the old tutorial counter follows along');
    assert.ok(c.quests.has('hv_deeper|0'), 'Deeper Still needs the intro done');
    assert.ok(game.db.prepare("SELECT points FROM town_rep WHERE account_id = ? AND town = 'hearthvale'").get(c.id).points >= 80, 'rep paid');
    // Quest RPCs only read and pin: there is no way to claim a reward from the client.
    const list = game.quests.list(c);
    assert.ok(list.done.includes('hv_intro'));
    assert.deepEqual(game.quests.pin(c, 'hv_garden').pins, ['hv_garden']);
  } finally {
    done();
  }
});

test('heroes at tutorial 0–4 land on the right hv_intro step', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_V0);
  migrate(db);
  applyMigrations(
    db,
    MIGRATIONS.filter((m) => m.id < '010'),
  );
  const now = Date.now();
  for (const [i, t] of [0, 1, 2, 3, 4, 99].entries()) {
    db.prepare('INSERT INTO accounts (id, username, pass_hash, salt, created_at) VALUES (?,?,?,?,?)').run(i + 1, `u${i}`, 'x', 'y', now);
    db.prepare("INSERT INTO heroes (account_id, name, avatar, gold, skills, equip, created_at, tutorial) VALUES (?,?,'{}',0,'{}','{}',?,?)").run(i + 1, `Hero${i}`, now, t);
  }
  applyMigrations(db, MIGRATIONS);
  const steps = db.prepare("SELECT account_id, step FROM quest_progress WHERE quest = 'hv_intro' ORDER BY account_id").all().map((r) => r.step);
  assert.deepEqual(steps, [0, 1, 2, 3, 4, 4], 'finished or skipped heroes carry on at step 5');
});

test('a quest that hands over a letter: given on start, and it stays out of waystones', () => {
  addQuests([{ id: 'test_letter', town: 'hearthvale', title: 'A Letter', requires: ['nope_never'], give: { letter_amberfold: 1 }, steps: [{ ev: 'deliver', match: { item: 'letter_amberfold' }, text: 'Deliver it', target: { kind: 'town' } }], reward: { gold: 1 } }]);
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Post');
    assert.ok(!c.quests.has('test_letter|0'), 'needs a quest nobody can finish');
    game.quests.start(c, 'test_letter');
    assert.equal(game.heroes.count(c.id, 'letter_amberfold'), 1);
    const r = call(c, 'travel', { to: 'stone_wildwatch' });
    assert.match(r.err, /won't carry your Letter/);
    assert.ok(!canStart(QUESTS.test_letter, c.hero, new Set(), {}));
  } finally {
    delete QUESTS.test_letter;
    done();
  }
});

test('a once-only step already done counts: a stone attuned before the quest got there', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Early');
    game.heroes.attune(c.hero, 'stone_wildwatch'); // walked past it on day one
    game.quests.skipTo(c, 'hv_intro', 4);
    emit(c, 'craft', { out: 'pick_copper', item: 'pick_copper', qty: 1 });
    assert.equal(c.quests.get('hv_intro|0').step, 6, 'the attune step went straight through');
    assert.ok(c.sent.some((m) => m.t === 'quest' && m.id === 'hv_intro' && m.stepDone === 5));
    // And a hero stuck on it from before is let through on connect.
    const d = hero('Stuck');
    game.heroes.attune(d.hero, 'stone_wildwatch');
    game.db.prepare("UPDATE quest_progress SET step = 5 WHERE account_id = ? AND quest = 'hv_intro'").run(d.id);
    game.quests.load(d);
    game.quests.ensure(d);
    assert.equal(d.quests.get('hv_intro|0').step, 6);
  } finally {
    done();
  }
});
