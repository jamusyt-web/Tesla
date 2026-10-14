// Amberfold's waters (SPEC §4.4): the Mill Pond's three fish and its
// legend, and the Westmarch salt pools (a mix of both towns' fish).
export const fish = {
  rivercarp: { d: 46, kg: [1, 5], behavior: 'smooth', xp: 55 },
  amber_trout: { d: 54, kg: [1, 4], behavior: 'dart', xp: 70 },
  leaf_eel: { d: 62, kg: [0.5, 3], behavior: 'dart', xp: 85 },
  // Rises only from the deep pond, with an Amberline Rod, while the leaves fall.
  legend_millcarp: { d: 92, kg: [25, 70], behavior: 'mixed', xp: 400, legend: { rod: 4, window: { weather: 'leaves' } } },
};

// Shallows 50/35/15, deep water 25/40/35 (luck), plus the old boot.
export const fishTables = {
  amberfold: {
    lvl: 12,
    fish: [
      { id: 'old_boot', shallow: 7, deep: 7 },
      { id: 'rivercarp', shallow: 50, deep: 25 },
      { id: 'amber_trout', shallow: 35, deep: 40 },
      { id: 'leaf_eel', shallow: 15, deep: 35, luck: true },
    ],
    legends: ['legend_millcarp'],
  },
  road_west: {
    lvl: 8,
    fish: [
      { id: 'old_boot', shallow: 7, deep: 7 },
      { id: 'perch', shallow: 40, deep: 20 },
      { id: 'trout', shallow: 30, deep: 30 },
      { id: 'rivercarp', shallow: 20, deep: 30 },
      { id: 'amber_trout', shallow: 10, deep: 20, luck: true },
    ],
    legends: [],
  },
};
