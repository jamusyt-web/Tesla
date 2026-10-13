// Monster types and their battle stats (turn-based, resolved on the server).
// Where they live is set by the camps (spawns) in the world map.
import { CONTENT, mergeInto } from './content/index.js';

export const MONSTERS = {
  slime: {
    name: 'Bog Slime', lvl: 1, hp: 40, atk: 6, def: 1, xp: 14, gold: [4, 9], color: '#6aa844',
    drops: [{ id: 'slime_gel', p: 0.9, min: 1, max: 2 }],
    moves: [{ name: 'Slam', mult: 1 }, { name: 'Acid Spit', mult: 1.3 }],
  },
  wolf: {
    name: 'Timber Wolf', lvl: 4, hp: 85, atk: 12, def: 3, xp: 32, gold: [9, 18], color: '#8b8f9c',
    drops: [{ id: 'wolf_pelt', p: 0.85, min: 1, max: 2 }],
    moves: [{ name: 'Bite', mult: 1 }, { name: 'Pounce', mult: 1.5 }],
  },
  goblin: {
    name: 'Goblin Scrapper', lvl: 7, hp: 150, atk: 19, def: 6, xp: 60, gold: [18, 35], color: '#5fa35a',
    drops: [{ id: 'goblin_coin', p: 0.6, min: 1, max: 2 }, { id: 'copper_ore', p: 0.5, min: 1, max: 3 }],
    moves: [{ name: 'Club Smash', mult: 1.1 }, { name: 'Dirty Trick', mult: 1.6 }],
  },
  golem: {
    name: 'Ruinwarden Golem', lvl: 11, hp: 420, atk: 30, def: 12, xp: 160, gold: [50, 90], color: '#7a8b6d',
    drops: [{ id: 'golem_core', p: 0.35, min: 1, max: 1 }, { id: 'iron_ore', p: 0.8, min: 2, max: 4 }],
    moves: [{ name: 'Stone Fist', mult: 1 }, { name: 'Earthquake', mult: 1.4, aoe: true }],
    boss: true,
  },
  caterpillar: {
    name: 'Thornback Grub', lvl: 2, hp: 55, atk: 8, def: 2, xp: 20, gold: [5, 11], color: '#8fd16a',
    drops: [{ id: 'sunpetal', p: 0.5, min: 1, max: 2 }, { id: 'slime_gel', p: 0.4, min: 1, max: 1 }],
    moves: [{ name: 'Gnaw', mult: 1 }, { name: 'Web Spit', mult: 1.25 }],
  },
  crab: {
    name: 'Shorecleaver Crab', lvl: 3, hp: 70, atk: 10, def: 5, xp: 26, gold: [7, 14], color: '#e2574c',
    drops: [{ id: 'perch', p: 0.5, min: 1, max: 2 }, { id: 'copper_ore', p: 0.45, min: 1, max: 2 }],
    moves: [{ name: 'Snap', mult: 1 }, { name: 'Shell Crush', mult: 1.4 }],
  },
  ghost: {
    name: 'Barrow Wisp', lvl: 5, hp: 95, atk: 15, def: 3, xp: 42, gold: [12, 22], color: '#e9f2ff',
    drops: [{ id: 'moonbloom', p: 0.6, min: 1, max: 2 }, { id: 'sapphire', p: 0.03, min: 1, max: 1 }],
    moves: [{ name: 'Chill Touch', mult: 1 }, { name: 'Grave Wail', mult: 1.5 }],
  },
  boar: {
    name: 'Razorback Boar', lvl: 6, hp: 130, atk: 18, def: 6, xp: 52, gold: [14, 26], color: '#8b5a33',
    drops: [{ id: 'leather', p: 0.6, min: 1, max: 1 }, { id: 'wolf_pelt', p: 0.4, min: 1, max: 2 }],
    moves: [{ name: 'Gore', mult: 1 }, { name: 'Charge', mult: 1.55 }],
  },
  skeleton: {
    name: 'Barrow Skeleton', lvl: 9, hp: 210, atk: 24, def: 9, xp: 95, gold: [26, 45], color: '#e8d9b0',
    drops: [{ id: 'iron_ore', p: 0.7, min: 1, max: 3 }, { id: 'goblin_coin', p: 0.5, min: 1, max: 2 }],
    moves: [{ name: 'Rusted Cleave', mult: 1 }, { name: 'Grave Slash', mult: 1.45 }],
  },
  // ── Dungeon monsters (the Hollow Crypt). Base stats for one hero; a run
  // scales them for the party, the tier and the day (shared/dungeon.js).
  thrall: {
    name: 'Rotting Thrall', lvl: 4, hp: 80, atk: 12, def: 3, xp: 24, gold: [6, 12], color: '#6f9a5a', dungeon: true,
    drops: [{ id: 'grave_dust', p: 0.35, min: 1, max: 1 }],
    moves: [{ name: 'Claw', mult: 1 }, { name: 'Putrid Bite', mult: 1.3 }],
  },
  crypt_skeleton: {
    name: 'Crypt Skeleton', lvl: 5, hp: 100, atk: 14, def: 6, xp: 30, gold: [8, 15], color: '#e8d9b0', dungeon: true,
    drops: [{ id: 'grave_dust', p: 0.35, min: 1, max: 1 }, { id: 'iron_ore', p: 0.2, min: 1, max: 1 }],
    moves: [{ name: 'Rusted Cleave', mult: 1 }, { name: 'Bone Rattle', mult: 1.35 }],
  },
  crypt_wisp: {
    name: 'Crypt Wisp', lvl: 5, hp: 95, atk: 15, def: 3, xp: 30, gold: [9, 16], color: '#b8d4ff', dungeon: true,
    drops: [{ id: 'grave_dust', p: 0.35, min: 1, max: 1 }],
    moves: [{ name: 'Chill Touch', mult: 1 }, { name: 'Grave Wail', mult: 1.5 }],
  },
  pale_count: {
    name: 'The Pale Count', lvl: 8, hp: 360, atk: 20, def: 7, xp: 160, gold: [80, 120], color: '#b03a48', dungeon: true, boss: true,
    drops: [{ id: 'grave_dust', p: 1, min: 1, max: 2 }],
    moves: [{ name: 'Night Claw', mult: 1 }, { name: 'Drain', mult: 1.1, drain: 0.5 }],
    // Every third round from the second, he gathers a Blood Mist that lands
    // on everyone the next round. Defend!
    telegraph: { start: 2, every: 3, move: { name: 'Blood Mist', mult: 1.8, aoe: true, full: true } },
  },
  bear: {
    name: 'Rimefang Bear', lvl: 10, hp: 300, atk: 27, def: 11, xp: 125, gold: [32, 55], color: '#f2f6fa',
    drops: [{ id: 'wolf_pelt', p: 0.9, min: 2, max: 3 }, { id: 'golem_core', p: 0.08, min: 1, max: 1 }],
    moves: [{ name: 'Maul', mult: 1 }, { name: 'Roar', mult: 1.3, aoe: true }],
  },
};
mergeInto(MONSTERS, CONTENT.monsters, 'monsters');

