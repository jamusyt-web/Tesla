// Where a point is: its region, the town it belongs to (where you can trade,
// craft and use a town's services) and its biome (the look and mood).
// They look only at the entries near the point (world.js keeps an index).
import { MAP, around } from './world.js';

// The smallest entry of `list` whose circle holds (x, z) and passes `ok`.
function smallest(list, x, z, ok = () => true) {
  let best = null;
  for (const e of list) if (Math.hypot(x - e.x, z - e.z) < e.r && ok(e) && (!best || e.r < best.r)) best = e;
  return best;
}

export const regionAt = (x, z) => smallest(around('regions', x, z), x, z);
export const townAt = (x, z) => smallest(around('regions', x, z), x, z, (r) => r.kind === 'town');
export const zoneAt = (x, z) => smallest(around('zones', x, z), x, z);

// zone biome, else region biome, else the map's, else meadow. A wilds zone is
// the wilds biome. Today that gives meadow everywhere except the Wilds.
export function biomeAt(x, z) {
  const zone = zoneAt(x, z);
  const region = regionAt(x, z);
  return zone?.biome ?? ((zone?.kind ?? zone?.id) === 'wilds' ? 'wilds' : null) ?? region?.biome ?? MAP?.biome ?? 'meadow';
}
