// The Almanac (SPEC §5.4): each hero's dailies, the weekly Grand Errand and
// the "Today" strip. Dailies are quests made for one hero; their whole
// definition is packed into the quest id, so both sides can rebuild one
// from its id alone (questDef in shared/quests.js):
//   alm:<column>:<ev>:<key>=<value>:<n>:<tier>:<skill>:<material>:<salt>
//   err:<tier>:<towns>:<ev>~<key>=<value>~<n>;...      (the weekly, 5 steps)
import { ITEMS } from './items.js';
import { MONSTERS } from './monsters.js';
import { NODE_TYPES } from './nodes.js';
import { RECIPES } from './recipes.js';
import { STATIONS } from './crafting.js';
import { DUNGEONS, MODIFIERS, modifierFor, featuredKind, nightmareKind } from './dungeon.js';
import { FISH } from './fishing.js';
import { addGenerator } from './quests.js';
import { plural } from './orders.js';

export const COLUMNS = ['make', 'venture', 'wander'];
export const MAX_OPEN = 6; // dailies: today's 3 plus up to 3 carried over
export const MAX_WEEKLY = 2; // this week's errand plus one banked
export const DAILY_GOLD = 40; // × tier
export const DAILY_XP = 100; // × tier
export const ERRAND_GOLD = 300; // × tier
export const ERRAND_REP = 200; // split across the errand's towns

const nodeFor = (item) => Object.entries(NODE_TYPES).find(([, n]) => n.drops?.[0]?.id === item)?.[0] ?? null;
const recipeFor = (item) => RECIPES.find((r) => r.out === item) ?? null;

// One step from its parts: { ev, match, n, text, target }.
export function stepFrom(ev, k, v, n) {
  const match = k && k !== '-' ? { [k]: v } : {};
  n = Math.max(1, Number(n) || 1);
  const name = (id) => ITEMS[id]?.name ?? id;
  switch (ev) {
    case 'gather':
      return { ev, match, n, text: `Gather ${n}× ${name(v)}`, target: { kind: 'node', type: nodeFor(v) } };
    case 'craft': {
      const r = recipeFor(v);
      return { ev, match, n, text: `Make ${n}× ${name(v)}`, hint: r ? `At the ${STATIONS[r.station]?.label ?? r.station}.` : '', target: { kind: 'station', station: r?.station } };
    }
    case 'kill':
      return { ev, match, n, text: `Defeat ${n} ${plural(MONSTERS[v]?.name ?? v, n)}`, target: { kind: 'monster', type: v } };
    case 'dungeon':
      return { ev, match, n, text: `Clear ${DUNGEONS[v]?.name ?? 'a dungeon'}`, target: { kind: 'entrance', dungeon: v } };
    case 'fish':
      return { ev, match, n, text: v && FISH[v] ? `Catch ${n}× ${name(v)}` : `Land ${n} fish`, target: { kind: 'lake' } };
    case 'order':
      return { ev, match, n, text: n > 1 ? `Fill ${n} orders on the Order Board` : 'Fill an order on the Order Board', target: { kind: 'board' } };
    case 'landmark':
      return { ev, match, n, text: { shrine: 'Pray at a shrine', vista: 'Take in a view', cache: 'Open a cache', ruin: 'Read a ruin' }[v] ?? 'Visit a landmark', target: { kind: 'landmark', lk: v } };
    case 'sell':
      return { ev, match, n, text: `Sell ${n} goods to a merchant`, target: { kind: 'building', action: 'market' } };
    case 'deliver':
      return { ev, match, n, text: 'Deliver a job from the bulletin board', target: { kind: 'board' } };
    default:
      return { ev, match, n, text: `Do it ${n} times`, target: { kind: 'explore' } };
  }
}

const SKILL_OF = { gather: null, craft: 'crafting', kill: 'combat', dungeon: 'combat', fish: 'fishing' };
export const skillFor = (ev, v) => (ev === 'gather' ? NODE_TYPES[nodeFor(v)]?.skill : SKILL_OF[ev]) ?? null;

// A daily, rebuilt from its id.
function daily(id) {
  const p = id.split(':');
  if (p[0] !== 'alm' || p.length < 9) return null;
  const [, col, ev, kv, n, tier, skill, mat] = p;
  const [k, v] = kv.split('=');
  const T = Math.max(1, Number(tier) || 1);
  const reward = { gold: DAILY_GOLD * T };
  if (skill && skill !== '-') reward.xp = { [skill]: DAILY_XP * T };
  if (mat && ITEMS[mat]) reward.items = { [mat]: 1 };
  return { id, title: { make: 'Make', venture: 'Venture', wander: 'Wander' }[col] ?? 'Daily', col, repeat: 'daily', tier: T, steps: [stepFrom(ev, k, v, n)], reward };
}
// The weekly Grand Errand, rebuilt from its id.
function errand(id) {
  const p = id.split(':');
  if (p[0] !== 'err' || p.length < 4) return null;
  const T = Math.max(1, Number(p[1]) || 1);
  const towns = p[2].split(',').filter(Boolean);
  const steps = p
    .slice(3)
    .join(':')
    .split(';')
    .map((s) => {
      const [ev, kv, n] = s.split('~');
      const [k, v] = (kv ?? '-').split('=');
      return stepFrom(ev, k, v, n);
    });
  const rep = {};
  for (const t of towns) rep[t] = Math.round(ERRAND_REP / towns.length);
  return { id, title: 'The Grand Errand', repeat: 'weekly', tier: T, steps, reward: { gold: ERRAND_GOLD * T, rep, items: { [`trophy_${towns[0] ?? 'hearthvale'}`]: 1 } } };
}
addGenerator((id) => (id.startsWith('alm:') ? daily(id) : id.startsWith('err:') ? errand(id) : null));

export const dailyId = (col, ev, k, v, n, tier, skill, mat, salt) => ['alm', col, ev, `${k ?? '-'}=${v ?? ''}`, n, tier, skill ?? '-', mat ?? '-', salt].join(':');
export const errandId = (tier, towns, steps) => ['err', tier, towns.join(','), steps.map((s) => `${s.ev}~${s.k ?? '-'}=${s.v ?? ''}~${s.n}`).join(';')].join(':');

// The Today strip: the day's twist, the featured dungeon, the week's
// Nightmare. (Elite windows and Market Day join in Phase 5.)
export function todayStrip(now = Date.now()) {
  const mod = modifierFor(now);
  const feat = featuredKind(now);
  const nm = nightmareKind(now);
  return {
    twist: { id: mod, name: MODIFIERS[mod].name, text: MODIFIERS[mod].text },
    featured: { kind: feat, name: DUNGEONS[feat]?.name ?? feat },
    nightmare: { kind: nm, name: DUNGEONS[nm]?.name ?? nm },
    legends: Object.entries(FISH)
      .filter(([, f]) => f.legend)
      .map(([id, f]) => ({ id, name: ITEMS[id]?.name ?? id, rod: f.legend.rod, window: f.legend.window ?? null })),
  };
}
