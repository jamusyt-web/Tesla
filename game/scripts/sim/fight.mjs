// The fight check (SPEC §4.2), against the real tables: each Amberfold
// monster fought by a hero arriving in Hearthvale's best gear and by one
// leaving in Amberfold's, with the game's own heroStats and damage at middle
// rolls (hero ×1.25 for crits and specials, monster ×1.2).
//   node scripts/sim/fight.mjs [town]      prints rounds and hp lost
// fightRow() is what server/tests/world-content.test.js checks.
import { fileURLToPath } from 'node:url';
import { MONSTERS, heroStats, damage } from '../../shared/monsters.js';
import { ITEMS } from '../../shared/items.js';
import { xpForLevel, levelFromXp } from '../../shared/skills.js';
import { CONTENT } from '../../shared/content/index.js';

const mid = () => 0.5;
// A pure fighter's hero level for a combat level (hero ≈ 0.75 × combat).
export const pureHero = (c) => levelFromXp(Math.floor(xpForLevel(c) / 2));
// Gear in: Hearthvale's best crafted line; out: the town's own.
export const GEAR = {
  hearthvale: ['sword_gold', 'armor_iron', 'amulet_sapphire'],
  amberfold: ['steel_saber', 'steel_brigandine', 'amber_pendant'],
};
export function fight(heroLvl, combat, gear, m, fighters = 1) {
  const st = heroStats(heroLvl, combat, gear.map((id) => ITEMS[id]));
  const hd = damage(st.atk, m.def, 1.25, mid);
  const md = damage(m.atk, st.def, 1.2, mid);
  const rounds = Math.ceil(m.hp / (hd * fighters));
  return { rounds, pct: Math.round((((rounds - 1) * md) / st.hp) * 100) };
}
// Every one of a town's monsters, arriving (at its band floor) and leaving (at its top).
export function fightRows(town = 'amberfold', band = [12, 18]) {
  const ids = Object.keys(CONTENT.monsters).filter((id) => !MONSTERS[id].dungeon);
  return ids.map((id) => {
    const m = MONSTERS[id];
    return { id, lvl: m.lvl, boss: !!m.boss, arrive: fight(pureHero(band[0]), band[0], GEAR.hearthvale, m), leave: fight(pureHero(band[1]), band[1], GEAR[town], m), duo: fight(pureHero(band[0] + 2), band[0] + 2, GEAR.hearthvale, m, 2) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = (r) => `${r.rounds} rounds, ${r.pct}% hp`;
  for (const r of fightRows(process.argv[2] ?? 'amberfold')) console.log(`${r.id.padEnd(16)} L${r.lvl}${r.boss ? ' boss' : '     '}  arriving: ${f(r.arrive).padEnd(22)} leaving: ${f(r.leave).padEnd(22)} a duo at 14: ${f(r.duo)}`);
}
