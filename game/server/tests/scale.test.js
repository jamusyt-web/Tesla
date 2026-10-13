import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { current as currentMap } from '../map.js';
import { setWorld, NODE_TYPES } from '../../shared/world.js';
import { world, rebuildWorld } from '../static.js';
import { Channel } from '../channel.js';
import { stressWorld } from './stressworld.js';

// The server on a world the size of the five-town Hearthlands.
let towns;
before(() => {
  const s = stressWorld();
  setWorld(s.world);
  rebuildWorld();
  towns = s.towns;
});
after(() => {
  setWorld(currentMap.map);
  rebuildWorld();
});

const game = { crafting: { attach() {}, expire() {}, releaseSpot() {} }, announce() {} };
// A stand-in for a connected hero (what the channel tick touches).
function bot(id, at, low) {
  return {
    hero: { id, name: `Bot${id}` },
    ent: { x: at.x, z: at.z, rot: 0, path: null, act: 'idle', hp: 50, maxHp: 50, lastSwing: 0, speedMul: 1, lastSnap: '' },
    room: null,
    low,
    bytes: 0,
    sendRaw(d) {
      this.bytes += d.length;
    },
    send(m) {
      this.bytes += JSON.stringify(m).length;
    },
    attuneNearby() {},
  };
}

test('a channel tick stays under 2 ms (p95) with 410 nodes, 240 monsters and 10 heroes', () => {
  const ch = new Channel(game, 1);
  assert.equal(ch.nodes.size, 410);
  assert.equal(ch.mobs.size, 240);
  const bots = Array.from({ length: 10 }, (_, i) => bot(9000 + i, towns[i % towns.length], i % 2 === 0));
  for (const b of bots) ch.players.set(b.hero.id, b);
  const nav = world().nav;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const times = [];
  let now = Date.now();
  for (let k = 0; k < 600; k++) {
    // Heroes wander about their towns.
    for (const [i, b] of bots.entries()) {
      if (b.ent.path) continue;
      const t = towns[i % towns.length];
      b.ent.path = nav.findPath(b.ent.x, b.ent.z, t.x + (rnd() - 0.5) * 160, t.z + (rnd() - 0.5) * 160);
      if (b.ent.path) b.ent.act = 'walk';
    }
    now += 50;
    const t0 = performance.now();
    ch.tick(now, 0.05);
    if (k >= 100) times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 2, `tick p95 ${p95.toFixed(2)} ms`);
  console.log(`  tick p95 ${p95.toFixed(2)} ms, p50 ${times[times.length >> 1].toFixed(2)} ms`);
  assert.ok(bots.every((b) => b.bytes > 0), 'everyone got snapshots');
});

test('far-off parts of the world sleep, and catch up when someone comes', () => {
  const ch = new Channel(game, 2);
  const home = towns[0];
  const far = towns[6];
  const b = bot(9100, home, false);
  ch.players.set(b.hero.id, b);
  let now = Date.now();
  const run = (n) => {
    for (let k = 0; k < n; k++) ch.tick((now += 50), 0.05);
  };
  run(2);
  const farMobs = [...ch.mobs.values()].filter((m) => Math.hypot(m.sp.x - far.x, m.sp.z - far.z) < 200);
  const nearMobs = [...ch.mobs.values()].filter((m) => Math.hypot(m.sp.x - home.x, m.sp.z - home.z) < 200);
  const farNode = [...ch.nodes.values()].find((n) => Math.hypot(n.x - far.x, n.z - far.z) < 200);
  Object.assign(farNode, { alive: false, hp: 0, respawnAt: now + 1000 });
  const where = (list) => list.map((m) => `${m.x.toFixed(2)},${m.z.toFixed(2)}`).join(';');
  const farBefore = where(farMobs);
  const nearBefore = where(nearMobs);
  run(400); // 20 s
  assert.equal(where(farMobs), farBefore, 'monsters far from everyone stand still');
  assert.notEqual(where(nearMobs), nearBefore, 'monsters near a hero roam');
  assert.equal(farNode.alive, false, 'a node far away waits to regrow');
  // The hero arrives: the far side wakes and catches up.
  Object.assign(b.ent, { x: far.x, z: far.z, path: null });
  run(12);
  assert.equal(farNode.alive, true, 'it regrew as soon as someone came');
  assert.equal(farNode.hp, NODE_TYPES[farNode.type].hp);
  run(200);
  assert.notEqual(where(farMobs), farBefore, 'and its monsters roam again');
});
