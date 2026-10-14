// Rich and ancient gathering nodes (SPEC §4.3): now and then a tree, rock or
// herb turns rich (gold) or ancient (violet) for a while and gives far more,
// to heroes skilled enough to work it. The schedule is the clock's, so every
// channel agrees on which node it is; the states live in memory.
//   rich:    in every region, every 10 minutes, one node for 8 minutes
//   ancient: in every region, once an hour (offset by region × 7 min), for 15
// A node that falls is spent: it comes back plain, or as whatever variant it
// rolls as it regrows (shared/wilds.js: Sturdy, Elder, Golden…). A node's
// rolled variant is n.var; its state on show (n.st) is the clock's when the
// clock has picked it, else its variant.
import { NODE_TYPES, REGIONS } from '../shared/world.js';
import { hash32 } from '../shared/clock.js';
import { regionAt } from '../shared/places.js';
import { ST, STATE_FX, rollVariant, variantName, hpOf } from '../shared/wilds.js';

export { STATE_FX };
export const NODE_STATE = { normal: 0, rich: 1, ancient: 2, big: 3, elder: 4, golden: 5 };
// Which state wins when the clock picks a node that already rolled a variant.
const RANK = { 0: 0, 3: 1, 1: 2, 4: 3, 5: 4, 2: 5 };
export const RICH_EVERY = 10 * 60_000;
export const RICH_FOR = 8 * 60_000;
export const ANCIENT_EVERY = 60 * 60_000;
export const ANCIENT_FOR = 15 * 60_000;
const KINDS = new Set(['tree', 'rock', 'herb']);

// A node's state for snapshots and loot: 0 normal, 1 rich, 2 ancient.
export function stateOf(n) {
  return n?.st ?? NODE_STATE.normal;
}

// The nodes that could turn, per region: { regionId: [node ids] } (sorted, so
// every channel picks the same one).
function pools(ch) {
  if (ch.nsPools) return ch.nsPools;
  const out = {};
  for (const n of ch.nodes.values()) {
    if (!KINDS.has(NODE_TYPES[n.type]?.kind)) continue;
    const r = regionAt(n.x, n.z);
    if (r) (out[r.id] ??= []).push(n.id);
  }
  for (const list of Object.values(out)) list.sort();
  return (ch.nsPools = out);
}

// Which node in each region should be rich or ancient at `now`: Map(id → { st, key }).
export function scheduled(ch, now) {
  const want = new Map();
  const P = pools(ch);
  REGIONS.forEach((r, i) => {
    const pool = P[r.id];
    if (!pool?.length) return;
    // The hashed node, or the next one along when that's an empty grove slot
    // or a stump about to go (nothing there to shine).
    const pick = (key) => {
      const h = hash32(key);
      for (let j = 0; j < pool.length; j++) {
        const n = ch.nodes.get(pool[(h + j) % pool.length]);
        if (n && n.g !== 'gone' && !n.vanishAt) return n.id;
      }
      return pool[h % pool.length];
    };
    const k = Math.floor(now / RICH_EVERY);
    if (now - k * RICH_EVERY < RICH_FOR) {
      const key = `rich:${r.id}:${k}`;
      want.set(pick(key), { st: NODE_STATE.rich, key });
    }
    const t = now - i * 7 * 60_000;
    const a = Math.floor(t / ANCIENT_EVERY);
    if (t - a * ANCIENT_EVERY < ANCIENT_FOR) {
      const key = `ancient:${r.id}:${a}`;
      want.set(pick(key), { st: NODE_STATE.ancient, key, region: r });
    }
  });
  return want;
}

// Called from the channel tick: start and end states on this channel's nodes
// (it only looks again when the minute changes).
export function tickNodeStates(ch, now) {
  if (ch.isRun || !REGIONS.length) return;
  const minute = Math.floor(now / 60_000);
  if (ch.nsMinute === minute) return;
  ch.nsMinute = minute;
  ch.nsSpent ??= new Set();
  const want = scheduled(ch, now);
  for (const n of ch.nodes.values()) {
    const w = want.get(n.id);
    const clock = w && !ch.nsSpent.has(w.key) ? w.st : 0;
    const st = RANK[clock] >= RANK[n.var ?? 0] ? clock : n.var; // the better of the two shows
    if (stateOf(n) === st) continue;
    // (A node mid-chop keeps its state until it falls: its hp belongs to it.)
    if (n.alive && n.hp < hpOf(n.type, stateOf(n))) continue;
    setState(ch, n, st, w?.key ?? null);
    if (st === NODE_STATE.ancient) announce(ch, n, w.region);
  }
}

// Show a node in a state (its hp to match, when it's standing untouched).
function setState(ch, n, st, key = null) {
  n.st = st;
  n.stKey = key;
  if (n.alive) n.hp = hpOf(n.type, st);
  ch.broadcast({ t: 'nst', id: n.id, st, hp: n.hp });
}

// A node fell while rich or ancient: it's spent for this turn of the schedule.
// Its rolled variant is spent too.
export function spend(ch, n) {
  if (stateOf(n) && n.stKey) (ch.nsSpent ??= new Set()).add(n.stKey);
  n.st = 0;
  n.stKey = null;
  n.var = 0;
  // Forget old turns now and then.
  if (ch.nsSpent?.size > 500) ch.nsSpent.clear();
}

// A node grows back: it rolls what it comes back as. Returns its state.
export function regrow(ch, n, rng = Math.random) {
  n.var = rollVariant(n.type, rng);
  n.st = n.var;
  n.stKey = null;
  n.hp = hpOf(n.type, n.st);
  if (n.st === ST.golden) announce(ch, n, regionAt(n.x, n.z));
  return n.st;
}

// The server owner turns a standing node into a state (owner.wild): to try
// a variant out, or to give friends a golden moment.
export function force(ch, n, st) {
  n.var = st;
  setState(ch, n, st);
  if (st === ST.golden) announce(ch, n, regionAt(n.x, n.z));
}

// The variants a channel starts with: a few of today's, the same on every
// channel (seeded by the node and the day), so the woods differ day to day.
export function seedVariants(nodes, day) {
  for (const n of nodes.values()) {
    if (!n.alive) continue; // (an empty grove slot)
    let s = hash32(`${n.id}:${day}`);
    n.var = rollVariant(n.type, () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0) / 4294967296));
    n.st = n.var;
    n.hp = hpOf(n.type, n.st);
  }
}

// Tell the heroes in a node's region that something special stirs: a toast,
// and a pin on their map (client: { t: 'find' }).
function announce(ch, n, region) {
  if (!region) return;
  const t = NODE_TYPES[n.type];
  const st = stateOf(n);
  const gate = STATE_FX[st]?.gate ?? 0;
  const text = `${st === NODE_STATE.golden ? 'A' : 'An'} ${variantName(n.type, st)} ${st === NODE_STATE.golden ? 'shines' : 'stirs'} in ${region.name}!${gate ? ` (${t.skill[0].toUpperCase() + t.skill.slice(1)} ${t.lvl + gate})` : ''}`;
  for (const c of ch.players.values()) {
    if (regionAt(c.ent.x, c.ent.z)?.id !== region.id) continue;
    c.send({ t: 'toast', kind: 'gold', text });
    c.send({ t: 'find', id: n.id, st, x: n.x, z: n.z, name: variantName(n.type, st) });
  }
}
