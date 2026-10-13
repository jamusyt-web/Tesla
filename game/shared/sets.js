// Dungeon gear sets (SPEC §4.8): wearing 2 or 3 pieces of one set adds a
// bonus. Pieces are items with `set: '<id>'`; the bonuses are stats (hp…)
// or perk names (shared/perks.js). The barrow pieces keep their own perks too.
import { ITEMS, WORN } from './items.js';
import { CONTENT } from './content/index.js';

export const SETS = {
  barrow: { name: 'Barrow', 2: { hp: 30 }, 3: { perk: 'regenOut' } },
  thornroot: { name: 'Thornroot', 2: { perk: 'thornguard' }, 3: { perk: 'forestXp' } },
  rimeward: { name: 'Rimeward', 2: { perk: 'frostbite' }, 3: { perk: 'auraDef' } },
  ashkar: { name: 'Ashkar', 2: { perk: 'sunfire' }, 3: { perk: 'critHeal' } },
  prismsworn: { name: 'Prismsworn', 2: { perk: 'starlit' }, 3: { perk: 'fastSpecial' } },
  ...(CONTENT.sets ?? {}),
};

// How many pieces of each set are worn: { setId: n }.
export function setCounts(equip) {
  const out = {};
  for (const s of WORN) {
    const set = ITEMS[equip?.[s]]?.set;
    if (set) out[set] = (out[set] ?? 0) + 1;
  }
  return out;
}

// The bonuses that apply: [{ set, pieces, hp?, perk? }], 2-piece then 3-piece.
export function setBonuses(equip) {
  const out = [];
  for (const [set, n] of Object.entries(setCounts(equip))) {
    const S = SETS[set];
    if (!S) continue;
    for (const k of [2, 3]) if (n >= k && S[k]) out.push({ set, pieces: k, ...S[k] });
  }
  return out;
}
