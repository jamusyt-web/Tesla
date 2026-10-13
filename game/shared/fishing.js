// Fishing fight: a Stardew-style reel minigame. You hold to lift a catch bar
// and keep a darting fish inside it; progress fills while it's inside and
// drains while it's out. Bigger fish move faster and more erratically, better
// rods give you a bigger bar and reel faster.
//
// The simulation is deterministic (fixed 60 Hz ticks, seeded RNG, only
// + - * / and Math.min/max/abs — no trig) so the server can replay a player's
// exact button presses and reach the same result. That makes catches
// cheat-proof: the client just reports *when* the button was held.
import { mulberry32 } from './world.js';
import { CONTENT, mergeInto } from './content/index.js';
import { isNight, isNoon, dayMin } from './clock.js';

export const FISH_TICK = 1 / 60;
export const FISH_MAX_TICKS = 60 * 40; // after 40 s the fish breaks free
const START_PROGRESS = 0.3;

// Species. d = base difficulty (0–100). kg = size range; bigger rolls are harder.
// behavior shapes how the fish moves in the bar. A legendary has
// legend: { rod (the rod tier it needs), window? } and bites only in deep
// water inside its window (shared/clock.js weather and time of day).
export const FISH = {
  old_boot: { d: 4, kg: [0.4, 0.9], behavior: 'floater', xp: 3 },
  minnow: { d: 12, kg: [0.05, 0.3], behavior: 'smooth', xp: 9 },
  perch: { d: 24, kg: [0.3, 1.4], behavior: 'smooth', xp: 14 },
  trout: { d: 40, kg: [0.8, 3.2], behavior: 'dart', xp: 22 },
  pike: { d: 64, kg: [2, 9], behavior: 'mixed', xp: 40 },
  golden_koi: { d: 74, kg: [1, 4], behavior: 'dart', xp: 70 },
  lake_king: { d: 92, kg: [18, 60], behavior: 'mixed', xp: 180, legend: { rod: 2 } },
};
mergeInto(FISH, CONTENT.fish ?? {}, 'fish');

// What bites where (SPEC §4.4). A table: { lvl (the Fishing level a spot
// needs), fish: [{ id, shallow, deep, luck? }], legends: [ids] }. Weights
// marked luck grow with your luck. A spot's table is its node's `table`,
// else its lake's `fish`, else 'mirror'.
export const FISH_TABLES = {
  // Mirror Lake: Hearthvale's waters, as they always were.
  mirror: {
    lvl: 1,
    fish: [
      { id: 'old_boot', shallow: 7, deep: 7 },
      { id: 'minnow', shallow: 48, deep: 18 },
      { id: 'perch', shallow: 30, deep: 22 },
      { id: 'trout', shallow: 14, deep: 24, luck: true },
      { id: 'pike', shallow: 3, deep: 10, luck: true },
      { id: 'golden_koi', shallow: 1, deep: 2.5, luck: true },
    ],
    legends: ['lake_king'],
  },
};
// A town's table: its three fish weighted 50/35/15 in the shallows and
// 25/40/35·luck in deep water, plus the old boot.
export const townTable = (lvl, [a, b, c], legends = []) => ({
  lvl,
  fish: [{ id: 'old_boot', shallow: 7, deep: 7 }, { id: a, shallow: 50, deep: 25 }, { id: b, shallow: 35, deep: 40 }, { id: c, shallow: 15, deep: 35, luck: true }],
  legends,
});
mergeInto(FISH_TABLES, CONTENT.fishTables ?? {}, 'fishTables');
export const tableOf = (id) => FISH_TABLES[id] ?? FISH_TABLES.mirror;

// Luck: better rods and more practice bring the good fish up.
export const fishLuck = (rodTier, lvl, bonus = 0) => 1 + 0.04 * Math.min(lvl, 40) + 0.6 * (rodTier - 1) + bonus;

// Is a legendary's window open? window: { weather?: kind, time?: 'night' |
// 'noon' | [from, to] (clock minutes) }. ctx: { now, weather (kind or null) }.
export function inWindow(legend, ctx = {}) {
  const w = legend?.window;
  if (!w) return true;
  const now = ctx.now ?? Date.now();
  if (w.weather && ctx.weather !== w.weather) return false;
  if (w.time === 'night' && !isNight(now)) return false;
  if (w.time === 'noon' && !isNoon(now)) return false;
  if (Array.isArray(w.time) && !(dayMin(now) >= w.time[0] && dayMin(now) < w.time[1])) return false;
  return true;
}

// The weights at a spot: [{ id, w }]. ctx: { luck (bonus), rareWeight, now, weather }.
export function fishWeights(table, rodTier, lvl, deep, ctx = {}) {
  const T = typeof table === 'string' ? tableOf(table) : table;
  const luck = fishLuck(rodTier, lvl, ctx.luck || 0);
  const rare = 1 + (ctx.rareWeight || 0);
  const out = T.fish.map((e) => ({ id: e.id, w: (deep ? e.deep : e.shallow) * (e.luck ? luck * rare : 1) }));
  for (const id of T.legends ?? []) {
    const L = FISH[id]?.legend;
    out.push({ id, w: deep && L && rodTier >= L.rod && inWindow(L, ctx) ? 0.6 * luck * rare : 0 });
  }
  return out.filter((r) => r.w > 0 && FISH[r.id]);
}
// (The old name, for the mirror table.)
export const fishTable = (rodTier, fishingLvl, deep) => fishWeights('mirror', rodTier, fishingLvl, deep);

