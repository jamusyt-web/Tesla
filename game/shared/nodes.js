// Gathering node types: what each kind of tree, rock, herb patch and
// fishing spot is, needs and drops. Placed nodes are in the map (world.js NODES).
// hp: total swing power to break; tier: minimum tool tier; lvl: skill level gate.
import { CONTENT, mergeInto } from './content/index.js';

export const NODE_TYPES = {
  tree_oak: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Oak Tree', hp: 6, tier: 1, lvl: 1, xp: 7, respawn: 18, r: 0.9, drops: [{ id: 'oak_log', min: 2, max: 3 }], rare: [{ id: 'golden_acorn', p: 0.006 }] },
  tree_birch: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Birch Tree', hp: 10, tier: 1, lvl: 4, xp: 15, respawn: 24, r: 0.8, drops: [{ id: 'birch_log', min: 2, max: 3 }], rare: [{ id: 'golden_acorn', p: 0.01 }] },
  tree_pine: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Ancient Pine', hp: 18, tier: 2, lvl: 8, xp: 32, respawn: 40, r: 1.0, drops: [{ id: 'pine_log', min: 2, max: 4 }], rare: [{ id: 'golden_acorn', p: 0.03 }] },
  rock_stone: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Boulder', hp: 5, tier: 1, lvl: 1, xp: 6, respawn: 16, r: 1.0, drops: [{ id: 'stone', min: 2, max: 3 }], rare: [] },
  rock_copper: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Copper Vein', hp: 8, tier: 1, lvl: 2, xp: 11, respawn: 22, r: 1.0, drops: [{ id: 'copper_ore', min: 1, max: 2 }, { id: 'stone', min: 0, max: 1 }], rare: [] },
  rock_iron: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Iron Vein', hp: 14, tier: 2, lvl: 5, xp: 22, respawn: 30, r: 1.1, drops: [{ id: 'iron_ore', min: 1, max: 2 }], rare: [{ id: 'sapphire', p: 0.008 }] },
  rock_gold: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Gold Vein', hp: 22, tier: 3, lvl: 8, xp: 42, respawn: 45, r: 1.2, drops: [{ id: 'gold_ore', min: 1, max: 2 }], rare: [{ id: 'sapphire', p: 0.035 }] },
  herb_mint: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Mint', hp: 1, tier: 0, lvl: 1, xp: 5, respawn: 14, r: 0, drops: [{ id: 'mint_leaf', min: 1, max: 2 }], rare: [] },
  herb_sun: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Sunpetal', hp: 1, tier: 0, lvl: 3, xp: 10, respawn: 20, r: 0, drops: [{ id: 'sunpetal', min: 1, max: 2 }], rare: [] },
  herb_moon: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Moonbloom', hp: 1, tier: 0, lvl: 7, xp: 22, respawn: 32, r: 0, drops: [{ id: 'moonbloom', min: 1, max: 1 }], rare: [] },
  fish_spot: { kind: 'fish', tool: 'rod', skill: 'fishing', name: 'Fishing Spot', hp: 1, tier: 1, lvl: 1, xp: 9, respawn: 6, r: 0, drops: [], rare: [] },
};
mergeInto(NODE_TYPES, CONTENT.nodes, 'nodes');
