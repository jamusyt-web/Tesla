// Skyblock-style skills. Each level needs a bit more XP than the last.
export const SKILLS = {
  foraging: { name: 'Foraging', icon: '🪓', perk: 'Double log chance' },
  mining: { name: 'Mining', icon: '⛏️', perk: 'Double ore chance' },
  herbalism: { name: 'Herbalism', icon: '🌿', perk: 'Double herb chance' },
  fishing: { name: 'Fishing', icon: '🎣', perk: 'Rare catch chance' },
  combat: { name: 'Combat', icon: '⚔️', perk: '+2 ATK per level' },
  crafting: { name: 'Crafting', icon: '🔨', perk: 'Unlocks recipes' },
};
export const SKILL_IDS = Object.keys(SKILLS);
export const MAX_LEVEL = 50;

// Total XP needed to *reach* level L (level 1 = 0 xp).
export function xpForLevel(L) {
  if (L <= 1) return 0;
  let total = 0;
  for (let i = 1; i < L; i++) total += Math.floor(40 * Math.pow(i, 1.6));
  return total;
}

export function levelFromXp(xp) {
  let L = 1;
  while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++;
  return L;
}

// { level, into, need, pct } for progress bars
export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const need = next - base;
  const into = xp - base;
  return { level, into, need, pct: level >= MAX_LEVEL ? 1 : into / need };
}

// Overall hero level = derived from total skill XP so everything you do levels you.
export function heroLevel(skills) {
  const total = SKILL_IDS.reduce((s, k) => s + (skills?.[k] || 0), 0);
  return levelFromXp(Math.floor(total / 2));
}

// Perk: chance of doubling a gathering drop, by skill level.
export const doubleChance = (lvl) => Math.min(0.5, (lvl - 1) * 0.02);
