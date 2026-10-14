// The model manifest, in groups. 'core' (manifest/core.js, minus what the
// rules below send elsewhere) loads before the first frame; every other group
// loads when it's wanted (assets.ensureGroup): 'kit:crypt' (the dungeon's
// pieces and crypt monsters) and 'mobs:hearthvale' (the Wilds' monsters) right
// after the first frame, a new biome's models when you first get near it.
import { MODELS as CORE, PALETTES, MODULE_PACKS, TEXTURES } from './core.js';
import { MODELS as AUTUMN } from './autumn.js';
import { MODELS as CAVE } from './kit-cave.js';
import { MODELS as MOBS_AMBERFOLD } from './mobs-amberfold.js';

export { PALETTES, MODULE_PACKS, TEXTURES };

// Every slot of every group, in one table (what assets.js looks slots up in).
export const MODELS = { ...CORE };
// Modular building pieces are loaded "raw": no re-centering or resizing,
// because their pivots are what make walls and roofs line up.
for (const [pack, names] of Object.entries(MODULE_PACKS)) for (const n of names) MODELS[`${pack}:${n}`] ??= { url: `/models/${pack}/${n}.glb`, raw: true, outline: !/^(flag|banner|stall|fountain-center|metal-gate)/.test(n) };

// Which group a slot of core.js belongs to. (The brazier by the crypt door in
// town is core; the crypt's own furniture is not.)
const RULES = [
  ['kit:crypt', (s) => /^modular-dungeon:/.test(s) || (/^dg_/.test(s) && s !== 'dg_fire') || /^mob_(crypt_|pale_count)/.test(s)],
  ['mobs:hearthvale', (s) => /^mob_/.test(s)],
];
export const GROUPS = { core: [] };
for (const slot of Object.keys(MODELS)) {
  const id = RULES.find(([, test]) => test(slot))?.[0] ?? 'core';
  (GROUPS[id] ??= []).push(slot);
}

export const groupOf = (slot) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(slot)) ?? null;

// Add a group of slots ({ slot: def }); a slot can belong to one group only.
export function registerGroup(id, models) {
  if (GROUPS[id]) throw new Error(`Model group "${id}" is registered twice.`);
  for (const slot of Object.keys(models)) if (slot in MODELS) throw new Error(`Model slot "${slot}" is in two groups.`);
  Object.assign(MODELS, models);
  GROUPS[id] = Object.keys(models);
}

// Each town's own groups (SPEC §9.3): its biome's scenery and its monsters
// load when you first get near one of its regions; a cave kit when a run
// in one starts.
registerGroup('biome:autumn', AUTUMN);
registerGroup('mobs:amberfold', MOBS_AMBERFOLD);
registerGroup('kit:cave', CAVE);
// The groups a biome brings (game.js loads them as you approach), and the
// group a dungeon kit needs.
export const BIOME_GROUPS = { autumn: ['biome:autumn', 'mobs:amberfold'] };
export const KIT_GROUPS = { 'modular-dungeon': 'kit:crypt', cave: 'kit:cave' };
