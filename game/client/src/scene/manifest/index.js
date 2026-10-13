// The model manifest, in groups. 'core' (manifest/core.js: everything the
// game uses today) loads at start. A new biome's models come as their own
// group (registerGroup) so a phone only fetches them when it first gets near
// that biome (Phase 1, P3: ensureGroup in assets.js).
import { MODELS as CORE, PALETTES, MODULE_PACKS, TEXTURES } from './core.js';

export { PALETTES, MODULE_PACKS, TEXTURES };

// Every slot of every group, in one table (what assets.js looks slots up in).
export const MODELS = { ...CORE };
// group id → its slots
export const GROUPS = { core: Object.keys(CORE) };

export const groupOf = (slot) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(slot)) ?? null;

// Add a group of slots ({ slot: def }); a slot can belong to one group only.
export function registerGroup(id, models) {
  if (GROUPS[id]) throw new Error(`Model group "${id}" is registered twice.`);
  for (const slot of Object.keys(models)) if (slot in MODELS) throw new Error(`Model slot "${slot}" is in two groups.`);
  Object.assign(MODELS, models);
  GROUPS[id] = Object.keys(models);
}
