// Copies every model referenced in client/src/scene/manifest.js (MODELS and
// the modular MODULE_PACKS pieces) from a folder
// of unzipped asset packs into client/public/models/, along with any texture
// files the models reference (e.g. Kenney's Textures/colormap.png), and
// writes client/public/models/CREDITS.md.
//
//   node scripts/import-models.mjs <packs-root>
//
// <packs-root> holds one folder per pack, named like the url segment in the
// manifest: a url "/models/nature-kit/tree_oak.glb" is looked up anywhere
// inside "<packs-root>/nature-kit/". Models whose url points at
// /models/custom/ are yours and are left alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, MODULE_PACKS } from '../client/src/scene/manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'public', 'models');
const packsRoot = process.argv[2];
if (!packsRoot) {
  console.error('usage: node scripts/import-models.mjs <packs-root>');
  process.exit(1);
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return null;
}

// External image URIs inside a .glb (its JSON chunk).
function glbImages(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') return [];
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + len));
  return (json.images || []).map((i) => i.uri).filter((u) => u && !u.startsWith('data:'));
}

const urls = new Set();
for (const def of Object.values(MODELS)) for (const u of [].concat(def.url)) urls.add(u);
// Modular building pieces (see client/src/scene/buildings.js).
for (const [pack, names] of Object.entries(MODULE_PACKS)) for (const n of names) urls.add(`/models/${pack}/${n}.glb`);
const packs = new Map();
let copied = 0;
const missing = [];
for (const url of urls) {
  const m = url.match(/^\/models\/([^/]+)\/(.+)$/);
  if (!m) continue;
  const [, pack, file] = m;
  if (pack === 'custom') continue;
  const packDir = path.join(packsRoot, pack);
  const src = fs.existsSync(packDir) ? findFile(packDir, path.basename(file)) : null;
  if (!src) {
    missing.push(url);
    continue;
  }
  const dest = path.join(OUT, pack, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
  for (const img of glbImages(src)) {
    const from = path.join(path.dirname(src), img);
    const to = path.join(path.dirname(dest), img);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  if (!packs.has(pack)) {
    const lic = findFile(packDir, 'License.txt');
    packs.set(pack, lic ? fs.readFileSync(lic, 'utf8').replace(/\s+/g, ' ').trim() : '');
  }
}

let credits = '# Model credits\n\nThird-party models used by Hearthvale. Everything here is CC0 (public domain) unless noted.\nYour own models go in `custom/` and are not listed.\n\n';
for (const [pack, lic] of [...packs].sort()) credits += `## ${pack}\n\n${lic || 'See the pack for license details.'}\n\n`;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), credits);
console.log(`Copied ${copied} models from ${packs.size} packs into client/public/models/.`);
if (missing.length) console.log(`Not found (these slots will use the built-in fallback):\n  ${missing.join('\n  ')}`);
