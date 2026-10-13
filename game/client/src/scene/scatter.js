// Ground cover (bushes, mushrooms, grass…) generated on the client per chunk
// from a biome's cover rules. It's never stored in the map, the server and
// the nav grid never see it, and it never blocks anyone. Plain JS (no three),
// so the server tests can check it.
//
// A rule: { slot, per100m2, s: [min, max], nearWater?: true, biome? }
//   per100m2   how many per 100 m² of open ground
//   nearWater  only on lake shores
//   biome      only where near.biomeAt(x, z) is this biome (when given)
import { mulberry32 } from '../../../shared/world.js';

export const CHUNK = 96; // metres: the side of a streaming square

// biome id → cover rules. Filled from the biome definitions; meadow has none,
// so Hearthvale keeps exactly its hand-placed cover.
export const COVER = {};

const VARIANTS = 3; // at most 3 variants per scatter slot

function distSeg(px, pz, [ax, az, bx, bz]) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

// Distance to the coast (negative inland), from the lands near this chunk.
export function landDist(x, z, lands) {
  let d = Infinity;
  for (const l of lands) d = Math.min(d, Math.hypot(x - l.x, z - l.z) - l.r);
  return d;
}

// Is (x, z) free for cover: on land, off paths, plazas, buildings, nodes and lakes?
export function openGround(x, z, near) {
  if (landDist(x, z, near.lands) > -1) return false;
  for (const p of near.plazas) if (Math.hypot(x - p.x, z - p.z) < p.r + 1) return false;
  for (const b of near.buildings) if (Math.abs(x - b.x) < b.w / 2 + 1.2 && Math.abs(z - b.z) < b.d / 2 + 1.2) return false;
  for (const s of near.segs) if (distSeg(x, z, s) < s[4] + 0.6) return false;
  for (const n of near.nodes ?? []) if (Math.hypot(x - n.x, z - n.z) < (n.r ?? 1) + 1) return false;
  for (const l of near.lakes) if (Math.hypot(x - l.x, z - l.z) < l.r + 1.5) return false;
  return true;
}

const shore = (x, z, lakes) => lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 6);

// Cover placements for chunk (i, j): [{ slot, v, x, z, rot, s }]. The same
// inputs always give the same list. near = { lands, plazas, buildings, segs,
// nodes, lakes, biomeAt? }, all already narrowed to this chunk.
export function scatterPoints(i, j, rules, near, seed = 0) {
  const out = [];
  if (!rules?.length) return out;
  const x0 = i * CHUNK;
  const z0 = j * CHUNK;
  rules.forEach((rule, k) => {
    const r = mulberry32((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 1, 83492791) ^ seed) >>> 0);
    const n = Math.round((rule.per100m2 * CHUNK * CHUNK) / 100);
    const [s0, s1] = rule.s ?? [1, 1];
    for (let t = 0; t < n; t++) {
      // Draw every number first, so a skipped point doesn't shift the rest.
      const x = x0 + r() * CHUNK;
      const z = z0 + r() * CHUNK;
      const rot = r() * Math.PI * 2;
      const s = s0 + r() * (s1 - s0);
      const v = Math.floor(r() * VARIANTS);
      if (rule.biome && near.biomeAt && near.biomeAt(x, z) !== rule.biome) continue;
      if (rule.nearWater && !shore(x, z, near.lakes)) continue;
      if (!openGround(x, z, near)) continue;
      out.push({ slot: rule.slot, v, x, z, rot, s });
    }
  });
  return out;
}
