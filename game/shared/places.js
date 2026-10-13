// Where a point is: its region, the town it belongs to (where you can trade,
// craft and use a town's services) and its biome (the look and mood).
// They look only at the entries near the point (world.js keeps an index).
import { MAP, around } from './world.js';
import { biome } from './biomes.js';

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

// ── Ground colours ──────────────────────────────────────────────────────
// The ground palette at (x, z): the map's biome, then each region (big to
// small) and each zone with a biome blended in across its edge
// (smooth(r − 4, r + 3)). Colours are linear RGB [r, g, b], the same numbers
// three.js would make of the biome's hex colours.
const lin = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) rgbCache.set(hex, (v = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))));
  return v;
}
const KEYS = ['grass', 'grass2', 'path', 'plaza', 'sand', 'cliff'];
const paletteOf = (id) => Object.fromEntries(KEYS.map((k) => [k, rgb(biome(id).ground[k])]));
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function groundAt(x, z) {
  const base = MAP?.biome ?? 'meadow';
  const layers = [...around('regions', x, z), ...around('zones', x, z)]
    .filter((e) => e.biome && e.biome !== base && Math.hypot(x - e.x, z - e.z) < e.r + 3)
    .sort((a, b) => b.r - a.r);
  if (!layers.length) return paletteOf(base);
  const out = Object.fromEntries(KEYS.map((k) => [k, [...paletteOf(base)[k]]]));
  for (const e of layers) {
    const w = 1 - smooth(e.r - 4, e.r + 3, Math.hypot(x - e.x, z - e.z));
    if (w <= 0) continue;
    const p = paletteOf(e.biome);
    for (const k of KEYS) for (let c = 0; c < 3; c++) out[k][c] += (p[k][c] - out[k][c]) * w;
  }
  return out;
}
