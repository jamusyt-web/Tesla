// Amberfold's gathering nodes (SPEC §4.3). Each needs skill 12 and (for
// trees and rocks) a gold tool: tier 4 finally gates something.
export default {
  tree_maple: { kind: 'tree', tool: 'axe', skill: 'foraging', name: 'Amber Maple', hp: 30, tier: 4, lvl: 12, xp: 44, respawn: 45, r: 1.0, drops: [{ id: 'maple_log', min: 2, max: 3 }], rare: [{ id: 'amber_sap', p: 0.04 }] },
  rock_coal: { kind: 'rock', tool: 'pick', skill: 'mining', name: 'Coal Seam', hp: 32, tier: 4, lvl: 12, xp: 50, respawn: 45, r: 1.1, crystal: '#2b2b2b', drops: [{ id: 'coal', min: 1, max: 3 }], rare: [{ id: 'sapphire', p: 0.02 }] },
  herb_hearthcap: { kind: 'herb', tool: null, skill: 'herbalism', name: 'Hearthcap', hp: 1, tier: 0, lvl: 12, xp: 30, respawn: 35, r: 0, drops: [{ id: 'hearthcap', min: 1, max: 2 }], rare: [] },
};
