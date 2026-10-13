// The rules of getting around that the server enforces and the client shows:
// the waystone toll, items waystones won't carry, a hero's home stone and
// passages (a hop between two ends, opened by a skill level or a kit).
import { ITEMS } from './items.js';
import { REGIONS, STONES, PASSAGES } from './world.js';
import { SKILLS, levelFromXp } from './skills.js';

// Raw goods: what the toll is charged on (SPEC §6.3).
export const TOLL_TAGS = new Set(['wood', 'plank', 'ore', 'bar', 'herb', 'fish', 'hide', 'monster', 'gem', 'reagent']);
export const TOLL_MAX = 120;

// toll = min(120, floor(0.04 × max(0, floorValueCarried − 500))), where
// floorValueCarried = Σ qty × value × 0.6 over the raw goods in the bag.
// Worked in tenths of gold so it's exact. bag = { item: qty }.
export function travelToll(bag, items = ITEMS) {
  let tenths = 0;
  for (const [id, n] of Object.entries(bag ?? {})) {
    const it = items[id];
    if (it && TOLL_TAGS.has(it.tag)) tenths += n * (it.value ?? 0) * 6;
  }
  return Math.min(TOLL_MAX, Math.floor((4 * Math.max(0, tenths - 5000)) / 1000));
}

// The first bag item that waystones refuse to carry (letters, crates), or null.
export function nowarpItem(bag, items = ITEMS) {
  for (const [id, n] of Object.entries(bag ?? {})) if (n > 0 && items[id]?.nowarp) return id;
  return null;
}

// A town's home stone: the region's `stone`, else the waystone inside it
// nearest its centre, else the first waystone there is.
export function homeStone(town = 'hearthvale') {
  const r = REGIONS.find((x) => x.id === town);
  if (r?.stone) {
    const st = STONES.find((s) => s.id === r.stone);
    if (st) return st;
  }
  let best = null;
  let bd = Infinity;
  if (r) {
    for (const s of STONES) {
      const d = Math.hypot(s.x - r.x, s.z - r.z);
      if (d < r.r && d < bd) (best = s), (bd = d);
    }
  }
  return best ?? STONES[0] ?? null;
}

// Passages: within PASSAGE_RANGE of either end you can hop to the other.
export const PASSAGE_RANGE = 3;
export const passageById = (id) => PASSAGES.find((p) => p.id === id) ?? null;

// The passage end you're standing at: { p, from: [x, z], to: [x, z] }, or null.
export function passageAt(x, z, range = PASSAGE_RANGE) {
  let best = null;
  for (const p of PASSAGES) {
    for (const [a, b] of [[[p.x, p.z], [p.tx, p.tz]], [[p.tx, p.tz], [p.x, p.z]]]) {
      const d = Math.hypot(x - a[0], z - a[1]);
      if (d <= range && (!best || d < best.d)) best = { p, from: a, to: b, d };
    }
  }
  return best;
}

// Can a hero (skills as xp, bag as { item: qty }) use passage p? Its skill
// level opens it, and so does its kit in the bag (never used up).
export function passageOpen(p, skills, bag) {
  if (!p.req && !p.kit) return true;
  if (p.req && levelFromXp(skills?.[p.req.skill] || 0) >= p.req.lvl) return true;
  return !!(p.kit && (bag?.[p.kit] ?? 0) > 0);
}

// What it takes, in words: "Mining 10 or Hooded Lantern".
export function passageNeeds(p) {
  const parts = [];
  if (p.req) parts.push(`${SKILLS[p.req.skill]?.name ?? p.req.skill} ${p.req.lvl}`);
  if (p.kit) parts.push(ITEMS[p.kit]?.name ?? p.kit);
  return parts.join(' or ');
}
