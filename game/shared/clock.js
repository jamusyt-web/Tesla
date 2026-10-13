// The world clock and weather (SPEC §2.3). Pure: the same moment gives the
// same answer on the server and every client (clients use the server's time).
//
// A day is 100 minutes: 0–60 day, 60–70 dusk, 70–90 night, 90–100 dawn.
import { BIOMES } from './biomes.js';

export const DAY_MS = 100 * 60_000;
export const dayMin = (now) => (now / 60_000) % 100;
export const isNight = (now) => {
  const m = dayMin(now);
  return m >= 70 && m < 90;
};
export const isNoon = (now) => {
  const m = dayMin(now);
  return m >= 25 && m < 35;
};
// How dark it is, 0 (day) to 1 (night), easing through dusk and dawn.
export function nightness(now) {
  const m = dayMin(now);
  if (m < 60) return 0;
  if (m < 70) return (m - 60) / 10;
  if (m < 90) return 1;
  return 1 - (m - 90) / 10;
}

// A 32-bit hash of a string (FNV-1a).
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export const WEATHER_SLOT_MS = 1_200_000; // 20 minutes
// The weather in a biome right now: { kind, rate } or null. Each 20-minute
// slot rolls its own chance; 'night' weather only shows at night.
export function weatherAt(biomeId, now) {
  const w = BIOMES[biomeId]?.weather;
  if (!w) return null;
  if (w.night && !isNight(now)) return null;
  const roll = hash32(`${biomeId}:${Math.floor(now / WEATHER_SLOT_MS)}`) / 2 ** 32;
  return roll < (w.chance ?? 1) ? { kind: w.kind, rate: w.rate } : null;
}
