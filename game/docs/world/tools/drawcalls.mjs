// Estimate draw calls per 96 m chunk for the shipped map (read-only analysis).
import fs from 'node:fs';
import path from 'node:path';
const GAME = '/home/user/Tesla/game';
const { MODELS } = await import(path.join(GAME, 'client/src/scene/manifest.js'));
const map = JSON.parse(fs.readFileSync(path.join(GAME, 'maps/world.json'), 'utf8'));
// count mesh primitives in a glb (three.js makes one Mesh per primitive)
const prims = new Map();
function countGlb(url) {
  if (prims.has(url)) return prims.get(url);
  const f = path.join(GAME, 'client/public', url);
  let n = null, tris = 0;
  try {
    const b = fs.readFileSync(f);
    const len = b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
    // walk node tree from scene
    const scene = j.scenes[j.scene ?? 0];
    n = 0;
    const walk = (ni) => { const nd = j.nodes[ni]; if (nd.mesh != null) { const m = j.meshes[nd.mesh]; n += m.primitives.length; for (const p of m.primitives) { const acc = p.indices != null ? j.accessors[p.indices] : j.accessors[p.attributes.POSITION]; tris += acc.count / 3; } } for (const c of nd.children ?? []) walk(c); };
    for (const r of scene.nodes) walk(r);
  } catch (e) { n = null; }
  const out = { n, tris };
  prims.set(url, out);
  return out;
}
const NO_OUTLINE = new Set(['deco_flower', 'deco_grass', 'deco_lily_pad', 'deco_mushroom']);
const NO_SHADOW = new Set(['deco_flower', 'deco_grass', 'deco_lily_pad']);
const CHUNK = 96;
const chunks = new Map();
for (const p of map.props) {
  const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
  (chunks.get(k) ?? chunks.set(k, []).get(k)).push(p);
}
let totalColor = 0, totalShadow = 0, totalTris = 0;
const rows = [];
for (const [k, list] of [...chunks.entries()].sort()) {
  const groups = new Map();
  let proc = 0, procMeshes = 0, bob = 0;
  for (const p of list) {
    if (p.slot.startsWith('proc_')) { proc++; continue; }
    const def = MODELS[p.slot];
    if (!def) continue;
    const urls = [].concat(def.url);
    if (p.bob) { bob++; continue; }
    const v = (p.v || 0) % urls.length;
    const key = p.slot + '|' + v;
    if (!groups.has(key)) groups.set(key, { slot: p.slot, url: urls[v], def, n: 0 });
    groups.get(key).n++;
  }
  let color = 0, shadow = 0, tris = 0;
  for (const g of groups.values()) {
    const c = countGlb(g.url);
    const sub = c.n ?? 1;
    const outline = !NO_OUTLINE.has(g.slot) && g.def.outline !== false;
    color += sub * (outline ? 2 : 1);
    if (!NO_SHADOW.has(g.slot)) shadow += sub;
    tris += c.tris * g.n * (outline ? 2 : 1);
  }
  rows.push({ chunk: k, props: list.length, groups: groups.size, propDraws: color, propShadowDraws: shadow, propTris: Math.round(tris), proc, bob });
  totalColor += color; totalShadow += shadow; totalTris += tris;
}
console.table(rows);
console.log('total prop draws (colour pass)', totalColor, 'shadow', totalShadow, 'tris', Math.round(totalTris));
// sample per-slot primitive counts
const slots = ['deco_tree_round','deco_tree_pine','deco_bush','deco_flower','deco_grass','deco_mushroom','deco_rock_small','deco_log','deco_stump','fence_low','lamp_post','tree_oak','tree_birch','tree_pine','rock_stone','rock_copper'];
for (const s of slots) { const def = MODELS[s]; if (!def) continue; console.log(s, [].concat(def.url).map((u) => { const c = countGlb(u); return `${c.n}p/${Math.round(c.tris)}t`; }).join(' ')); }
