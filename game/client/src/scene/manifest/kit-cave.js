// The cave dungeon kit (SPEC §4.7): Kenney's Modular Cave Kit in its own
// red-brown, for the Thornroot Warren (and later caves). Its template-*
// pieces match the crypt kit's sizes, so the same layout code builds both.
// The room-* and corridor-wide* prefabs are not used (too heavy).
// Group 'kit:cave': loads when a cave run starts.
const CAVE = (f) => `/models/cave/${f}.glb`;
const NK = (f) => `/models/nature-kit/${f}.glb`;
const GLOW = (color, glow = 0.35) => ({ tint: { color: '#ffffff', amount: 0, emissive: color, glow } });

const piece = (n, extra = {}) => ({ url: CAVE(n), raw: true, ...extra });
export const MODELS = {
  'cave:template-floor': piece('template-floor', { outline: false }),
  'cave:template-floor-detail': piece('template-floor-detail', { outline: false }),
  'cave:template-floor-detail-a': piece('template-floor-detail-a', { outline: false }),
  'cave:template-wall': piece('template-wall', { outline: false }),
  'cave:template-wall-detail-a': piece('template-wall-detail-a', { outline: false }),
  'cave:template-wall-corner': piece('template-wall-corner', { outline: false }),
  'cave:gate': piece('gate'),
  'cave:gate-metal-bars': piece('gate-metal-bars'),
  'cave:gate-rock': piece('gate-rock'),
  // The Warren's dressing, in place of the crypt's (DUNGEONS.thornroot_warren.dressing).
  wr_log: { url: [NK('log_large'), NK('log')], width: 2.2, recolor: { woodBark: '#6a4a2a' } },
  wr_stump: { url: [NK('stump_oldTall'), NK('stump_old')], height: 1.1, recolor: { woodBark: '#5a3a24' } },
  wr_mushroom: { url: [NK('mushroom_tanGroup'), NK('mushroom_redGroup')], height: 0.9, ...GLOW('#ffb84a', 0.3) },
  wr_glowcap: { url: [NK('mushroom_tanTall'), NK('mushroom_redTall')], height: 0.6, ...GLOW('#ffd27a', 0.5) },
  // The way out of a cave: the cave's own rock arch.
  'cave:stairs': { url: '/models/modular-dungeon/stairs.glb', raw: true, remap: [{ band: 'metal', to: '#8a5a42', ref: 0.5 }], outline: false },
};
