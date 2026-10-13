// Testvale: a test fixture town (maps/fixtures/twotown.json), with a little
// of everything a real town's content pack brings, so tests can exercise
// every system on two towns. It isn't in the game: tests install it
// (server/tests/twotown.js). Plain data, like every pack.
export default {
  id: 'testvale',
  items: {
    tv_lantern: { name: 'Testvale Lantern', icon: '🏮', cat: 'tool', tag: 'kit', kit: 'lantern', value: 40, rarity: 'uncommon' },
    tv_letter: { name: 'Letter to Testvale', icon: '✉️', cat: 'special', tag: 'letter', value: 0, rarity: 'common', bound: true, nowarp: true },
  },
  recipes: [{ id: 'tv_plank', out: 'oak_plank', qty: 1, in: { oak_log: 2 }, lvl: 1, xp: 4, station: 'workbench', pattern: 'saw', town: 'testvale' }],
  dungeons: {
    testvale_cave: {
      name: 'Testvale Cave',
      word: 'cave',
      blurb: 'A damp cave under Testvale.',
      town: 'testvale',
      kit: 'cave',
      skin: 'variation-a',
      dust: 'slime_gel',
      dressing: ['mushroom'],
      fog: '#3a4a5a',
      tiers: { 1: 13, 2: 16, 3: 19, 4: 25 },
      pool: ['thrall', 'crypt_skeleton', 'crypt_wisp'],
      elite: ['crypt_skeleton'],
      boss: { monster: 'pale_count', adds: ['thrall', 'crypt_wisp'] },
    },
  },
  // The standard chest rule (shared/dungeon.js standardChests) for Tier 1 level 13.
  chests: {
    testvale_cave: {
      vault: { gold: [130, 234], dust: [2, 3], table: [{ id: 'iron_bar', w: 35, n: 3 }, { id: 'grilled_fish', w: 30, n: 2 }, { id: 'sapphire', w: 10, n: 1 }, { id: null, w: 18, n: 0 }] },
      boss: { gold: [312, 520], dust: [3, 5], rolls: 2, table: [{ id: 'iron_bar', w: 35, n: 3 }, { id: 'grilled_fish', w: 30, n: 2 }, { id: 'sapphire', w: 10, n: 1 }, { id: ['barrow_plate'], w: 4, n: 1 }, { id: 'charm_wayfarer', w: 3, n: 1 }, { id: null, w: 18, n: 0 }] },
    },
  },
  fishTables: {
    testvale: { lvl: 6, fish: [{ id: 'old_boot', shallow: 7, deep: 7 }, { id: 'perch', shallow: 50, deep: 25 }, { id: 'trout', shallow: 35, deep: 40 }, { id: 'pike', shallow: 15, deep: 35, luck: true }], legends: [] },
  },
  trade: { base: 0.55, floorPool: 2000, rate: { wood: 0.45, ore: 0.9, herb: 0.5, fish: 0.85, food: 0.8, hide: 0.6, gem: 0.7, gear: 0.55 } },
  supplies: ['iron_ore', 'birch_log', 'sunpetal', 'fish_stew', 'hearth_charm'],
  customers: [
    { name: 'Tester Tam', face: '🧑‍🔧', v: 1, cats: { resource: 2, material: 2, consumable: 1, tool: 1, gear: 1 }, likes: ['iron_ore', 'iron_bar'] },
    { name: 'Cook Ada', face: '👩‍🍳', v: 2, cats: { resource: 2, material: 0, consumable: 3, tool: 0, gear: 0 }, likes: ['perch', 'trout'] },
  ],
};
