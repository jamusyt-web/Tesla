// How many distinct materials (by name + texture use) the props of each chunk use:
// the draw-call floor if a chunk's static props were merged by material.
import fs from 'node:fs';
import path from 'node:path';
const GAME = '/home/user/Tesla/game';
const { MODELS } = await import(path.join(GAME, 'client/src/scene/manifest/index.js'));
const map = JSON.parse(fs.readFileSync(path.join(GAME, 'maps/world.json'), 'utf8'));
const mats = new Map();
const matsOf = (url) => {
  if (mats.has(url)) return mats.get(url);
  const b = fs.readFileSync(path.join(GAME, 'client/public', url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  const out = new Set();
  for (const m of j.meshes) for (const p of m.primitives) {
    const mt = j.materials?.[p.material];
    const tex = mt?.pbrMetallicRoughness?.baseColorTexture ? 'T' : '';
    out.add((mt?.name ?? 'default') + tex + (tex ? ':' + url.split('/')[2] : ':' + JSON.stringify(mt?.pbrMetallicRoughness?.baseColorFactor ?? [])));
  }
  mats.set(url, out);
  return out;
};
const C = 96, chunks = new Map();
for (const p of map.props) {
  if (p.slot.startsWith('proc_') || p.bob || !MODELS[p.slot]) continue;
  const k = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`;
  const urls = [].concat(MODELS[p.slot].url);
  const set = chunks.get(k) ?? chunks.set(k, new Set()).get(k);
  for (const m of matsOf(urls[(p.v || 0) % urls.length])) set.add(m + (MODELS[p.slot].recolor || MODELS[p.slot].remap ? '|' + p.slot : ''));
}
for (const [k, s] of [...chunks].sort()) if (s.size > 6) console.log(k, 'distinct materials', s.size);
