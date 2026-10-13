// Precompress the built client (dist/) so the server can send small files:
// every compressible file gets a .br and a .gz next to it, kept only when it
// saves at least 10%. Runs at the end of `vite build` (vite.config.js); run it
// by hand with `node scripts/precompress.mjs [dir]`.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.glb', '.gltf', '.png', '.bin', '.txt']);

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (COMPRESSIBLE.has(path.extname(e.name)) && fs.statSync(p).size >= 512) yield p;
  }
}

async function one(file) {
  const raw = fs.readFileSync(file);
  const big = raw.length > 256 * 1024;
  const [br, gz] = await Promise.all([
    brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: big ? 9 : 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
    gzip(raw, { level: 9 }),
  ]);
  const out = { raw: raw.length, br: raw.length, gz: raw.length };
  for (const [ext, buf] of [['.br', br], ['.gz', gz]]) {
    const dest = file + ext;
    if (buf.length <= raw.length * 0.9) {
      fs.writeFileSync(dest, buf);
      out[ext.slice(1)] = buf.length;
    } else fs.rmSync(dest, { force: true });
  }
  return out;
}

export async function precompress(dir) {
  const list = [...files(dir)];
  const sum = { files: list.length, raw: 0, br: 0, gz: 0 };
  // A few at a time: brotli is CPU-heavy.
  for (let i = 0; i < list.length; i += 16) {
    for (const r of await Promise.all(list.slice(i, i + 16).map(one))) {
      sum.raw += r.raw;
      sum.br += r.br;
      sum.gz += r.gz;
    }
  }
  return sum;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || 'dist');
  const s = await precompress(dir);
  console.log(`precompressed ${s.files} files: ${(s.raw / 1e6).toFixed(2)} MB → br ${(s.br / 1e6).toFixed(2)} MB, gz ${(s.gz / 1e6).toFixed(2)} MB`);
}
