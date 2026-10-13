// Checks the model manifest: every slot belongs to exactly one group, and
// every model and texture file it names exists in client/public.
// `node scripts/check-manifest.mjs` prints problems and exits 1 if there are any.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, GROUPS, TEXTURES } from '../client/src/scene/manifest/index.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/public');

export function checkManifest() {
  const problems = [];
  const seen = new Map();
  for (const [id, slots] of Object.entries(GROUPS))
    for (const s of slots) {
      if (seen.has(s)) problems.push(`slot ${s} is in groups ${seen.get(s)} and ${id}`);
      seen.set(s, id);
    }
  const exists = (u) => fs.existsSync(path.join(PUBLIC, u.split('?')[0]));
  for (const [slot, def] of Object.entries(MODELS)) {
    if (!seen.has(slot)) problems.push(`slot ${slot} is in no group`);
    for (const u of [].concat(def.url)) if (!exists(u)) problems.push(`slot ${slot}: missing ${u}`);
    if (def.texture && !exists(def.texture)) problems.push(`slot ${slot}: missing texture ${def.texture}`);
  }
  for (const [pack, list] of Object.entries(TEXTURES)) for (const u of Object.values(list)) if (!exists(u)) problems.push(`${pack} palette: missing ${u}`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = checkManifest();
  for (const line of p) console.log(line);
  console.log(p.length ? `${p.length} problem(s)` : `manifest ok: ${Object.keys(MODELS).length} slots in ${Object.keys(GROUPS).length} groups`);
  process.exit(p.length ? 1 : 0);
}
