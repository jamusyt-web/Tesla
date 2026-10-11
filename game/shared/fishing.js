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

export const FISH_TICK = 1 / 60;
export const FISH_MAX_TICKS = 60 * 40; // after 40 s the fish breaks free
const START_PROGRESS = 0.3;

// Species. d = base difficulty (0–100). kg = size range; bigger rolls are harder.
// behavior shapes how the fish moves in the bar.
export const FISH = {
  old_boot: { d: 4, kg: [0.4, 0.9], behavior: 'floater', xp: 3 },
  minnow: { d: 12, kg: [0.05, 0.3], behavior: 'smooth', xp: 9 },
  perch: { d: 24, kg: [0.3, 1.4], behavior: 'smooth', xp: 14 },
  trout: { d: 40, kg: [0.8, 3.2], behavior: 'dart', xp: 22 },
  pike: { d: 64, kg: [2, 9], behavior: 'mixed', xp: 40 },
  golden_koi: { d: 74, kg: [1, 4], behavior: 'dart', xp: 70 },
  lake_king: { d: 92, kg: [18, 60], behavior: 'mixed', xp: 180 },
};

// What bites depends on rod tier, fishing level and whether the spot is deep.
export function fishTable(rodTier, fishingLvl, deep) {
  const luck = 1 + fishingLvl * 0.04 + (rodTier - 1) * 0.6;
  return [
    { id: 'old_boot', w: 7 },
    { id: 'minnow', w: deep ? 18 : 48 },
    { id: 'perch', w: deep ? 22 : 30 },
    { id: 'trout', w: (deep ? 24 : 14) * luck },
    { id: 'pike', w: (deep ? 10 : 3) * luck },
    { id: 'golden_koi', w: (deep ? 2.5 : 1) * luck },
    { id: 'lake_king', w: deep && rodTier >= 2 ? 0.6 * luck : 0 },
  ];
}

export function rollFish(rng, rodTier, fishingLvl, deep) {
  const table = fishTable(rodTier, fishingLvl, deep).filter((r) => r.w > 0);
  let roll = rng() * table.reduce((s, r) => s + r.w, 0);
  let id = table[0].id;
  for (const r of table) {
    roll -= r.w;
    if (roll <= 0) {
      id = r.id;
      break;
    }
  }
  const f = FISH[id];
  const sz = rng(); // 0 = smallest of its kind, 1 = record-breaker
  const kg = Math.round((f.kg[0] + (f.kg[1] - f.kg[0]) * sz * sz) * 100) / 100;
  const d = Math.min(100, Math.max(1, Math.round(f.d + (sz - 0.4) * 14)));
  return { id, kg, d, behavior: f.behavior, seed: Math.floor(rng() * 2 ** 31) };
}

// Gear → how forgiving the fight is.
// zoneBonus: a Fine/Masterwork rod's slightly bigger catch zone.
export function fishingGear(rodTier, fishingLvl, zoneBonus = 0) {
  const t = Math.max(1, Math.min(3, rodTier));
  return {
    zone: Math.min(0.42, Math.min(0.4, 0.22 + (t - 1) * 0.045 + Math.min(fishingLvl, 20) * 0.003) + zoneBonus),
    gain: 0.26 + (t - 1) * 0.04,
    drain: 0.17 - (t - 1) * 0.02,
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