// ── One curve for every new monster (SPEC §4.2) ──
// L is the recommended Combat level. Hearthvale's monsters above predate it.
export const ROLES = {
  normal: { hp: 1, atk: 1, def: 0, xp: 1, gold: 1 },
  boss: { hp: 1.75, atk: 1.1, def: 2, xp: 1.5, gold: 2 },
  elite: { hp: 2.4, atk: 1.15, def: 2, xp: 2, gold: 1.5 }, // hp grows with each fighter
  dboss: { hp: 2, atk: 1.05, def: 2, xp: 1.5, gold: 2.5 }, // dungeon bosses
};
export function mobStats(L, role = 'normal', fighters = 1) {
  const R = ROLES[role] ?? ROLES.normal;
  const over = Math.max(0, L - 12);
  const per = role === 'elite' ? 1 + 0.6 * (Math.max(1, fighters) - 1) : 1;
  const g = L ** 0.6 * R.gold;
  return {
    lvl: L,
    hp: Math.round((22 * L + 0.25 * over * over) * R.hp * per),
    atk: Math.round((2.6 * L + 2) * R.atk),
    def: L + R.def,
    xp: Math.round(10 * L * (1 + over / 40) * R.xp),
    gold: [Math.round(7 * g), Math.round(11 * g)],
  };
}

// An elite: a base monster (its look, moves and drops) restatted to its own
// level, with hp for the number of heroes fighting it.
export function eliteDef(type, L, fighters = 1, name = null) {
  const base = MONSTERS[type];
  return { ...base, ...mobStats(L, 'elite', fighters), name: name ?? `Elite ${base.name}`, elite: true, boss: false };
}

// Hero combat stats derived from level + gear, and the hero's effects
// (shared/perks.js: atkPct, defHpPct, a set's hp, a tonic's atk/def).
export function heroStats(level, combatLvl, gear, E = {}) {
  let atk = 8 + level * 2 + combatLvl * 2;
  let def = 2 + level;
  let hp = 90 + level * 12;
  for (const g of gear) {
    if (!g) continue;
    atk += g.atk || 0;
    def += g.def || 0;
    hp += g.hp || 0;
  }
  hp += E.setHp || 0;
  const atkPct = (E.atkPct || 0) + (E.tonicAtk || 0);
  const defPct = (E.defHpPct || 0) + (E.tonicDef || 0);
  return { atk: Math.round(atk * (1 + atkPct)), def: Math.round(def * (1 + defPct)), hp: Math.round(hp * (1 + (E.defHpPct || 0))) };
}

export const damage = (atk, def, mult = 1, rng = Math.random) =>
  Math.max(1, Math.round((atk * mult - def * 0.6) * (0.88 + rng() * 0.24)));
