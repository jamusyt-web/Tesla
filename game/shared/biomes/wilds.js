// The Wilds (a `kind: 'wilds'` zone): hazier, greener-grey and a touch dimmer
// than the meadow; the same ground.
import meadow from './meadow.js';

export default {
  ...meadow,
  id: 'wilds',
  name: 'The Wilds',
  tufts: { colors: ['#4e6e38', '#43602f', '#5b7a42'], density: 1 },
  light: { ...meadow.light, fog: '#9faea6', fogNear: 14, fogFar: 70, hemi: 1.05, sun: '#ffd0a0' },
  critters: [],
};
