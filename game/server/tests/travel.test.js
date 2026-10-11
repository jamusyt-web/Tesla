import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import { SHIPPED_MAP, useMap } from '../map.js';
import * as W from '../../shared/world.js';

// Fast travel: waystones in the map, attuning by walking up, and paid travel.

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
  const welcome = await next((m) => m.t === 'welcome');
  return { ws, inbox, next, call, welcome, id: welcome.you.id };
}
async function player(name) {
  const { body } = await post('/api/signup', { username: name.toLowerCase(), password: 'secret1' });
  assert.equal((await post('/api/hero', { name, avatar: {} }, body.token)).status, 200);
  return { ...(await connect(body.token, name)), token: body.token };
}
// Put a hero somewhere directly (as if they'd walked there).
const place = (p, x, z) => Object.assign(game.online.get(p.id).ent, { x, z, path: null });
const stone = (id) => W.STONES.find((s) => s.id === id);

test('the shipped map has waystones; older maps get the starter ones; bad stones are caught', () => {
  const shipped = JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8'));
  assert.deepEqual(shipped.stones.map((s) => s.id), ['stone_square', 'stone_wildwatch']);
  for (const st of shipped.stones) {
    const [x, z] = W.stoneFront(st);
    assert.ok(W.isWalkable(x, z, W.buildColliders()), `you can stand in front of ${st.name}`);
  }
  const { stones, ...old } = shipped;
  const up = W.upgradeMap(old);
  assert.deepEqual(up.stones.map((s) => s.id), ['stone_square', 'stone_wildwatch'], 'a map from before fast travel gets them');
  assert.equal(old.stones, undefined, 'without touching the original');
  assert.deepEqual(W.upgradeMap({ ...shipped, stones: [] }).stones, [], 'an owner who removed them all keeps it that way');
  const nameless = { ...shipped, stones: [{ id: 'stone_x', x: 0, z: 0 }] };
  assert.match(W.mapProblems(nameless).join(), /stone_x.*needs a name/);
  assert.match(W.mapProblems({ ...shipped, stones: [{ id: 'stone_y', name: 'Y', x: 0, z: 0, rot: 'east' }] }).join(), /stone_y.*numeric rot/);
  const built = { ...old, buildings: [...old.buildings, { id: 'b_over', x: 6, z: 5, w: 6, d: 6 }] };
  assert.deepEqual(W.upgradeMap(built).stones.map((s) => s.id), ['stone_wildwatch'], "a starter stone isn't dropped inside something built since");
  assert.ok(W.buildColliders().circles.some((c) => c.x === stones[0].x && c.z === stones[0].z), 'a waystone is solid');
  assert.ok(W.travelFee(stones[0], stones[1]) >= 5);
});

test('walk up to a waystone to attune; travel between them for a fee', async () => {
  const sq = stone('stone_square');
  const ww = stone('stone_wildwatch');
  const a = await player('Ada');
  const b = await player('Bram');
  assert.deepEqual(a.welcome.you.stones, [], 'new heroes know no waystones');

  // Away from any stone you can't travel.
  place(a, 0, 30);
  assert.match((await a.call('travel', { to: ww.id })).err, /Walk up to a waystone/);

  // At the square: attuned to it, but not to Wildwatch yet.
  const [sx, sz] = W.stoneFront(sq);
  place(a, sx, sz);
  assert.equal((await a.next((m) => m.t === 'attuned' && m.id === sq.id)).name, sq.name);
  assert.match((await a.call('travel', { to: ww.id })).err, /haven't been to Wildwatch/);
  assert.match((await a.call('travel', { to: sq.id })).err, /already here/);
  assert.match((await a.call('travel', { to: 'nowhere' })).err, /No such waystone/);

  // Visit Wildwatch, come back, then travel there.
  const [wx, wz] = W.stoneFront(ww);
  place(a, wx, wz);
  await a.next((m) => m.t === 'attuned' && m.id === ww.id);
  place(a, sx, sz);
  const fee = W.travelFee(sq, ww);
  const at0 = W.stoneFront(ww);
  const gold = game.heroes.gold(a.id);
  place(b, at0[0], at0[1]); // Bram is standing where Ada would arrive, watching
  const mark = b.inbox.length;
  const res = await a.call('travel', { to: ww.id });
  assert.ok(res.ok, res.err);
  assert.equal(res.data.fee, fee);
  assert.equal(game.heroes.gold(a.id), gold - fee, 'the fee was paid');
  const at = game.online.get(a.id).ent;
  assert.ok(Math.hypot(at.x - ww.x, at.z - ww.z) <= W.STONE_RANGE - 1, 'arrived at Wildwatch, close enough to travel on');
  assert.ok(W.isWalkable(at.x, at.z, W.buildColliders()), 'standing somewhere walkable');
  const tp = await b.next((m) => m.t === 'tp' && m.id === a.id, 3000, mark);
  assert.ok(Math.hypot(tp.from.x - sx, tp.from.z - sz) < 0.1 && Math.hypot(tp.x - at.x, tp.z - at.z) < 0.1, 'others see the jump (so they snap, not slide)');
  await a.next((m) => m.t === 's' && m.full);

  // Straight back is too soon; and travel costs gold you must have.
  assert.match((await a.call('travel', { to: sq.id })).err, /still humming/);
  game.online.get(a.id).lastTravel = 0;
  game.heroes.addGold(a.id, -game.heroes.gold(a.id));
  assert.match((await a.call('travel', { to: sq.id })).err, new RegExp(`costs ${W.travelFee(ww, sq)} gold`));
  assert.ok(Math.hypot(game.online.get(a.id).ent.x - at.x, game.online.get(a.id).ent.z - at.z) < 0.5, 'and nothing happened');

  // Attunement is saved: it's there after logging back in.
  a.ws.close();
  await new Promise((r) => setTimeout(r, 150));
  const again = await connect(a.token, 'Ada again');
  assert.deepEqual([...again.welcome.you.stones].sort(), [sq.id, ww.id].sort());
  again.ws.close();
  b.ws.close();
});

test('no travelling out of a battle', async () => {
  const c = await player('Cyra');
  const sq = stone('stone_square');
  const [sx, sz] = W.stoneFront(sq);
  place(c, sx, sz);
  await c.next((m) => m.t === 'attuned');
  game.heroes.attune(game.online.get(c.id).hero, 'stone_wildwatch');
  game.online.get(c.id).battle = { leave() {} };
  assert.match((await c.call('travel', { to: 'stone_wildwatch' })).err, /battle/);
  game.online.get(c.id).battle = null;
  c.ws.close();
});

test('waystones removed from the map are dropped from what heroes are told', async () => {
  const d = await player('Dee');
  game.heroes.attune(game.online.get(d.id).hero, 'stone_gone');
  d.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  const map = JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8'));
  useMap(map); // unchanged map: stone_gone is not in it
  const { body } = await post('/api/login', { username: 'dee', password: 'secret1' });
  const again = await connect(body.token, 'Dee again');
  assert.ok(!again.welcome.you.stones.includes('stone_gone'));
  again.ws.close();
});
