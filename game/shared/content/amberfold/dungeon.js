// The Thornroot Warren (SPEC §4.7): a red-brown cave under the Elder Oak,
// full of roots and glowing mushrooms. Its reagent, Heartwood Sap, makes the
// Thornroot set. Chests follow the standard rule for a Tier 1 level of 13.
export const dungeons = {
  thornroot_warren: {
    name: 'The Thornroot Warren',
    word: 'warren',
    blurb: 'A burrow of roots and red earth under the Elder Oak. Something old and thorny sleeps at its heart, and its sap is worth a fortune to a smith.',
    town: 'amberfold',
    kit: 'cave',
    skin: 'default',
    dust: 'heartwood_sap',
    dressing: ['roots', 'mushroom'],
    fog: '#4a3326',
    tiers: { 1: 13, 2: 16, 3: 19, 4: 25 },
    gear: { 1: 'a Steel Saber or the Iron line and potions', 2: 'Steel gear and Hearthcap Pies', 3: 'Steel or Thornroot gear and a full party' },
    pool: ['root_thrall', 'warren_hog', 'thorn_wisp'],
    elite: ['warren_hog'],
    boss: { monster: 'mother_thorn', adds: ['root_thrall', 'thorn_wisp', 'root_thrall'] },
  },
};

const BASE = [{ id: 'steel_bar', w: 35, n: 3 }, { id: 'carp_chowder', w: 30, n: 2 }, { id: 'amber_sap', w: 10, n: 1 }];
export const chests = {
  thornroot_warren: {
    vault: { gold: [130, 234], dust: [2, 3], table: [...BASE, { id: null, w: 18, n: 0 }] },
    boss: { gold: [312, 520], dust: [3, 5], rolls: 2, table: [...BASE, { id: ['thornwood_blade', 'thornroot_jerkin', 'heartwood_amulet'], w: 4, n: 1 }, { id: 'charm_forager_1', w: 3, n: 1 }, { id: null, w: 18, n: 0 }] },
  },
};
