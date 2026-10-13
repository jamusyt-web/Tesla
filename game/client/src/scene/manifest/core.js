// The core model group: every external 3D model the game uses today, by "slot". Swap any model by
// pointing its url at a different .glb (files live in client/public/models/,
// your own go in client/public/models/custom/). See ASSETS.md.
//
// Sizing: `height` (metres), `width` (largest horizontal side), `fit: [x, z]`
// (fit inside a footprint) or a raw `scale`; `stretch: [x, y, z]` multiplies.
// `rotY` turns the model, `sink` lowers it into the ground (metres).
// `recolor: { materialName: '#hex' }` repaints named materials (flat-colour
// packs); `remap` repaints a palette-atlas pack (see assets.js), `texture`
// swaps in another atlas, `glowBand` lights up part of one, and `heights`
// sizes each variant separately.
// `doubleSide` for thin leaves/petals, `outline: false` to skip ink lines.
// A list of urls = variants. Remove a slot to use the built-in procedural one.

const NK = (f) => `/models/nature-kit/${f}.glb`;
const K = (pack) => (f) => `/models/${pack}/${f}.glb`;
const PIR = K('pirate-kit');
const PLA = K('platformer-kit');
const SUR = K('survival-kit');
const HOL = K('holiday-kit');
const FUR = K('furniture-kit');
const WAT = K('watercraft-kit');
const MKT = K('mini-market');
const MCH = K('mini-characters');
const PET = K('cube-pets');
const DUN = K('mini-dungeon');
const GRV = K('graveyard-kit');
const FOR = K('mini-forest');
const FOOD = K('food-kit');
const FTK = K('fantasy-town-kit');
const CST = K('castle-kit');
const MDK = K('modular-dungeon');

// (No ink outline: the kit's walls are open panels, and an outline shell would cover their faces.)
const CRYPT_STONE = { remap: [{ band: 'metal', to: '#9a9288', ref: 0.5 }], outline: false };
// Graveyard fire baskets and lanterns are cast in green: make them old iron, the flame glowing.
const CRYPT_IRON = { remap: [{ band: 'green', to: '#5b514a', ref: 0.5 }], glowBand: { band: 'yellow', color: '#ffb347', amount: 0.8 } };
// Lighter, warmer iron and glowing glass for every lantern.
const WARM_LAMP = { remap: [{ band: 'metal', to: '#7d7570', ref: 0.42 }], glowBand: { band: 'yellow', color: '#ffb347', amount: 0.6 } };

// Pack-wide colour fixes by material name. Nature Kit stores sRGB colours
// where glTF expects linear ones, so it renders pastel; these restore a warm,
// saturated palette that matches the textured packs.
export const PALETTES = {
  'nature-kit': {
    leafsGreen: '#4F9150',
    leafsDark: '#2E6B47',
    leafsFall: '#FF9241',
    woodBark: '#8F5E3E',
    woodBarkDark: '#6B4530',
    woodBirch: '#F2EBDD',
    woodInner: '#F0D2A2',
    wood: '#9A6E4A',
    woodDark: '#6E4A30',
    grass: '#5E9A48',
    dirt: '#B98457',
    dirtDark: '#8E5F40',
    stone: '#9C988E',
    stoneDark: '#77746C',
    colorYellow: '#FFCB3D',
    colorPurple: '#7F8BFF',
    colorRed: '#E8505A',
    colorTan: '#F5B678',
    colorWhite: '#EFE6D6',
    _defaultMat: '#F3E6CF',
  },
  'furniture-kit': { wood: '#C8834F', woodDark: '#8F5B3D', carpet: '#D9483F', carpetDarker: '#9B3A36', carpetWhite: '#F3E6CF', plant: '#4FA65A', metal: '#9EA3B0', metalDark: '#474A58', metalLight: '#C9CED8', fur: '#8F5B3D', glass: '#BFE3F0', lamp: '#FFD27A', _defaultMat: '#F3E6CF' },
};

