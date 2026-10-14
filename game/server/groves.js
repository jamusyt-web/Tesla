// Shifting groves (the living wilds, L2). Nodes that share a `grove` id are
// one patch of forest (or herb meadow, or rocky ground) with more places for
// trees than trees: about GROVE_FILL of its slots hold one at a time. When
// one falls its stump stays while a sapling grows in a free slot nearby;
// once the sapling is grown the stump is gone. So a grove wanders, and never
// runs out. Per channel, in memory; every channel starts the same.
//
// A slot's grove state n.g: null (a tree, standing or felled), 'sapling'
// (growing; it stands up at n.respawnAt) or 'gone' (empty ground).
import { hash32 } from '../shared/clock.js';

export const GROVE_FILL = 0.6;
const NEAREST = 5; // a sapling takes one of the nearest few free slots
const CLEAR = 1.4; // metres: not where someone is standing

// Group a channel's grove nodes and empty the slots that start empty.
export function initGroves(ch) {
  const groves = new Map();
  for (const n of ch.nodes.values()) {
    if (!n.grove) continue;
    if (!groves.has(n.grove)) groves.set(n.grove, []);
    groves.get(n.grove).push(n);
  }
  for (const list of groves.values()) {
    list.sort((a, b) => hash32(a.id) - hash32(b.id) || (a.id < b.id ? -1 : 1));
    const keep = Math.ceil(list.length * GROVE_FILL);
    list.forEach((n, i) => i >= keep && empty(n));
  }
  ch.groves = groves;
}
function empty(n) {
  n.alive = false;
  n.g = 'gone';
  n.hp = 0;
  n.respawnAt = Infinity;
  n.vanishAt = 0;
}

// Is someone standing on this slot? (Nothing sprouts under a hero.)
export const busyAt = (ch, s) => [...ch.players.values()].some((c) => Math.hypot(c.ent.x - s.x, c.ent.z - s.z) < CLEAR);

// A grove node fell at `now` and would regrow in growMs: a sapling starts in
// a free slot near it instead, and its stump goes when the sapling is grown.
// A grove fuller than GROVE_FILL (after a growing rain) just loses the tree.
// Returns the sapling's slot, or null (none: the stump goes, or with no free
// slot at all, the tree regrows where it stood).
export function fell(ch, n, now, growMs, rng = Math.random) {
  const list = ch.groves?.get(n.grove);
  if (!list) return null;
  const up = list.filter((s) => s !== n && s.g !== 'gone' && !s.vanishAt).length;
  if (up >= Math.ceil(list.length * GROVE_FILL)) {
    n.respawnAt = Infinity;
    n.vanishAt = now + growMs;
    return null;
  }
  const free = list.filter((s) => s !== n && s.g === 'gone' && !busyAt(ch, s));
  if (!free.length) return null;
  free.sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z));
  const s = free[Math.floor(rng() * Math.min(NEAREST, free.length))];
  n.respawnAt = Infinity;
  n.vanishAt = now + growMs;
  s.g = 'sapling';
  s.respawnAt = now + growMs;
  ch.broadcast({ t: 'node', id: s.id, alive: false, hp: 0, g: 'sapling', respawnIn: growMs });
  return s;
}

// Each tick, for a felled grove node: its stump is gone once its sapling has grown.
export function vanish(ch, n, now) {
  if (!n.vanishAt || now < n.vanishAt || n.alive) return;
  n.vanishAt = 0;
  n.g = 'gone';
  n.respawnAt = Infinity;
  ch.broadcast({ t: 'node', id: n.id, alive: false, hp: 0, g: 'gone' });
}
export function tickGroves(ch, nodes, now) {
  for (const n of nodes) vanish(ch, n, now);
}

// How full each grove is: { grove: [standing or growing, slots] } (for tests and the owner).
export function groveFill(ch) {
  const out = {};
  for (const [id, list] of ch.groves ?? []) out[id] = [list.filter((s) => s.g !== 'gone' && !s.vanishAt).length, list.length];
  return out;
}
