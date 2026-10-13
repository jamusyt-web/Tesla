// Rich and ancient gathering nodes (SPEC §4.3): now and then a tree, rock or
// herb turns rich (gold) or ancient (violet) for a while and gives far more,
// to heroes skilled enough to work it. The schedule is the clock's, so every
// channel agrees on which node it is; the states live in memory.
//   rich:    in every region, every 10 minutes, one node for 8 minutes
//   ancient: in every region, once an hour (offset by region × 7 min), for 15
// A node that falls is spent: it comes back plain.
import { NODE_TYPES, REGIONS } from '../shared/world.js';
import { hash32 } from '../shared/clock.js';
import { regionAt } from '../shared/places.js';

export const NODE_STATE = { normal: 0, rich: 1, ancient: 2 };
// What each state does: level gate, yield, xp and rare chance multipliers.
export const STATE_FX = {
  0: { gate: 0, yield: 1, xp: 1, rare: 1, sureRare: false },
  1: { gate: 8, yield: 3, xp: 2.5, rare: 3, sureRare: false },
  2: { gate: 16, yield: 5, xp: 6, rare: 1, sureRare: true },
};
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
    const pick = (key) => pool[hash32(key) % pool.length];
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
    const st = w && !ch.nsSpent.has(w.key) ? w.st : 0;
    if (stateOf(n) === st) continue;
    n.st = st;
    n.stKey = w?.key ?? null;
    ch.broadcast({ t: 'nst', id: n.id, st });
    if (st === NODE_STATE.ancient) announceAncient(ch, n, w.region);
  }
}

// A node fell while rich or ancient: it's spent for this turn of the schedule.
export function spend(ch, n) {
  if (stateOf(n) && n.stKey) (ch.nsSpent ??= new Set()).add(n.stKey);
  n.st = 0;
  n.stKey = null;
  // Forget old turns now and then.
  if (ch.nsSpent?.size > 500) ch.nsSpent.clear();
}

function announceAncient(ch, n, region) {
  const t = NODE_TYPES[n.type];
  const text = `An ancient ${t.name} stirs in ${region.name}! (${t.skill[0].toUpperCase() + t.skill.slice(1)} ${t.lvl + STATE_FX[2].gate})`;
  for (const c of ch.players.values()) if (regionAt(c.ent.x, c.ent.z)?.id === region.id) c.send({ t: 'toast', kind: 'gold', text });
}
