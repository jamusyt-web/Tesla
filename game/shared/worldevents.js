// World events (the living wilds, L3): something happening somewhere every
// few minutes. Each region's clock is cut into SLOT_MS slots; in most slots
// one thing happens there for a few minutes: a growing rain fills a grove,
// a golden hour lights a few nodes, the fish go into a frenzy, a stampede
// charges out of a camp, a treasure goblin turns up, and on clear nights the
// herbs shine. Pure and clock-hashed, so every channel and every client
// agrees on what's on (server/worldevents.js makes it happen).
import { hash32, isNight } from './clock.js';
import { REGIONS, NODES, LAKES, SPAWNS, STONES, LANDMARKS } from './world.js';
import { NODE_TYPES } from './nodes.js';
import { MONSTERS } from './monsters.js';
import { zoneAt } from './places.js';

export const SLOT_MS = 10 * 60_000;
const CHANCE = 70; // % of slots with an event

// kind → { name, icon, min (duration), needs (what the region must have), night }
export const EVENT_KINDS = {
  growth: { name: 'Growing Rain', icon: '🌱', min: 6, needs: 'grove', text: (p) => `A growing rain over ${p}: the groves are filling up fast!` },
  golden: { name: 'Golden Hour', icon: '✨', min: 6, needs: 'node', text: (p) => `Golden hour in ${p}: something shines among the trees and rocks.` },
  frenzy: { name: 'Fish Frenzy', icon: '🐟', min: 5, needs: 'lake', text: (p) => `The fish are in a frenzy at ${p}! Quick bites, better catches.` },
  stampede: { name: 'Stampede', icon: '🐗', min: 5, needs: 'camp', text: (p, m) => `A stampede of ${m} near ${p}! Double gold while it lasts.` },
  goblin: { name: 'Treasure Goblin', icon: '💰', min: 4, needs: 'spot', text: (p) => `A Treasure Goblin is loose near ${p}, its sack bulging!` },
  moonlit: { name: 'Moonlit Herbs', icon: '🌙', min: 8, needs: 'herb', night: true, text: (p) => `The herbs of ${p} shine in the moonlight.` },
};

const inR = (r, e) => Math.hypot(e.x - r.x, e.z - r.z) < r.r;
const smallestAt = (x, z) => REGIONS.filter((r) => inR(r, { x, z })).sort((a, b) => a.r - b.r)[0] ?? null;
const ownedBy = (r, e) => smallestAt(e.x, e.z)?.id === r.id;

// What a region has to hold events with (cached per map).
let CACHE = null;
let CACHE_FOR = null;
function contents() {
  if (CACHE && CACHE_FOR === NODES) return CACHE;
  CACHE = new Map();
  CACHE_FOR = NODES;
  for (const r of REGIONS) {
    if (r.kind === 'outpost') continue;
    const nodes = NODES.filter((n) => ownedBy(r, n));
    const groves = {};
    for (const n of nodes) if (n.grove) (groves[n.grove] ??= []).push(n);
    const work = nodes.filter((n) => ['tree', 'rock', 'herb'].includes(NODE_TYPES[n.type]?.kind));
    CACHE.set(r.id, {
      region: r,
      grove: Object.entries(groves).map(([id, list]) => ({ id, x: avg(list, 'x'), z: avg(list, 'z') })),
      node: work,
      herb: work.filter((n) => NODE_TYPES[n.type].kind === 'herb'),
      lake: LAKES.filter((l) => ownedBy(r, l) && NODES.some((n) => n.type === 'fish_spot' && Math.hypot(n.x - l.x, n.z - l.z) < l.r + 4)),
      camp: SPAWNS.filter((s) => ownedBy(r, s) && MONSTERS[s.monster] && !MONSTERS[s.monster].boss),
      spot: [...STONES, ...LANDMARKS].filter((e) => ownedBy(r, e)),
    });
  }
  return CACHE;
}
const avg = (list, k) => Math.round(list.reduce((a, n) => a + n[k], 0) / list.length);

// The event in a region's slot, or null: { id, region, kind, start, end, x, z, place, target }.
export function eventIn(regionId, slot) {
  const C = contents().get(regionId);
  if (!C) return null;
  const h = hash32(`wev:${regionId}:${slot}`);
  if (h % 100 >= CHANCE) return null;
  const start = slot * SLOT_MS + ((h >>> 8) % 4) * 60_000;
  const kinds = Object.keys(EVENT_KINDS).filter((k) => C[EVENT_KINDS[k].needs]?.length && (!EVENT_KINDS[k].night || isNight(start)));
  if (!kinds.length) return null;
  const kind = kinds[(h >>> 16) % kinds.length];
  const K = EVENT_KINDS[kind];
  const list = C[K.needs];
  const target = list[(h >>> 4) % list.length];
  const place = kind === 'frenzy' ? lakeName(target) : target.name ?? zoneAt(target.x, target.z)?.label ?? C.region.name;
  return { id: `${regionId}:${slot}`, region: regionId, kind, start, end: start + K.min * 60_000, x: target.x, z: target.z, place, target: target.id ?? null, monster: kind === 'stampede' ? target.monster : null };
}
const lakeName = (l) => ({ mirror_lake: 'Mirror Lake', mill_pond: 'the Mill Pond', saltpools: 'the Salt Pools', deepwood_pool: 'the Deepwood Pool' })[l.id] ?? 'the lake';

// Every event on at `now`.
export function eventsAt(now) {
  const slot = Math.floor(now / SLOT_MS);
  const out = [];
  for (const id of contents().keys())
    for (const s of [slot - 1, slot]) {
      const e = eventIn(id, s);
      if (e && now >= e.start && now < e.end) out.push(e);
    }
  return out;
}

// The words for an event ("A stampede of Mossback Hogs near the Westmarch Stones! …").
export function eventText(e) {
  const K = EVENT_KINDS[e.kind];
  const m = e.monster ? `${MONSTERS[e.monster]?.name ?? e.monster}s` : '';
  return K.text(e.place, m);
}
export const eventName = (e) => (e.kind === 'stampede' && e.monster ? `${MONSTERS[e.monster]?.name ?? ''} Stampede` : EVENT_KINDS[e.kind]?.name ?? 'Something stirs');
