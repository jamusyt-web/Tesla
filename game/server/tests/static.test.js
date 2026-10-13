// Serving the built client: precompressed files by Accept-Encoding, ETags and
// 304s, long caching for versioned URLs, and the size of a first load.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { openDb } from '../db.js';
import { createServer } from '../app.js';
import { precompress } from '../../scripts/precompress.mjs';

let srv;
let base;
let dir;
const BIG_JS = 'export const x = ' + JSON.stringify('hearthvale '.repeat(4000)) + ';\n';

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'models', 'kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Hearthvale</title>' + '<p>hi</p>'.repeat(200));
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), BIG_JS);
  fs.writeFileSync(path.join(dir, 'models', 'kit', 'tree.glb'), Buffer.alloc(20000, 7));
  fs.writeFileSync(path.join(dir, 'models', 'kit', 'noise.bin'), crypto.randomBytes(4000));
  await precompress(dir);
  const db = openDb(':memory:');
  ({ server: srv } = createServer(db, { dist: dir, shopSim: false }));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  srv.close();
  srv.closeAllConnections?.();
  fs.rmSync(dir, { recursive: true, force: true });
});

// fetch() would decode for us; ask the raw way so the bytes can be checked.
const get = (p, headers = {}) =>
  new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) =>
      http
        .get(base + p, { headers }, (res) => {
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        })
        .on('error', reject),
    );
  });

test('precompressed copies are served by what the browser accepts', async () => {
  const br = await get('/assets/index-abc123.js', { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['content-type'], 'text/javascript');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), BIG_JS);
  assert.ok(br.body.length < BIG_JS.length / 5, 'much smaller');
  const gz = await get('/assets/index-abc123.js', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), BIG_JS);
  const plain = await get('/assets/index-abc123.js');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString(), BIG_JS);
  assert.equal(Number(plain.headers['content-length']), BIG_JS.length);
  // Something that doesn't compress well is sent as it is.
  const noise = await get('/models/kit/noise.bin', { 'accept-encoding': 'br, gzip' });
  assert.equal(noise.headers['content-encoding'], undefined);
  assert.equal(noise.body.length, 4000);
});

test('ETags: a repeat request with the tag gets a 304 and no body', async () => {
  const a = await get('/models/kit/tree.glb', { 'accept-encoding': 'br' });
  assert.equal(a.headers['content-encoding'], 'br');
  assert.ok(a.headers.etag);
  const b = await get('/models/kit/tree.glb', { 'accept-encoding': 'br', 'if-none-match': a.headers.etag });
  assert.equal(b.status, 304);
  assert.equal(b.body.length, 0);
  const c = await get('/models/kit/tree.glb', { 'if-none-match': 'W/"other"' });
  assert.equal(c.status, 200);
});

test('caching: hashed bundles and ?v= URLs are kept for good; the page and bare URLs revalidate', async () => {
  assert.match((await get('/assets/index-abc123.js')).headers['cache-control'], /immutable/);
  assert.match((await get('/models/kit/tree.glb?v=1a2b3c')).headers['cache-control'], /max-age=31536000, immutable/);
  assert.equal((await get('/models/kit/tree.glb')).headers['cache-control'], 'no-cache');
  const page = await get('/', { 'accept-encoding': 'br' });
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.match(zlib.brotliDecompressSync(page.body).toString(), /Hearthvale/);
  assert.equal((await get('/some/route')).headers['content-type'], 'text/html; charset=utf-8', 'app routes get the page');
  assert.equal((await get('/models/missing.glb')).status, 404);
  assert.doesNotMatch((await get('/%2e%2e/%2e%2e/etc/passwd')).body.toString(), /root:/, 'nothing outside dist/');
});

test('a first load (models, textures, UI art, the script bundle) is at most 3 MB compressed', () => {
  const ROOT = path.resolve(import.meta.dirname, '../..');
  let bytes = 0;
  const walk = (d, keep = () => true) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, keep);
      else if (keep(p)) bytes += zlib.gzipSync(fs.readFileSync(p), { level: 6 }).length;
    }
  };
  walk(path.join(ROOT, 'client/public')); // everything the client may load up front today
  const assets = path.join(ROOT, 'dist/assets');
  if (fs.existsSync(assets)) walk(assets, (p) => /\.(js|css)$/.test(p));
  else bytes += 400_000; // no build here: allow for the bundle (about 0.3 MB gzipped)
  assert.ok(bytes <= 3_000_000, `first load is ${(bytes / 1e6).toFixed(2)} MB`);
});