// Modular building kits: every piece listed here is loaded as slot
// "<pack>:<piece>" and assembled by client/src/scene/buildings.js.
export const MODULE_PACKS = {
  'fantasy-town-kit': [
    'wall', 'wall-half', 'wall-window-shutters', 'wall-window-glass', 'wall-window-round', 'wall-window-small', 'wall-door', 'wall-doorway-square-wide',
    'wall-detail-cross', 'wall-detail-diagonal', 'wall-wood', 'wall-wood-half', 'wall-wood-window-shutters', 'wall-wood-window-glass', 'wall-wood-door',
    'wall-wood-doorway-square-wide', 'wall-wood-detail-cross', 'wall-wood-detail-diagonal', 'roof', 'roof-left', 'roof-right', 'roof-gable-top', 'roof-window',
    'roof-high', 'roof-high-left', 'roof-high-right', 'roof-high-gable-top', 'roof-high-point', 'chimney-base', 'chimney', 'chimney-top', 'overhang',
    'stall-red', 'stall-green', 'banner-green', 'banner-red', 'lantern', 'wheel', 'cart',
  ],
  'castle-kit': ['tower-square-arch', 'tower-square-mid', 'tower-square-top-roof-high-windows', 'metal-gate', 'flag-banner-short', 'wall', 'tower-square-base', 'tower-square-mid-windows', 'tower-square-top-roof'],
  // Dungeon runs (client/src/scene/dungeon.js): 4 m floor tiles and walls
  // whose pivot is on the wall's face, gates and the way back up.
  'modular-dungeon': ['template-wall', 'template-wall-detail-a', 'template-wall-corner', 'gate', 'gate-metal-bars', 'stairs'],
};

// Palette-swapped copies of a kit's colour atlas (same layout, recoloured
// strips) — give each building its own roof/wall colours.
const FT = (n) => `/models/fantasy-town-kit/Textures/${n}.png`;
export const TEXTURES = {
  'fantasy-town-kit': {
    roof_purple: FT('roof_purple'), roof_blue: FT('roof_blue'), roof_yellow: FT('roof_yellow'), roof_orange: FT('roof_orange'),
    cot_a: FT('cot_a'), cot_b: FT('cot_b'), cot_c: FT('cot_c'), cot_d: FT('cot_d'), cot_e: FT('cot_e'),
    hall: FT('hall'), shop: FT('shop'), roof_slate: FT('roof_slate'),
  },
  'castle-kit': { grey_red: '/models/castle-kit/Textures/variation-e.png' },
};

