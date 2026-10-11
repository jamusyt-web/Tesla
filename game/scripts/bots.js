// Populate the town with friendly bots so you can see a busy lobby while
// testing. Bots are ordinary players: they connect over the same WebSocket
// protocol and the server treats them exactly like humans.
//
//   npm run bots            # 6 bots against http://localhost:8787
//   npm run bots -- 12 http://localhost:8787
//
// Must run on the same machine as the server (it creates bot accounts
// directly in the server's database, so no invite codes are needed).
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { openDb } from '../server/db.js';
import { Heroes } from '../server/heroes.js';
import { Auth } from '../server/auth.js';
import { randomAvatar } from '../shared/avatar.js';
import { setWorld, NODES, buildColliders, approachPoint, NODE_TYPES, BUILDINGS, doorPoint, NavGrid } from '../shared/world.js';

const COUNT = Number(process.argv[2] || 6);
const URL_ = process.argv[3] || 'http://localhost:8787';
const NAMES = ['Pip', 'Juniper', 'Bramble', 'Clover', 'Wren', 'Maple', 'Fennel', 'Tansy', 'Rowan', 'Hazel', 'Sorrel', 'Basil', 'Poppy', 'Thistle', 'Ember', 'Moss'];
const LINES = ['hi everyone!', 'anyone selling oak planks?', 'this tree is huge 🌳', 'wanna fight slimes?', 'my shop has potions btw', 'brb', 'gg', 'nice hat!', 'where do you get birch?', 'buying copper ore 9g each', 'lol', 'so cozy here', '✨ found a golden acorn earlier'];

const db = openDb();
const heroes = new Heroes(db);
const auth = new Auth(db);
// Use the same world map as the server we're joining.
setWorld(await (await fetch(`${URL_}/api/map`)).json());
const nodes = NODES;
const col = buildColliders();
const nav = new NavGrid(col);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function account(i) {
  const username = `bot_${i}`;
  let row = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username);
  if (!row) {
    const salt = crypto.randomBytes(16).toString('hex');
    const r = db.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?,?,?,?)').run(username, crypto.randomBytes(32).toString('hex'), salt, Date.now());
    row = { id: Number(r.lastInsertRowid) };
  }
  if (!heroes.load(row.id)) heroes.create(row.id, `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''} (bot)`.slice(0, 16).replace(/[()]/g, '').trim(), randomAvatar());
  return auth.issue(row.id).token;
}

async function runBot(i) {
  const token = account(i);
  const ws = new WebSocket(`${URL_.replace(/^http/, 'ws')}/ws?token=${token}`);
  let me = null;
  let rid = 0;
  const pending = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') me = { ...m.you };
    if (m.t === 's') for (const r of m.p) if (me && r[0] === me.id) Object.assign(me, { x: r[1], z: r[2], act: r[4] });
    if (m.t === 'res') pending.get(m.rid)?.(m), pending.delete(m.rid);
  });
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const req = (t, a) => new Promise((r) => { const id = ++rid; pending.set(id, r); send({ ...a, t, rid: id }); setTimeout(() => r({ ok: false }), 5000); });
  const walk = async (x, z) => {
    send({ t: 'move', x, z });
    await sleep(600);
    for (let k = 0; k < 40 && me?.act === 'walk'; k++) await sleep(400);
  };
  await new Promise((r) => ws.on('open', r));
  while (!me) await sleep(100);
  console.log(`🤖 ${me.name} joined channel`);
  for (;;) {
    const roll = Math.random();
    if (roll < 0.35) {
      // Chop or mine something nearby.
      const types = ['tree_oak', 'rock_stone', 'herb_mint'];
      const t = pick(types);
      const cands = nodes.filter((n) => n.type === t).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      const n = pick(cands.slice(0, 4));
      const ap = approachPoint(n, me.x, me.z, col, nav);
      if (ap) {
        await walk(ap[0], ap[1]);
        const nt = NODE_TYPES[n.type];
        for (let k = 0; k < 12; k++) {
          const r = await req('hit', { node: n.id });
          if (!r.ok || r.data?.broke || nt.kind === 'herb') break;
          await sleep(720 + Math.random() * 120);
        }
      }
    } else if (roll < 0.6) {
      const b = pick(BUILDINGS.filter((x) => !x.deco));
      const [dx, dz] = doorPoint(b);
      await walk(dx + (Math.random() - 0.5) * 3, dz + (Math.random() - 0.5) * 3);
    } else if (roll < 0.8) {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 7;
      await walk(Math.cos(a) * d, Math.sin(a) * d);
    } else if (roll < 0.9) {
      send({ t: 'chat', text: pick(LINES) });
    } else {
      send({ t: 'emote', e: pick(['wave', 'dance', 'cheer', 'heart']) });
    }
    await sleep(1500 + Math.random() * 4000);
  }
}

for (let i = 0; i < COUNT; i++) {
  runBot(i).catch((e) => console.error('bot crashed', e.message));
  await sleep(400);
}
