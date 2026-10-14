// Biomes: each place's look and mood (SPEC §2): ground and grass colours,
// water, sky, fog and light, weather, critters, ground cover and ambience.
// One file per biome in shared/biomes/; a town's content pack registers its
// own with registerBiome. Which biome a point is in: biomeAt (places.js).
//
// BIOMES[id] = { id, name, ground: { grass, grass2, path, plaza, sand, cliff },
//   tufts: { colors: [a, b, c], density }, water: { shallow, deep },
//   sea: { shallow, deep }, sky: { top, mid, bot },
//   light: { fog, fogNear, fogFar, hemiSky, hemiGround, hemi, sun, sunI, exposure },
//   weather: null | { kind, rate, chance, night? }, critters: [],
//   cover: [{ slot, per100m2, s: [min, max], nearWater? }], ambience, pack }
// Fog distances are for high quality; phones use near × 0.9 and far × 0.75.
import meadow from './biomes/meadow.js';
import wilds from './biomes/wilds.js';
import autumn from './biomes/autumn.js';

export const BIOMES = {};
export function registerBiome(b) {
  if (BIOMES[b.id]) throw new Error(`Biome "${b.id}" is defined twice.`);
  BIOMES[b.id] = b;
}
registerBiome(meadow);
registerBiome(wilds);
registerBiome(autumn);

export const biome = (id) => BIOMES[id] ?? BIOMES.meadow;

// Phones see a little less far.
export const LOW_FOG = { near: 0.9, far: 0.75 };
