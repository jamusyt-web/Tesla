// Where a point is: its region, the town it belongs to (where you can trade,
// craft and use a town's services) and its biome (the look and mood).
// Phase 1 (M1) indexes these for a big world; today they scan the map lists.
import { MAP, REGIONS, ZONES } from './world.js';

// The smallest entry of `list` whose circle holds (x, z) and passes `ok`.
function smallest(list, x, z, ok = () => true) {
  let best = null;
  for (const e of list) if (Math.hypot(x - e.x, z - e.z) < e.r && ok(e) && (!best || e.r < best.r)) best = e;
  return best;
}

export const regionAt = (x, z) => smallest(REGIONS, x, z);
export const townAt = (x, z) => smallest(REGIONS, x, z, (r) => r.kind === 'town');
export const zoneAt = (x, z) => smallest(ZONES, x, z);

// zone biome, else region biome, else the map's, else meadow. A wilds zone is
// the wilds biome. Today that gives meadow everywhere except the Wilds.
export function biomeAt(x, z) {
  const zone = zoneAt(x, z);
  const region = regionAt(x, z);
  return zone?.biome ?? ((zone?.kind ?? zone?.id) === 'wilds' ? 'wilds' : null) ?? region?.biome ?? MAP?.biome ?? 'meadow';
}
