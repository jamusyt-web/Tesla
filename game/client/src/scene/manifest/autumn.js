// The autumn biome's models (Amberfold, the Westmarch and the Amberwood;
// SPEC §2.2, §4.3): amber maples, fall pines, pumpkins and hay, the Great
// Mill and the Elder Oak. Group 'biome:autumn': it loads when you first
// get near an autumn region, never before the first frame.
const NK = (f) => `/models/nature-kit/${f}.glb`;
const GRV = (f) => `/models/graveyard-kit/${f}.glb`;
const SUR = (f) => `/models/survival-kit/${f}.glb`;
const FTK = (f) => `/models/fantasy-town-kit/${f}.glb`;

// Nature Kit's fall leaves, two ways: deep red and amber gold.
const RED = { leafsFall: '#C9472F' };
const GOLD = { leafsFall: '#E0A33A' };

export const MODELS = {
  // ── Gatherable: Amber Maple (and its stump) and Hearthcap ──────────
  tree_maple: { url: [NK('tree_oak_fall'), NK('tree_fat_fall'), NK('tree_default_fall')], height: 5.0, recolor: RED },
  tree_maple_stump: { url: NK('stump_round'), height: 0.6, recolor: { woodBark: '#7a4a2a' } },
  rock_coal: { url: NK('stone_largeD'), width: 2.4, stretch: [1, 1.2, 1], recolor: { stone: '#5f5a55', _defaultMat: '#5f5a55' } },
  herb_hearthcap: { url: [NK('mushroom_redGroup'), NK('mushroom_redTall')], height: 0.8, recolor: { colorRed: '#D9542F' } },

  // ── Cover (scattered by the biome's rules; shared/biomes/autumn.js) ──
  au_tree_fall: { url: [NK('tree_oak_fall'), NK('tree_default_fall'), NK('tree_fat_fall')], height: 4.6, recolor: GOLD },
  au_tree_red: { url: [NK('tree_tall_fall'), NK('tree_cone_fall'), NK('tree_simple_fall')], height: 4.8, recolor: RED },
  au_pine_fall: { url: [GRV('pine-fall'), GRV('pine-fall-crooked'), SUR('tree-autumn-tall')], height: 5.4 },
  au_bush: { url: ['plant_bushDetailed', 'plant_bush', 'plant_bushTriangle'].map(NK), width: 1.1, doubleSide: true, outline: false, recolor: { grass: '#C9472F' } },
  au_pumpkin: { url: [GRV('pumpkin'), GRV('pumpkin-tall'), NK('crop_pumpkin')], heights: [0.6, 0.8, 0.5] },
  au_grass: { url: ['grass', 'grass_large', 'grass_leafs'].map(NK), width: 1.0, doubleSide: true, outline: false, recolor: { grass: '#B08A3A' } },

  // ── Props placed in the map ─────────────────────────────────────────
  au_hay: { url: [GRV('hay-bale'), GRV('hay-bale-bundled')], width: 1.6 },
  au_logs: { url: NK('log_stackLarge'), width: 2.6 },
  au_stones: { url: NK('statue_ring'), width: 7 },
  au_windmill: { url: FTK('windmill'), height: 14 },
  au_watermill: { url: FTK('watermill'), width: 8 },
  // The Elder Oak: the dark oak, very large (its card on the skyline too).
  au_elder_oak: { url: NK('tree_oak_dark'), height: 26, recolor: { leafsDark: '#B5521F', woodBarkDark: '#5a3a24' } },
};
