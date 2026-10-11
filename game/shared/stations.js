// Where the crafting stations stand and where a hero stands to use one.
// Positions come from the station props in the world map (shared/world.js).
import { PROPS } from './world.js';
import { STATIONS } from './crafting.js';

const at = (id) => PROPS.find((p) => p.station === id);

// Two work spots in front of each station plus a shared overflow spot, so a
// busy station never blocks anyone. rot faces the station.
export function spotsOf(id) {
  const p = at(id);
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
export const stationPos = (id) => {
  const p = at(id);
  return p ? { x: p.x, z: p.z, r: p.r } : null;
};
export const STATION_IDS = Object.keys(STATIONS);
// "Quick" crafting works anywhere near a crafting station (the Workshop yard).
export const YARD_RANGE = 10;
export const inYard = (x, z) => PROPS.some((p) => p.station && Math.hypot(p.x - x, p.z - z) <= YARD_RANGE);
