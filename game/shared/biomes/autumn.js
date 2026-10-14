// Autumn (Amberfold, the Westmarch and the Amberwood; SPEC §2.2): golden
// grass, red and amber trees, a warm low sun and leaves falling now and
// then. The air is clearer than the spec's first draft (fog 30–105 m, a
// pale honey colour), so the red trees read from a distance on a phone. Its models are the 'biome:autumn' group (client manifest/autumn.js),
// loaded when you first get near; its cover is scattered per chunk.
export default {
  id: 'autumn',
  name: 'Autumn',
  ground: { grass: '#b3a04c', grass2: '#9c8a3e', path: '#d1ad74', plaza: '#c2a882', sand: '#d6b07a', cliff: '#6f4a32' },
  tufts: { colors: ['#c9872f', '#a8642a', '#d9a441'], density: 1 },
  water: { shallow: '#6fae9f', deep: '#2a5f66' },
  sea: { shallow: '#5aa3b0', deep: '#1e4f6e' },
  sky: { top: '#f2b36b', mid: '#f6d6a0', bot: '#fde2c0' },
  light: { fog: '#f2dcb6', fogNear: 30, fogFar: 105, hemiSky: '#f0d2a8', hemiGround: '#6b4a32', hemi: 1.2, sun: '#ffc98a', sunI: 2.6, exposure: 1.05 },
  weather: { kind: 'leaves', rate: 0.6, chance: 0.5 },
  critters: ['butterfly', 'deer'],
  // Ground cover per 100 m² (trees stay out of the towns: `wild`).
  cover: [
    { slot: 'au_tree_fall', per100m2: 0.4, s: [0.9, 1.3], wild: true },
    { slot: 'au_tree_red', per100m2: 0.3, s: [0.9, 1.25], wild: true },
    { slot: 'au_pine_fall', per100m2: 0.2, s: [0.9, 1.2], wild: true },
    { slot: 'au_bush', per100m2: 0.7, s: [0.8, 1.3] },
    { slot: 'au_pumpkin', per100m2: 0.1, s: [0.8, 1.2] },
    { slot: 'deco_mushroom', per100m2: 0.4, s: [0.8, 1.2], wild: true },
    { slot: 'au_grass', per100m2: 0.8, s: [0.8, 1.3] },
  ],
  ambience: 'autumn',
  pack: 'biome:autumn',
};
