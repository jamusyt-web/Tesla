// Where the crafting stations stand and where a hero stands to use one.
// Positions come from the station props in the world map (shared/world.js).
// Every town has its own (an anvil in each yard), so a station is found by
// kind and place: the nearest one of that kind.
import { PROPS } from './world.js';
import { STATIONS } from './crafting.js';

export const stationsOf = (kind) => PROPS.filter((p) => p.station === kind);
export function nearestStation(kind, x = 0, z = 0) {
  let best = null;
  let bd = Infinity;
  for (const p of PROPS) {
    if (p.station !== kind) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) (best = p), (bd = d);
  }
  return best;
}

// Two work spots in front of a station (a station prop, or the nearest of a
// kind to x, z) plus a shared overflow spot, so a busy station never blocks
// anyone. rot faces the station.
export function spotsOf(st, x = 0, z = 0) {
  const p = typeof st === 'string' ? nearestStation(st, x, z) : st;
  if (!p) return [];
  const d = p.r + 0.75;
  return [
    [-0.7, -d],
    [0.7, -d],
    [0, -(p.r + 1.95)],
  ].map(([dx, dz], i) => {
    const x = +(p.x + dx).toFixed(2);
    const z = +(p.z + dz).toFixed(2);
    return { i, x, z, rot: Math.atan2(p.x - x, p.z - z) };
  });
}
export const stationPos = (kind, x = 0, z = 0) => {
  const p = nearestStation(kind, x, z);
  return p ? { x: p.x, z: p.z, r: p.r, id: p.id } : null;
};
export const STATION_IDS = Object.keys(STATIONS);
// "Quick" crafting works anywhere near a crafting station (the Workshop yard).
export const YARD_RANGE = 10;
export const inYard = (x, z) => PROPS.some((p) => p.station && Math.hypot(p.x - x, p.z - z) <= YARD_RANGE);