// What bites. ctx also takes kgSkew (bigger catches; 0.25 = Trophy).
export function rollFish(rng, table, rodTier, fishingLvl, deep, ctx = {}) {
  const list = fishWeights(table, rodTier, fishingLvl, deep, ctx);
  let roll = rng() * list.reduce((s, r) => s + r.w, 0);
  let id = list[0].id;
  for (const r of list) {
    roll -= r.w;
    if (roll <= 0) {
      id = r.id;
      break;
    }
  }
  const f = FISH[id];
  const sz = rng() ** (1 / (1 + (ctx.kgSkew || 0))); // 0 = smallest of its kind, 1 = record-breaker
  const kg = Math.round((f.kg[0] + (f.kg[1] - f.kg[0]) * sz * sz) * 100) / 100;
  const d = Math.min(100, Math.max(1, Math.round(f.d + (sz - 0.4) * 14)));
  return { id, kg, d, behavior: f.behavior, seed: Math.floor(rng() * 2 ** 31) };
}

// Gear → how forgiving the fight is. Rods go up to tier 7, levels count to 40.
// zoneBonus: a Fine/Masterwork rod's slightly bigger catch zone (and charms).
export function fishingGear(rodTier, fishingLvl, zoneBonus = 0) {
  const t = Math.max(1, Math.min(7, rodTier));
  return {
    zone: Math.min(0.42, Math.min(0.4, 0.22 + Math.min(t - 1, 3) * 0.045 + Math.min(fishingLvl, 40) * 0.003) + zoneBonus),
    gain: 0.26 + (t - 1) * 0.03,
    drain: Math.max(0.06, 0.17 - (t - 1) * 0.018),
  };
}

// A rough "how hard is this for you" label for the UI.
export function fightRating(d, gear) {
  const ease = gear.zone * 220 + gear.gain * 60;
  const r = d - ease;
  return r < -25 ? 'easy' : r < -5 ? 'fair' : r < 12 ? 'tough' : 'brutal';
}

export function newFight(fish, gear) {
  return {
    rng: mulberry32(fish.seed),
    d: fish.d,
    behavior: fish.behavior,
    gear,
    tick: 0,
    fishPos: 0.5,
    fishVel: 0,
    target: 0.5,
    nextMove: 30,
    zonePos: 0.0,
    zoneVel: 0,
    progress: START_PROGRESS,
    inZone: false,
    done: null, // 'caught' | 'escaped'
  };
}

// Advance one tick. Returns the same state object.
export function stepFight(s, held) {
  if (s.done) return s;
  const dt = FISH_TICK;
  const k = s.d / 100; // 0..1 difficulty
  const rng = s.rng;
  const dart = s.behavior === 'dart';
  // Fish AI: every so often pick a new depth to swim toward.
  if (--s.nextMove <= 0) {
    let tgt = 0.05 + rng() * 0.9;
    if (s.behavior === 'sinker') tgt = 0.05 + rng() * 0.55;
    else if (s.behavior === 'floater') tgt = 0.45 + rng() * 0.5;
    else if ((dart && rng() < 0.6) || (s.behavior === 'mixed' && rng() < 0.4)) {
      // Darters like big jumps to the other side of the bar.
      if (Math.abs(tgt - s.fishPos) < 0.35) tgt = s.fishPos < 0.5 ? 0.6 + rng() * 0.35 : 0.05 + rng() * 0.35;
    }
    s.target = tgt;
    const every = (125 - 95 * k) * (dart ? 0.8 : s.behavior === 'smooth' ? 1.25 : 1);
    s.nextMove = Math.max(12, Math.round(every * (0.6 + rng() * 0.8)));
  }
  // Swim toward the target with a speed cap and agility that grow with size.
  const vmax = 0.22 + k * 1.05;
  const agility = (2.5 + k * 9) * (dart ? 1.25 : 1);
  let want = (s.target - s.fishPos) * 4;
  want = Math.max(-vmax, Math.min(vmax, want));
  s.fishVel += (want - s.fishVel) * Math.min(1, agility * dt);
  s.fishPos += s.fishVel * dt;
  if (s.fishPos < 0) {
    s.fishPos = 0;
    s.fishVel = 0;
  } else if (s.fishPos > 1) {
    s.fishPos = 1;
    s.fishVel = 0;
  }
  // Your catch bar: holding lifts it, letting go lets it sink.
  const g = s.gear;
  s.zoneVel += (held ? 2.8 : -2.4) * dt;
  s.zoneVel = Math.max(-1.4, Math.min(1.4, s.zoneVel));
  s.zonePos += s.zoneVel * dt;
  const top = 1 - g.zone;
  if (s.zonePos < 0) {
    s.zonePos = 0;
    s.zoneVel = -s.zoneVel * 0.3;
  } else if (s.zonePos > top) {
    s.zonePos = top;
    s.zoneVel = 0;
  }
  s.inZone = s.fishPos >= s.zonePos && s.fishPos <= s.zonePos + g.zone;
  s.progress += s.inZone ? g.gain * dt : -g.drain * (0.75 + k * 0.6) * dt;
  s.tick++;
  if (s.progress >= 1) {
    s.progress = 1;
    s.done = 'caught';
  } else if (s.progress <= 0) {
    s.progress = 0;
    s.done = 'escaped';
  } else if (s.tick >= FISH_MAX_TICKS) s.done = 'escaped';
  return s;
}

// Replay a fight from the list of ticks at which the button toggled
// (starting released). Used by the server to verify a catch.
export function replayFight(fish, gear, toggles, endTick) {
  const s = newFight(fish, gear);
  let held = false;
  let k = 0;
  const end = Math.min(FISH_MAX_TICKS, endTick);
  while (!s.done && s.tick < end) {
    while (k < toggles.length && toggles[k] <= s.tick) {
      held = !held;
      k++;
    }
    stepFight(s, held);
  }
  return s;
}
