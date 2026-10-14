// Phase 0 seams (SPEC §10): the RPC table, the event bus, the migration
// loader, the content registry and the re-exports that keep old imports working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, SCHEMA_V0, migrate, GameError } from '../db.js';
import { applyMigrations, MIGRATIONS } from '../migrations/index.js';
import { register, dispatch, allowedInRun, rpcNames } from '../rpc.js';
import { on, emit } from '../events.js';
import { Game, TUTORIAL } from '../game.js';
import { TUTORIAL as TUTORIAL2 } from '../tutorial.js';
import { Battle } from '../battle.js';
import { hitNode } from '../gather.js';
import { world } from '../static.js';
import * as W from '../../shared/world.js';
import * as NODES_MOD from '../../shared/nodes.js';
import * as NAV from '../../shared/nav.js';
import { biomeAt, townAt, regionAt } from '../../shared/places.js';
import { mergeInto, CONTENT } from '../../shared/content/index.js';
import { MODELS, GROUPS, registerGroup, groupOf } from '../../client/src/scene/manifest/index.js';
import { MODELS as CORE } from '../../client/src/scene/manifest/core.js';
import { PROC_BUILDERS, registerProc } from '../../client/src/scene/procprops.js';
import { spotsOf } from '../../shared/stations.js';
import { checkManifest } from '../../scripts/check-manifest.mjs';

const schema = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();

// Every RPC that worked before the move, and whether it worked inside a dungeon run.
const OLD_RPCS = ['craft', 'craft.info', 'craft.start', 'craft.finish', 'craft.cancel', 'craft.quick', 'npcSell', 'drink', 'travel', 'owner.teleport', 'equip', 'avatar', 'profile', 'market.summary', 'market.book', 'market.mine', 'market.place', 'market.cancel', 'shop.enter', 'shop.exit', 'shop.state', 'shop.stock', 'shop.unstock', 'shop.price', 'shop.setup', 'shop.collect', 'shop.ledger', 'shop.ack', 'shop.buy', 'shop.directory', 'town.info', 'invite.create', 'dungeon.info', 'dungeon.enter', 'dungeon.ready', 'dungeon.join', 'dungeon.leave', 'dungeon.use', 'party.get', 'party.invite', 'party.answer', 'party.leave', 'party.kick', 'party.promote', 'jobs.list', 'jobs.post', 'jobs.deliver', 'jobs.cancel', 'channel.switch', 'tutorialSkip'];
// (M3: placing and cancelling market orders left the run list, SPEC §6.1.)
const OLD_IN_RUN = (name) => (/^(dungeon|party|market)\./.test(name) && !['market.place', 'market.cancel'].includes(name)) || ['equip', 'avatar', 'profile', 'town.info', 'jobs.list', 'drink', 'craft.info', 'invite.create', 'tutorialSkip', 'shop.state', 'shop.ledger', 'shop.collect', 'shop.ack', 'shop.directory'].includes(name);

test('rpc table: every old RPC is registered, with the same in-dungeon rule', () => {
  const names = new Set(rpcNames());
  for (const n of OLD_RPCS) {
    assert.ok(names.has(n), `${n} is registered`);
    assert.equal(allowedInRun(n), OLD_IN_RUN(n), `${n} in a run`);
  }
  assert.equal(allowedInRun('no.such'), false);
});

test('rpc dispatch: calls the registered function; unknown names fail politely; names are unique', () => {
  register('test.echo', (g, c, a) => ({ g, c, a }), { inRun: true });
  const r = dispatch('G', 'C', 'test.echo', { x: 1 });
  assert.deepEqual(r, { g: 'G', c: 'C', a: { x: 1 } });
  assert.deepEqual(dispatch('G', 'C', 'test.echo', null).a, {}, 'missing args become {}');
  assert.equal(allowedInRun('test.echo'), true);
  assert.throws(() => dispatch('G', 'C', 'nope'), (e) => e instanceof GameError && /Unknown action/.test(e.message));
  assert.throws(() => register('test.echo', () => {}), /twice/);
});

test('events: listeners get (client, data) in order; errors never break the emitter; off() stops them', () => {
  const got = [];
  const off = on('test.ev', (c, d) => got.push([c, d.n]));
  on('test.ev', () => {
    throw new Error('boom');
  });
  const err = console.error;
  console.error = () => {};
  try {
    emit('c1', 'test.ev', { n: 1 });
    off();
    emit('c2', 'test.ev', { n: 2 });
  } finally {
    console.error = err;
  }
  assert.deepEqual(got, [['c1', 1]]);
  emit(null, 'nobody.listens'); // fine
});

