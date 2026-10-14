// Amberfold's monsters (SPEC §4.2): stats from the one curve, mobStats(L)
// in shared/monsters.js (the content test holds them to it). lvl is the
// recommended Combat level. Normals have two moves; bosses a third,
// telegraphed one: Defend when you see it coming!
const two = (a, b) => [{ name: a, mult: 1 }, { name: b, mult: 1.4 }];

export default {
  mossback_hog: {
    name: 'Mossback Hog', lvl: 11, hp: 242, atk: 31, def: 11, xp: 110, gold: [30, 46], color: '#4f5a3a',
    drops: [{ id: 'leather', p: 0.6, min: 1, max: 1 }, { id: 'hearthcap', p: 0.3, min: 1, max: 1 }],
    moves: two('Tusk', 'Mossy Charge'),
  },
  hedge_bandit: {
    name: 'Hedge Bandit', lvl: 13, hp: 286, atk: 36, def: 13, xp: 133, gold: [33, 51], color: '#7a4a2a',
    drops: [{ id: 'goblin_coin', p: 0.5, min: 1, max: 2 }, { id: 'bandit_map', p: 0.05, min: 1, max: 1 }],
    moves: two('Quick Shot', 'Volley'),
  },
  russet_stag: {
    name: 'Russet Stag', lvl: 12, hp: 264, atk: 33, def: 12, xp: 120, gold: [31, 49], color: '#b5652e',
    drops: [{ id: 'venison', p: 0.8, min: 1, max: 2 }, { id: 'antler', p: 0.3, min: 1, max: 1 }],
    moves: two('Hoof', 'Antler Rush'),
  },
  bramble_bear: {
    name: 'Bramble Bear', lvl: 15, hp: 332, atk: 41, def: 15, xp: 161, gold: [36, 56], color: '#7a5236',
    drops: [{ id: 'wolf_pelt', p: 0.9, min: 1, max: 2 }, { id: 'honeycomb', p: 0.4, min: 1, max: 2 }],
    moves: two('Swipe', 'Bramble Maul'),
  },
  antlered_elder: {
    name: 'The Antlered Elder', lvl: 17, hp: 665, atk: 51, def: 19, xp: 287, gold: [77, 120], color: '#5a3a24', boss: true,
    drops: [{ id: 'elder_antler', p: 0.35, min: 1, max: 1 }, { id: 'maple_log', p: 1, min: 2, max: 4 }],
    moves: two('Gore', 'Trample'),
    // Every third round from the second it lowers its great antlers, and the
    // sweep lands on everyone the round after.
    telegraph: { start: 2, every: 3, move: { name: 'Antler Sweep', mult: 1.6, aoe: true, full: true } },
  },
  // ── The Thornroot Warren (base stats for one hero; a run scales them) ──
  root_thrall: {
    name: 'Root Thrall', lvl: 13, hp: 286, atk: 36, def: 13, xp: 133, gold: [33, 51], color: '#6f5a35', dungeon: true,
    drops: [{ id: 'heartwood_sap', p: 0.35, min: 1, max: 1 }],
    moves: two('Lash', 'Strangle'),
  },
  warren_hog: {
    name: 'Warren Hog', lvl: 13, hp: 286, atk: 36, def: 13, xp: 133, gold: [33, 51], color: '#5f4a3a', dungeon: true,
    drops: [{ id: 'heartwood_sap', p: 0.35, min: 1, max: 1 }, { id: 'leather', p: 0.3, min: 1, max: 1 }],
    moves: two('Root Tusk', 'Burrow Charge'),
  },
  thorn_wisp: {
    name: 'Thorn Wisp', lvl: 14, hp: 309, atk: 38, def: 14, xp: 147, gold: [34, 54], color: '#d9a441', dungeon: true,
    drops: [{ id: 'heartwood_sap', p: 0.35, min: 1, max: 1 }],
    moves: two('Spore Touch', 'Pollen Wail'),
  },
  mother_thorn: {
    name: 'Mother Thorn', lvl: 13, hp: 572, atk: 38, def: 15, xp: 200, gold: [82, 128], color: '#5f7a3a', dungeon: true, boss: true,
    drops: [{ id: 'heartwood_sap', p: 1, min: 1, max: 2 }],
    moves: [{ name: 'Bramble Whip', mult: 1 }, { name: 'Sap Drain', mult: 1.1, drain: 0.5 }],
    telegraph: { start: 2, every: 3, move: { name: 'Thorn Burst', mult: 1.6, aoe: true, full: true } },
  },
};
