// Amberfold's monsters (SPEC §4.2): Kenney cube-pets and characters,
// recoloured. Group 'mobs:amberfold': loads with the autumn biome.
const PET = (f) => `/models/cube-pets/${f}.glb`;
const FOR = (f) => `/models/mini-forest/${f}.glb`;
const GRV = (f) => `/models/graveyard-kit/${f}.glb`;

export const MODELS = {
  mob_mossback_hog: { url: PET('animal-hog'), height: 1.25, remap: [{ band: 'warm', to: '#4f5a3a', ref: 0.55 }] },
  mob_hedge_bandit: { url: FOR('character-archer'), height: 1.9, remap: [{ band: 'green', to: '#7a4a2a', ref: 0.5 }] },
  mob_russet_stag: { url: PET('animal-deer'), height: 2.1, remap: [{ band: 'warm', to: '#b5652e', ref: 0.6 }] },
  mob_bramble_bear: { url: PET('animal-polar'), height: 2.3, remap: [{ band: 'white', to: '#7a5236', ref: 0.5 }, { band: 'metal', to: '#5a3a24', ref: 0.4 }] },
  mob_antlered_elder: { url: PET('animal-deer'), height: 3.6, remap: [{ band: 'warm', to: '#5a3a24', ref: 0.45 }] },
  // The Thornroot Warren
  mob_root_thrall: { url: GRV('character-zombie'), height: 1.85, remap: [{ band: 'green', to: '#6f5a35', ref: 0.5 }] },
  mob_warren_hog: { url: PET('animal-hog'), height: 1.3, remap: [{ band: 'warm', to: '#5f4a3a', ref: 0.5 }] },
  mob_thorn_wisp: { url: GRV('character-ghost'), height: 1.6, tint: { color: '#ffd27a', amount: 0.35, emissive: '#d98a1a', glow: 0.35 } },
  mob_mother_thorn: { url: GRV('character-keeper'), height: 2.8, remap: [{ band: 'red', to: '#5f7a3a', ref: 0.5 }, { band: 'green', to: '#4a6a2a', ref: 0.5 }] },
};
