// What Hearthvale's Order Board asks for (SPEC §5.4). Each day the board
// picks 4 of these; everyone sees the same 4 and fills their own copy.
// kind: gather (raw goods), hunt (monsters), craft (made goods), special
// (something rare); tier sizes the order (shared/orders.js).
export default [
  { key: 'hv_oak', kind: 'gather', item: 'oak_log', tier: 1 },
  { key: 'hv_birch', kind: 'gather', item: 'birch_log', tier: 1 },
  { key: 'hv_stone', kind: 'gather', item: 'stone', tier: 1 },
  { key: 'hv_copper', kind: 'gather', item: 'copper_ore', tier: 1 },
  { key: 'hv_iron', kind: 'gather', item: 'iron_ore', tier: 1 },
  { key: 'hv_mint', kind: 'gather', item: 'mint_leaf', tier: 1 },
  { key: 'hv_sunpetal', kind: 'gather', item: 'sunpetal', tier: 1 },
  { key: 'hv_perch', kind: 'gather', item: 'perch', tier: 1 },
  { key: 'hv_slimes', kind: 'hunt', monster: 'slime', tier: 1 },
  { key: 'hv_wolves', kind: 'hunt', monster: 'wolf', tier: 1 },
  { key: 'hv_boars', kind: 'hunt', monster: 'boar', tier: 1 },
  { key: 'hv_goblins', kind: 'hunt', monster: 'goblin', tier: 1 },
  { key: 'hv_planks', kind: 'craft', item: 'oak_plank', tier: 1 },
  { key: 'hv_copperbar', kind: 'craft', item: 'copper_bar', tier: 1 },
  { key: 'hv_bricks', kind: 'craft', item: 'stone_brick', tier: 1 },
  { key: 'hv_grilled', kind: 'craft', item: 'grilled_fish', tier: 1 },
  { key: 'hv_potions', kind: 'craft', item: 'health_potion', tier: 1 },
  { key: 'hv_koi', kind: 'special', item: 'golden_koi', qty: 1, tier: 1 },
  { key: 'hv_goldbar', kind: 'special', item: 'gold_bar', qty: 2, tier: 1 },
];
