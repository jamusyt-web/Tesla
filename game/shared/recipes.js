// Crafting recipes. `skill` level gates the recipe; crafting grants Crafting XP.
export const RECIPES = [
  // Refining — turning raw gathered goods into worth-more materials
  { id: 'oak_plank', out: 'oak_plank', qty: 1, in: { oak_log: 2 }, lvl: 1, xp: 4 },
  { id: 'birch_plank', out: 'birch_plank', qty: 1, in: { birch_log: 2 }, lvl: 3, xp: 8 },
  { id: 'stone_brick', out: 'stone_brick', qty: 1, in: { stone: 2 }, lvl: 1, xp: 3 },
  { id: 'copper_bar', out: 'copper_bar', qty: 1, in: { copper_ore: 2, oak_log: 1 }, lvl: 2, xp: 8 },
  { id: 'iron_bar', out: 'iron_bar', qty: 1, in: { iron_ore: 2, birch_log: 1 }, lvl: 5, xp: 15 },
  { id: 'gold_bar', out: 'gold_bar', qty: 1, in: { gold_ore: 2, pine_log: 1 }, lvl: 8, xp: 28 },
  { id: 'leather', out: 'leather', qty: 1, in: { wolf_pelt: 2 }, lvl: 2, xp: 8 },
  // Consumables
  { id: 'grilled_fish', out: 'grilled_fish', qty: 1, in: { minnow: 1, oak_log: 1 }, lvl: 1, xp: 4 },
  { id: 'health_potion', out: 'health_potion', qty: 1, in: { mint_leaf: 2, slime_gel: 1 }, lvl: 2, xp: 8 },
  { id: 'moon_elixir', out: 'moon_elixir', qty: 1, in: { moonbloom: 2, sunpetal: 2, golden_koi: 1 }, lvl: 9, xp: 40 },
  // Tools
  { id: 'axe_copper', out: 'axe_copper', qty: 1, in: { copper_bar: 3, oak_plank: 2 }, lvl: 3, xp: 25 },
  { id: 'pick_copper', out: 'pick_copper', qty: 1, in: { copper_bar: 3, oak_plank: 2 }, lvl: 3, xp: 25 },
  { id: 'axe_iron', out: 'axe_iron', qty: 1, in: { iron_bar: 4, birch_plank: 2 }, lvl: 6, xp: 60 },
  { id: 'pick_iron', out: 'pick_iron', qty: 1, in: { iron_bar: 4, birch_plank: 2 }, lvl: 6, xp: 60 },
  { id: 'axe_gold', out: 'axe_gold', qty: 1, in: { gold_bar: 5, iron_bar: 2, golden_acorn: 1 }, lvl: 10, xp: 150 },
  { id: 'pick_gold', out: 'pick_gold', qty: 1, in: { gold_bar: 5, iron_bar: 2, sapphire: 1 }, lvl: 10, xp: 150 },
  { id: 'rod_fine', out: 'rod_fine', qty: 1, in: { birch_plank: 3, iron_bar: 1, trout: 3 }, lvl: 5, xp: 40 },
  // Gear
  { id: 'sword_copper', out: 'sword_copper', qty: 1, in: { copper_bar: 4, leather: 1 }, lvl: 3, xp: 30 },
  { id: 'sword_iron', out: 'sword_iron', qty: 1, in: { iron_bar: 5, leather: 2 }, lvl: 6, xp: 70 },
  { id: 'sword_gold', out: 'sword_gold', qty: 1, in: { gold_bar: 5, iron_bar: 3, golem_core: 1 }, lvl: 10, xp: 160 },
  { id: 'armor_leather', out: 'armor_leather', qty: 1, in: { leather: 3 }, lvl: 3, xp: 30 },
  { id: 'armor_iron', out: 'armor_iron', qty: 1, in: { iron_bar: 6, leather: 2 }, lvl: 7, xp: 80 },
  { id: 'amulet_sapphire', out: 'amulet_sapphire', qty: 1, in: { sapphire: 1, gold_bar: 2, goblin_coin: 3 }, lvl: 9, xp: 120 },
];

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