// A game in this process with a hero whose socket goes nowhere.
function setup() {
  const db = openDb(':memory:');
  const game = new Game(db, { shopSim: false });
  const id = Number(db.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?,?,?,?)').run('tut', 'x', 'y', Date.now()).lastInsertRowid);
  game.heroes.create(id, 'Tutee', {});
  const sent = [];
  const ws = { readyState: 1, send: (d) => sent.push(JSON.parse(d)), on() {}, close() {} };
  const c = game.connect(ws, id);
  return { db, game, c, sent };
}

test('the tutorial path emits gather, craft, kill and stock in order, and each pays its step', async () => {
  const { game, c, sent } = setup();
  const seen = [];
  const offs = ['gather', 'craft', 'kill', 'stock'].map((ev) => on(ev, (cc, d) => cc === c && seen.push(ev)));
  const gold0 = game.heroes.gold(c.hero.id);
  const ch = c.ch;
  try {
    // 1. Fell an oak.
    const oak = [...ch.nodes.values()].find((n) => n.type === 'tree_oak');
    Object.assign(c.ent, { x: oak.x + 1.6, z: oak.z });
    let now = Date.now();
    for (let k = 0; k < 40 && ch.nodes.get(oak.id).alive; k++) hitNode(game, c, oak.id, (now += 1000));
    assert.equal(ch.nodes.get(oak.id).alive, false, 'the oak fell');
    assert.equal(c.hero.tutorial, 1);
    // 2. Saw planks at the workbench (finished at once: graded D, still pays out).
    game.heroes.addItem(c.hero.id, 'oak_log', 4);
    const spot = spotsOf('workbench')[0];
    Object.assign(c.ent, { x: spot.x, z: spot.z });
    const st = dispatch(game, c, 'craft.start', { recipe: 'oak_plank', batch: 1 });
    dispatch(game, c, 'craft.finish', { sid: st.sid, inputs: [], end: 1, off: [0, 0] });
    assert.equal(c.hero.tutorial, 2);
    // 3. Slay a monster.
    const mob = [...ch.mobs.values()].find((m) => m.type === 'slime');
    const b = new Battle(ch, mob);
    ch.battles.set(b.id, b);
    b.join(c);
    b.mobHp = 1;
    b.choose(c, 'attack');
    b.resolve();
    assert.equal(c.hero.tutorial, 3);
    // 4. Stock a display.
    dispatch(game, c, 'shop.stock', { slot: 0, item: 'oak_plank', qty: 1, price: 10 });
    assert.equal(c.hero.tutorial, 4);
  } finally {
    offs.forEach((f) => f());
    game.stop();
  }
  assert.deepEqual(seen, ['gather', 'craft', 'kill', 'stock']);
  // The tutorial is hv_intro's first four steps now: each step done is one message.
  assert.deepEqual(sent.filter((m) => m.t === 'quest' && m.id === 'hv_intro' && m.stepDone != null).map((m) => m.stepDone), [0, 1, 2, 3]);
  const rewards = TUTORIAL.reduce((a, s) => a + s.reward, 0);
  assert.ok(game.heroes.gold(c.hero.id) - gold0 >= rewards, 'every step paid');
});

test('the tutorial ignores steps done out of order', () => {
  const { game, c } = setup();
  try {
    emit(c, 'stock', {});
    emit(c, 'kill', { monster: 'slime' });
    emit(c, 'craft', { out: 'oak_plank' });
    assert.equal(c.hero.tutorial, 0);
    emit(c, 'gather', { kind: 'rock', type: 'rock_stone', loot: {} });
    assert.equal(c.hero.tutorial, 0);
    emit(c, 'gather', { kind: 'tree', type: 'tree_oak', loot: { oak_log: 1 } });
    emit(c, 'craft', { out: 'birch_plank' });
    assert.equal(c.hero.tutorial, 1);
    // Step 3 wants a slime now, not just any fight.
    emit(c, 'craft', { out: 'oak_plank', qty: 2 });
    emit(c, 'kill', { monster: 'wolf' });
    assert.equal(c.hero.tutorial, 2);
    emit(c, 'kill', { monster: 'slime' });
    assert.equal(c.hero.tutorial, 3);
  } finally {
    game.stop();
  }
});

test('migrations: the six built in give user_version 6; the file loader adds nothing until it has files', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  // The same database built by hand (schema + the six), then the file
  // migrations: identical to what openDb gives, and nothing dropped.
  const ref = openDb(':memory:');
  const plain = new (db.constructor)(':memory:');
  plain.exec(SCHEMA_V0);
  migrate(plain);
  for (const t of schema(plain)) assert.ok(schema(ref).some((r) => r.name === t.name), `${t.name} is kept`);
  applyMigrations(plain);
  assert.deepEqual(schema(plain), schema(ref));
  if (!MIGRATIONS.length) assert.ok(!schema(ref).some((r) => r.name === 'schema_migrations'), 'nothing to apply: nothing touched');
  const before = schema(plain);
  assert.deepEqual(applyMigrations(plain, []), []);
  assert.deepEqual(schema(plain), before);
});

