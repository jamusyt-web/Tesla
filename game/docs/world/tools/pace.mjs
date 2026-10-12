const { xpForLevel: X, levelFromXp } = await import('/home/user/Tesla/game/shared/skills.js');
// [band, from, to, avg xp per gathering action, note]
const bands = [['Hearthvale', 1, 12, 22], ['Amberfold', 12, 18, 46], ['Rimeholt', 18, 25, 62], ['Sandmere', 25, 32, 84], ['Starfall', 32, 40, 115], ['Endgame (rich/ancient)', 40, 50, 150]];
const APH = 240; // gathering actions per focused hour
let cum = 0, toHero50 = 0;
for (const [n, a, b, xp] of bands) {
  const need = X(b) - X(a); const h = need / (xp * APH); cum += h;
  const part = b <= 33 ? h : a < 33 ? (X(33) - X(a)) / (xp * APH) : 0; toHero50 += part;
  console.log(`${n}: skill ${a}->${b} needs ${need} xp, ${xp} xp/action -> ${(xp * APH / 1000).toFixed(1)}k/h, ${h.toFixed(1)} h per skill, cumulative ${cum.toFixed(1)} h`);
}
console.log('per skill to 50:', cum.toFixed(1), 'h; six skills', (6 * cum).toFixed(0), 'h focused; hero 50 (all skills 33):', (6 * toHero50).toFixed(0), 'h focused');
console.log('hero level when all six skills at', [10, 12, 18, 25, 32, 33].map((s) => `${s}->${levelFromXp(3 * X(s))}`).join(' '));
