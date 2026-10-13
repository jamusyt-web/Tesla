import { defineConfig } from 'vite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { precompress } from './scripts/precompress.mjs';

const SERVER = process.env.GAME_SERVER || 'http://localhost:8787';

// One version for every file in client/public (models, textures, UI art):
// asset URLs carry ?v=<it>, so browsers can cache them for good and a new
// build that changes any of them fetches fresh copies.
function publicVersion(dir = 'client/public') {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p).update(fs.readFileSync(p));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return h.digest('hex').slice(0, 10);
}

// After the build: a .br and a .gz next to every file worth compressing.
const precompressPlugin = () => ({
  name: 'hearthvale-precompress',
  apply: 'build',
  async closeBundle() {
    const s = await precompress(path.resolve('dist'));
    console.log(`precompressed ${s.files} files: ${(s.raw / 1e6).toFixed(2)} MB → br ${(s.br / 1e6).toFixed(2)} MB`);
  },
});

export default defineConfig({
  root: 'client',
  // Don't wipe the terminal on start — the game server prints the invite code there.
  clearScreen: false,
  publicDir: 'public',
  define: { __ASSET_VERSION__: JSON.stringify(publicVersion()) },
  plugins: [precompressPlugin()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
});
