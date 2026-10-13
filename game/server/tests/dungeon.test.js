import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import * as W from '../../shared/world.js';
import { generateDungeon, dungeonCol, dungeonWalkable, dungeonBounds, partyScale, scaledDef, rollChest, trapUp, TRAP, KO_HP, weeklySeed, MAX_WIPES, FIRST_CLEAR_GOLD } from '../../shared/dungeon.js';
import { MONSTERS } from '../../shared/monsters.js';

// Dungeons: the generator, a solo run from the door to the boss, wipes,
// traps, coming back after a dropped connection, parties (ready check, room
// fights, scaling) and a plain town fight (the battle code is shared).

let srv;
let game;
let wss;
let base;

before(async () => {
  ({ server: srv, game, wss } = createServer(openDb(':memory:'), { shopSim: false }));
  game.auth.openSignup = true;
  game.start();
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  for (const ws of wss.clients) ws.terminate();
  game.stop();
  srv.close();
  srv.closeAllConnections?.();
});

const post = async (p, body, token) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

async function connect(token, name) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${token}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters])
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
  });
  const next = (pred, ms = 3000, from = 0) =>
    new Promise((resolve, reject) => {
      const hit = inbox.slice(from).find(pred);
      if (hit) return resolve(hit);
      waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error(`timeout in ${name}'s inbox (got ${inbox.filter((m) => m.t !== 's').map((m) => m.t).slice(-12).join(', ')})`)), ms);
    });
  let rid = 0;
  const call = (m, a = {}) => {
    const id = ++rid;
    ws.send(JSON.stringify({ t: 'rpc', m, a, rid: id }));
    return next((r) => r.t === 'res' && r.rid === id);
  };
  const send = (msg) => {
    const id = 10_000 + ++rid;
    ws.send(JSON.stringify({ ...msg, rid: id }));
    return next((r) => r.t === 'res' && r.rid === id);
  };
  const welcome = await next((m) => m.t === 'welcome');
  return { ws, inbox, next, call, send, welcome, id: welcome.you.id };
}
async function player(name) {
  const { body } = await post('/api/signup', { username: name.toLowerCase(), password: 'secret1' });
  assert.equal((await post('/api/hero', { name, avatar: {} }, body.token)).status, 200);
  return { ...(await connect(body.token, name)), token: body.token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (p) => game.online.get(p.id);
const runOf = (p) => client(p).ch;
const door = () => W.ENTRANCES[0];
const toDoor = (p) => {
  const [x, z] = W.entranceFront(door());
  Object.assign(client(p).ent, { x, z, path: null });
  client(p).lastRunAt = 0; // skip the breather between runs
};
// Stand a couple of metres from a monster, somewhere you could walk to it from.
function standNear(p, mob) {
  const ch = runOf(p);
  const e = client(p).ent;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = mob.x + Math.sin(a) * 2.2;
    const z = mob.z + Math.cos(a) * 2.2;
    if (ch.walkable(x, z) && ch.nav.clear(x, z, mob.x, mob.z)) return Object.assign(e, { x, z, path: null });
  }
  throw new Error('nowhere to stand');
}
// Monsters made harmless (and fragile) or deadly, for the length of a test.
function rig(run, change) {
  const orig = run.monsterDef;
  run.monsterDef = (mob, n) => ({ ...orig.call(run, mob, n), ...change });
  return () => (run.monsterDef = orig);
}
const weak = { hp: 1, atk: 1 };
const deadly = { hp: 9999, atk: 999, moves: [{ name: 'Doom', mult: 5 }] };

// Fight a monster (and its pack) to the end, taking action `a` each round.
async function fight(p, mob, a = 'attack') {
  standNear(p, mob);
  const start = p.inbox.length;
  const r = await p.send({ t: 'engage', mob: mob.id });
  assert.ok(r.ok, r.err);
  const b = client(p).battle;
  assert.ok(b, 'in a battle');
  for (let round = 0; round < 60; round++) {
    const done = p.inbox.slice(start).find((m) => m.t === 'battleEnd' && m.id === b.id);
    if (done) return done;
    const mark = p.inbox.length;
    p.ws.send(JSON.stringify({ t: 'bact', a }));
    await p.next((m) => (m.t === 'bres' || m.t === 'battleEnd') && m.id === b.id, 8000, mark);
    await sleep(5);
  }
  throw new Error('the fight never ended');
}

test('the generator: deterministic, connected, gated, key before the vault, boss at the end', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const party = 1 + (seed % 4);
    const d = generateDungeon(seed, { party, ox: 1000, oz: 1000 });
    assert.deepEqual(generateDungeon(seed, { party, ox: 1000, oz: 1000 }), d, 'same seed, same dungeon');
    const kinds = d.rooms.map((r) => r.kind);
    for (const k of ['entry', 'boss', 'vault', 'shrine', 'elite']) assert.equal(kinds.filter((x) => x === k).length, 1, `one ${k}`);
    assert.ok(d.rooms.length >= 10);
    const boss = d.rooms.find((r) => r.kind === 'boss');
    assert.ok(boss.main && boss.w === 5 && boss.h === 5);
    assert.equal(boss.depth, Math.max(...d.rooms.filter((r) => r.main).map((r) => r.depth)), 'the boss ends the main path');
    assert.ok(d.rooms.find((r) => r.kind === 'elite').main, 'the elite guards the main path');
    assert.ok(d.spawns.some((s) => s.key && s.elite), 'the elite has the key');
    assert.ok(d.spawns.filter((s) => s.room === boss.id).at(-1).boss, 'the boss steps in last');
    const vault = d.rooms.find((r) => r.kind === 'vault');
    assert.ok(d.gates.find((g) => g.to === vault.id).key, 'the Vault needs the key');
    assert.ok(!d.spawns.some((s) => s.room === vault.id || s.room === 0), 'nothing waits in the Vault or the Entry Hall');
    // Traps only on the way to the Vault and the Shrine.
    assert.equal(d.traps.length, 2);
    for (const t of d.traps) assert.ok(['vault', 'shrine'].includes(d.rooms[d.links.find((l) => l.cells.some(([i, j]) => Math.abs(d.ox + (i + 0.5) * 4 - t.x) < 0.01 && Math.abs(d.oz + (j + 0.5) * 4 - t.z) < 0.01)).b].kind));
    assert.ok(d.props.some((p) => p.use === 'rest') && d.props.some((p) => p.use === 'exit') && d.props.some((p) => p.use === 'vault') && d.props.some((p) => p.use === 'shrine'));
    // With every gate shut you're kept in the Entry Hall; open, you can walk everywhere.
    const col = dungeonCol(d);
    const bossMob = d.spawns.find((s) => s.boss);
    assert.equal(new W.NavGrid(col, { bounds: dungeonBounds(d), walkable: dungeonWalkable }).findPath(d.entry.x, d.entry.z, bossMob.x, bossMob.z), null, 'closed gates keep you in');
    col.closed.clear();
    const nav = new W.NavGrid(col, { bounds: dungeonBounds(d), walkable: dungeonWalkable });
    for (const s of d.spawns) assert.ok(nav.findPath(d.entry.x, d.entry.z, s.x, s.z), `seed ${seed}: ${s.monster} can be reached`);
    for (const p of d.props.filter((q) => q.use)) assert.ok(nav.findPath(d.entry.x, d.entry.z, p.x + (p.use === 'exit' ? 0 : 1.6), p.z + (p.use === 'exit' ? 1.6 : 0)) || nav.findPath(d.entry.x, d.entry.z, p.x, p.z + 1.6), `seed ${seed}: the ${p.use} can be reached`);
  }
  // Bigger parties meet more monsters, and each lasts longer and acts once per hero.
  const count = (n) => [1, 2, 3, 4, 5, 6, 7, 8].reduce((a, s) => a + generateDungeon(s, { party: n }).spawns.length, 0);
  assert.ok(count(4) > count(1), `${count(4)} vs ${count(1)}`);
  const solo = scaledDef(MONSTERS.thrall, 1);
  const four = scaledDef(MONSTERS.thrall, 4);
  assert.ok(four.hp > solo.hp * 4 && four.perFighter && solo.perFighter);
  assert.ok(scaledDef(MONSTERS.thrall, 1, { tier: 3 }).atk > solo.atk * 1.5);
  const elite = scaledDef(MONSTERS.crypt_skeleton, 1, { elite: true, affixes: ['armored', 'vampiric'] });
  assert.ok(elite.hp === MONSTERS.crypt_skeleton.hp * 2 && elite.def === MONSTERS.crypt_skeleton.def + 8 && elite.drain === 0.5 && /Armored/.test(elite.name));
  // Groups earn more per head; the first clear of the day pays double.
  assert.ok(partyScale(4).reward > partyScale(1).reward);
  const r0 = () => 0;
  const plain = rollChest('hollow_crypt', 'boss', { rng: r0 });
  const first = rollChest('hollow_crypt', 'boss', { rng: r0, firstToday: true });
  assert.equal(first.gold, plain.gold + FIRST_CLEAR_GOLD);
  const n = (l) => Object.values(l.items).reduce((a, b) => a + b, 0);
  assert.ok(n(first) > n(plain));
});

