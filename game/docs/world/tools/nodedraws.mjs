// Estimate standing-node draw calls (NodeView, not instanced) for the shipped map.
import fs from 'node:fs';
import path from 'node:path';
const GAME = '/home/user/Tesla/game';
const { MODELS } = await import(path.join(GAME, 'client/src/scene/manifest.js'));
const map = JSON.parse(fs.readFileSync(path.join(GAME, 'maps/world.json'), 'utf8'));
const prim = (url) => {
  const b = fs.readFileSync(path.join(GAME, 'client/public', url));
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  let n = 0;
  const walk = (ni) => { const nd = j.nodes[ni]; if (nd.mesh != null) n += j.meshes[nd.mesh].primitives.length; for (const c of nd.children ?? []) walk(c); };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r);
  return n;
};
const hash = (str) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
let total = 0, shadow = 0; const by = {};
for (const n of map.nodes) {
  const def = MODELS[n.type];
  let d = 0, s = 0;
  if (!def) { d = 3; } else {
    const urls = [].concat(def.url);
    const p = prim(urls[Math.abs(hash(n.id)) % urls.length]);
    const ol = def.outline !== false ? 2 : 1;
    d = p * ol; s = p;
    if (['rock_copper', 'rock_iron', 'rock_gold'].includes(n.type)) { d += 6; s += 6; }
  }
  total += d; shadow += s; by[n.type] = (by[n.type] || 0) + d;
}
console.log('nodes', map.nodes.length, 'colour draws', total, 'shadow draws', shadow, by);
