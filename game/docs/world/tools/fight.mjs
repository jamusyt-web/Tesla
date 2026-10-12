// Spec check: one mobStats curve vs the gear ladder, for a pure fighter and a balanced hero.
const G = '/home/user/Tesla/game/shared/';
const { xpForLevel: X, levelFromXp } = await import(G + 'skills.js');
const { heroStats, damage } = await import(G + 'monsters.js');
const L06 = (L) => Math.pow(L, 0.6);
export function mobStats(L, role = 'normal') {
  const b = { hp: 22 * L + 0.25 * Math.max(0, L - 12) ** 2, atk: 2.6 * L + 2, def: L, xp: 10 * L * (1 + Math.max(0, L - 12) / 40), g0: 7 * L06(L), g1: 11 * L06(L) };
  const k = { normal: [1, 1, 0, 1, 1], boss: [1.75, 1.1, 2, 1.5, 2], elite: [2.4, 1.15, 2, 2, 1.5] }[role];
  return { lvl: L, hp: Math.round(b.hp * k[0]), atk: Math.round(b.atk * k[1]), def: b.def + k[2], xp: Math.round(b.xp * k[3]), gold: [Math.round(b.g0 * k[4]), Math.round(b.g1 * k[4])] };
}
const GEAR = {
  1: [{ atk: 26 }, { def: 10 }, { atk: 5, def: 5, hp: 40 }],
  2: [{ atk: 36 }, { def: 16, hp: 20 }, { atk: 7, def: 6, hp: 60 }],
  3: [{ atk: 48 }, { def: 22, hp: 40 }, { atk: 9, def: 8, hp: 80 }],
  4: [{ atk: 62 }, { def: 29, hp: 60 }, { atk: 11, def: 10, hp: 100 }],
  5: [{ atk: 78 }, { def: 36, hp: 80 }, { atk: 13, def: 12, hp: 120 }],
};
const pureH = (c) => levelFromXp(Math.floor(X(c) / 2));
const balH = (c) => levelFromXp(Math.floor(3 * X(c)));
const mid = () => 0.5;
function fight(st, m, n = 1) {
  const hd = damage(st.atk, m.def, 1.25, mid); // crits + specials averaged
  const md = damage(m.atk, st.def, 1.2, mid);
  const rounds = Math.ceil(m.hp / (hd * n));
  return { rounds, pct: Math.round(((rounds - 1) * md) / st.hp * 100) };
}
const fmt = (f) => `${f.rounds}r/${f.pct}%`;
const towns = [
  ['Amberfold', 2, [11, 13, 15], 17],
  ['Rimeholt', 3, [16, 18, 21], 23],
  ['Sandmere', 4, [22, 25, 27], 29],
  ['Starfall', 5, [28, 30, 32], 36],
];
if (process.argv[2] !== 'quiet') {
for (const [name, t, mobs, boss] of towns) {
  for (const [lab, c, gt] of [['arrive', mobs[0], t - 1], ['leave', boss, t]]) {
    for (const [kind, H] of [['pure', pureH(c)], ['bal', Math.min(50, balH(c))]]) {
      const st = heroStats(H, c, GEAR[gt]);
      const row = mobs.map((l) => `L${l} ${fmt(fight(st, mobStats(l)))}`).join(' · ');
      const B = mobStats(boss, 'boss');
      console.log(`${name.padEnd(9)} ${lab.padEnd(6)} ${kind.padEnd(4)} c${c} H${H} g${gt} atk${st.atk} def${st.def} hp${st.hp} | ${row} | boss L${boss}(hp${B.hp} atk${B.atk}) solo ${fmt(fight(st, B))} duo ${fmt(fight(st, B, 2))}`);
    }
  }
}
for (const L of [11, 13, 15, 17, 18, 21, 23, 25, 29, 30, 32, 36, 46]) console.log(L, JSON.stringify(mobStats(L)), JSON.stringify(mobStats(L, 'boss')), JSON.stringify(mobStats(L, 'elite')));
for (const c of [12, 18, 25, 32, 33, 40, 50]) console.log('combat', c, 'pure hero', pureH(c), 'balanced hero', balH(c), 'xp', X(c));
}
