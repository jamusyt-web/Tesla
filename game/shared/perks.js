// What a hero's gear, sets, charm, skill milestones, level-40 choices and
// buffs do, as one table of effects (SPEC §4.1, §4.8). The server's battle,
// gathering, fishing and crafting code read it; nothing else decides.
//
// effectsOf(hero) → { name: amount }. Amounts add up; a missing name is 0.
// Flags are 1. Percentages are fractions (0.08 = +8%).
import { ITEMS, WORN } from './items.js';
import { levelFromXp } from './skills.js';
import { setBonuses } from './sets.js';
import { activeBuffs } from './buffs.js';

// Gear and set perks, by name.
export const PERKS = {
  quickSpecial: { quickSpecial: 1 }, // the special charges in 2, not 3
  mender: { mender: 0.4 }, // healing items heal 40% more
  thornguard: { thornguard: 0.15 }, // reflect 15% of damage taken
  frostbite: { frostbite: 0.2 }, // your special cuts the target's atk 20% for 2 rounds
  sunfire: { critChance: 0.08 }, // crit chance 12% → 20%
  starlit: { starlit: 0.08 }, // your party gets +8% atk while you stand
  regenOut: { regenOut: 2 }, // out-of-battle regen 4 → 6 hp/s
  forestXp: { forestXp: 0.1 }, // +10% gathering xp in forests
  auraDef: { auraDef: 0.05 }, // party +5% def
  critHeal: { critHeal: 0.05 }, // a crit heals you 5% of max hp
  fastSpecial: { fastSpecial: 1 }, // specials need 1 fewer charge (never below 2)
};

// Skill milestones that work on the server (the rest are client hints).
export const MILESTONES = {
  foraging: { 15: { sapTap: 0.05 }, 20: { perfectTree: 0.08 }, 35: { auraRegrowTree: 0.2 } },
  mining: { 20: { perfectRock: 0.08 }, 25: { sunstoneX2: 1 }, 35: { auraRegrowRock: 0.2 } },
  herbalism: { 15: { bloom: 0.1 }, 20: { gentleHands: 0.1 }, 25: { rareHerb: 0.5 }, 35: { auraRegrowHerb: 0.2 } },
  fishing: { 10: { biteWindow: 100 }, 15: { recordSkew: 0.05 }, 25: { nightAngler: 0.3 }, 35: { fishFry: 0.1 } },
  combat: { 15: { secondStance: 1 }, 20: { rally: 0.05 }, 30: { mentor: 0.2 }, 35: { guardian: 0.3 } },
  crafting: { 5: { steadyHands: 1 }, 10: { salvage: 1 }, 15: { batchCap: 5 }, 30: { quickFee: 0.02 }, 35: { apprentice: 1 } },
};

// The level-40 choice in each skill (hero.perks[skill] = 'a' | 'b'); at 50 you get both.
export const PICKS = {
  foraging: { a: { name: 'Lumberjack', text: 'Axe power +1', fx: { treePower: 1 } }, b: { name: 'Woodwright', text: '25% chance of +1 plank', fx: { bonusPlank: 0.25 } } },
  mining: { a: { name: 'Prospector', text: 'Pickaxe power +1', fx: { rockPower: 1 } }, b: { name: 'Smelter', text: '25% chance of +1 bar', fx: { bonusBar: 0.25 } } },
  herbalism: { a: { name: 'Gatherer', text: '+15% double herbs', fx: { doubleHerb: 0.15 } }, b: { name: 'Alchemist', text: '25% chance of +1 potion or meal', fx: { bonusConsumable: 0.25 } } },
  fishing: { a: { name: 'Angler', text: '+20% rare weight', fx: { rareWeight: 0.2 } }, b: { name: 'Trophy', text: '+25% kg', fx: { kgSkew: 0.25 } } },
  combat: { a: { name: 'Vanguard', text: '+6% attack', fx: { atkPct: 0.06 } }, b: { name: 'Warden', text: '+6% defence and hp', fx: { defHpPct: 0.06 } } },
  crafting: { a: { name: 'Smith', text: 'Perfect windows +1 tick', fx: { perfectTick: 1 } }, b: { name: 'Artisan', text: '+4% Masterwork', fx: { masterworkPct: 0.04 } } },
};
export const PICK_LVL = 40;

// All the effects on a hero right now.
export function effectsOf(hero, now = Date.now()) {
  const E = {};
  const add = (fx) => {
    for (const [k, v] of Object.entries(fx ?? {})) if (typeof v === 'number') E[k] = (E[k] ?? 0) + v;
  };
  const equip = hero?.equip ?? {};
  for (const s of WORN) {
    const it = ITEMS[equip[s]];
    if (!it) continue;
    if (it.perk) add(PERKS[it.perk] ?? { [it.perk]: 1 });
    add(it.fx); // a charm's effect
  }
  for (const b of setBonuses(equip)) {
    if (b.hp) add({ setHp: b.hp });
    if (b.perk) add(PERKS[b.perk] ?? { [b.perk]: 1 });
  }
  for (const [skill, by] of Object.entries(MILESTONES)) {
    const lvl = levelFromXp(hero?.skills?.[skill] || 0);
    for (const [L, fx] of Object.entries(by)) if (lvl >= Number(L)) add(fx);
    const pick = hero?.perks?.[skill];
    if (lvl >= 50) for (const p of Object.values(PICKS[skill])) add(p.fx);
    else if (lvl >= PICK_LVL && PICKS[skill][pick]) add(PICKS[skill][pick].fx);
  }
  for (const b of Object.values(activeBuffs(hero?.buffs, now))) add(b.fx);
  return E;
}

// The gear perk names in force (gear and sets), for older callers.
export const perkNames = (E) => new Set(Object.keys(PERKS).filter((p) => Object.keys(PERKS[p]).every((k) => (E[k] ?? 0) > 0)));
