import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import '../map.js';
import { scheduled } from '../nodestates.js';
import { NODES, NODE_TYPES, approachPoint, buildColliders, NavGrid } from '../../shared/world.js';

let srv;
let game;
let wss;
let base;

before(async () => {
  const db = openDb(':memory:');
  ({ server: srv, game, wss } = createServer(db));
  game.auth.openSignup = true;
  game.start();
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  for (const ws of wss.clients) ws.terminate(); // a failed test must not hang the run
  game.stop();
  srv.close();
  srv.closeAllConnections?.();
});

async function post(path, body, token) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

// A scripted player: an account, a hero, and a live socket with a message inbox.
async function player(name, { low = false } = {}) {
  const { body } = await post('/api/signup', { username: name.toLowerCase(), password: 'secret1' });
  const hero = await post('/api/hero', { name, avatar: {} }, body.token);
  assert.equal(hero.status, 200, JSON.stringify(hero.body));
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?token=${body.token}${low ? '&low=1' : ''}`);
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
      setTimeout(() => reject(new Error(`timeout waiting in ${name}'s inbox (got: ${inbox.filter((m) => m.t !== 's').slice(-14).map((m) => m.t + (m.t === 'res' ? ':' + m.rid + ':' + (m.ok ? 'ok' : m.err) : '')).join(', ')})`)), ms);
    });
  let rid = 0;
  const rpc = (t, payload) => {
    const id = ++rid + 1000;
    ws.send(JSON.stringify({ ...payload, t, rid: id }));
    return next((m) => m.t === 'res' && m.rid === id);
  };
  // Actions that go through the server's RPC table (t: 'rpc').
  const call = (m, a = {}) => rpc('rpc', { m, a });
  const welcome = await next((m) => m.t === 'welcome');
  return { ws, inbox, next, rpc, call, welcome, id: welcome.you.id, token: body.token };
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

  // Ben walks; Ann receives snapshots with his position changing. (Pick a spot
  // he can walk straight to: where he spawned varies, and the plaza has benches.)
  const col = buildColliders();
  const nav = new NavGrid(col);
  const tries = [[6, 2], [-6, 2], [6, -2], [-6, -2], [2, 6], [2, -6], ...Array.from({ length: 24 }, (_, k) => [Math.round(Math.sin(k / 3.8) * (4 + (k % 3))), Math.round(Math.cos(k / 3.8) * (4 + (k % 3)))])];
  const [dx, dz] = tries.find(([dx, dz]) => nav.clear(bStart.x, bStart.z, bStart.x + dx, bStart.z + dz));
  b.ws.send(JSON.stringify({ t: 'move', x: bStart.x + dx, z: bStart.z + dz }));
  const snap = await a.next((m) => m.t === 's' && m.p.some((r) => r[0] === b.id && r[4] === 'walk'));
  assert.ok(snap);
  await new Promise((r) => setTimeout(r, 1400));
  const last = [...a.inbox].reverse().find((m) => m.t === 's' && m.p.some((r) => r[0] === b.id)).p.find((r) => r[0] === b.id);
  assert.ok(Math.abs(last[1] - (bStart.x + dx)) < 0.6 && Math.abs(last[2] - (bStart.z + dz)) < 0.6, `Ben arrived (${last})`);

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
  // An oak that isn't rich or ancient for the next few minutes (those need more skill).
  const ch = { nodes: new Map(NODES.map((n) => [n.id, n])) };
  const busy = new Set([0, 60_000, 120_000].flatMap((dt) => [...scheduled(ch, Date.now() + dt).keys()]));
  const oak = NODES.find((n) => n.type === 'tree_oak' && !busy.has(n.id));
  // Too far away: rejected.
  const far = await a.rpc('hit', { node: oak.id });
  assert.equal(far.ok, false);
  assert.match(far.err, /closer/);
  // Walk both to the tree.
  const col = buildColliders();
  for (const p of [a, b]) {
    const ap = approachPoint(oak, p.welcome.you.x, p.welcome.you.z, col, new NavGrid(col));
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
  // A swing that lands just after the fall is "too late", not an error toast.
  const late = await a.rpc('hit', { node: oak.id });
  assert.equal(late.ok, true, late.err);
  assert.equal(late.data.gone, true);
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

test('fishing: hook, fight, and the server replays the fight to confirm the catch', async () => {
  const { newFight, stepFight } = await import('../../shared/fishing.js');
  const { isDeepSpot } = await import('../../shared/world.js');
  const a = await player('Finn');
  try {
  const col = buildColliders();
  const spot = NODES.find((n) => n.type === 'fish_spot' && !isDeepSpot(n));
  const ap = approachPoint(spot, a.welcome.you.x, a.welcome.you.z, col, new NavGrid(col));
  a.ws.send(JSON.stringify({ t: 'move', x: ap[0], z: ap[1] }));
  await new Promise((r) => setTimeout(r, 9000));

  // Plays a fight like a skilled player and returns the recorded toggles.
  const solve = (bite) => {
    const s = newFight(bite.fish, bite.gear);
    const toggles = [];
    let held = false;
    while (!s.done) {
      const want = s.fishPos - (s.zonePos + bite.gear.zone / 2) - s.zoneVel * 0.15 > 0;
      if (want !== held) {
        toggles.push(s.tick);
        held = want;
      }
      stepFight(s, held);
    }
    return { toggles, end: s.tick, done: s.done };
  };
  const fishOnce = async (instant) => {
    a.inbox.length = 0;
    const c = await a.rpc('cast', { node: spot.id });
    assert.equal(c.ok, true, c.err);
    const bite = await a.next((m) => m.t === 'bite', 9000);
    const hook = await a.rpc('reel', {});
    assert.equal(hook.data.fight, true);
    const sol = solve(bite);
    if (!instant) await new Promise((r) => setTimeout(r, (sol.end / 60) * 1000));
    a.ws.send(JSON.stringify({ t: 'land', toggles: sol.toggles, end: sol.end }));
    return { res: await a.next((m) => m.t === 'fishResult', 5000), sol };
  };
  // Submitting a whole fight instantly is rejected (can't beat real time).
  const cheat = await fishOnce(true);
  assert.equal(cheat.res.ok, false);
  // Playing it out in real time works.
  const honest = await fishOnce(false);
  assert.equal(honest.sol.done, 'caught', 'the test player should land an easy fish');
  assert.equal(honest.res.ok, true, honest.res.reason);
  assert.ok(honest.res.kg > 0);
  } finally {
    a.ws.close();
  }
});

test('walk-in shops: owner stocks, a friend walks in, sees the shelves and buys; town hides them both', async () => {
  const a = await player('Shopkeep');
  const b = await player('Browser');
  try {
    game.heroes.addItem(a.id, 'oak_plank', 10);
    game.heroes.addGold(b.id, 500);
    const st = await a.call('shop.stock', { slot: 2, item: 'oak_plank', qty: 10, price: 12 });
    assert.equal(st.ok, true, st.err);
    const inA = await a.call('shop.enter', { owner: a.id });
    assert.equal(inA.ok, true, inA.err);
    assert.equal(inA.data.slots[0].item, 'oak_plank');
    await b.next((m) => m.t === 'hide' && m.id === a.id);
    // While inside, the town doesn't hear your chopping (and you can't).
    const chop = await a.rpc('hit', { node: NODES[0].id });
    assert.equal(chop.ok, false);
    assert.match(chop.err, /inside a shop/);
    // Buying needs you to be in the shop.
    const remote = await b.call('shop.buy', { owner: a.id, slot: 2, qty: 1, price: 12, item: 'oak_plank', nonce: 'x1' });
    assert.match(remote.err, /Walk into that shop first/);
    const inB = await b.call('shop.enter', { owner: a.id });
    assert.equal(inB.ok, true, inB.err);
    assert.ok(inB.data.occ.some((p) => p.id === a.id), 'Browser sees the owner inside');
    await a.next((m) => m.t === 'rjoin' && m.p.id === b.id);
    // A purchase retried with the same nonce only happens once.
    const buy1 = await b.call('shop.buy', { owner: a.id, slot: 2, qty: 3, price: 12, item: 'oak_plank', nonce: 'n1' });
    const buy2 = await b.call('shop.buy', { owner: a.id, slot: 2, qty: 3, price: 12, item: 'oak_plank', nonce: 'n1' });
    assert.equal(buy1.ok, true, buy1.err);
    assert.deepEqual(buy2.data, buy1.data);
    assert.equal(game.heroes.count(b.id, 'oak_plank'), 3);
    const sale = await a.next((m) => m.t === 'shopSale');
    assert.equal(sale.sales[0].qty, 3);
    await a.next((m) => m.t === 'rshelf' && m.slot === 2 && m.s.qty === 7);
    // Walking around inside is server-checked like in town.
    b.ws.send(JSON.stringify({ t: 'move', x: -2, z: 1.5, v: 'room' }));
    await a.next((m) => m.t === 'rs' && m.p.some((r) => r[0] === b.id && r[4] === 'walk'));
    const out = await b.call('shop.exit', {});
    assert.equal(out.ok, true, out.err);
    await a.next((m) => m.t === 'rleave' && m.id === b.id);
  } finally {
    a.ws.close();
    b.ws.close();
  }
});

test('hands-on crafting: materials held while you work, the server replays your timing, results are paid once', async () => {
  const { bot } = await import('./craft-bot.js');
  const { packInputs } = await import('../../shared/crafting.js');
  const { spotsOf } = await import('../../shared/stations.js');
  const a = await player('Smith');
  try {
    game.heroes.addItem(a.id, 'oak_log', 20);
    const far = await a.call('craft.start', { recipe: 'oak_plank', batch: 3 });
    assert.match(far.err, /Walk up to the Workbench/);
    const spot = spotsOf('workbench')[0];
    const col = buildColliders();
    const path = new NavGrid(col).findPath(a.welcome.you.x, a.welcome.you.z, spot.x, spot.z);
    assert.ok(path, 'the workbench is reachable');
    a.ws.send(JSON.stringify({ t: 'move', x: spot.x, z: spot.z }));
    await new Promise((r) => setTimeout(r, 6000));
    const st = await a.call('craft.start', { recipe: 'oak_plank', batch: 3 });
    assert.equal(st.ok, true, st.err);
    assert.equal(game.heroes.count(a.id, 'oak_log'), 14, '6 logs held while crafting');
    // You can't wander off or start something else mid-craft.
    assert.match((await a.rpc('hit', { node: NODES[0].id })).err, /Finish your craft/);
    const cheatPlay = bot(st.data.spec, 0, 5, 0);
    // Finishing instantly is impossible for a human: graded as if nothing was pressed.
    const cheat = await a.call('craft.finish', { sid: st.data.sid, inputs: packInputs(cheatPlay.inputs), end: cheatPlay.end, off: [0, 0] });
    assert.equal(cheat.ok, true, cheat.err);
    assert.equal(cheat.data.grade, 'D');
    assert.equal(cheat.data.out.qty, 3, 'still never less than the plain recipe');
    // Again, played in real time.
    const st2 = await a.call('craft.start', { recipe: 'oak_plank', batch: 3 });
    assert.equal(st2.ok, true, st2.err);
    assert.match((await a.call('craft.cancel', { sid: 'nope' })).err, /already ended/);
    const play = bot(st2.data.spec, 0, 7, 0);
    await new Promise((r) => setTimeout(r, (play.end / 60) * 1000 + 50));
    const fin = await a.call('craft.finish', { sid: st2.data.sid, inputs: packInputs(play.inputs), end: play.end, off: [0, 0] });
    assert.equal(fin.ok, true, fin.err);
    assert.equal(fin.data.grade, 'S');
    assert.ok(fin.data.out.qty >= 3);
    const planks = game.heroes.count(a.id, 'oak_plank');
    // A retried finish gets the same answer and pays nothing more.
    const again = await a.call('craft.finish', { sid: st2.data.sid, inputs: packInputs(play.inputs), end: play.end, off: [0, 0] });
    assert.deepEqual(again.data.out, fin.data.out);
    assert.equal(game.heroes.count(a.id, 'oak_plank'), planks);
    assert.equal(game.heroes.count(a.id, 'oak_log'), 8);
  } finally {
    a.ws.close();
  }
});

test('heroes are only told about monsters near them', async () => {
  const a = await player('Ivo');
  try {
    const all = [...game.channels.find((ch) => ch.players.has(a.id)).mobs.values()];
    const near = (x, z) => all.filter((m) => Math.hypot(m.x - x, m.z - z) < 100).map((m) => m.id).sort();
    assert.deepEqual(a.welcome.mobs.map((m) => m.id).sort(), near(a.welcome.you.x, a.welcome.you.z), 'welcome lists the monsters in range');
    // Far down the south shore the Wilds' monsters drop out of sight...
    const c = game.online.get(a.id);
    Object.assign(c.ent, { x: 0, z: 90, path: null });
    const gone = await a.next((m) => m.t === 's' && m.rm?.length);
    assert.ok(gone.rm.every((id) => all.find((m) => m.id === id)), 'only real monsters are dropped');
    // ...and come back when the hero does.
    Object.assign(c.ent, { x: 0, z: -20, path: null });
    const back = await a.next((m) => m.t === 's' && m.add?.length);
    assert.ok(back.add.every((m) => m.type && Number.isFinite(m.x)), 'new arrivals come with everything needed to draw them');
  } finally {
    a.ws.close();
  }
});

test('phones are told about fewer, nearer monsters; one-off monsters come and go', async () => {
  const a = await player('Pia', { low: true });
  try {
    const c = game.online.get(a.id);
    const ch = c.ch;
    assert.equal(c.low, true);
    const near = a.welcome.mobs.map((m) => [m, Math.hypot(m.x - a.welcome.you.x, m.z - a.welcome.you.z)]);
    assert.ok(near.length <= 20 && near.every(([, d]) => d < 50), 'within 50 m, at most 20');
    // An elite appears next to her, and goes again.
    const elite = ch.addMob('slime', { x: c.ent.x + 3, z: c.ent.z + 2 });
    const add = await a.next((m) => m.t === 's' && m.add?.some((x) => x.id === elite.id));
    assert.equal(add.add.find((x) => x.id === elite.id).type, 'slime');
    assert.ok(ch.removeMob(elite.id));
    await a.next((m) => m.t === 's' && m.rm?.includes(elite.id));
  } finally {
    a.ws.close();
  }
});
