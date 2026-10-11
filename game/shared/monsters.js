// Monsters that roam The Wilds. Battles are turn-based and resolved on the server.
export const MONSTERS = {
  slime: {
    name: 'Bog Slime', lvl: 1, hp: 40, atk: 6, def: 1, xp: 14, gold: [4, 9], color: '#6aa844',
    drops: [{ id: 'slime_gel', p: 0.9, min: 1, max: 2 }],
    moves: [{ name: 'Slam', mult: 1 }, { name: 'Acid Spit', mult: 1.3 }],
    spawn: { x: 0, z: -52, r: 15, count: 6 },
  },
  wolf: {
    name: 'Timber Wolf', lvl: 4, hp: 85, atk: 12, def: 3, xp: 32, gold: [9, 18], color: '#8b8f9c',
    drops: [{ id: 'wolf_pelt', p: 0.85, min: 1, max: 2 }],
    moves: [{ name: 'Bite', mult: 1 }, { name: 'Pounce', mult: 1.5 }],
    spawn: { x: -20, z: -68, r: 10, count: 5 },
  },
  goblin: {
    name: 'Goblin Scrapper', lvl: 7, hp: 150, atk: 19, def: 6, xp: 60, gold: [18, 35], color: '#5fa35a',
    drops: [{ id: 'goblin_coin', p: 0.6, min: 1, max: 2 }, { id: 'copper_ore', p: 0.5, min: 1, max: 3 }],
    moves: [{ name: 'Club Smash', mult: 1.1 }, { name: 'Dirty Trick', mult: 1.6 }],
    spawn: { x: 20, z: -72, r: 10, count: 4 },
  },
  golem: {
    name: 'Ruinwarden Golem', lvl: 11, hp: 420, atk: 30, def: 12, xp: 160, gold: [50, 90], color: '#7a8b6d',
    drops: [{ id: 'golem_core', p: 0.35, min: 1, max: 1 }, { id: 'iron_ore', p: 0.8, min: 2, max: 4 }],
    moves: [{ name: 'Stone Fist', mult: 1 }, { name: 'Earthquake', mult: 1.4, aoe: true }],
    spawn: { x: 0, z: -86, r: 6, count: 2 },
    boss: true,
  },
  caterpillar: {
    name: 'Thornback Grub', lvl: 2, hp: 55, atk: 8, def: 2, xp: 20, gold: [5, 11], color: '#8fd16a',
    drops: [{ id: 'sunpetal', p: 0.5, min: 1, max: 2 }, { id: 'slime_gel', p: 0.4, min: 1, max: 1 }],
    moves: [{ name: 'Gnaw', mult: 1 }, { name: 'Web Spit', mult: 1.25 }],
    spawn: { x: 15, z: -47, r: 7, count: 4 },
  },
  crab: {
    name: 'Shorecleaver Crab', lvl: 3, hp: 70, atk: 10, def: 5, xp: 26, gold: [7, 14], color: '#e2574c',
    drops: [{ id: 'perch', p: 0.5, min: 1, max: 2 }, { id: 'copper_ore', p: 0.45, min: 1, max: 2 }],
    moves: [{ name: 'Snap', mult: 1 }, { name: 'Shell Crush', mult: 1.4 }],
    spawn: { x: -25, z: -47, r: 7, count: 4 },
  },
  ghost: {
    name: 'Barrow Wisp', lvl: 5, hp: 95, atk: 15, def: 3, xp: 42, gold: [12, 22], color: '#e9f2ff',
    drops: [{ id: 'moonbloom', p: 0.6, min: 1, max: 2 }, { id: 'sapphire', p: 0.03, min: 1, max: 1 }],
    moves: [{ name: 'Chill Touch', mult: 1 }, { name: 'Grave Wail', mult: 1.5 }],
    spawn: { x: -12, z: -82, r: 6, count: 3 },
  },
  boar: {
    name: 'Razorback Boar', lvl: 6, hp: 130, atk: 18, def: 6, xp: 52, gold: [14, 26], color: '#8b5a33',
    drops: [{ id: 'leather', p: 0.6, min: 1, max: 1 }, { id: 'wolf_pelt', p: 0.4, min: 1, max: 2 }],
    moves: [{ name: 'Gore', mult: 1 }, { name: 'Charge', mult: 1.55 }],
    spawn: { x: 30, z: -52, r: 7, count: 4 },
  },
  skeleton: {
    name: 'Barrow Skeleton', lvl: 9, hp: 210, atk: 24, def: 9, xp: 95, gold: [26, 45], color: '#e8d9b0',
    drops: [{ id: 'iron_ore', p: 0.7, min: 1, max: 3 }, { id: 'goblin_coin', p: 0.5, min: 1, max: 2 }],
    moves: [{ name: 'Rusted Cleave', mult: 1 }, { name: 'Grave Slash', mult: 1.45 }],
    spawn: { x: 16, z: -86, r: 6, count: 3 },
  },
  bear: {
    name: 'Rimefang Bear', lvl: 10, hp: 300, atk: 27, def: 11, xp: 125, gold: [32, 55], color: '#f2f6fa',
    drops: [{ id: 'wolf_pelt', p: 0.9, min: 2, max: 3 }, { id: 'golem_core', p: 0.08, min: 1, max: 1 }],
    moves: [{ name: 'Maul', mult: 1 }, { name: 'Roar', mult: 1.3, aoe: true }],
    spawn: { x: -28, z: -78, r: 6, count: 2 },
  },
};

// Hero combat stats derived from level + gear.
export function heroStats(level, combatLvl, gear) {
  let atk = 8 + level * 2 + combatLvl * 2;
  let def = 2 + level;
  let hp = 90 + level * 12;
  for (const g of gear) {
    if (!g) continue;
    atk += g.atk || 0;
    def += g.def || 0;
    hp += g.hp || 0;
  }
  return { atk, def, hp };
}

export const damage = (atk, def, mult = 1, rng = Math.random) =>
  Math.max(1, Math.round((atk * mult - def * 0.6) * (0.88 + rng() * 0.24)));
