// World events on a channel (shared/worldevents.js says what's on, and
// where): this starts and ends them. Every few seconds the channel asks; an
// event starts once and ends once per channel.
//   growth   the grove's empty slots sprout saplings that stand up in 30 s
//   golden   one node there turns golden, two more elder
//   frenzy   the lake's spots bite fast and lucky (gather.js reads ch.frenzy)
//   stampede five of the camp's monsters charge out, worth double gold
//   goblin   a Treasure Goblin with a heavy sack
//   moonlit  (night) two herbs turn moonlit (golden), three wild (elder)
// Heroes in the region get a toast; everyone gets a pin on their map.
import { eventsAt, eventText, eventName, EVENT_KINDS } from '../shared/worldevents.js';
import { MONSTERS } from '../shared/monsters.js';
import { NODE_TYPES, LAKES, SPAWNS } from '../shared/world.js';
import { regionAt } from '../shared/places.js';
import { ST } from '../shared/wilds.js';
import { force } from './nodestates.js';
import { busyAt } from './groves.js';

const CHECK_MS = 3000;
const SPROUT_MS = 30_000;

export function tickWorldEvents(ch, now) {
  if (ch.isRun || !ch.game?.opts?.wilds) return;
  if (now - (ch.wevAt ?? 0) < CHECK_MS) return;
  ch.wevAt = now;
  ch.wev ??= new Map(); // id → the event, once started here
  const on = eventsAt(now);
  for (const e of on) if (!ch.wev.has(e.id)) start(ch, e, now);
  for (const [id, e] of ch.wev) {
    if (!e.done && (now >= e.end || spent(ch, e))) finish(ch, id, e);
    // (An ended one is kept a while, so it can't start again in its slot.)
    else if (e.done && now - e.end > 15 * 60_000) ch.wev.delete(id);
  }
}

// An event whose monsters are all beaten, or whose golden finds are all
// gathered, is over early (so no one walks to it for nothing).
function spent(ch, e) {
  if (e.mobs.length) return e.mobs.every((id) => !ch.mobs.has(id));
  if (e.nodes?.length) return e.nodes.every((id) => !ch.nodes.get(id)?.st);
  return false;
}

// The events on now, for a hero arriving (pins on the map).
export const activeEvents = (ch) => [...(ch.wev?.values() ?? [])].filter((e) => !e.done).map(publicEvent);
const publicEvent = (e) => ({ id: e.id, kind: e.kind, name: eventName(e), icon: EVENT_KINDS[e.kind].icon, text: eventText(e), x: e.x, z: e.z, region: e.region, end: e.end });

export function start(ch, e, now = Date.now()) {
  const ev = { ...e, mobs: [] };
  ch.wev ??= new Map();
  ch.wev.set(e.id, ev);
  const near = (n, r) => Math.hypot(n.x - e.x, n.z - e.z) < r;
  if (e.kind === 'growth') {
    for (const s of ch.groves?.get(e.target) ?? []) {
      if (s.g !== 'gone' || busyAt(ch, s)) continue;
      s.g = 'sapling';
      s.respawnAt = now + SPROUT_MS;
      ch.broadcast({ t: 'node', id: s.id, alive: false, hp: 0, g: 'sapling', respawnIn: SPROUT_MS });
    }
  } else if (e.kind === 'golden' || e.kind === 'moonlit') {
    const herbsOnly = e.kind === 'moonlit';
    const pool = [...ch.nodes.values()].filter((n) => n.alive && !n.st && regionAt(n.x, n.z)?.id === e.region && (herbsOnly ? NODE_TYPES[n.type]?.kind === 'herb' : ['tree', 'rock', 'herb'].includes(NODE_TYPES[n.type]?.kind)));
    pool.sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z));
    pool.slice(0, herbsOnly ? 2 : 1).forEach((n) => force(ch, n, ST.golden));
    pool.slice(herbsOnly ? 2 : 1, herbsOnly ? 5 : 3).forEach((n) => force(ch, n, ST.elder));
    ev.nodes = pool.slice(0, herbsOnly ? 5 : 3).map((n) => n.id);
  } else if (e.kind === 'frenzy') {
    (ch.frenzy ??= new Map()).set(e.target, e.end);
  } else if (e.kind === 'stampede' && MONSTERS[e.monster]) {
    const M = MONSTERS[e.monster];
    const def = { ...M, id: e.monster, name: `Stampeding ${M.name}`, gold: M.gold.map((g) => g * 2), xp: Math.round(M.xp * 1.25) };
    for (let i = 0; i < 5; i++) ev.mobs.push(ch.addMob(def, { x: e.x + Math.cos(i * 1.26) * 6, z: e.z + Math.sin(i * 1.26) * 6 }, { r: 10 }).id);
  } else if (e.kind === 'goblin' && MONSTERS.goblin) {
    const M = MONSTERS.goblin;
    const def = { ...M, id: 'goblin', name: 'Treasure Goblin', lvl: M.lvl, gold: M.gold.map((g) => g * 8), drops: [{ id: 'goblin_coin', p: 1, min: 3, max: 6 }, { id: 'sapphire', p: 0.15, min: 1, max: 1 }] };
    ev.mobs.push(ch.addMob(def, { x: e.x + 5, z: e.z + 5 }, { r: 14 }).id);
  }
  const msg = { t: 'wev', ...publicEvent(ev) };
  for (const c of ch.players.values()) {
    c.send(msg);
    if (regionAt(c.ent.x, c.ent.z)?.id === e.region || near(c.ent, 250)) c.send({ t: 'toast', kind: 'gold', text: eventText(e) });
  }
}

// The server owner starts an event of `kind` where they stand (owner.event).
export function startHere(ch, c, kind, now = Date.now()) {
  const K = EVENT_KINDS[kind];
  if (!K) return null;
  const { x, z } = c.ent;
  const region = regionAt(x, z);
  const d = (e) => Math.hypot(e.x - x, e.z - z);
  const nearest = (list) => [...list].sort((a, b) => d(a) - d(b))[0] ?? null;
  const e = { id: `here:${now}`, region: region?.id ?? null, kind, start: now, end: now + K.min * 60_000, x, z, place: region?.name ?? 'the wilds', target: null, monster: null };
  if (kind === 'growth') {
    const g = nearest([...(ch.groves ?? new Map()).entries()].map(([id, list]) => ({ id, x: list[0].x, z: list[0].z })));
    if (!g) return null;
    Object.assign(e, { target: g.id, x: g.x, z: g.z });
  } else if (kind === 'frenzy') {
    const l = nearest(LAKES);
    if (!l) return null;
    Object.assign(e, { target: l.id, x: l.x, z: l.z });
  } else if (kind === 'stampede') {
    const s = nearest(SPAWNS.filter((sp) => MONSTERS[sp.monster] && !MONSTERS[sp.monster].boss));
    if (!s) return null;
    Object.assign(e, { monster: s.monster, x: x + 8, z: z + 8 });
  }
  start(ch, e, now);
  return e;
}

export function finish(ch, id, ev) {
  ev.done = true;
  if (ev.kind === 'frenzy') ch.frenzy?.delete(ev.target);
  // One mid-fight stays until the fight ends, then leaves (channel.battleOver).
  for (const id of ev.mobs) if (!ch.removeMob(id)) ch.mobs.get(id) && (ch.mobs.get(id).expired = true);
  ch.broadcast({ t: 'wev', id, done: true });
}
