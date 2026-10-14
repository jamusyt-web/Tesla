// What Amberfold's Order Board asks for (SPEC §5.4), tier 2 sizes.
// Import orders want goods from another town (legs: road legs away).
const T = 2;
export default [
  { key: 'af_maple', kind: 'gather', item: 'maple_log', tier: T },
  { key: 'af_coal', kind: 'gather', item: 'coal', tier: T },
  { key: 'af_hearthcap', kind: 'gather', item: 'hearthcap', tier: T },
  { key: 'af_carp', kind: 'gather', item: 'rivercarp', tier: T },
  { key: 'af_trout', kind: 'gather', item: 'amber_trout', tier: T },
  { key: 'af_venison', kind: 'gather', item: 'venison', tier: T },
  { key: 'af_birch', kind: 'gather', item: 'birch_log', tier: T },
  { key: 'af_hogs', kind: 'hunt', monster: 'mossback_hog', tier: T },
  { key: 'af_bandits', kind: 'hunt', monster: 'hedge_bandit', tier: T },
  { key: 'af_stags', kind: 'hunt', monster: 'russet_stag', tier: T },
  { key: 'af_bears', kind: 'hunt', monster: 'bramble_bear', tier: T },
  { key: 'af_planks', kind: 'craft', item: 'maple_plank', tier: T },
  { key: 'af_steel', kind: 'craft', item: 'steel_bar', tier: T },
  { key: 'af_chowder', kind: 'craft', item: 'carp_chowder', tier: T },
  { key: 'af_skewers', kind: 'craft', item: 'venison_skewer', tier: T },
  { key: 'af_ironbar', kind: 'import', item: 'iron_bar', legs: 1, tier: T },
  { key: 'af_mint', kind: 'import', item: 'mint_leaf', legs: 1, tier: T },
  { key: 'af_sap', kind: 'special', item: 'amber_sap', qty: 1, tier: T },
  { key: 'af_eels', kind: 'special', item: 'leaf_eel', qty: 4, tier: T },
];
