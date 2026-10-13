// Skill milestones (SPEC §4.8): what each skill level unlocks, for the
// level-up popup and the skills panel. Part of it is a table (the perks in
// shared/perks.js MILESTONES, plus titles and the level-40 choice); the rest
// is worked out from the content: nodes you can now gather, recipes you can
// now make, waters you can now fish, dungeon tiers now in reach, passages.
// Kinds: P passage or place, Q quality of life, S small side-grade, C cosmetic.
import { NODE_TYPES } from './nodes.js';
import { RECIPES } from './recipes.js';
import { ITEMS } from './items.js';
import { FISH_TABLES } from './fishing.js';
import { DUNGEONS, recFor, TIERS } from './dungeon.js';
import { PASSAGES } from './world.js';
import { PICKS, PICK_LVL, MILESTONES as FX } from './perks.js';
import { SKILLS } from './skills.js';

// The words for every milestone the game applies (keys match perks.js MILESTONES).
export const MILESTONE_TEXT = {
  foraging: { 15: ['S', 'Sap tap: maples and frostpines sometimes drop Amber Sap'], 20: ['S', 'Wider PERFECT window on trees'], 35: ['S', 'Grove Keeper: trees near you regrow 20% faster, for everyone'], 50: ['C', 'Title: Forest Warden, and both level-40 choices'] },
  mining: { 20: ['S', 'Wider PERFECT window on rocks'], 25: ['S', 'Sunstones turn up twice as often'], 35: ['S', 'Stone Keeper: rocks near you regrow 20% faster, for everyone'], 50: ['C', 'Title: Deepdelver, and both level-40 choices'] },
  herbalism: { 15: ['S', 'Bloom: 10% chance of an extra herb'], 20: ['S', 'Gentle hands: 10% of picks leave the herb standing'], 25: ['S', 'Rare herbs ×1.5'], 35: ['S', 'Herb Keeper: herbs near you regrow 20% faster, for everyone'], 50: ['C', 'Title: Green Sage, and both level-40 choices'] },
  fishing: { 10: ['S', 'Bite window +100 ms'], 15: ['S', 'Records: heavier fish a little more often'], 25: ['S', 'Night Angler: better luck after dark'], 30: ['Q', 'Legend Lore: legendary windows in your journal'], 35: ['S', 'Fish Fry: friends within 20 m get +10% fishing xp'], 50: ['C', 'Title: Lake Legend, and both level-40 choices'] },
  combat: { 15: ['S', 'Second Stance: defending charges your special'], 20: ['S', 'Rally: joining a friend’s fight gives you both +5% attack'], 30: ['S', 'Mentor: +20% xp for party members 8+ levels below you'], 35: ['S', 'Guardian: defending shields your lowest-health ally'], 50: ['C', 'Title: Champion of the Hearthlands, and both level-40 choices'] },
  crafting: { 5: ['S', 'Steady Hands: good windows last a tick longer (tiers 1–4)'], 10: ['S', 'Salvage: break gear down for half its bars, at the anvil'], 15: ['Q', 'Batches up to 5 bigger'], 30: ['Q', 'Quick-craft fee 4% → 2%'], 35: ['S', 'Apprentice: friends at your yard get Steady Hands'], 50: ['C', 'Title: Grandmaster, and both level-40 choices'] },
};
export const GRAND_TITLES = { foraging: 'Forest Warden', mining: 'Deepdelver', herbalism: 'Green Sage', fishing: 'Lake Legend', combat: 'Champion of the Hearthlands', crafting: 'Grandmaster' };

// Every unlock at exactly level L of a skill: [{ kind, text, show? }] where
// show is a Compass target ("Show me").
export function unlocksAt(skill, L) {
  const out = [];
  const t = MILESTONE_TEXT[skill]?.[L];
  if (t) out.push({ kind: t[0], text: t[1] });
  if (L === PICK_LVL && PICKS[skill]) out.push({ kind: 'S', text: `Choose: ${PICKS[skill].a.name} (${PICKS[skill].a.text}) or ${PICKS[skill].b.name} (${PICKS[skill].b.text})`, choose: true });
  for (const [type, n] of Object.entries(NODE_TYPES))
    if (n.skill === skill && n.lvl === L && n.kind !== 'fish') out.push({ kind: 'P', text: `${n.name}: you can gather it now`, show: { kind: 'node', type } });
  if (skill === 'crafting')
    for (const r of RECIPES) if (r.lvl === L) out.push({ kind: 'P', text: `Recipe: ${ITEMS[r.out]?.name ?? r.out}`, show: { kind: 'station', station: r.station }, recipe: r.id });
  if (skill === 'fishing')
    for (const [id, tb] of Object.entries(FISH_TABLES)) if (tb.lvl === L && L > 1) out.push({ kind: 'P', text: `New waters open to you (${id})`, show: { kind: 'lake' } });
  if (skill === 'combat')
    for (const [kind, d] of Object.entries(DUNGEONS))
      for (const tier of Object.keys(d.tiers ?? {}).map(Number)) if (recFor(kind, tier) === L) out.push({ kind: 'P', text: `${d.name} at ${TIERS[tier]?.name ?? `Tier ${tier}`} is within reach`, show: { kind: 'entrance', dungeon: kind } });
  for (const p of PASSAGES) if (p.req?.skill === skill && p.req.lvl === L) out.push({ kind: 'P', text: `Passage: ${p.name ?? p.id}`, show: { kind: 'passage', id: p.id } });
  return out;
}

// Everything a skill unlocks from level 2 to 50 (the skills panel's ladder).
export function ladder(skill) {
  const out = [];
  for (let L = 2; L <= 50; L++) {
    const u = unlocksAt(skill, L);
    if (u.length) out.push({ lvl: L, list: u });
  }
  return out;
}

// Every milestone with an effect has words (checked in tests).
export const milestoneKeys = () => Object.fromEntries(Object.entries(FX).map(([s, by]) => [s, Object.keys(by).map(Number)]));
export { SKILLS };
