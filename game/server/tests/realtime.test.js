import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import { generateNodes, NODE_TYPES, approachPoint, generateScenery, buildColliders } from '../../shared/world.js';

let srv;
let game;
let base;

before(async () => {
  const db = openDb(':memory:');
  ({ server: srv, game } = createServer(db));
  game.auth.openSignup = true;
  game.start();
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  game.stop();
  srv.close();
  srv.closeAllConnections?.();
});

async function post(path, body, token) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// A scripted player: an account, a hero, and a live socket with a message inbox.
async function player(name) {
  const { body } = await post('/api/signup', { username: name.toLowerCase(), password: 'secret1' });
  const hero = await post('/api/hero', { name, avatar: {} }, body.token);
  assert.equal(hero.status, 200, JSON.stringify(hero.body));
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${body.token}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(m);
    }
  });
  const next = (pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) return resolve(hit);
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error(`timeout waiting in ${name}'s inbox`)), ms);
    });
  let rid = 0;
  const rpc = (t, payload) => {
    const id = ++rid + 1000;
    ws.send(JSON.stringify({ ...payload, t, rid: id }));
    return next((m) => m.t === 'res' && m.rid === id);
  };
  const welcome = await next((m) => m.t === 'welcome');
  return { ws, inbox, next, rpc, welcome, id: welcome.you.id, token: body.token };
}

test('players see each other join, move, chat and leave in real time', async () => {
  const a = await player('Ann');
  const b = await player('Ben');
  assert.equal(a.welcome.channel, b.welcome.channel, 'fill-first puts friends in the same channel');
  assert.ok(b.welcome.players.some((p) => p.id === a.id), 'Ben sees Ann already in the lobby');
  const join = await a.next((m) => m.t === 'join' && m.p.id === b.id);
  assert.equal(join.p.name, 'Ben');
  const bStart = b.welcome.you;
  assert.ok(Math.hypot(bStart.x - a.welcome.you.x, bStart.z - a.welcome.you.z) >= 1.2, 'no spawning inside each other');

  // Ben walks; Ann receives snapshots with his position changing.
  b.ws.send(JSON.stringify({ t: 'move', x: bStart.x + 6, z: bStart.z + 2 }));
  const snap = await a.next((m) => m.t === 's' && m.p.some((r) => r[0] === b.id && r[4] === 'walk'));
  assert.ok(snap);
  await new Promise((r) => setTimeout(r, 1400));
  const last = [...a.inbox].reverse().find((m) => m.t === 's' && m.p.some((r) => r[0] === b.id)).p.find((r) => r[0] === b.id);
  assert.ok(Math.abs(last[1] - (bStart.x + 6)) < 0.6 && Math.abs(last[2] - (bStart.z + 2)) < 0.6, `Ben arrived (${last})`);

  b.ws.send(JSON.stringify({ t: 'chat', text: '  hello   there  ' }));
  const chat = await a.next((m) => m.t === 'chat' && m.from === b.id);
  assert.equal(chat.text, 'hello there');

  b.ws.close();
  await a.next((m) => m.t === 'leave' && m.id === b.id);
  a.ws.close();
});

test('gathering is validated by the server and shared between players', async () => {
  const a = await player('Cam');
  const b = await player('Dee');
  const oak = generateNodes().find((n) => n.type === 'tree_oak');
  // Too far away: rejected.
  const far = await a.rpc('hit', { node: oak.id });
  assert.equal(far.ok, false);
  assert.match(far.err, /closer/);
  // Walk both to the tree.
  const col = buildColliders(generateNodes(), generateScenery());
  for (const p of [a, b]) {
    const ap = approachPoint(oak, p.welcome.you.x, p.welcome.you.z, col);
    p.ws.send(JSON.stringify({ t: 'move', x: ap[0], z: ap[1] }));
  }
  await new Promise((r) => setTimeout(r, 11000));
  let hp = NODE_TYPES.tree_oak.hp;
  // Swinging faster than the axe allows is ignored, not counted.
  const r1 = await a.rpc('hit', { node: oak.id });
  assert.equal(r1.ok, true, r1.err);
  const r2 = await a.rpc('hit', { node: oak.id });
  assert.equal(r2.data.tooFast, true);
  hp -= 1;
  // Ben sees Cam's swing.
  const seen = await b.next((m) => m.t === 'nh' && m.by === a.id);
  assert.equal(seen.hp, hp);
  // Both chop until it falls; both get logs.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 730));
    const who = i % 2 ? a : b;
    const r = await who.rpc('hit', { node: oak.id });
    if (r.data?.broke || (!r.ok && /regrowing/.test(r.err))) break;
  }
  const lootA = await a.next((m) => m.t === 'loot');
  const lootB = await b.next((m) => m.t === 'loot');
  assert.ok(lootA.loot.oak_log >= 2 && lootB.loot.oak_log >= 2, 'co-op chopping rewards everyone who helped');
  const dead = await b.next((m) => m.t === 'node' && m.id === oak.id && m.alive === false);
  assert.ok(dead.respawnIn > 0);
  a.ws.close();
  b.ws.close();
});

test('logging in elsewhere replaces the old session (no ghost twins)', async () => {
  const a = await player('Eve');
  const closed = new Promise((r) => a.ws.on('close', (code) => r(code)));
  const ws2 = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${a.token}`);
  const welcomed = new Promise((r) => ws2.on('message', (d) => JSON.parse(d).t === 'welcome' && r()));
  assert.equal(await closed, 4002);
  await welcomed;
  const live = [...game.channels.flatMap((ch) => [...ch.players.values()])].filter((c) => c.hero.id === a.id);
  assert.equal(live.length, 1, 'exactly one copy of Eve in the world');
  ws2.close();
});
