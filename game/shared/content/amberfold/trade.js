// Amberfold's merchant (SPEC §6.2) lives in shared/economy.js TRADE: its
// smiths pay well for ore and bars and fish, and little for wood (the
// Amberwood is full of maples). Its supplier stall and its shop customers:
export const supplies = ['maple_log', 'coal', 'hearthcap', 'carp_chowder', 'hearth_charm'];

// Who shops in Amberfold (SPEC §3.2): they like ore, bars, fish and potions.
export const customers = [
  { name: 'Miller Hodge', face: '👨‍🌾', v: 1, cats: { resource: 3, material: 2, consumable: 1, tool: 1, gear: 0 }, likes: ['rivercarp', 'amber_trout', 'leaf_eel', 'oak_plank', 'maple_plank'] },
  { name: 'Smith Brann', face: '🧔', v: 7, cats: { resource: 2, material: 3, consumable: 0.5, tool: 2, gear: 1 }, likes: ['iron_ore', 'gold_ore', 'coal', 'iron_bar', 'gold_bar', 'steel_bar'] },
  { name: 'Widow Fenn', face: '👵', v: 2, cats: { resource: 1, material: 0.5, consumable: 3, tool: 0, gear: 0.5 }, likes: ['health_potion', 'moon_elixir', 'carp_chowder', 'hearthcap_pie', 'honeycomb'] },
  { name: 'Ranger Oak', face: '🧝', v: 6, cats: { resource: 1.5, material: 1, consumable: 2, tool: 2, gear: 2 }, likes: ['rod_fine', 'rod_amber', 'climbing_rope', 'venison_skewer', 'steel_saber'] },
];
