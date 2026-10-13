// Crafting recipes. `lvl` (Crafting level) gates the recipe; crafting grants
// Crafting XP. `station` is where it's made and `pattern` the hands-on steps
// (shared/crafting.js).
import { CONTENT } from './content/index.js';

export const RECIPES = [
  // Refining — turning raw gathered goods into worth-more materials
  { id: 'oak_plank', out: 'oak_plank', qty: 1, in: { oak_log: 2 }, lvl: 1, xp: 4, station: 'workbench', pattern: 'saw' },
  { id: 'birch_plank', out: 'birch_plank', qty: 1, in: { birch_log: 2 }, lvl: 3, xp: 8, station: 'workbench', pattern: 'saw' },
  { id: 'stone_brick', out: 'stone_brick', qty: 1, in: { stone: 2 }, lvl: 1, xp: 3, station: 'grindstone', pattern: 'dress' },
  { id: 'whetstone', out: 'whetstone', qty: 1, in: { stone_brick: 2, copper_bar: 1 }, lvl: 4, xp: 12, station: 'grindstone', pattern: 'dress' },
  { id: 'mint_tea', out: 'mint_tea', qty: 1, in: { mint_leaf: 2, sunpetal: 1 }, lvl: 3, xp: 10, station: 'cookpot', pattern: 'brew' },
  { id: 'copper_bar', out: 'copper_bar', qty: 1, in: { copper_ore: 2, oak_log: 1 }, lvl: 2, xp: 8, station: 'forge', pattern: 'smelt' },
  { id: 'iron_bar', out: 'iron_bar', qty: 1, in: { iron_ore: 2, birch_log: 1 }, lvl: 5, xp: 15, station: 'forge', pattern: 'smelt' },
  { id: 'gold_bar', out: 'gold_bar', qty: 1, in: { gold_ore: 2, pine_log: 1 }, lvl: 8, xp: 28, station: 'forge', pattern: 'smelt' },
  { id: 'leather', out: 'leather', qty: 1, in: { wolf_pelt: 2 }, lvl: 2, xp: 8, station: 'workbench', pattern: 'scrape' },
  // Consumables
  { id: 'fish_stew', out: 'fish_stew', qty: 1, in: { perch: 2, mint_leaf: 1 }, lvl: 2, xp: 8, station: 'cookpot', pattern: 'stew' },
  { id: 'grilled_fish', out: 'grilled_fish', qty: 1, in: { minnow: 1, oak_log: 1 }, lvl: 1, xp: 4, station: 'cookpot', pattern: 'grill' },
  { id: 'health_potion', out: 'health_potion', qty: 1, in: { mint_leaf: 2, slime_gel: 1 }, lvl: 2, xp: 8, station: 'cookpot', pattern: 'brew' },
  { id: 'moon_elixir', out: 'moon_elixir', qty: 1, in: { moonbloom: 2, sunpetal: 2, golden_koi: 1 }, lvl: 9, xp: 40, station: 'cookpot', pattern: 'elixir' },
  // Tools
  { id: 'axe_copper', out: 'axe_copper', qty: 1, in: { copper_bar: 3, oak_plank: 2 }, lvl: 3, xp: 25, station: 'anvil', pattern: 'forge_tool' },
  { id: 'pick_copper', out: 'pick_copper', qty: 1, in: { copper_bar: 3, oak_plank: 2 }, lvl: 3, xp: 25, station: 'anvil', pattern: 'forge_tool' },
  { id: 'axe_iron', out: 'axe_iron', qty: 1, in: { iron_bar: 4, birch_plank: 2 }, lvl: 6, xp: 60, station: 'anvil', pattern: 'forge_tool' },
  { id: 'pick_iron', out: 'pick_iron', qty: 1, in: { iron_bar: 4, birch_plank: 2 }, lvl: 6, xp: 60, station: 'anvil', pattern: 'forge_tool' },
  { id: 'axe_gold', out: 'axe_gold', qty: 1, in: { gold_bar: 5, iron_bar: 2, golden_acorn: 1 }, lvl: 10, xp: 150, station: 'anvil', pattern: 'forge_tool' },
  { id: 'pick_gold', out: 'pick_gold', qty: 1, in: { gold_bar: 5, iron_bar: 2, sapphire: 1 }, lvl: 10, xp: 150, station: 'anvil', pattern: 'forge_tool' },
  { id: 'rod_fine', out: 'rod_fine', qty: 1, in: { birch_plank: 3, iron_bar: 1, trout: 2 }, lvl: 5, xp: 40, station: 'workbench', pattern: 'assemble' },
  { id: 'rod_master', out: 'rod_master', qty: 1, in: { gold_bar: 2, birch_plank: 3, pike: 2 }, lvl: 8, xp: 120, station: 'workbench', pattern: 'assemble' },
  // Gear
  { id: 'sword_copper', out: 'sword_copper', qty: 1, in: { copper_bar: 4, leather: 1 }, lvl: 3, xp: 30, station: 'anvil', pattern: 'forge_blade' },
  { id: 'sword_iron', out: 'sword_iron', qty: 1, in: { iron_bar: 5, leather: 2 }, lvl: 6, xp: 70, station: 'anvil', pattern: 'forge_blade' },
  { id: 'sword_gold', out: 'sword_gold', qty: 1, in: { gold_bar: 5, iron_bar: 3, golem_core: 1 }, lvl: 10, xp: 160, station: 'anvil', pattern: 'forge_blade' },
  { id: 'armor_leather', out: 'armor_leather', qty: 1, in: { leather: 3 }, lvl: 3, xp: 30, station: 'workbench', pattern: 'stitch' },
  { id: 'armor_iron', out: 'armor_iron', qty: 1, in: { iron_bar: 6, leather: 2 }, lvl: 7, xp: 80, station: 'anvil', pattern: 'forge_plate' },
  // From the Hollow Crypt's Grave Dust.
  { id: 'wraith_blade', out: 'wraith_blade', qty: 1, in: { iron_bar: 4, grave_dust: 8, leather: 1 }, lvl: 7, xp: 100, station: 'anvil', pattern: 'forge_blade' },
  { id: 'barrow_plate', out: 'barrow_plate', qty: 1, in: { iron_bar: 5, grave_dust: 6, leather: 1 }, lvl: 7, xp: 100, station: 'anvil', pattern: 'forge_plate' },
  { id: 'ghostlight_amulet', out: 'ghostlight_amulet', qty: 1, in: { gold_bar: 1, grave_dust: 6, moonbloom: 2 }, lvl: 6, xp: 80, station: 'grindstone', pattern: 'facet' },
  { id: 'amulet_sapphire', out: 'amulet_sapphire', qty: 1, in: { sapphire: 1, gold_bar: 2, goblin_coin: 3 }, lvl: 9, xp: 120, station: 'grindstone', pattern: 'facet' },
];

RECIPES.push(...CONTENT.recipes);

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
