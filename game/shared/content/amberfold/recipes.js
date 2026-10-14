// Amberfold's recipes (SPEC §4.6). Some need goods from Hearthvale (iron
// bars, gold bars, sunpetals, golden acorns), so the road gets walked both
// ways. `town` recipes are made only in Amberfold's yard; set pieces also
// need Neighbour standing there (rep 2). The Smokehouse is Amberfold's own.
const T = 'amberfold';
const R = (id, inp, lvl, xp, station, pattern, more = {}) => ({ id, out: id, qty: 1, in: inp, lvl, xp, station, pattern, ...more });

export default [
  R('maple_plank', { maple_log: 2 }, 12, 30, 'workbench', 'saw'),
  R('steel_bar', { iron_bar: 1, coal: 2, maple_log: 1 }, 12, 45, 'forge', 'smelt'),
  R('carp_chowder', { rivercarp: 2, hearthcap: 1 }, 12, 40, 'cookpot', 'stew'),
  R('climbing_rope', { leather: 3, maple_plank: 2 }, 12, 120, 'workbench', 'stitch'),
  R('maple_glazed_carp', { amber_trout: 1, maple_log: 1, honeycomb: 1 }, 13, 55, 'smokehouse', 'grill'),
  R('venison_skewer', { venison: 2, hearthcap: 1 }, 13, 55, 'smokehouse', 'grill'),
  R('hearthcap_pie', { hearthcap: 2, venison: 1, sunpetal: 1 }, 14, 60, 'smokehouse', 'stew'),
  R('rod_amber', { maple_plank: 3, steel_bar: 1, amber_trout: 2 }, 13, 250, 'workbench', 'assemble'),
  R('axe_steel', { steel_bar: 4, maple_plank: 2 }, 14, 300, 'anvil', 'forge_tool'),
  R('pick_steel', { steel_bar: 4, maple_plank: 2, gold_bar: 1 }, 14, 300, 'anvil', 'forge_tool'),
  R('steel_saber', { steel_bar: 5, leather: 2, antler: 1 }, 15, 350, 'anvil', 'forge_blade'),
  R('charm_forager_1', { maple_plank: 2, amber_sap: 1, golden_acorn: 1 }, 15, 300, 'workbench', 'assemble', { town: T }),
  R('steel_brigandine', { steel_bar: 5, leather: 3 }, 16, 380, 'anvil', 'forge_plate'),
  R('amber_pendant', { gold_bar: 2, amber_sap: 1, honeycomb: 2 }, 17, 400, 'grindstone', 'facet'),
  R('charm_forager_2', { charm_forager_1: 1, elder_antler: 1, amber_sap: 2 }, 17, 500, 'workbench', 'assemble', { town: T, rep: 2 }),
  // The Thornroot set.
  R('thornwood_blade', { heartwood_sap: 8, steel_bar: 3, elder_antler: 1 }, 16, 420, 'anvil', 'forge_blade', { town: T, rep: 2 }),
  R('thornroot_jerkin', { heartwood_sap: 8, leather: 3, steel_bar: 2 }, 16, 420, 'workbench', 'stitch', { town: T, rep: 2 }),
  R('heartwood_amulet', { heartwood_sap: 8, amber_sap: 1, gold_bar: 1 }, 16, 420, 'grindstone', 'facet', { town: T, rep: 2 }),
];
