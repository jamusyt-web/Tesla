// The Deepwood (living wilds, L2): an old green forest north of the
// Westmarch road. Deeper greens than the meadow, soft green-gold air, and
// thick cover: pines and round trees, bushes, logs, stumps and mushrooms.
// Everything it draws is in the core models, so there's nothing more to load.
import meadow from './meadow.js';

export default {
  ...meadow,
  id: 'deepwood',
  name: 'The Deepwood',
  ground: { ...meadow.ground, grass: '#5e9446', grass2: '#4f8240', path: '#b39467' },
  tufts: { colors: ['#4f8a3e', '#5f9a48', '#447a36'], density: 1.2 },
  light: { ...meadow.light, fog: '#cfdcc2', fogNear: 26, fogFar: 100, hemiSky: '#cfe0c8', hemi: 1.2, sun: '#ffe6b0', sunI: 2.5 },
  critters: ['butterfly', 'deer'],
  cover: [
    { slot: 'deco_tree_pine', per100m2: 0.35, s: [0.9, 1.4] },
    { slot: 'deco_tree_round', per100m2: 0.3, s: [0.9, 1.3] },
    { slot: 'deco_bush', per100m2: 0.9, s: [0.8, 1.4] },
    { slot: 'deco_mushroom', per100m2: 0.5, s: [0.8, 1.2] },
    { slot: 'deco_log', per100m2: 0.05, s: [0.9, 1.2] },
    { slot: 'deco_stump', per100m2: 0.08, s: [0.9, 1.2] },
  ],
};
