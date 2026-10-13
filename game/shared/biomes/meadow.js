// Hearthvale's meadow: exactly today's colours and light.
export default {
  id: 'meadow',
  name: 'Meadow',
  ground: { grass: '#74a04c', grass2: '#628c42', path: '#b89b6e', plaza: '#a89a82', sand: '#d6bd8a', cliff: '#7a5b40' },
  tufts: { colors: ['#6b9a48', '#5a8a3d', '#7caa55'], density: 1 },
  water: { shallow: '#5fb3c4', deep: '#1f5f86' },
  sea: { shallow: '#58a8bc', deep: '#1b4f74' },
  sky: { top: '#5fb8f0', mid: '#a9dcf7', bot: '#fde7c4' },
  light: { fog: '#b8c4c8', fogNear: 20, fogFar: 100, hemiSky: '#c8d8ec', hemiGround: '#6b5a48', hemi: 1.3, sun: '#ffe4bc', sunI: 2.7, exposure: 1.05 },
  weather: null,
  critters: ['butterfly', 'deer'],
  cover: [], // Hearthvale keeps exactly its hand-placed cover
  ambience: null, // today's sounds
  pack: 'core',
};
