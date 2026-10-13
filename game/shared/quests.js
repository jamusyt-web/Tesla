// Quests (SPEC §5.2): the data and the rules both sides share. The server
// (server/quests.js) advances them from game events and pays the rewards;
// the client only shows them.
//
// QUESTS[id] = { id, town, title, requires: [questId], after?: [questId, step],
//   min?: { combat?, hero?, skills? }, repeat: null | 'daily' | 'weekly',
//   give?: { item: n },                          // handed over when it starts (letters)
//   steps: [{ ev, match, n, text, hint, target, reward? }],
//   reward: { gold, items?, xp?: { skill: n }, rep?: { town: n }, title? } }
//
// A step's event (ev) is one the game raises (server/events.js): gather fish
// kill craft stock sell trade deliver travel attune discover landmark dungeon
// order big passage use. `match` narrows it; `n` is how many it takes.
// `target` tells the Compass where to point:
//   { kind: 'node'|'monster'|'building'|'station'|'stone'|'entrance'|'landmark'|'lake'|'board'|'town', ... }
import { ITEMS } from './items.js';
import { levelFromXp as skillLevel } from './skills.js';
import { CONTENT } from './content/index.js';
import HEARTHVALE from './content/hearthvale/quests.js';

export const QUESTS = {};
export function addQuests(list) {
  for (const q of list) {
    if (QUESTS[q.id]) throw new Error(`Quest "${q.id}" is defined twice.`);
    QUESTS[q.id] = q;
  }
}
addQuests(HEARTHVALE);
addQuests(CONTENT.quests ?? []);

// A quest by id; generated ones (the Almanac's dailies) are rebuilt from their id.
const GENERATORS = [];
export const addGenerator = (fn) => GENERATORS.push(fn);
export function questDef(id) {
  if (QUESTS[id]) return QUESTS[id];
  for (const g of GENERATORS) {
    const q = g(id);
    if (q) return q;
  }
  return null;
}

const GRADES = ['D', 'C', 'B', 'A', 'S'];
const gradeAtLeast = (g, min) => g != null && GRADES.indexOf(g) >= GRADES.indexOf(min);
// The item an event is about (a craft's base recipe output, not its quality copy).
const itemOf = (d) => d.out ?? d.item;

// Does event data `d` fit a step's `match`? ctx adds where it happened
// ({ town, region }) for steps that care.
export function matches(match = {}, ev, d, ctx = {}) {
  for (const [k, v] of Object.entries(match)) {
    if (k === 'item') {
      if (ev === 'gather' ? !(d.loot?.[v] > 0) : itemOf(d) !== v) return false;
    } else if (k === 'tag') {
      if (ev === 'gather' ? !Object.keys(d.loot ?? {}).some((i) => ITEMS[i]?.tag === v) : ITEMS[itemOf(d)]?.tag !== v) return false;
    } else if (k === 'minGrade') {
      if (!gradeAtLeast(d.grade, v)) return false;
    } else if (k === 'tier') {
      if (!(d.tier >= v)) return false;
    } else if (k === 'legend') {
      if (!!d.legend !== !!v) return false;
    } else if (k === 'town' || k === 'region') {
      if ((d[k] ?? ctx[k]) !== v) return false;
    } else if (d[k] !== v) return false;
  }
  return true;
}

// How much an event moves a step on: 0 when it doesn't fit; the number of
// goods for gathering, crafting and trading; else 1.
export function stepGain(step, ev, d, ctx = {}) {
  if (step.ev !== ev || !matches(step.match, ev, d, ctx)) return 0;
  const m = step.match ?? {};
  if (ev === 'gather') {
    if (m.item) return d.loot[m.item];
    if (m.tag) return Object.entries(d.loot ?? {}).reduce((a, [i, n]) => a + (ITEMS[i]?.tag === m.tag ? n : 0), 0);
    return 1;
  }
  if (['craft', 'sell', 'trade', 'deliver', 'stock', 'big'].includes(ev)) return Math.max(1, d.qty | 0);
  return 1;
}

// The step a hero is on, and its numbers.
export const stepOf = (def, row) => def?.steps[row.step] ?? null;
export const stepNeed = (step) => step?.n ?? 1;

// Can this hero start the quest? (done: Set of finished quest ids; at: the
// step each active quest is on.)
export function canStart(def, hero, done, at = {}) {
  if (!def || def.repeat) return false;
  if ((def.requires ?? []).some((q) => !done.has(q))) return false;
  if (def.after) {
    const [q, step] = def.after;
    if (!done.has(q) && !((at[q] ?? -1) >= step)) return false;
  }
  return meetsMin(def.min, hero);
}
export function meetsMin(min, hero) {
  if (!min) return true;
  const lvl = (s) => skillLevel(hero.skills?.[s] || 0);
  if (min.combat && lvl('combat') < min.combat) return false;
  if (min.hero && (hero.level ?? 1) < min.hero) return false;
  for (const [s, n] of Object.entries(min.skills ?? {})) if (lvl(s) < n) return false;
  return true;
}

// One line for the reward, for the card and the toast.
export function rewardText(r = {}) {
  const parts = [];
  if (r.gold) parts.push(`${r.gold} g`);
  for (const [id, n] of Object.entries(r.items ?? {})) parts.push(`${n > 1 ? `${n}× ` : ''}${ITEMS[id]?.name ?? id}`);
  for (const [s, n] of Object.entries(r.xp ?? {})) parts.push(`${n} ${s[0].toUpperCase() + s.slice(1)} xp`);
  for (const [t, n] of Object.entries(r.rep ?? {})) parts.push(`${n} rep`);
  if (r.title) parts.push(`title "${r.title}"`);
  return parts.join(', ');
}