test('migrations: file migrations run once each, in order, and a failing one rolls back', () => {
  const db = openDb(':memory:');
  const order = [];
  const list = [
    { id: '901_a', fn: (d) => (order.push('a'), d.exec('CREATE TABLE t901 (x INTEGER)')) },
    { id: '902_b', fn: (d) => (order.push('b'), d.exec('ALTER TABLE t901 ADD COLUMN y INTEGER')) },
  ];
  assert.deepEqual(applyMigrations(db, list, 5), ['901_a', '902_b']);
  assert.deepEqual(applyMigrations(db, list, 6), [], 'second boot: nothing to do');
  assert.deepEqual(order, ['a', 'b']);
  assert.deepEqual(db.prepare("SELECT id, applied_at FROM schema_migrations WHERE id LIKE '90%' ORDER BY id").all().map((r) => [r.id, r.applied_at]), [['901_a', 5], ['902_b', 5]]);
  const bad = [{ id: '903_bad', fn: (d) => (d.exec('CREATE TABLE t903 (x)'), d.exec('NOT SQL')) }];
  assert.throws(() => applyMigrations(db, bad), /903_bad/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 't903'").get().n, 0, 'rolled back');
});

test('heroes: gold carries a reason; simple fields are whitelisted', () => {
  const { game, c } = setup();
  try {
    const seen = [];
    const off = on('gold', (cc, d) => seen.push(d));
    game.heroes.addGold(c.hero.id, 7, 'test');
    off();
    assert.deepEqual(seen, [{ id: c.hero.id, n: 7, reason: 'test' }]);
    assert.throws(() => game.heroes.getField(c.hero.id, 'gold'), /Unknown hero field/);
    assert.throws(() => game.heroes.setField(c.hero.id, 'name', 'x'), /Unknown hero field/);
  } finally {
    game.stop();
  }
});

test('re-exports: world.js still offers node types and walking; the game the tutorial', () => {
  assert.equal(W.NODE_TYPES, NODES_MOD.NODE_TYPES);
  for (const k of ['isWalkable', 'NavGrid', 'buildColliders', 'indexColliders', 'stepPath', 'approachPoint']) assert.equal(W[k], NAV[k], k);
  assert.equal(TUTORIAL, TUTORIAL2);
  const col = world().col;
  assert.equal(W.isWalkable(W.SPAWN.x, W.SPAWN.z, col), true);
});

test('places: Hearthvale is a town, the Wilds are wilds, the rest meadow', () => {
  assert.equal(townAt(0, 0)?.id, 'hearthvale');
  assert.equal(regionAt(0, 0)?.id, 'hearthvale');
  assert.equal(biomeAt(0, 0), 'meadow');
  const wilds = W.ZONES.find((z) => z.kind === 'wilds');
  assert.equal(biomeAt(wilds.x, wilds.z), 'wilds');
  assert.equal(townAt(5000, 5000), null);
  assert.equal(biomeAt(5000, 5000), 'meadow');
});

test('registries: content, model groups and code-drawn props', () => {
  assert.deepEqual(Object.keys(CONTENT.items), []);
  assert.throws(() => mergeInto({ a: 1 }, { a: 2 }, 'x'), /defined twice/);
  for (const slot of Object.keys(CORE)) assert.ok(MODELS[slot], slot);
  assert.deepEqual(checkManifest(), [], 'every slot in one group, every file there');
  assert.ok(GROUPS.core.includes('tree_oak') && GROUPS['kit:crypt'].includes('dg_chest') && GROUPS['mobs:hearthvale'].includes('mob_wolf'));
  assert.equal(groupOf('dg_fire'), 'core', 'the brazier by the crypt door is in town');
  const slot = Object.keys(CORE)[0];
  assert.equal(groupOf(slot), 'core');
  assert.throws(() => registerGroup('dupe', { [slot]: {} }), /two groups/);
  registerGroup('test', { test_slot: { url: '/x.glb' } });
  assert.equal(groupOf('test_slot'), 'test');
  assert.throws(() => registerProc('nope', () => null), /proc_/);
  registerProc('proc_test', () => null);
  assert.ok(PROC_BUILDERS.proc_test);
  assert.throws(() => registerProc('proc_test', () => null), /twice/);
});