test('a solo run: door, gates, no regen, Last Light, key, vault, boss, chest, records, out', async () => {
  const a = await player('Delver');
  assert.match((await a.call('dungeon.enter', { kind: 'hollow_crypt' })).err, /Walk up to the crypt door/);
  toDoor(a);
  const townPos = { x: client(a).ent.x, z: client(a).ent.z };
  const info0 = (await a.call('dungeon.info', { kind: 'hollow_crypt' })).data;
  assert.deepEqual(info0.tiers.map((t) => t.unlocked), [true, ...info0.tiers.slice(1).map(() => false)]);
  assert.deepEqual(info0.tiers.slice(0, 4).map((t) => t.name), ['Tier 1', 'Tier 2', 'Tier 3', 'Deep']);
  assert.ok(info0.tiers[0].firstToday);
  assert.match((await a.call('dungeon.enter', { kind: 'hollow_crypt', tier: 2 })).err, /Clear Tier 1 first/);
  const w = a.next((m) => m.t === 'welcome' && m.dungeon, 3000, a.inbox.length);
  const r = await a.call('dungeon.enter', { kind: 'hollow_crypt' });
  assert.ok(r.ok, r.err);
  const dm = (await w).dungeon;
  const run = runOf(a);
  assert.ok(run.isRun && dm.run === run.id && dm.layout.rooms.length === run.layout.rooms.length);
  // The Entry Hall is safe, so its doors stand open and the first halls show.
  assert.ok(dm.state.revealed.includes(0) && dm.state.revealed.length < run.layout.rooms.length / 2);
  assert.ok(dm.state.open.length >= 1 && dm.state.open.length < run.layout.gates.length);
  assert.ok(Math.hypot(client(a).ent.x - run.layout.entry.x, client(a).ent.z - run.layout.entry.z) < 3, 'starts in the Entry Hall');
  // Only some things work underground.
  assert.match((await a.call('travel', { to: 'stone_square' })).err, /Not inside the crypt/);
  assert.match((await a.call('shop.enter', { owner: a.id })).err, /Not inside the crypt/);
  assert.match((await a.call('channel.switch', { id: 1 })).err, /Not inside the crypt/);
  assert.match((await a.send({ t: 'cast', node: 'x' })).err, /Not inside the crypt/);
  assert.ok((await a.call('party.get')).ok);
  assert.match((await a.call('dungeon.enter', { kind: 'hollow_crypt' })).err, /already in a dungeon|Walk up/);
  // No health comes back on its own; a potion does.
  client(a).ent.hp = 50;
  await sleep(600);
  assert.equal(Math.round(client(a).ent.hp), 50, 'no health regeneration in a dungeon');
  game.heroes.addItem(a.id, 'health_potion', 1);
  const dr = await a.call('drink', { item: 'health_potion' });
  assert.ok(dr.ok && dr.data.heal > 0, dr.err);
  // Last Light: one full heal at the brazier, once.
  const brazier = run.layout.props.find((p) => p.use === 'rest');
  client(a).ent.hp = 20;
  Object.assign(client(a).ent, { x: brazier.x + 1.8, z: brazier.z });
  assert.ok((await a.call('dungeon.use', { what: 'rest' })).ok);
  assert.equal(client(a).ent.hp, client(a).ent.maxHp);
  assert.match((await a.call('dungeon.use', { what: 'rest' })).err, /Last Light/);
  // The Vault is shut until the key turns up.
  const vault = run.layout.props.find((p) => p.use === 'vault');
  Object.assign(client(a).ent, { x: vault.x + 1.6, z: vault.z });
  assert.match((await a.call('dungeon.use', { what: 'vault' })).err, /locked/);
  // Can't fight through bars: a monster in the next room is out of reach.
  const D = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const shut = run.layout.gates
    .filter((g) => run.dcol.closed.has(g.id))
    .flatMap((g) => [...run.mobs.values()].filter((m) => m.room === g.to).map((m) => ({ m, x: g.x - D[g.dir][0] * 1.2, z: g.z - D[g.dir][1] * 1.2 })))
    .sort((p, q) => Math.hypot(p.x - p.m.x, p.z - p.m.z) - Math.hypot(q.x - q.m.x, q.z - q.m.z))[0];
  if (shut && Math.hypot(shut.x - shut.m.x, shut.z - shut.m.z) <= 6) {
    Object.assign(client(a).ent, { x: shut.x, z: shut.z, path: null });
    assert.match((await a.send({ t: 'engage', mob: shut.m.id })).err, /can't reach/);
  }

  // Clear the rooms in order of depth: each room's pack is one chained fight.
  const unrig = rig(run, weak);
  let gates = 0;
  let healed = false;
  let chained = false;
  for (;;) {
    const mob = [...run.mobs.values()].filter((m) => m.state !== 'dead').sort((m1, m2) => run.layout.rooms[m1.room].depth - run.layout.rooms[m2.room].depth || m1.boss - m2.boss)[0];
    if (!mob) break;
    const pack = [...run.mobs.values()].filter((m) => m.room === mob.room && m.state !== 'dead').length;
    client(a).ent.hp = Math.round(client(a).ent.maxHp / 2);
    const mark = a.inbox.length;
    const end = await fight(a, mob);
    assert.equal(end.victory, true);
    assert.ok(end.inRun);
    assert.ok([...run.mobs.values()].every((m) => m.room !== mob.room || m.state === 'dead'), 'the whole pack fell in one fight');
    if (pack > 1) chained ||= a.inbox.slice(mark).some((m) => m.t === 'bres' && m.ev.some((e) => e.k === 'next'));
    healed ||= a.inbox.slice(mark).some((m) => m.t === 'droom') && client(a).ent.hp > client(a).ent.maxHp / 2;
    gates += a.inbox.slice(mark).filter((m) => m.t === 'dgate').length;
  }
  unrig();
  assert.ok(chained, 'packs step in one after another');
  assert.ok(healed, 'clearing a room heals a little');
  assert.ok(gates >= 4, 'gates opened as rooms were cleared');
  assert.ok(run.hasKey && run.bossDown);
  assert.equal(run.dcol.closed.size, 0, 'every gate is open at the end');
  const boss = await a.next((m) => m.t === 'dboss');
  assert.ok(boss.seconds >= 0 && boss.best);
  assert.ok(run.revealed.size >= run.layout.rooms.filter((r) => r.main).length);
  const rec = game.db.prepare('SELECT * FROM dungeon_runs ORDER BY id DESC LIMIT 1').get();
  assert.equal(rec.kind, 'hollow_crypt');
  assert.equal(rec.party, 1);
  assert.deepEqual(JSON.parse(rec.hero_ids), [a.id]);

  // The boss chest was given when he fell (first clear of the day: a bonus).
  assert.match((await a.call('dungeon.use', { what: 'boss' })).err, /Walk up to the chest/);
  Object.assign(client(a).ent, { x: run.layout.bossChest.x, z: run.layout.bossChest.z + 1 });
  const bc = await a.call('dungeon.use', { what: 'boss' });
  assert.ok(bc.ok, bc.err);
  assert.ok(bc.data.firstToday && bc.data.gold >= FIRST_CLEAR_GOLD && bc.data.items.grave_dust >= 1);
  // The Vault: the first to open it opens it for everyone; it gives once.
  Object.assign(client(a).ent, { x: vault.x + 1.6, z: vault.z });
  const gold0 = game.heroes.gold(a.id);
  const v1 = await a.call('dungeon.use', { what: 'vault' });
  assert.ok(v1.ok, v1.err);
  assert.ok(v1.data.gold > 0 && v1.data.items.grave_dust >= 1);
  assert.equal(game.heroes.gold(a.id), gold0 + v1.data.gold);
  const v2 = await a.call('dungeon.use', { what: 'vault' });
  assert.deepEqual(v2.data, v1.data, 'opening it again shows what you got');
  assert.equal(game.heroes.gold(a.id), gold0 + v1.data.gold, 'but gives nothing more');

  // Out again: where you went in, in a town channel.
  const back = a.next((m) => m.t === 'welcome' && m.channel, 3000, a.inbox.length);
  assert.ok((await a.call('dungeon.leave')).ok);
  await back;
  assert.ok(!runOf(a).isRun);
  assert.ok(Math.hypot(client(a).ent.x - townPos.x, client(a).ent.z - townPos.z) < 2.5);
  for (let k = 0; k < 20 && game.runs.has(run.id); k++) await sleep(50);
  assert.ok(!game.runs.has(run.id), 'an empty run closes');

  // Tier 2 is open now; the day's bonus is spent.
  const info = (await a.call('dungeon.info', { kind: 'hollow_crypt' })).data;
  assert.deepEqual(info.tiers.map((t) => t.unlocked).slice(0, 4), [true, true, false, false]);
  assert.equal(info.tiers[0].firstToday, false);
  assert.equal(info.tiers[0].best[0].party, 1);
  assert.match((await a.call('dungeon.enter', { kind: 'hollow_crypt', tier: 2 })).err, /Catch your breath/);
  toDoor(a);
  assert.ok((await a.call('dungeon.enter', { kind: 'hollow_crypt', tier: 2, mode: 'weekly' })).ok);
  const run2 = runOf(a);
  assert.ok(run2.tier === 2 && run2.mode === 'weekly');
  const m2 = [...run2.mobs.values()].find((m) => !m.elite && !m.boss);
  assert.ok(run2.monsterDef(m2, 1).hp > MONSTERS[m2.type].hp * 1.3, 'tier 2 monsters are tougher');
  // This week's crypt is the same for everyone.
  assert.equal(run2.layout.seed, weeklySeed('hollow_crypt', 2));
  // The day's bonus is once per dungeon kind (any tier): Tier 2 doesn't earn it again.
  const unrig2 = rig(run2, weak);
  const bossMob = [...run2.mobs.values()].find((m) => m.boss);
  await fight(a, bossMob);
  unrig2();
  assert.ok(run2.bossDown);
  assert.equal(run2.grants.get(a.id).boss.firstToday, false);
  assert.equal(game.bestTier(a.id, 'hollow_crypt'), 2);
  await a.call('dungeon.leave');
  a.ws.close();
});

test('wipes send you back to the Entry Hall (the fourth ends the run); traps; a dropped connection keeps your seat', async () => {
  const b = await player('Wanderer');
  toDoor(b);
  await b.call('dungeon.enter', { kind: 'hollow_crypt' });
  const run = runOf(b);
  const c = client(b);
  const unrig = rig(run, deadly);
  const mob = [...run.mobs.values()].find((m) => run.layout.rooms[m.room].depth === 1);
  const end = await fight(b, mob, 'defend');
  assert.equal(end.victory, false);
  const wipe = await b.next((m) => m.t === 'dwipe');
  assert.equal(wipe.left, MAX_WIPES);
  assert.ok(Math.hypot(c.ent.x - run.layout.entry.x, c.ent.z - run.layout.entry.z) < 6, 'woke at the entry');
  assert.equal(c.ent.hp, Math.round(c.stats().hp * KO_HP));
  assert.equal(mob.state, 'roam', 'the pack is still there');
  // Running away isn't a wipe.
  standNear(b, mob);
  assert.ok((await b.send({ t: 'engage', mob: mob.id })).ok);
  b.ws.send(JSON.stringify({ t: 'bact', a: 'flee' }));
  await b.next((m) => m.t === 'battleEnd' && m.mob === mob.id, 3000, b.inbox.length - 2);
  assert.equal(run.wipes, 1);
  assert.equal(mob.state, 'roam');

  // Traps: standing on raised spikes hurts, once per rise.
  const t = run.layout.traps[0];
  for (let k = 0; k < 400 && trapUp(t, Date.now() - run.startedAt); k++) await sleep(10);
  Object.assign(c.ent, { x: t.x, z: t.z, path: null, hp: c.ent.maxHp });
  const hit = await b.next((m) => m.t === 'dtrap' && m.who === b.id, TRAP.cycle + 1000, b.inbox.length);
  assert.ok(hit.dmg > 0 && c.ent.hp === c.ent.maxHp - hit.dmg);
  await sleep(TRAP.up - 100);
  assert.equal(c.ent.hp, c.ent.maxHp - hit.dmg, 'once per rise');

  // Drop the connection: the seat (and your health) is kept; you come back inside.
  c.ent.hp = 33;
  b.ws.close();
  await sleep(150);
  const saved = game.heroes.load(b.id);
  assert.ok(Math.hypot(saved.x - W.entranceFront(door())[0], saved.z - W.entranceFront(door())[1]) < 3, 'the saved position is where you went in');
  const again = { ...(await connect(b.token, 'Wanderer again')), id: b.id };
  assert.equal(again.welcome.dungeon?.run, run.id);
  assert.equal(again.welcome.dungeon.state.wipes, 1);
  assert.equal(client(again).ent.hp, 33);

  // Three more wipes and the crypt throws you out.
  for (let k = 0; k < MAX_WIPES; k++) {
    const mark = again.inbox.length;
    await fight(again, mob, 'defend');
    await again.next((m) => m.t === 'dwipe', 3000, mark);
  }
  const out = await again.next((m) => m.t === 'welcome' && m.channel, 3000, again.inbox.length - 6);
  assert.ok(out && !runOf(again).isRun);
  assert.ok(!game.runs.has(run.id));
  unrig();
  again.ws.close();
});

test('parties: invite, ready check, in together, room fights pull everyone in, harder monsters, chat stays inside', async () => {
  const lead = await player('Captain');
  const mate = await player('Firstmate');
  const outsider = await player('Outsider');
  assert.match((await mate.call('party.invite', { id: mate.id })).err, /yourself/);
  assert.ok((await lead.call('party.invite', { id: mate.id })).ok);
  const inv = await mate.next((m) => m.t === 'partyInvite');
  assert.equal(inv.from.name, 'Captain');
  const acc = await mate.call('party.answer', { accept: true });
  assert.ok(acc.ok, acc.err);
  assert.equal(acc.data.party.members.length, 2);
  await lead.next((m) => m.t === 'party' && m.party?.members.length === 2);
  assert.ok((await lead.call('profile', { id: mate.id })).data.sameParty);
  assert.match((await mate.call('dungeon.enter', { kind: 'hollow_crypt', party: true })).err, /Walk up/);
  toDoor(mate);
  assert.match((await mate.call('dungeon.enter', { kind: 'hollow_crypt', party: true })).err, /leader/);
  // The ready check: in when everyone has answered.
  toDoor(lead);
  const r = await lead.call('dungeon.enter', { kind: 'hollow_crypt', party: true });
  assert.ok(r.ok && r.data.ready, r.err);
  const ask = await mate.next((m) => m.t === 'dready');
  assert.equal(ask.from, 'Captain');
  assert.ok(!runOf(lead).isRun, 'nobody goes in before the answers');
  assert.match((await lead.call('dungeon.enter', { kind: 'hollow_crypt', party: true })).err, /already running/);
  const wl = lead.next((m) => m.t === 'welcome' && m.dungeon, 3000, lead.inbox.length);
  const wm = mate.next((m) => m.t === 'welcome' && m.dungeon, 3000, mate.inbox.length);
  assert.ok((await mate.call('dungeon.ready', { yes: true })).ok);
  await Promise.all([wl, wm]);
  const run = runOf(lead);
  assert.ok(run.isRun);
  assert.equal(runOf(mate), run);
  assert.equal(run.partySize, 2);
  assert.ok((await outsider.call('profile', { id: lead.id })).data.dungeon);
  // Monsters scale for two (and more monsters wait than for one).
  const mob = [...run.mobs.values()].find((m) => run.layout.rooms[m.room].depth === 1);
  assert.ok(run.monsterDef(mob, 2).hp > run.monsterDef(mob, 1).hp * 2);
  // A fight in a room pulls in everyone standing in it.
  run.cleared.add(0);
  for (const g of run.layout.gates) if (g.from === 0) run.dcol.closed.delete(g.id);
  run.navGrid.invalidate();
  standNear(lead, mob);
  standNear(mate, mob);
  const unrig = rig(run, { atk: 1 });
  assert.ok((await lead.send({ t: 'engage', mob: mob.id })).ok);
  const b = client(lead).battle;
  assert.equal(client(mate).battle, b, 'the mate was pulled in');
  assert.equal(b.fighters.size, 2);
  assert.equal(b.mobMax, run.monsterDef(mob, 2).hp);
  // Each hero still standing draws a monster action.
  const mark = lead.inbox.length;
  lead.ws.send(JSON.stringify({ t: 'bact', a: 'defend' }));
  mate.ws.send(JSON.stringify({ t: 'bact', a: 'defend' }));
  const res = await lead.next((m) => m.t === 'bres' && m.id === b.id, 3000, mark);
  assert.equal(res.ev.filter((e) => e.from === 'mob').length, 2, 'the monster acts once per hero');
  for (const p of [lead, mate]) p.ws.send(JSON.stringify({ t: 'bact', a: 'flee' }));
  await lead.next((m) => m.t === 'battleEnd' && m.id === b.id);
  unrig();
  assert.equal(run.wipes, 0);
  // Chat in a run reaches the party only.
  lead.ws.send(JSON.stringify({ t: 'chat', text: 'hello crypt' }));
  await mate.next((m) => m.t === 'chat' && m.text === 'hello crypt');
  await sleep(150);
  assert.ok(!outsider.inbox.some((m) => m.t === 'chat' && m.text === 'hello crypt'));
  // Leave: no coming back to the same run; the party sees where you are.
  await mate.call('dungeon.leave');
  assert.match((await mate.call('dungeon.join', { run: run.id })).err, /can't rejoin/);
  const view = (await lead.call('party.get')).data;
  assert.deepEqual(view.members.map((m) => m.where).sort(), ['dungeon', 'town']);
  assert.equal(view.run, run.id);
  assert.ok((await mate.call('party.leave')).ok);
  await lead.next((m) => m.t === 'party' && m.party === null);
  await lead.call('dungeon.leave');
  for (const p of [lead, mate, outsider]) p.ws.close();
});

test('a party member who said no can join later; a ready check times out to whoever said yes', async () => {
  const [l, m1, m2] = [await player('Leader'), await player('Second'), await player('Third')];
  for (const m of [m1, m2]) {
    await l.call('party.invite', { id: m.id });
    await m.next((x) => x.t === 'partyInvite');
    assert.ok((await m.call('party.answer', { accept: true })).ok);
  }
  toDoor(l);
  assert.ok((await l.call('dungeon.enter', { kind: 'hollow_crypt', party: true })).ok);
  await m1.call('dungeon.ready', { yes: true });
  await m2.call('dungeon.ready', { yes: false });
  const run = runOf(l);
  assert.ok(run.isRun && runOf(m1) === run && !runOf(m2).isRun);
  assert.equal(run.partySize, 2, 'built for the two who went');
  await m2.next((x) => x.t === 'toast' && /without you/.test(x.text));
  const info = (await m2.call('dungeon.info', { kind: 'hollow_crypt' })).data;
  assert.ok(info.partyRun?.canJoin);
  const j = await m2.call('dungeon.join', { run: run.id });
  assert.ok(j.ok, j.err);
  assert.equal(runOf(m2), run);
  for (const p of [l, m1, m2]) await p.call('dungeon.leave');
  for (let k = 0; k < 20 && game.runs.has(run.id); k++) await sleep(50);
  // Time's up: in go those who said yes (here, just the leader).
  const p = game.parties.get(l.id);
  toDoor(l);
  await l.call('dungeon.enter', { kind: 'hollow_crypt', party: true });
  p.ready.until = Date.now() - 1;
  for (let k = 0; k < 60 && !runOf(l).isRun; k++) await sleep(50);
  assert.ok(runOf(l).isRun && !runOf(m1).isRun && !runOf(m2).isRun);
  assert.equal(runOf(l).partySize, 1);
  await l.call('dungeon.leave');
  for (const x of [l, m1, m2]) x.ws.close();
});

test('town fights still work as before (one monster, it respawns)', async () => {
  const t = await player('Townsfolk');
  const ch = client(t).ch;
  const mob = [...ch.mobs.values()].find((m) => m.state === 'roam' && !MONSTERS[m.type].boss);
  assert.ok(mob);
  const orig = ch.monsterDef;
  ch.monsterDef = (m) => ({ ...orig.call(ch, m), hp: 1, atk: 1 });
  Object.assign(client(t).ent, { x: mob.x + 2, z: mob.z, path: null });
  mob.path = null;
  const r = await t.send({ t: 'engage', mob: mob.id });
  assert.ok(r.ok, r.err);
  const b = client(t).battle;
  assert.equal(b.queue.length, 0, 'town monsters fight alone');
  t.ws.send(JSON.stringify({ t: 'bact', a: 'attack' }));
  const end = await t.next((m) => m.t === 'battleEnd' && m.id === b.id, 4000);
  ch.monsterDef = orig;
  assert.ok(end.victory && !end.inRun);
  assert.ok(end.results[t.id].gold >= 0 && end.results[t.id].xp);
  assert.equal(mob.state, 'dead');
  assert.ok(mob.respawnAt > Date.now() && mob.respawnAt < Infinity);
  t.ws.close();
});

test('safety: no skipping tiers by joining, a run closing mid-fight ends the fight, the fourth wipe says so, held seats count', async () => {
  const vet = await player('Veteran');
  const rookie = await player('Rookie');
  // The veteran has cleared Tier 1, so can lead a Tier 2 run; the rookie can't join it.
  game.db.prepare('INSERT INTO dungeon_runs (kind, tier, mode, week, party, heroes, hero_ids, seconds, finished_at) VALUES (?,?,?,?,?,?,?,?,?)').run('hollow_crypt', 1, 'random', 0, 1, '["Veteran"]', JSON.stringify([vet.id]), 999, Date.now());
  await vet.call('party.invite', { id: rookie.id });
  await rookie.next((m) => m.t === 'partyInvite');
  await rookie.call('party.answer', { accept: true });
  toDoor(vet);
  assert.match((await vet.call('dungeon.enter', { kind: 'hollow_crypt', tier: 2, party: true })).err, /Rookie can't go in yet: Clear Tier 1 first/);
  assert.ok((await vet.call('dungeon.enter', { kind: 'hollow_crypt', tier: 2 })).ok, 'alone is fine');
  const run = runOf(vet);
  assert.equal(run.tier, 2);
  // (A solo run isn't the party's; make it theirs to try joining.)
  run.partyId = game.parties.get(vet.id).id;
  assert.match((await rookie.call('dungeon.join', { run: run.id })).err, /Clear Tier 1 first/);
  // Held seats count toward the four.
  assert.equal(run.seats(), 1);
  run.members.set(-1, { name: 'Ghost', goneAt: Date.now() });
  run.members.set(-2, { name: 'Ghost2', goneAt: Date.now() });
  run.members.set(-3, { name: 'Ghost3', goneAt: Date.now() });
  assert.ok(run.full && !run.canJoin(12345));
  for (const id of [-1, -2, -3]) run.members.delete(id);

  // Closing mid-fight: out of the battle properly, with the health it left you.
  const unrig = rig(run, { hp: 9999, atk: 5 });
  const mob = [...run.mobs.values()].find((m) => run.layout.rooms[m.room].depth === 1);
  standNear(vet, mob);
  assert.ok((await vet.send({ t: 'engage', mob: mob.id })).ok);
  const b = client(vet).battle;
  b.fighters.get(vet.id).hp = 42;
  const mark = vet.inbox.length;
  game.failRun(run);
  assert.match((await vet.send({ t: 'engage', mob: mob.id })).err, /closing|Already/);
  const out = await vet.next((m) => m.t === 'welcome' && m.channel, 3000, mark);
  assert.ok(out && !client(vet).battle && !runOf(vet).isRun);
  assert.equal(client(vet).ent.hp, 42, 'the health from the fight comes out with you');
  assert.ok(vet.inbox.slice(mark).some((m) => m.t === 'battle' && m.left === vet.id && m.why === 'closed'), 'told the battle is over for you');
  assert.ok(vet.inbox.slice(mark).some((m) => m.t === 'toast' && /had enough of you/.test(m.text)), 'the failure message arrives');
  assert.equal(mob.battle, null);
  assert.ok(!game.runs.has(run.id));
  unrig();
  for (const p of [vet, rookie]) p.ws.close();
});

// ── Dungeon kinds (Phase 1, M5) ──
import fs from 'node:fs';
import { useMap, SHIPPED_MAP } from '../map.js';
import { rebuildWorld } from '../static.js';
import { Battle } from '../battle.js';
import { mobStats } from '../../shared/monsters.js';
import { xpForLevel } from '../../shared/skills.js';
import { DUNGEONS, TIERS, NIGHTMARE, DEEP, nightmareKind, featuredKind, KINDS, recFor, word, standardChests } from '../../shared/dungeon.js';
import { harness } from './harness.js';
import { twoTownMap, addTestvaleCave, removeTestvaleCave, TV } from './twotown.js';

test("Nightmare restats every monster to level 46; Deep is the fourth tier", () => {
  const n = scaledDef(MONSTERS.thrall, 1, { tier: NIGHTMARE });
  assert.deepEqual([n.hp, n.atk, n.def], [1301, 122, 46]);
  const boss = scaledDef(MONSTERS.pale_count, 1, { tier: NIGHTMARE });
  assert.deepEqual([boss.hp, boss.atk, boss.def], [2602, 128, 48]);
  const s = mobStats(46, 'normal');
  assert.equal(n.xp, s.xp * 4, 'tier 1 multipliers, loot ×4');
  assert.equal(TIERS[NIGHTMARE].loot, 4);
  const deep = scaledDef(MONSTERS.thrall, 1, { tier: DEEP });
  assert.equal(deep.hp, Math.round(MONSTERS.thrall.hp * 3.0));
  assert.equal(TIERS[DEEP].name, 'Deep');
  assert.deepEqual(recFor('hollow_crypt', DEEP), { level: 18, gear: null });
  assert.equal(word('hollow_crypt'), 'crypt');
  assert.ok(KINDS().includes(nightmareKind()) && KINDS().includes(featuredKind()));
});

test("Testvale's cave kind generates, runs to the boss, and pays its own reagent", () => {
  addTestvaleCave();
  useMap(twoTownMap({ cave: true }));
  rebuildWorld();
  const { game, hero, call, done } = harness();
  try {
    for (let seed = 1; seed <= 20; seed++) {
      const L = generateDungeon(seed, { kind: 'testvale_cave', tier: 2 });
      assert.equal(L.kind, 'testvale_cave');
      assert.ok(L.spawns.some((x) => x.boss && x.monster === 'pale_count'));
    }
    const c = hero('Caver');
    const door = W.ENTRANCES.find((e) => e.kind === 'testvale_cave');
    Object.assign(c.ent, { x: door.x, z: door.z + 6 });
    assert.match(call(c, 'dungeon.enter', { kind: 'testvale_cave', tier: DEEP }).err, /Clear Tier 3 first/);
    const info = call(c, 'dungeon.info', { kind: 'testvale_cave' }).data;
    assert.equal(info.word, 'cave');
    assert.deepEqual(info.tiers.find((t) => t.tier === 1).rec, { level: 13, gear: null });
    assert.ok(call(c, 'dungeon.enter', { kind: 'testvale_cave', tier: 1 }).ok);
    const run = c.ch;
    assert.ok(run.isRun && run.kind === 'testvale_cave');
    // Fight the boss's pack down (the test skips the walk).
    c.fx = { at: Date.now() + 1e9, E: {} };
    const boss = [...run.mobs.values()].find((m) => m.boss);
    const b = new Battle(run, boss);
    run.battles.set(b.id, b);
    b.join(c);
    for (let k = 0; k < 20 && !b.over; k++) {
      b.fighters.get(c.id).hp = 9999;
      b.mobHp = 1;
      b.choose(c, 'attack');
      b.resolve();
    }
    assert.ok(run.bossDown, 'the boss fell');
    const loot = run.grants.get(c.id)?.boss;
    assert.ok(loot.items.slime_gel >= 3, `the cave's reagent: ${JSON.stringify(loot.items)}`);
    assert.equal(loot.firstToday, true);
    assert.ok(loot.gold >= 24 * 13, 'gold scaled by its Tier 1 level');
    // A second clear of the same kind today (any tier) pays no first-clear bonus.
    assert.equal(game.firstClearToday(c.id, 'testvale_cave'), false);
    assert.equal(game.firstClearToday(c.id, 'hollow_crypt'), true, 'another kind still has its own');
  } finally {
    done();
    useMap(JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8')));
    rebuildWorld();
    removeTestvaleCave();
  }
});

test("the week's Nightmare needs Tier 3 and Combat 40, and only in its week", () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Dreamer');
    const kind = nightmareKind();
    assert.match(game.tierLock(c.id, kind, NIGHTMARE), /Clear Tier 3 first/);
    game.db.prepare("INSERT INTO dungeon_runs (kind, tier, mode, week, party, heroes, hero_ids, seconds, finished_at) VALUES (?, 3, 'random', 0, 1, '[]', ?, 100, ?)").run(kind, JSON.stringify([c.id]), Date.now());
    assert.match(game.tierLock(c.id, kind, NIGHTMARE), /Combat 40/);
    c.hero.skills.combat = xpForLevel(40);
    assert.equal(game.tierLock(c.id, kind, NIGHTMARE), null);
    assert.equal(game.tierLock(c.id, kind, DEEP), null, 'Deep opens after Tier 3');
    // Chests by the standard rule: nothing is a real outcome, and the boss rolls twice.
    const C = standardChests({ rec1: 10, bar: 'iron_bar', food: 'grilled_fish', gem: 'sapphire' });
    assert.deepEqual(C.vault.gold, [100, 180]);
    assert.equal(C.boss.rolls, 2);
  } finally {
    done();
  }
});