export const MODELS = {
  // ── Gatherable trees (+ the stump left behind) ──────────────────────
  tree_oak: { url: [NK('tree_oak'), NK('tree_oak_dark')], height: 4.6 },
  tree_oak_stump: { url: NK('stump_round'), height: 0.55 },
  tree_birch: { url: [NK('tree_detailed_fall'), NK('tree_thin_fall'), NK('tree_default_fall')], height: 4.6, recolor: { leafsFall: '#A3BE5C', _defaultMat: '#F2EBDD' } },
  tree_birch_stump: { url: NK('stump_round'), height: 0.55, recolor: { woodBark: '#EDE4D3' } },
  tree_pine: { url: [NK('tree_pineDefaultA'), NK('tree_pineDefaultB')], height: 6.2, stretch: [1.2, 1, 1.2] },
  tree_pine_stump: { url: NK('stump_roundDetailed'), height: 0.6, recolor: { woodBark: '#8F5B3D' } },

  // ── Mineable rocks (ore crystals are added in code) ─────────────────
  rock_stone: { url: NK('stone_smallH'), height: 1.8 },
  rock_copper: { url: NK('stone_largeD'), width: 2.3, stretch: [1, 1.35, 1], recolor: { stone: '#B0A08F', _defaultMat: '#B0A08F' } },
  rock_iron: { url: NK('stone_smallE'), width: 2.1, recolor: { stone: '#8E929E' } },
  rock_gold: { url: NK('stone_tallB'), height: 2.1, recolor: { stone: '#C9B99A', _defaultMat: '#C9B99A' } },
  rock_rubble: { url: NK('stone_smallFlatC'), width: 1.4 },

  // ── Herbs ───────────────────────────────────────────────────────────
  herb_mint: { url: FOR('plant'), width: 1.1, remap: [{ to: '#5fd690', ref: 0.6 }] },
  herb_sun: { url: NK('flower_yellowC'), height: 0.8, doubleSide: true },
  herb_moon: { url: NK('flower_purpleA'), height: 0.9, doubleSide: true },
  herb_sprout: { url: NK('plant_bushSmall'), width: 0.55, doubleSide: true, outline: false },

  // ── Scenery ─────────────────────────────────────────────────────────
  deco_tree_round: {
    url: ['tree_default', 'tree_fat', 'tree_plateau', 'tree_small', 'tree_detailed', 'tree_default_dark', 'tree_fat_darkh', 'tree_detailed_dark', 'tree_fat_fall', 'tree_plateau_fall'].map(NK),
    height: 4.3,
  },
  deco_tree_pine: {
    url: ['tree_pineRoundC', 'tree_pineRoundD', 'tree_pineRoundE', 'tree_pineRoundF', 'tree_pineGroundA', 'tree_pineGroundB', 'tree_pineSmallA', 'tree_pineTallA_detailed', 'tree_pineTallC_detailed'].map(NK),
    height: 5.2,
  },
  deco_bush: { url: ['plant_bushDetailed', 'plant_bush', 'plant_flatShort', 'plant_flatTall', 'plant_bushTriangle'].map(NK), width: 1.0, doubleSide: true, outline: false, recolor: { grass: '#4A8A4C' } },
  deco_flower: { url: ['flower_redA', 'flower_redB', 'flower_redC', 'flower_yellowB', 'flower_purpleB'].map(NK), height: 0.55, doubleSide: true, outline: false, recolor: { colorRed: '#C9475A', colorYellow: '#E0B040', colorPurple: '#8A6FC0' } },
  deco_grass: { url: ['grass', 'grass_large', 'grass_leafs', 'grass_leafsLarge'].map(NK), width: 1.0, doubleSide: true, outline: false, recolor: { grass: '#6E9E50' } },
  deco_mushroom: { url: ['mushroom_redGroup', 'mushroom_tanGroup', 'mushroom_red', 'mushroom_redTall', 'mushroom_tan', 'mushroom_tanTall'].map(NK), height: 0.7 },
  deco_log: { url: ['log', 'log_large', 'log_stack'].map(NK), width: 2.2 },
  deco_stump: { url: ['stump_old', 'stump_oldTall', 'stump_squareDetailed'].map(NK), height: 0.9 },
  deco_rock_small: { url: ['stone_smallA', 'stone_smallB', 'stone_smallD', 'stone_smallG', 'stone_smallI', 'stone_smallFlatA'].map(NK), width: 0.9 },
  deco_lily_pad: { url: [NK('lily_large'), NK('lily_small')], width: 1.1, outline: false },

  // ── Props (placed in the world map, maps/world.json) ───────────────
  prop_barrel: { url: PIR('barrel'), height: 1.1 },
  prop_barrel_alt: { url: PLA('barrel'), height: 1.1 },
  prop_crate: { url: [PLA('crate'), PLA('crate-strong')], height: 1.0 },
  prop_crate_open: { url: [PIR('crate'), PIR('crate-bottles')], width: 1.3 },
  prop_chest: { url: PIR('chest'), height: 0.9 },
  prop_bucket: { url: SUR('bucket'), height: 0.7 },
  workshop_workbench: { url: SUR('workbench'), height: 1.05 },
  workshop_anvil: { url: SUR('workbench-anvil'), height: 1.2 },
  workshop_grindstone: { url: SUR('workbench-grind'), height: 1.05 },
  workshop_chopping_block: { url: NK('stump_square'), height: 0.75 },
  workshop_lumber_pile: { url: [SUR('resource-planks'), SUR('tree-log')], width: 2.2 },
  workshop_tools_leaning: { url: ['tool-hammer', 'tool-pickaxe', 'tool-shovel', 'tool-hoe', 'tool-axe'].map(SUR), height: 1.0 },
  campfire: { url: SUR('campfire-pit'), width: 1.2 },
  tent: { url: [SUR('tent-canvas'), SUR('tent-canvas-half')], width: 3.1 },
  market_stall_canopy: { url: FTK('stall-red'), height: 3.0 },
  market_stall_gazebo: { url: FTK('stall-green'), height: 3.0, texture: '/models/fantasy-town-kit/Textures/roof_blue.png' },
  market_table: { url: FTK('stall'), width: 2.4 },
  market_goods_fruit: { url: MKT('display-fruit'), height: 0.6 },
  market_goods_bottles: { url: SUR('bottle-large'), height: 0.5 },
  shop_sign: { url: PLA('sign'), height: 2.1 },
  signpost_directions: { url: PLA('arrows'), height: 2.7 },
  signpost_trail: { url: SUR('signpost'), height: 2.3 },
  bench_park: { url: HOL('bench'), width: 1.8 },
  bench_rustic: { url: HOL('cabin-fence'), width: 2.0 },
  lamp_post: { url: HOL('lantern'), height: 3.1, ...WARM_LAMP },
  lantern_hanging: { url: HOL('lantern-hanging'), height: 1.0, ...WARM_LAMP },
  flower_pots: { url: ['plantSmall1', 'plantSmall2', 'plantSmall3'].map(FUR), height: 0.8, recolor: { wood: '#C8643F' } },
  flowers_planters: { url: [PLA('flowers-tall'), PLA('flowers')], width: 2.0 },
  hedge_planter: { url: PLA('hedge'), width: 2.5 },
  fence_low: { url: [FTK('fence'), FTK('fence-broken')], width: 3.1, stretch: [1, 0.75, 1] },
  fence_wood: { url: ['fence-straight', 'fence-corner', 'fence-corner-curved', 'fence-broken'].map(PLA), width: 2.5 },
  dock_railing: { url: PLA('fence-rope'), width: 2.5 },
  dock_pilings: { url: PLA('poles'), height: 2.5 },
  boat_rowing: { url: [PIR('boat-row-large'), PIR('boat-row-small')], width: 4.0 },
  lake_buoy: { url: [WAT('buoy'), WAT('buoy-flag')], height: 1.1 },
  fishing_drying_rack: { url: SUR('campfire-fishing-stand'), width: 1.6 },
  flags_banners: { url: ['flag', 'flag-pennant', 'flag-wide'].map(CST), height: 3.6, rotY: Math.PI / 2, texture: '/models/castle-kit/Textures/variation-e.png', outline: false },
  wilds_gate_defense: { url: PIR('cannon'), width: 1.7 },
  wilds_goblin_camp: { url: [PIR('flag-pirate'), PIR('flag-pirate-pennant')], height: 2.1 },

  // ── Characters & creatures (animated) ───────────────────────────────
  npc_villager: { url: [MCH('character-female-b'), MCH('character-male-a'), MCH('character-female-c'), MCH('character-male-b'), GRV('character-keeper'), MCH('character-female-f'), FOR('character-archer'), MCH('character-male-f')], height: 1.95 },
  npc_pet: { url: [PET('animal-cat'), PET('animal-dog'), PET('animal-chick'), PET('animal-bunny'), PET('animal-pig'), PET('animal-dog'), PET('animal-chick')], heights: [0.72, 0.75, 0.5, 0.65, 0.8, 0.75, 0.5] },
  npc_deer: { url: PET('animal-deer'), height: 1.5 },
  npc_beaver: { url: PET('animal-beaver'), height: 0.6 },
  mob_wolf: { url: PET('animal-fox'), height: 1.3, remap: [{ band: 'warm', to: '#7b8194', ref: 0.6 }] },
  mob_goblin: { url: DUN('character-orc'), height: 1.55 },
  mob_caterpillar: { url: PET('animal-caterpillar'), height: 0.9 },
  mob_crab: { url: PET('animal-crab'), height: 0.85 },
  mob_ghost: { url: GRV('character-ghost'), height: 1.5 },
  mob_boar: { url: PET('animal-hog'), height: 1.2 },
  mob_skeleton: { url: GRV('character-skeleton'), height: 1.9 },
  mob_bear: { url: PET('animal-polar'), height: 2.2 },
  // The Hollow Crypt
  mob_thrall: { url: GRV('character-zombie'), height: 1.85 },
  mob_crypt_skeleton: { url: GRV('character-skeleton'), height: 1.9 },
  mob_crypt_wisp: { url: GRV('character-ghost'), height: 1.6, tint: { color: '#a9c8ff', amount: 0.35, emissive: '#3f6bff', glow: 0.3 } },
  mob_pale_count: { url: GRV('character-vampire'), height: 2.7 },

  // ── Dungeon dressing (dg_* slots, placed by shared/dungeon.js) ──────
  // The kit's lavender stone, warmed to old grey stone.
  'modular-dungeon:template-floor': { url: MDK('template-floor'), raw: true, outline: false, ...CRYPT_STONE },
  'modular-dungeon:template-floor-detail': { url: MDK('template-floor-detail'), raw: true, outline: false, ...CRYPT_STONE },
  'modular-dungeon:template-floor-detail-a': { url: MDK('template-floor-detail-a'), raw: true, outline: false, ...CRYPT_STONE },
  'modular-dungeon:template-wall': { url: MDK('template-wall'), raw: true, ...CRYPT_STONE },
  'modular-dungeon:template-wall-detail-a': { url: MDK('template-wall-detail-a'), raw: true, ...CRYPT_STONE },
  'modular-dungeon:template-wall-corner': { url: MDK('template-wall-corner'), raw: true, ...CRYPT_STONE },
  'modular-dungeon:gate': { url: MDK('gate'), raw: true, ...CRYPT_STONE },
  'modular-dungeon:gate-metal-bars': { url: MDK('gate-metal-bars'), raw: true, ...CRYPT_STONE },
  'modular-dungeon:stairs': { url: MDK('stairs'), raw: true, ...CRYPT_STONE },
  dg_barrel: { url: DUN('barrel'), height: 1.0 },
  dg_pillar: { url: GRV('column-large'), height: 4.2 },
  dg_fire: { url: GRV('fire-basket'), width: 1.1, ...CRYPT_IRON },
  dg_brazier: { url: GRV('fire-basket'), width: 1.8, ...CRYPT_IRON },
  dg_coffin: { url: [GRV('coffin'), GRV('coffin-old')], width: 2.0 },
  dg_altar: { url: GRV('altar-stone'), width: 2.2 },
  dg_candles: { url: [GRV('candle-multiple'), GRV('candle')], heights: [0.5, 0.45] },
  dg_chest: { url: DUN('chest'), height: 1.0 },
  dg_pot: { url: DUN('pot'), height: 0.8 },
  dg_urn: { url: [GRV('urn-round'), GRV('urn-square')], height: 0.95 },
  dg_banner: { url: DUN('banner'), height: 1.9, outline: false },
  dg_rack: { url: [DUN('table'), DUN('wood-support')], width: 1.8 },
  dg_rubble: { url: [DUN('rocks'), DUN('stones'), GRV('debris'), GRV('rocks-tall')], width: 1.9 },
  dg_trap: { url: DUN('trap'), width: 3.4 },
  dg_lantern: { url: GRV('lantern-candle'), height: 0.75, ...CRYPT_IRON },
  dg_key: { url: DUN('key'), width: 0.9 },
  // The crypt door in the overworld (base, roof, door; built in town.js)
  crypt_base: { url: GRV('crypt-large'), fit: [6, 7.6] },
  crypt_roof: { url: GRV('crypt-large-roof'), fit: [6.4, 7.9] },
  crypt_door: { url: GRV('crypt-large-door'), width: 2.0 },
  crypt_grave: { url: [GRV('gravestone-broken'), GRV('debris')], width: 1.1 },

  // ── Item icons: rendered once into small pictures for the bag, market and
  // workshop (client/src/ui/portrait.js). `pose: [x, y, z]` turns the model
  // (degrees). `remap` repaints a palette atlas (see assets.js); `tint.emissive`
  // makes rare things glow. Items without an icon slot show their emoji.
  'icon:oak_log': { url: SUR('tree-log-small'), height: 1, pose: [0, 100, 0] },
  'icon:birch_log': { url: SUR('tree-log-small'), height: 1, pose: [0, 100, 0], remap: [{ to: '#efe6d4', ref: 0.6 }] },
  'icon:pine_log': { url: SUR('tree-log-small'), height: 1, pose: [0, 100, 0], remap: [{ to: '#7a4630', ref: 0.55 }] },
  'icon:stone': { url: NK('stone_smallH'), height: 1 },
  'icon:copper_ore': { url: NK('rock_smallE'), height: 1, recolor: { dirt: '#7f8597', grass: '#e07b39' } },
  'icon:iron_ore': { url: NK('rock_smallE'), height: 1, recolor: { dirt: '#7f8597', grass: '#c9d3df' } },
  'icon:gold_ore': { url: NK('rock_smallE'), height: 1, recolor: { dirt: '#7f8597', grass: '#ffd23f' } },
  'icon:sapphire': { url: PLA('jewel'), height: 1, pose: [15, 20, 0], remap: [{ to: '#4f7bff', ref: 0.42 }], tint: { color: '#ffffff', amount: 0, emissive: '#3f6bff', glow: 0.2 } },
  'icon:mint_leaf': { url: FOR('plant'), height: 1, remap: [{ to: '#5fd690', ref: 0.6 }] },
  'icon:sunpetal': { url: NK('flower_yellowC'), height: 1, doubleSide: true, recolor: { colorYellow: '#ffc23a', colorWhite: '#fff3c4', grass: '#4fae5c' } },
  'icon:moonbloom': { url: NK('flower_purpleA'), height: 1, doubleSide: true, recolor: { colorPurple: '#b6b8ff', colorWhite: '#e8f0ff', grass: '#3d8f5a' }, tint: { color: '#ffffff', amount: 0, emissive: '#8f95ff', glow: 0.2 } },
  'icon:minnow': { url: SUR('fish'), height: 1, pose: [0, 70, 0], remap: [{ to: '#a9c3dc', ref: 0.62 }] },
  'icon:perch': { url: SUR('fish'), height: 1, pose: [0, 70, 0], remap: [{ band: 'yellow', to: '#f0703a', ref: 0.72 }, { to: '#b4b84a', ref: 0.62 }] },
  'icon:trout': { url: SUR('fish-large'), height: 1, pose: [0, 70, 0], remap: [{ band: 'metal', to: '#b9a7bf', ref: 0.47 }] },
  'icon:pike': { url: FOOD('fish'), height: 1, pose: [0, 20, 0], remap: [{ to: '#6f8f4e', ref: 0.45 }] },
  'icon:golden_koi': { url: SUR('fish'), height: 1, pose: [0, 70, 0], remap: [{ to: '#ffcf3a', ref: 0.66 }], tint: { color: '#ffffff', amount: 0, emissive: '#ffb020', glow: 0.25 } },
  'icon:lake_king': { url: SUR('fish-large'), height: 1, pose: [0, 70, 0], remap: [{ band: 'metal', to: '#6a5d50', ref: 0.47 }, { band: 'red', to: '#9a7452', ref: 0.47 }] },
  'icon:old_boot': { url: HOL('sock-red'), height: 1, pose: [0, 90, 0], remap: [{ band: 'red', to: '#7a5639', ref: 0.42 }, { band: 'white', to: '#a8936f', ref: 0.8 }] },
  'icon:slime_gel': { url: FOOD('ice-cream-scoop-mint'), height: 1, remap: [{ to: '#8ee36a', ref: 0.5 }] },
  'icon:wolf_pelt': { url: SUR('bedroll'), height: 1, pose: [25, 30, 0], remap: [{ band: 'red', to: '#8d929b', ref: 0.47 }, { band: 'orange', to: '#c9c6bd', ref: 0.6 }] },
  'icon:goblin_coin': { url: DUN('coin'), height: 1, pose: [0, 30, 0], remap: [{ to: '#c2a945', ref: 0.7 }] },
  'icon:golem_core': { url: PIR('cannon-ball'), height: 1, remap: [{ to: '#7a8a96', ref: 0.3 }], tint: { color: '#ffffff', amount: 0, emissive: '#39e6c8', glow: 0.45 } },
  'icon:oak_plank': { url: SUR('resource-planks'), height: 1, pose: [0, 30, 0] },
  'icon:birch_plank': { url: SUR('resource-planks'), height: 1, pose: [0, 30, 0], remap: [{ to: '#f0dcb0', ref: 0.55 }] },
  'icon:stone_brick': { url: PLA('brick'), height: 1, pose: [0, 35, 0], remap: [{ band: 'orange', to: '#b8b2a6', ref: 0.55 }] },
  'icon:leather': { url: SUR('bedroll-packed'), height: 1, pose: [0, 70, 0], remap: [{ band: 'red', to: '#9a6238', ref: 0.47 }, { band: 'orange', to: '#c89a68', ref: 0.55 }] },
  'icon:fish_stew': { url: FOOD('bowl-soup'), height: 1 },
  'icon:grilled_fish': { url: SUR('fish'), height: 1, pose: [0, 70, 0], remap: [{ band: 'yellow', to: '#8a4f28', ref: 0.72 }, { to: '#c4783e', ref: 0.62 }] },
  'icon:health_potion': { url: DUN('potion'), height: 1 },
  'icon:moon_elixir': { url: DUN('potion'), height: 1, remap: [{ band: 'red', to: '#6f7dff', ref: 0.47 }], tint: { color: '#ffffff', amount: 0, emissive: '#6f7dff', glow: 0.2 } },
  'icon:axe_wood': { url: SUR('tool-axe'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#c9a06a', ref: 0.68 }] },
  'icon:axe_copper': { url: SUR('tool-axe'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#e07b39', ref: 0.68 }] },
  'icon:axe_iron': { url: SUR('tool-axe-upgraded'), height: 1, pose: [0, 0, -35] },
  'icon:axe_gold': { url: SUR('tool-axe-upgraded'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#ffd23f', ref: 0.68 }] },
  'icon:pick_wood': { url: SUR('tool-pickaxe'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#c9a06a', ref: 0.68 }] },
  'icon:pick_copper': { url: SUR('tool-pickaxe'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#e07b39', ref: 0.68 }] },
  'icon:pick_iron': { url: SUR('tool-pickaxe-upgraded'), height: 1, pose: [0, 0, -35] },
  'icon:pick_gold': { url: SUR('tool-pickaxe-upgraded'), height: 1, pose: [0, 0, -35], remap: [{ band: 'metal', to: '#ffd23f', ref: 0.68 }] },
  'icon:sword_wood': { url: DUN('weapon-sword'), height: 1, pose: [0, 0, -40], remap: [{ band: 'metal', to: '#c9a06a', ref: 0.6 }] },
  'icon:sword_copper': { url: DUN('weapon-sword'), height: 1, pose: [0, 0, -40], remap: [{ band: 'metal', to: '#e07b39', ref: 0.6 }] },
  'icon:sword_iron': { url: DUN('weapon-sword'), height: 1, pose: [0, 0, -40] },
  'icon:sword_gold': { url: DUN('weapon-sword'), height: 1, pose: [0, 0, -40], remap: [{ band: 'metal', to: '#ffd23f', ref: 0.6 }], tint: { color: '#ffffff', amount: 0, emissive: '#ffb020', glow: 0.15 } },
  'icon:armor_iron': { url: DUN('shield-round'), height: 1, pose: [-10, 20, 0], remap: [{ band: 'orange', to: '#6c7183', ref: 0.5 }] },
};
