import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import { JOB_DAYS, MAX_OPEN_JOBS } from '../jobs.js';

// The bulletin board: post a paid job, others deliver (in parts), the poster
// gets the goods and the deliverer the gold; cancelling and expiry refund.

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

const gold = (p) => game.heroes.gold(p.id);
const has = (p, item) => game.heroes.count(p.id, item);
const give = (p, item, n) => game.heroes.addItem(p.id, item, n);

test('post, deliver in parts, finish; gold and goods move exactly', async () => {
  const ann = await player('Annette');
  const bob = await player('Bobby');
  const cat = await player('Catrin');
  game.heroes.addGold(ann.id, 1000);
  const g0 = gold(ann);
  const logs0 = has(ann, 'oak_log');

  assert.match((await ann.call('jobs.post', { item: 'nope', qty: 5, per: 3 })).err, /Pick an item/);
  assert.match((await ann.call('jobs.post', { item: 'oak_log', qty: 0, per: 3 })).err, /between 1/);
  assert.match((await ann.call('jobs.post', { item: 'oak_log', qty: 5, per: 1.5 })).err, /whole number/);
  assert.match((await ann.call('jobs.post', { item: 'oak_log', qty: 999, per: 999 })).err, /don't have that much/);

  const posted = await ann.call('jobs.post', { item: 'oak_log', qty: 20, per: 5 });
  assert.ok(posted.ok, posted.err);
  const id = posted.data.id;
  assert.equal(gold(ann), g0 - 100, 'the reward is held when the job goes up');
  await bob.next((m) => m.t === 'chat' && m.sys && /posted a job/.test(m.text));

  const list = (await bob.call('jobs.list')).data;
  const job = list.here.find((j) => j.id === id);
  assert.equal(job.town, 'hearthvale', "posted on the board of the town it was put up in");
  assert.equal(job.posterName, 'Annette');
  assert.equal(job.left, 20);
  assert.ok(job.expiresAt - job.createdAt === JOB_DAYS * 86400_000);

  assert.match((await ann.call('jobs.deliver', { id, qty: 1 })).err, /your own job/);
  assert.match((await bob.call('jobs.deliver', { id, qty: 5 })).err, /Not enough Oak Log/);

  // Bob brings 8: paid 40 less 4% tax; Annette gets the logs.
  give(bob, 'oak_log', 8);
  const b0 = gold(bob);
  const r1 = await bob.call('jobs.deliver', { id, qty: 8 });
  assert.ok(r1.ok, r1.err);
  assert.equal(r1.data.left, 12);
  assert.equal(gold(bob) - b0, r1.data.paid);
  assert.equal(r1.data.gross, 40);
  assert.ok(r1.data.tax >= 1 && r1.data.tax <= 2);
  assert.equal(has(ann, 'oak_log'), logs0 + 8);
  assert.equal(has(bob, 'oak_log'), 0);
  await ann.next((m) => m.t === 'toast' && /Bobby delivered 8/.test(m.text));

  // Catrin offers 30 but only 12 are wanted: she hands in 12 and keeps 18.
  give(cat, 'oak_log', 30);
  const r2 = await cat.call('jobs.deliver', { id, qty: 30 });
  assert.equal(r2.data.qty, 12);
  assert.equal(r2.data.left, 0);
  assert.equal(has(cat, 'oak_log'), 18);
  assert.equal(has(ann, 'oak_log'), logs0 + 20);
  assert.match((await cat.call('jobs.deliver', { id, qty: 1 })).err, /no longer up/);
  assert.equal((await ann.call('jobs.list')).data.mine.find((j) => j.id === id).status, 'done');
  assert.equal(gold(ann), g0 - 100, 'the poster paid exactly the reward');
  for (const p of [ann, bob, cat]) p.ws.close();
});

test('cancel and expiry refund what was not delivered; limits hold', async () => {
  const dee = await player('Deedee');
  const eli = await player('Elias');
  game.heroes.addGold(dee.id, 500);
  const g0 = gold(dee);
  const id = (await dee.call('jobs.post', { item: 'stone', qty: 10, per: 4 })).data.id;
  give(eli, 'stone', 3);
  await eli.call('jobs.deliver', { id, qty: 3 });
  assert.match((await eli.call('jobs.cancel', { id })).err, /Not your job/);
  const c = await dee.call('jobs.cancel', { id });
  assert.equal(c.data.refund, 28, 'the 7 not delivered come back');
  assert.equal(gold(dee), g0 - 12);
  assert.match((await dee.call('jobs.cancel', { id })).err, /already closed/);

  // Expiry: wind the clock past the end.
  const id2 = (await dee.call('jobs.post', { item: 'stone', qty: 2, per: 10 })).data.id;
  const before = gold(dee);
  const now = Date.now() + JOB_DAYS * 86400_000 + 1000;
  game.expireJobs(now);
  assert.equal(gold(dee), before + 20);
  assert.ok(!(await eli.call('jobs.list')).data.here.some((j) => j.id === id2));
  await dee.next((m) => m.t === 'toast' && /ran out/.test(m.text));

  for (let i = 0; i < MAX_OPEN_JOBS; i++) assert.ok((await dee.call('jobs.post', { item: 'stone', qty: 1, per: 1 })).ok);
  assert.match((await dee.call('jobs.post', { item: 'stone', qty: 1, per: 1 })).err, /at most/);

  // Your only equipped tool can't be handed in.
  const axe = game.online.get(eli.id).hero.equip.axe;
  const jid = (await dee.call('jobs.cancel', { id: (await dee.call('jobs.list')).data.mine[0].id }), (await dee.call('jobs.post', { item: axe, qty: 1, per: 1 })).data.id);
  if (has(eli, axe) === 1) assert.match((await eli.call('jobs.deliver', { id: jid, qty: 1 })).err, /equipped/);
  dee.ws.close();
  eli.ws.close();
});
