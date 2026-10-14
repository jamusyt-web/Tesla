// The living wilds (SPEC §4.3, extended): what a gathering node can be.
// Besides the clock's rich and ancient nodes (server/nodestates.js), every
// tree, rock and herb rolls a variant each time it regrows, so a better one
// can turn up anywhere: a Sturdy Oak, an Elder Maple, once in a long while a
// Golden one. Pure rules, shared by the server (loot) and the client (looks
// and names).
//
// A node's state `st` (sent as { t: 'nst', id, st } and in snapshots):
//   0 plain · 1 rich · 2 ancient (the clock's) · 3 big · 4 elder · 5 golden (rolled)
import { NODE_TYPES } from './nodes.js';

export const ST = { plain: 0, rich: 1, ancient: 2, big: 3, elder: 4, golden: 5 };

// What each state does to a node. gate: skill levels on top of the node's;
// yield, xp, rare: multipliers; hp: how much more work it takes; sureRare: one
// rare drop guaranteed; keepsake: the golden's own find; scale: how big it
// looks; glow: its colour (null: none).
export const STATE_FX = {
  0: { gate: 0, yield: 1, xp: 1, rare: 1, hp: 1, sureRare: false, scale: 1, glow: null },
  1: { gate: 8, yield: 3, xp: 2.5, rare: 3, hp: 1, sureRare: false, scale: 1, glow: '#ffc83a' },
  2: { gate: 16, yield: 5, xp: 6, rare: 1, hp: 1, sureRare: true, scale: 1, glow: '#a46bff' },
  3: { gate: 0, yield: 1.5, xp: 1.5, rare: 1, hp: 1.5, sureRare: false, scale: 1.25, glow: null },
  4: { gate: 0, yield: 2.5, xp: 2, rare: 2, hp: 2, sureRare: false, scale: 1.45, glow: '#7fd36a' },
  5: { gate: 0, yield: 3, xp: 3, rare: 1, hp: 2, sureRare: true, scale: 1.35, glow: '#ffd84a', keepsake: true },
};
export const fxOf = (st) => STATE_FX[st] ?? STATE_FX[0];

// The odds a regrowing node comes back as each variant (the rest stay plain).
export const ODDS = { [ST.big]: 0.08, [ST.elder]: 0.012, [ST.golden]: 0.0015 };
const KINDS = new Set(['tree', 'rock', 'herb']);

// Roll a variant for a node of `type` (rng: () => [0, 1)).
export function rollVariant(type, rng = Math.random) {
  if (!KINDS.has(NODE_TYPES[type]?.kind)) return ST.plain;
  let x = rng();
  for (const st of [ST.golden, ST.elder, ST.big]) {
    if (x < ODDS[st]) return st;
    x -= ODDS[st];
  }
  return ST.plain;
}

// Words for each state, by node kind ("Sturdy Oak Tree", "Glittering Iron Vein").
const WORDS = {
  tree: { 1: 'Rich', 2: 'Ancient', 3: 'Sturdy', 4: 'Elder', 5: 'Golden' },
  rock: { 1: 'Rich', 2: 'Ancient', 3: 'Hefty', 4: 'Deep-seamed', 5: 'Glittering' },
  herb: { 1: 'Rich', 2: 'Ancient', 3: 'Blooming', 4: 'Wild', 5: 'Moonlit' },
};
export const stateWord = (type, st) => WORDS[NODE_TYPES[type]?.kind]?.[st] ?? '';
export const variantName = (type, st) => {
  const name = NODE_TYPES[type]?.name ?? type;
  return st ? `${stateWord(type, st)} ${name}` : name;
};

// What a golden node gives besides its goods: one keepsake by kind.
export const KEEPSAKE = { tree: 'golden_seed', rock: 'geode_heart', herb: 'moonlit_petal' };
export const keepsakeOf = (type) => KEEPSAKE[NODE_TYPES[type]?.kind] ?? null;

// A node's hp in a state.
export const hpOf = (type, st) => Math.max(1, Math.round((NODE_TYPES[type]?.hp ?? 1) * fxOf(st).hp));
// A yield in a state (whole goods).
export const yieldOf = (q, st) => Math.round(q * fxOf(st).yield);
