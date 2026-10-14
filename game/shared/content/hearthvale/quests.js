// Hearthvale's quests (SPEC §5.2): the intro chain every new hero follows,
// and side chains that open up as you go, one per corner of the island.
// Plain data: shared/quests.js explains the shape.
const T = 'hearthvale';

export default [
  {
    id: 'hv_intro',
    town: T,
    title: 'Welcome to Hearthvale',
    requires: [],
    repeat: null,
    steps: [
      { ev: 'gather', match: { type: 'tree_oak' }, text: 'Chop an oak in Whisperwood', hint: 'Tap a tree, then strike as the ring closes.', target: { kind: 'node', type: 'tree_oak' }, reward: { gold: 20 } },
      { ev: 'craft', match: { item: 'oak_plank' }, text: 'Saw a plank at the Workbench', hint: 'In the Workshop yard: pick Oak Plank, then saw in time.', target: { kind: 'station', station: 'workbench' }, reward: { gold: 30 } },
      { ev: 'kill', match: { monster: 'slime' }, text: 'Beat a Bog Slime', hint: 'Through the Wilds Gate, to the north.', target: { kind: 'monster', type: 'slime' }, reward: { gold: 50 } },
      { ev: 'stock', match: {}, text: 'Put something on your shop shelf', hint: 'Walk into Your Shop, tap an empty display and set a price.', target: { kind: 'building', action: 'shop' }, reward: { gold: 60 } },
      { ev: 'craft', match: { item: 'pick_copper' }, text: 'Forge a Copper Pickaxe', hint: 'Mine copper in the quarry, smelt bars at the forge, then forge it at the anvil.', target: { kind: 'station', station: 'anvil' }, reward: { gold: 80, items: { health_potion: 2 } } },
      { ev: 'attune', match: { id: 'stone_wildwatch' }, text: 'Attune the Wildwatch stone', hint: 'Touch the waystone past the Wilds Gate: you can travel back to it any time.', target: { kind: 'stone', id: 'stone_wildwatch' }, reward: { gold: 40 } },
      { ev: 'fish', match: {}, text: 'Land a fish at Mirror Lake', hint: 'Cast from the pier, strike when it bites, keep the fish in the bar.', target: { kind: 'lake' }, reward: { gold: 40 } },
      { ev: 'order', match: { town: T }, text: 'Fill an order on the Order Board', hint: 'The board by the square lists what the town needs today.', target: { kind: 'board' }, reward: { gold: 60, rep: { [T]: 30 } } },
      { ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 1 }, text: 'Clear the Hollow Crypt', hint: 'The door is at the north end of the Wilds. Bring a friend!', target: { kind: 'entrance', dungeon: 'hollow_crypt' }, reward: { gold: 150 } },
      { ev: 'attune', match: { id: 'stone_westmarch' }, text: 'Take the West Gate road to the Westmarch Stones', hint: 'Out through the West Gate, past Whisperwood. The leaves turn gold out there. Combat 11+ is safest.', target: { kind: 'stone', id: 'stone_westmarch' }, reward: { gold: 100 } },
    ],
    reward: { xp: { combat: 200 }, rep: { [T]: 50 }, title: 'Hearthvaler' },
  },

  {
    id: 'hv_quarry',
    town: T,
    title: 'Stone by Stone',
    after: ['hv_intro', 1],
    steps: [
      { ev: 'gather', match: { item: 'stone' }, n: 10, text: 'Mine 10 Stone at Copperstone Quarry', hint: 'East of town. Any pickaxe will do.', target: { kind: 'node', type: 'rock_stone' } },
      { ev: 'craft', match: { item: 'stone_brick' }, n: 4, text: 'Cut 4 Stone Bricks', hint: 'At the grindstone in the Workshop yard.', target: { kind: 'station', station: 'grindstone' } },
      { ev: 'craft', match: { item: 'whetstone' }, text: 'Grind a Whetstone', hint: 'Crafting 4. A whetstone makes your tools hit harder for 60 swings.', target: { kind: 'station', station: 'grindstone' } },
      { ev: 'use', match: { item: 'whetstone' }, text: 'Use a Whetstone', hint: 'Open your bag and tap it.', target: { kind: 'bag' } },
      { ev: 'gather', match: { item: 'gold_ore' }, n: 3, text: 'Mine 3 Gold Ore', hint: 'Mining 8: the glittering rocks at the back of the quarry.', target: { kind: 'node', type: 'rock_gold' } },
    ],
    reward: { gold: 220, xp: { mining: 300 }, rep: { [T]: 40 } },
  },

  {
    id: 'hv_garden',
    town: T,
    title: 'The Herb Garden',
    after: ['hv_intro', 2],
    steps: [
      { ev: 'gather', match: { item: 'mint_leaf' }, n: 8, text: 'Pick 8 Mint Leaves', hint: 'In the Herb Garden, south-west of the square.', target: { kind: 'node', type: 'herb_mint' } },
      { ev: 'craft', match: { item: 'mint_tea' }, n: 2, text: 'Brew 2 Mint Teas', hint: 'At the cookpot. A cup gives +10% gathering xp.', target: { kind: 'station', station: 'cookpot' } },
      { ev: 'use', match: { item: 'mint_tea' }, text: 'Drink a Mint Tea', hint: 'Open your bag and tap it.', target: { kind: 'bag' } },
      { ev: 'gather', match: { item: 'sunpetal' }, n: 5, text: 'Pick 5 Sunpetals', hint: 'Herbalism 3.', target: { kind: 'node', type: 'herb_sun' } },
      { ev: 'craft', match: { item: 'health_potion' }, n: 3, text: 'Brew 3 Health Potions', hint: 'At the cookpot: handy in a tough fight.', target: { kind: 'station', station: 'cookpot' } },
      { ev: 'gather', match: { item: 'moonbloom' }, n: 3, text: 'Pick 3 Moonblooms', hint: 'Herbalism 7.', target: { kind: 'node', type: 'herb_moon' } },
      { ev: 'craft', match: { item: 'moon_elixir' }, text: 'Brew a Moon Elixir', hint: 'Crafting 9, at the cookpot.', target: { kind: 'station', station: 'cookpot' } },
    ],
    reward: { gold: 300, xp: { herbalism: 400 }, items: { health_potion: 3 }, rep: { [T]: 40 } },
  },

  {
    id: 'hv_wilds',
    town: T,
    title: 'Trouble in the Wilds',
    after: ['hv_intro', 3],
    steps: [
      { ev: 'kill', match: { monster: 'wolf' }, n: 4, text: 'Drive off 4 Wolves', hint: 'They prowl the west of the Wilds.', target: { kind: 'monster', type: 'wolf' } },
      { ev: 'kill', match: { monster: 'boar' }, n: 3, text: 'Beat 3 Boars', hint: 'East of the Wilds, past the slimes.', target: { kind: 'monster', type: 'boar' } },
      { ev: 'kill', match: { monster: 'goblin' }, n: 3, text: 'Chase off 3 Goblins', hint: 'Their camp is north-east. Combat 7 or a friend helps.', target: { kind: 'monster', type: 'goblin' } },
      { ev: 'kill', match: { monster: 'bear' }, text: 'Face a Bear', hint: 'In the far north-west. Bring potions.', target: { kind: 'monster', type: 'bear' } },
      { ev: 'kill', match: { monster: 'golem' }, text: 'Topple a Stone Golem', hint: 'At the very north of the Wilds. Best with friends!', target: { kind: 'monster', type: 'golem' } },
    ],
    reward: { gold: 400, xp: { combat: 600 }, rep: { [T]: 60 } },
  },

  {
    id: 'hv_forge',
    town: T,
    title: 'Sparks at the Forge',
    after: ['hv_intro', 5],
    steps: [
      { ev: 'craft', match: { item: 'copper_bar' }, n: 4, text: 'Smelt 4 Copper Bars', hint: 'Copper ore from the quarry, at the forge.', target: { kind: 'station', station: 'forge' } },
      { ev: 'craft', match: { item: 'sword_copper' }, text: 'Forge a Copper Sword', hint: 'At the anvil. Equip it for a harder hit.', target: { kind: 'station', station: 'anvil' } },
      { ev: 'gather', match: { item: 'iron_ore' }, n: 6, text: 'Mine 6 Iron Ore', hint: 'Mining 5, in the quarry.', target: { kind: 'node', type: 'rock_iron' } },
      { ev: 'craft', match: { item: 'iron_bar' }, n: 3, text: 'Smelt 3 Iron Bars', hint: 'Crafting 5, at the forge.', target: { kind: 'station', station: 'forge' } },
      { ev: 'craft', match: { item: 'pick_iron' }, text: 'Forge an Iron Pickaxe', hint: 'Crafting 6, at the anvil.', target: { kind: 'station', station: 'anvil' } },
      { ev: 'craft', match: { minGrade: 'A' }, text: 'Make anything at grade A or better', hint: 'Hit the windows cleanly: no misses.', target: { kind: 'building', action: 'craft' } },
    ],
    reward: { gold: 450, xp: { crafting: 600 }, rep: { [T]: 60 } },
  },

  {
    id: 'hv_angler',
    town: T,
    title: 'The Old Angler',
    after: ['hv_intro', 7],
    steps: [
      { ev: 'fish', match: {}, n: 5, text: 'Land 5 fish', hint: 'Any fish at Mirror Lake.', target: { kind: 'lake' } },
      { ev: 'craft', match: { item: 'grilled_fish' }, n: 3, text: 'Grill 3 fish', hint: 'At the cookpot: grilled fish heals in battle.', target: { kind: 'station', station: 'cookpot' } },
      { ev: 'fish', match: { item: 'trout' }, text: 'Catch a Trout', hint: 'They bite more in deep water: cast from the end of the pier.', target: { kind: 'lake' } },
      { ev: 'craft', match: { item: 'rod_fine' }, text: 'Make a Fine Rod', hint: 'Crafting 5, at the workbench. Better fish come to a better rod.', target: { kind: 'station', station: 'workbench' } },
      { ev: 'fish', match: { item: 'pike' }, text: 'Catch a Pike', hint: 'A fighter: keep it in the bar.', target: { kind: 'lake' } },
      { ev: 'sell', match: { tag: 'fish' }, n: 5, text: 'Sell 5 fish to the Market merchant', hint: 'Market → Sell. He pays well for fish.', target: { kind: 'building', action: 'market' } },
    ],
    reward: { gold: 350, xp: { fishing: 500 }, rep: { [T]: 50 } },
  },

  {
    id: 'hv_trade',
    town: T,
    title: 'Coin and Counter',
    after: ['hv_intro', 4],
    steps: [
      { ev: 'sell', match: {}, n: 10, text: 'Sell 10 goods to the Market merchant', hint: 'Market → Sell: he buys almost anything.', target: { kind: 'building', action: 'market' } },
      { ev: 'stock', match: {}, n: 3, text: 'Stock 3 more things in your shop', hint: 'Townsfolk drop by and buy at fair prices, even while you are away.', target: { kind: 'building', action: 'shop' } },
      { ev: 'trade', match: {}, text: 'Buy or sell on the player market', hint: 'Market → an item → place an order. It fills when a price meets yours.', target: { kind: 'building', action: 'market' } },
      { ev: 'deliver', match: { kind: 'job' }, text: 'Deliver a job from the bulletin board', hint: 'Other heroes post jobs and pay for the goods.', target: { kind: 'board' } },
    ],
    reward: { gold: 250, rep: { [T]: 60 } },
  },

  {
    id: 'hv_wander',
    town: T,
    title: 'Every Corner',
    after: ['hv_intro', 6],
    steps: [
      { ev: 'landmark', match: { kind: 'vista' }, text: 'Take in a view', hint: 'High places show you the land around: look for the spyglass on your map.', target: { kind: 'landmark', lk: 'vista' } },
      { ev: 'landmark', match: { kind: 'cache' }, text: 'Open a hidden cache', hint: 'Caches sparkle when you are near. One hides under the pier.', target: { kind: 'landmark', lk: 'cache' } },
      { ev: 'landmark', match: { kind: 'shrine' }, text: 'Pray at a shrine', hint: 'A blessing that quickens your step.', target: { kind: 'landmark', lk: 'shrine' } },
      { ev: 'discover', match: {}, n: 6, text: 'Discover 6 places', hint: 'Walk the island: waystones, doors, ruins and views all count.', target: { kind: 'explore' } },
    ],
    reward: { gold: 200, xp: { foraging: 150, mining: 150, herbalism: 150 }, rep: { [T]: 50 } },
  },

  {
    id: 'hv_deeper',
    town: T,
    title: 'Deeper Still',
    requires: [],
    after: ['hv_intro', 9], // (once the Crypt is cleared, not after the road west)
    steps: [
      { ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 2 }, text: 'Clear the Hollow Crypt at Tier 2', hint: 'Pick Tier 2 at the crypt door.', target: { kind: 'entrance', dungeon: 'hollow_crypt' } },
      { ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 3 }, text: 'Clear it at Tier 3', hint: 'A full party of four helps.', target: { kind: 'entrance', dungeon: 'hollow_crypt' } },
      { ev: 'dungeon', match: { kind: 'hollow_crypt', tier: 4 }, text: 'Clear the Deep', hint: 'The hardest the crypt gets, bar the Nightmare.', target: { kind: 'entrance', dungeon: 'hollow_crypt' } },
    ],
    reward: { gold: 900, xp: { combat: 1500 }, items: { trophy_hearthvale: 1 }, rep: { [T]: 100 }, title: 'Cryptbreaker' },
  },
];
