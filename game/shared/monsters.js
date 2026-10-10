// Monsters that roam The Wilds. Battles are turn-based and resolved on the server.
export const MONSTERS = {
  slime: {
    name: 'Meadow Slime', lvl: 1, hp: 40, atk: 6, def: 1, xp: 14, gold: [4, 9], color: '#7ed957',
    drops: [{ id: 'slime_gel', p: 0.9, min: 1, max: 2 }],
    moves: [{ name: 'Bounce', mult: 1 }, { name: 'Goo Splash', mult: 1.3 }],
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
    name: 'Mossy Golem', lvl: 11, hp: 420, atk: 30, def: 12, xp: 160, gold: [50, 90], color: '#7a8b6d',
    drops: [{ id: 'golem_core', p: 0.35, min: 1, max: 1 }, { id: 'iron_ore', p: 0.8, min: 2, max: 4 }],
    moves: [{ name: 'Rock Fist', mult: 1 }, { name: 'Earthquake', mult: 1.4, aoe: true }],
    spawn: { x: 0, z: -86, r: 6, count: 2 },
    boss: true,
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
