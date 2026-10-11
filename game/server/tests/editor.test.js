import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

// The map loader reads DATA_DIR when it's first imported, so point it at a
// scratch folder before importing the server.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-map-'));
process.env.DATA_DIR = DATA;
const { openDb } = await import('../db.js');
const { createServer } = await import('../app.js');
const W = await import('../../shared/world.js');

let srv;
let game;
let wss;
let base;
before(async () => {
  ({ server: srv, game, wss } = createServer(openDb(':memory:'), { shopSim: false }));
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

const req = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, etag: r.headers.get('etag'), body: await r.json() };
};
async function account(name, invite) {
  const r = await req('POST', '/api/signup', { username: name, password: 'secret1', invite });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await req('POST', '/api/hero', { name: name[0].toUpperCase() + name.slice(1), avatar: {} }, r.body.token);
  return r.body.token;
}

test('only the server owner can save the world; a saved map is checked, backed up and goes live', async () => {
  const owner = await account('owner', game.auth.bootstrap());
  const friend = await account('friend', game.auth.hostInvite());
  assert.equal((await req('GET', '/api/me', null, owner)).body.admin, true, 'the first account owns the server');
  assert.equal((await req('GET', '/api/me', null, friend)).body.admin, false);

  const got = await req('GET', '/api/map');
  const map = got.body;
  assert.equal(map.rev, 1);

  assert.equal((await req('POST', '/api/map', { map, base: got.etag }, friend)).status, 403, 'friends cannot edit');

  const broken = structuredClone(map);
  broken.props.push({ ...broken.props[0] });
  const bad = await req('POST', '/api/map', { map: broken, base: got.etag }, owner);
  assert.equal(bad.status, 400);
  assert.match(bad.body.problems.join(), /used twice/);

  // A friend is in the world when the owner saves: they get sent back in.
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${friend}`);
  await new Promise((r) => ws.on('message', (d) => JSON.parse(d).t === 'welcome' && r()));
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));

  const edited = structuredClone(map);
  edited.props[0].x += 2;
  edited.props.push({ id: 'p_new_barrel', slot: 'prop_barrel', x: 3, z: 20, rot: 0, r: 0.55 });
  const ok = await req('POST', '/api/map', { map: edited, base: got.etag }, owner);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.rev, 2);
  assert.equal(await closed, 4003, 'players are told the world changed');

  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'maps', 'world.json'), 'utf8'));
  assert.equal(saved.rev, 2);
  assert.ok(saved.props.some((p) => p.id === 'p_new_barrel'));
  assert.ok(W.PROPS.some((p) => p.id === 'p_new_barrel' && p.x === 3), 'the server uses it right away');
  assert.ok(W.buildColliders().circles.some((c) => c.x === 3 && c.z === 20), 'and collides with it');
  const now = await req('GET', '/api/map');
  assert.notEqual(now.etag, got.etag);
  assert.equal(now.body.rev, 2);

  // Saving from a stale copy is refused instead of overwriting newer work.
  const stale = await req('POST', '/api/map', { map: edited, base: got.etag }, owner);
  assert.equal(stale.status, 409);

  // Each save keeps the previous version.
  const again = await req('POST', '/api/map', { map: now.body, base: now.etag }, owner);
  assert.equal(again.status, 200);
  assert.equal(again.body.rev, 3);
  const backups = fs.readdirSync(path.join(DATA, 'maps', 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^world-rev2-/);

  // Players can join the updated world.
  const ws2 = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${friend}`);
  const welcome = await new Promise((r) => ws2.on('message', (d) => (d = JSON.parse(d)).t === 'welcome' && r(d)));
  assert.ok(welcome.you, 'rejoined');
  ws2.close();
});
