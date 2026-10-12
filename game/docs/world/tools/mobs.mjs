import { mobStats } from './fight.mjs';
// [id, name, model recipe, regions, lvl, role, drops]
const M = [
  ['mossback_hog', 'Mossback Hog', 'hog, warm→#4f5a3a', 'westmarch, hollowmere', 11, 'normal', 'leather .6, hearthcap .3'],
  ['hedge_bandit', 'Hedge Bandit', 'archer, green→#7a4a2a', 'westmarch, hollowmere, thornback (charcoal camp)', 13, 'normal', 'goblin_coin .5, bandit_map .05'],
  ['russet_stag', 'Russet Stag', 'deer ×1.4', 'amberwood, thornback S', 12, 'normal', 'venison .8, antler .3'],
  ['bramble_bear', 'Bramble Bear', 'polar, white→#7a5236', 'amberwood', 15, 'normal', 'wolf_pelt .9, honeycomb .4'],
  ['antlered_elder', 'The Antlered Elder', 'deer ×2.4, dark', 'amberwood (−600,−130 glade)', 17, 'boss', 'elder_antler .35, maple_log 2–4 (1.0); telegraph Antler Sweep'],
  ['snow_fox', 'Snow Fox', 'fox, warm→#e8eef2', 'thornback N, rimefells', 16, 'normal', 'snow_fur .8'],
  ['frostbeak', 'Frostbeak', 'penguin, metal→#2c4a6e ref .3', 'rimefells', 18, 'normal', 'ice_char .4, snow_fur .3'],
  ['rime_wisp', 'Rime Wisp', 'ghost, tint #bfe6ff', 'rimefells', 19, 'normal', 'snowbell .5, rime_shard .1'],
  ['frost_raider', 'Frost Raider', 'orc, green→#6a8fb0, spear', 'rimefells', 21, 'normal', 'rimesilver_ore .6, goblin_coin .5'],
  ['old_tusk', 'Old Tusk', 'elephant 3.4 m, metal→#6b4a35', 'rimefells (−440,−600)', 23, 'boss', 'mammoth_ivory .35, snow_fur 2–3 (1.0); telegraph Avalanche'],
  ['moor_ox', 'Moor Ox', 'cow, warm→#8a5a3a', 'midmarch_w, skystair S', 19, 'normal', 'leather .7, coal .3'],
  ['moor_brute', 'Moor Brute', 'orc, spear + shield', 'midmarch_w', 22, 'normal', 'coal .6, goblin_coin .6'],
  ['carrion_crow', 'Carrion Crow', 'parrot→#2b2b33', 'midmarch_e', 24, 'normal', 'black_feather .7'],
  ['saltway_raider', 'Saltway Raider', 'soldier, red→#c9a25a', 'midmarch_e', 26, 'normal', 'salt .8, sunbronze_bar .05'],
  ['dune_wasp', 'Dune Wasp', 'bee, yellow→#c46a2a', 'dunesea', 22, 'normal', 'wasp_honey .6'],
  ['sun_lion', 'Sun Lion', 'lion', 'dunesea', 24, 'normal', 'lion_mane .5, leather .5'],
  ['dust_skeleton', 'Dust Skeleton', 'skeleton, warm→#d8c39a', 'dunesea', 25, 'normal', 'sun_ore .6'],
  ['glass_scorpion', 'Glass Scorpion', 'crab ×1.4, red→#b98b4e', 'dunesea', 26, 'normal', 'glass_shard .7'],
  ['sand_legionnaire', 'Sand Legionnaire', 'soldier (mini-arena)', 'dunesea', 27, 'normal', 'tomb_resin .1, goblin_coin .7'],
  ['brass_colossus', 'The Brass Colossus', 'procedural golem, brass', 'dunesea (680,−540)', 29, 'boss', 'colossus_gear .35, sun_ore 2–4 (1.0); telegraph Sandstorm'],
  ['shard_wisp', 'Shard Wisp', 'ghost, tint #ff7ae0', 'skystair, craterrim', 28, 'normal', 'prism_shard .15, starthistle .4'],
  ['gem_grub', 'Gem Grub', 'caterpillar + emissive', 'craterrim', 29, 'normal', 'prism_shard .25'],
  ['crag_gremlin', 'Crag Gremlin', 'koala, metal→#6d6a5c ref .3', 'skystair, craterrim', 30, 'normal', 'star_ore .5'],
  ['fallen_starguard', 'Fallen Starguard', 'soldier→#7a4fd0', 'craterrim', 32, 'normal', 'starmetal_bar .05, star_dust .1'],
  ['prism_warden', 'The Prism Warden', 'procedural golem + octahedron crust', 'craterrim (−20,−1100)', 36, 'boss', 'warden_core .35, prism_shard 1–2 (1.0); telegraph Prism Beam'],
];
console.log('| id | Name (model → recolour) | Where | L | hp | atk | def | xp | gold | Drops |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [id, n, mod, w, L, role, d] of M) { const s = mobStats(L, role); console.log(`| ${id} | ${n} (${mod}) | ${w} | ${L}${role === 'boss' ? ' boss' : ''} | ${s.hp} | ${s.atk} | ${s.def} | ${s.xp} | ${s.gold[0]}–${s.gold[1]} | ${d} |`); }
// Dungeon pools: base stats at the kind's tier-1 rec level; boss = 'dboss' (hp x2, atk x1.05, def +2, xp x1.5, gold x2.5)
const dboss = (L) => { const b = mobStats(L); return { hp: b.hp * 2, atk: Math.round((2.6 * L + 2) * 1.05), def: L + 2, xp: Math.round(b.xp * 1.5), gold: b.gold.map((g) => Math.round(g * 2.5)) }; };
const D = [
  ['thornroot_warren', [['root_thrall', 13], ['warren_hog', 13], ['thorn_wisp', 14]], ['mother_thorn', 13]],
  ['icefall_mine', [['frost_miner', 19], ['rime_crawler', 19], ['ice_wisp', 20]], ['frozen_foreman', 19]],
  ['ashkar_tomb', [['tomb_scarab', 25], ['sand_mummy', 26], ['tomb_guard', 26]], ['queen_ashkar', 25]],
  ['shard_vault', [['vault_wisp', 32], ['vault_grub', 32], ['starguard_husk', 33]], ['star_eater', 32]],
];
for (const [k, pool, [bid, bl]] of D) {
  console.log(k, pool.map(([id, L]) => { const s = mobStats(L); return `${id} L${L} ${s.hp}/${s.atk}/${s.def} xp${s.xp} g${s.gold.join('-')}`; }).join('; '), `| boss ${bid} L${bl}`, JSON.stringify(dboss(bl)));
}
// Elites: restat via mobStats(L, 'elite'), hp x(1+0.6(n-1)).
for (const [id, L] of [['mossjaw', 13], ['old_bristle', 14], ['hollow_stag', 19], ['frostmaw', 25], ['moor_king', 27], ['captain_vex', 30], ['glasswing', 31], ['starmaw', 38]]) { const s = mobStats(L, 'elite'); console.log(`elite ${id} L${L} hp${s.hp} atk${s.atk} def${s.def} xp${s.xp} gold${s.gold.join('-')}`); }
console.log('nightmare L46', JSON.stringify(mobStats(46)), JSON.stringify(dboss(46)));
