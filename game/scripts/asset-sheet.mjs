// Renders every .glb in a folder onto labelled contact sheets, using the
// game's toon look, so you can browse an asset pack the way it will appear
// in Hearthvale. Also prints a JSON catalog (size, triangles, animations).
//
//   node scripts/asset-sheet.mjs <folder-with-glbs> <out-dir> [perSheet=48]
//
// Needs Playwright with a Chromium (dev tool only — not used by the game).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const [dir, out, per = '48'] = process.argv.slice(2);
if (!dir || !out) {
  console.error('usage: node scripts/asset-sheet.mjs <glb-folder> <out-dir> [perSheet]');
  process.exit(1);
}
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(process.env.NODE_PATH || '', 'playwright')));
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort();
fs.mkdirSync(out, { recursive: true });

const PAGE = `<!doctype html><html><body style="margin:0;background:#fff">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const T = 200;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
r.setSize(T, T);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#dff3ff', '#a37d55', 1.6));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2); sun.position.set(3, 5, 4); scene.add(sun);
const grad = new THREE.DataTexture(new Uint8Array([120,120,120,255,200,200,200,255,255,255,255,255]), 3, 1);
grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const loader = new GLTFLoader();
window.renderSheet = async (names, cols) => {
  const rows = Math.ceil(names.length / cols);
  const c = document.createElement('canvas'); c.width = cols * T; c.height = rows * (T + 18);
  const x = c.getContext('2d'); x.fillStyle = '#f6efe2'; x.fillRect(0, 0, c.width, c.height);
  const info = [];
  for (let i = 0; i < names.length; i++) {
    let g;
    try { g = await loader.loadAsync('/pack/' + encodeURIComponent(names[i])); } catch (e) { info.push({ name: names[i], error: String(e) }); continue; }
    const root = g.scene; let tris = 0;
    root.traverse((o) => { if (o.isMesh) { const m = o.material; o.material = new THREE.MeshToonMaterial({ color: m.color, map: m.map, vertexColors: !!o.geometry.attributes.color, gradientMap: grad, transparent: m.transparent, opacity: m.opacity }); tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const ctr = box.getCenter(new THREE.Vector3());
    root.position.sub(ctr); scene.add(root);
    const rad = Math.max(size.x, size.y, size.z) * 0.95;
    cam.position.set(rad * 1.6, rad * 1.15, rad * 2.0); cam.lookAt(0, 0, 0); cam.near = rad / 100; cam.far = rad * 20; cam.updateProjectionMatrix();
    r.render(scene, cam); scene.remove(root);
    const cx = (i % cols) * T, cy = Math.floor(i / cols) * (T + 18);
    x.drawImage(r.domElement, cx, cy);
    x.fillStyle = '#4a3426'; x.font = '12px sans-serif'; x.fillText(names[i].replace(/\\.glb$/i, '').slice(0, 30), cx + 4, cy + T + 13);
    info.push({ name: names[i], size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)), tris: Math.round(tris), anims: g.animations.map((a) => a.name) });
  }
  return { png: c.toDataURL('image/png').split(',')[1], info };
};
window.ready = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = null;
  if (u === '/') return res.writeHead(200, { 'content-type': 'text/html' }), res.end(PAGE);
  if (u.startsWith('/three/')) f = path.join(THREE_DIR, u.slice(7));
  if (u.startsWith('/pack/')) f = path.join(dir, u.slice(6));
  if (!f || !fs.existsSync(f)) return res.writeHead(404), res.end();
  const ext = path.extname(f);
  res.writeHead(200, { 'content-type': ext === '.js' ? 'text/javascript' : ext === '.png' ? 'image/png' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.ready);
const catalog = [];
const N = Number(per);
for (let s = 0; s * N < files.length; s++) {
  const names = files.slice(s * N, (s + 1) * N);
  const { png, info } = await page.evaluate(([n, c]) => window.renderSheet(n, c), [names, 8]);
  const file = path.join(out, `sheet-${String(s + 1).padStart(2, '0')}.png`);
  fs.writeFileSync(file, Buffer.from(png, 'base64'));
  catalog.push(...info);
  console.error(`wrote ${file} (${names.length} models)`);
}
fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 1));
await browser.close();
server.close();
