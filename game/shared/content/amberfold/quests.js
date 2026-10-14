// Amberfold's quests (SPEC §5.2): the town's welcome (af_intro, started by
// finishing hv_intro: it hands you a letter to carry down the Westmarch
// road) and side chains for each corner of the Amberwood. Plain data:
// shared/quests.js explains the shape.
const T = 'amberfold';
const at = (kind, more = {}) => ({ kind, ...more, town: T });

export default [
  {
    id: 'af_intro',
    town: T,
    title: 'The Amber Town',
    requires: ['hv_intro'],
    repeat: null,
    give: { letter_amberfold: 1 },
    steps: [
      { ev: 'deliver', match: { item: 'letter_amberfold' }, text: 'Carry the letter to the Amberfold Town Hall', hint: 'West along the Westmarch road. Waystones won’t carry a letter: walk it.', target: at('building', { action: 'townhall' }), reward: { gold: 60 } },
      { ev: 'attune', match: { id: 'stone_amberfold' }, text: 'Attune the Amberfold waystone', hint: 'On the green by the square. Now you can travel back here any time.', target: { kind: 'stone', id: 'stone_amberfold' }, reward: { gold: 40 } },
      { ev: 'sell', match: { town: T }, n: 5, text: 'Sell 5 goods to the Amberfold merchant', hint: 'Amberfold’s smiths pay well for ore, bars and fish, and little for wood.', target: at('building', { action: 'market' }), reward: { gold: 60 } },
      { ev: 'craft', match: { station: 'smokehouse' }, text: 'Cook something at the Smokehouse', hint: 'Only Amberfold has one. Venison Skewers: 2 Venison and a Hearthcap.', target: at('station', { station: 'smokehouse' }), reward: { gold: 80 } },
      { ev: 'order', match: { town: T }, text: 'Fill an Amberfold order', hint: 'The board by the square: the same four orders for everyone today.', target: at('board'), reward: { gold: 80, rep: { [T]: 30 } } },
      { ev: 'kill', match: { monster: 'antlered_elder' }, text: 'Face the Antlered Elder', hint: 'Deep in the Amberwood, south-west of town. Combat 17, or bring friends. Defend when it lowers its antlers!', target: { kind: 'monster', type: 'antlered_elder' }, reward: { gold: 120 } },
    ],
    reward: { gold: 400, rep: { [T]: 100 }, items: { venison_skewer: 3 }, xp: { combat: 600 }, title: 'Amberfolk' },
  },

  {
    id: 'af_mill',
    town: T,
    title: 'Grist for the Mill',
    after: ['af_intro', 2],
    steps: [
      { ev: 'gather', match: { item: 'maple_log' }, n: 10, text: 'Chop 10 Maple Logs', hint: 'Amber Maples need Foraging 12 and a Golden Axe.', target: { kind: 'node', type: 'tree_maple' } },
      { ev: 'craft', match: { item: 'maple_plank' }, n: 4, text: 'Saw 4 Maple Planks', hint: 'At the workbench in the Amberfold yard.', target: at('station', { station: 'workbench' }) },
      { ev: 'gather', match: { item: 'coal' }, n: 6, text: 'Dig 6 Coal', hint: 'Coal Seams in the Amberwood: Mining 12 and a Golden Pickaxe.', target: { kind: 'node', type: 'rock_coal' } },
      { ev: 'craft', match: { item: 'steel_bar' }, n: 3, text: 'Smelt 3 Steel Bars', hint: 'An Iron Bar from Hearthvale, 2 Coal and a Maple Log each, at the forge.', target: at('station', { station: 'forge' }) },
      { ev: 'landmark', match: { id: 'lm_great_mill' }, text: 'Visit the Great Mill', hint: 'Its sails turn over the Millrace, south of the square.', target: { kind: 'landmark', id: 'lm_great_mill' } },
    ],
    reward: { gold: 350, xp: { crafting: 600 }, rep: { [T]: 50 } },
  },

  {
    id: 'af_supper',
    town: T,
    title: 'Harvest Supper',
    after: ['af_intro', 3],
    steps: [
      { ev: 'gather', match: { item: 'hearthcap' }, n: 8, text: 'Pick 8 Hearthcaps', hint: 'Red mushrooms in the Amberwood. Herbalism 12.', target: { kind: 'node', type: 'herb_hearthcap' } },
      { ev: 'fish', match: { item: 'rivercarp' }, n: 3, text: 'Catch 3 Rivercarp', hint: 'At the Mill Pond. Fishing 12.', target: { kind: 'lake' } },
      { ev: 'craft', match: { item: 'carp_chowder' }, n: 2, text: 'Cook 2 Carp Chowders', hint: 'At the cookpot: chowder heals 90 in a fight.', target: at('station', { station: 'cookpot' }) },
      { ev: 'craft', match: { item: 'hearthcap_pie' }, text: 'Bake a Hearthcap Pie', hint: 'At the Smokehouse. You’ll need a Sunpetal from Hearthvale.', target: at('station', { station: 'smokehouse' }) },
      { ev: 'use', match: { item: 'hearthcap_pie' }, text: 'Eat the pie before a fight', hint: 'Open your bag and tap it: +10% defence for 5 battles.', target: { kind: 'bag' } },
    ],
    reward: { gold: 300, xp: { herbalism: 600 }, items: { carp_chowder: 3 }, rep: { [T]: 40 } },
  },

  {
    id: 'af_woods',
    town: T,
    title: 'The Turning Woods',
    after: ['af_intro', 1],
    steps: [
      { ev: 'kill', match: { monster: 'mossback_hog' }, n: 4, text: 'Drive off 4 Mossback Hogs', hint: 'They root along the Westmarch road.', target: { kind: 'monster', type: 'mossback_hog' } },
      { ev: 'kill', match: { monster: 'hedge_bandit' }, n: 3, text: 'Chase off 3 Hedge Bandits', hint: 'Their camp is off the road, south of the Wayfarer’s shrine.', target: { kind: 'monster', type: 'hedge_bandit' } },
      { ev: 'kill', match: { monster: 'russet_stag' }, n: 4, text: 'Beat 4 Russet Stags', hint: 'In the Amberwood, among the maples.', target: { kind: 'monster', type: 'russet_stag' } },
      { ev: 'kill', match: { monster: 'bramble_bear' }, n: 2, text: 'Face 2 Bramble Bears', hint: 'In the deep wood. Combat 15, or bring a friend.', target: { kind: 'monster', type: 'bramble_bear' } },
    ],
    reward: { gold: 450, xp: { combat: 900 }, rep: { [T]: 60 } },
  },

  {
    id: 'af_warren',
    town: T,
    title: 'Under the Elder Oak',
    after: ['af_intro', 1],
    min: { combat: 12 },
    steps: [
      { ev: 'landmark', match: { id: 'lm_elder_oak' }, text: 'Find the Elder Oak', hint: 'The great tree west of town: you can see it from the Westmarch.', target: { kind: 'landmark', id: 'lm_elder_oak' } },
      { ev: 'dungeon', match: { kind: 'thornroot_warren', tier: 1 }, text: 'Clear the Thornroot Warren', hint: 'Its door is in the roots of the Elder Oak. Bring a friend!', target: { kind: 'entrance', dungeon: 'thornroot_warren' } },
      { ev: 'dungeon', match: { kind: 'thornroot_warren', tier: 2 }, text: 'Clear the Warren at Tier 2', hint: 'Mother Thorn grows tougher. Heartwood Sap makes the Thornroot set.', target: { kind: 'entrance', dungeon: 'thornroot_warren' } },
      { ev: 'dungeon', match: { kind: 'thornroot_warren', tier: 3 }, text: 'Clear it at Tier 3', hint: 'A full party of four helps.', target: { kind: 'entrance', dungeon: 'thornroot_warren' } },
    ],
    reward: { gold: 600, xp: { combat: 1200 }, items: { heartwood_sap: 8 }, rep: { [T]: 80 } },
  },

  {
    id: 'af_steel',
    town: T,
    title: 'Steel and Saber',
    after: ['af_mill', 4],
    steps: [
      { ev: 'craft', match: { item: 'axe_steel' }, text: 'Forge a Steel Axe', hint: 'Crafting 14, at the anvil. Tier 5: ready for Rimeholt’s frost pines.', target: at('station', { station: 'anvil' }) },
      { ev: 'craft', match: { item: 'steel_saber' }, text: 'Forge a Steel Saber', hint: 'Crafting 15. Needs an Antler from a Russet Stag.', target: at('station', { station: 'anvil' }) },
      { ev: 'craft', match: { item: 'steel_brigandine' }, text: 'Rivet a Steel Brigandine', hint: 'Crafting 16, at the anvil.', target: at('station', { station: 'anvil' }) },
      { ev: 'craft', match: { item: 'amber_pendant' }, text: 'Set an Amber Pendant', hint: 'Crafting 17, at the grindstone: 2 Gold Bars, Amber Sap and Honeycomb.', target: at('station', { station: 'grindstone' }) },
    ],
    reward: { gold: 700, xp: { crafting: 1500 }, rep: { [T]: 80 } },
  },

  {
    id: 'af_pond',
    town: T,
    title: 'The Mill Pond',
    after: ['af_supper', 2],
    steps: [
      { ev: 'fish', match: { item: 'amber_trout' }, n: 5, text: 'Catch 5 Amber Trout', hint: 'Deep water at the Mill Pond.', target: { kind: 'lake' } },
      { ev: 'craft', match: { item: 'rod_amber' }, text: 'Make an Amberline Rod', hint: 'Crafting 13, at the workbench: maple planks, steel and two Amber Trout.', target: at('station', { station: 'workbench' }) },
      { ev: 'fish', match: { item: 'leaf_eel' }, n: 3, text: 'Catch 3 Leaf Eels', hint: 'Quick and slippery: they dart.', target: { kind: 'lake' } },
      { ev: 'craft', match: { item: 'maple_glazed_carp' }, n: 2, text: 'Glaze 2 carp at the Smokehouse', hint: 'Amber Trout, a Maple Log and Honeycomb from a Bramble Bear.', target: at('station', { station: 'smokehouse' }) },
    ],
    reward: { gold: 400, xp: { fishing: 900 }, rep: { [T]: 50 } },
  },

  {
    id: 'af_legend',
    town: T,
    title: 'Grandfather Carp',
    after: ['af_pond', 2],
    steps: [{ ev: 'fish', match: { item: 'legend_millcarp' }, text: 'Land Grandfather Carp', hint: 'Deep in the Mill Pond, with an Amberline Rod, only while the autumn leaves are falling.', target: { kind: 'lake' } }],
    reward: { gold: 900, xp: { fishing: 2000 }, rep: { [T]: 100 }, title: 'Carp Whisperer' },
  },

  {
    id: 'af_wander',
    town: T,
    title: 'Amberfold Ways',
    after: ['af_intro', 2],
    steps: [
      { ev: 'attune', match: { id: 'stone_westmarch' }, text: 'Attune the Westmarch Stones', hint: 'Halfway along the road: a handy place to come back to.', target: { kind: 'stone', id: 'stone_westmarch' } },
      { ev: 'landmark', match: { kind: 'vista', region: 'westmarch' }, text: 'Take in the view over the Causeway', hint: 'On the rise just past the West Gate.', target: { kind: 'landmark', id: 'vista_causeway' } },
      { ev: 'landmark', match: { kind: 'shrine', region: 'amberfold' }, text: 'Pray at the Harvest Shrine', hint: 'Just north of the square.', target: { kind: 'landmark', id: 'shrine_harvest' } },
      { ev: 'landmark', match: { kind: 'cache', region: 'amberwood' }, text: 'Find a cache in the Amberwood', hint: 'The miller hides things, and so do the bees.', target: { kind: 'landmark', id: 'cache_millers_box' } },
      { ev: 'discover', match: {}, n: 8, text: 'Discover 8 places', hint: 'Ruins, views and caches all count. Your map shows what’s left.', target: { kind: 'explore' } },
    ],
    reward: { gold: 350, xp: { foraging: 500 }, rep: { [T]: 60 } },
  },
];
