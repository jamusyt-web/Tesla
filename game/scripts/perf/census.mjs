// The performance census (SPEC §9.4): plays the game in headless Chromium on
// the phone profile and measures it against the budgets in shared/budget.js.
//
//   npm run perf:census                 today's map (maps/world.json)
//   npm run perf:census -- --map stress the five-town stress map (maps/fixtures/stress.json)
//   options: --no-build (use the last build), --out <file.json>, --quick (fewer spots)
//
// At each spot (Hearthvale's spawn, Whisperwood and the Wilds; on today's map
// Amberfold's square, yard, wood, Elder Oak and Warren door and the Westmarch
// road's middle; on the stress map every town square and road middle) it measures three
// framings: the default camera, zoomed all the way out, and a crowd of 9
// heroes. It reports draw calls and triangles (main pass, shadow pass,
// heroes), textures, shader programs, update and frame times, the longest
// task while walking, what the first load downloads, and what each built
// chunk costs. It exits with 1 if any budget is missed.
//
// Needs Playwright (a dev tool, not a game dependency): npm i -g playwright,
// then run with NODE_PATH=$(npm root -g).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BUDGET } from '../../shared/budget.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] ?? d : d);
const MAP = opt('--map', 'real');
const OUT = opt('--out') ?? path.join(ROOT, 'scripts', 'perf', `last-${MAP}.json`);
const QUICK = args.includes('--quick');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(process.env.NODE_PATH || '', 'playwright')));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── In the page ──────────────────────────────────────────────────────────
// One framing: the median and worst frame's draws and triangles by pass, over
// `frames` frames, one of them redrawing the shadow map.
async function measure({ frames }) {
  const g = window.__hv.game;
  const r = g.renderer;
  const raf = () => new Promise((res) => requestAnimationFrame(res));
  const heroRoots = new Set([...g.players.values()].map((p) => p.av.root));
  const isHero = (o) => {
    for (let p = o; p; p = p.parent) if (heroRoots.has(p)) return true;
    return false;
  };
  const orig = r.renderBufferDirect;
  let cur = null;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const t0 = r.info.render.triangles;
    orig.call(this, camera, scene, geometry, material, object, group);
    if (!cur) return;
    const pass = scene === null ? 'shadow' : scene === g.heroScene || isHero(object) ? 'heroes' : 'main';
    cur[pass].draws++;
    cur[pass].tris += r.info.render.triangles - t0;
  };
  const list = [];
  for (let i = 0; i < frames; i++) {
    if (i === frames - 1) g.shadow.dirty = true; // the last frame also redraws the shadow map
    cur = { main: { draws: 0, tris: 0 }, shadow: { draws: 0, tris: 0 }, heroes: { draws: 0, tris: 0 } };
    await raf();
    list.push(cur);
  }
  cur = null;
  r.renderBufferDirect = orig;
  const med = (f) => [...list].map(f).sort((a, b) => a - b)[list.length >> 1];
  const last = list[list.length - 1];
  const sum = (x) => x.main.draws + x.shadow.draws + x.heroes.draws;
  const sumT = (x) => x.main.tris + x.shadow.tris + x.heroes.tris;
  return {
    draws: med(sum),
    tris: med(sumT),
    main: { draws: med((x) => x.main.draws), tris: med((x) => x.main.tris) },
    heroes: { draws: med((x) => x.heroes.draws), tris: med((x) => x.heroes.tris) },
    shadowFrame: { draws: sum(last), tris: sumT(last), shadowDraws: last.shadow.draws, shadowTris: last.shadow.tris },
  };
}

// Textures, programs, update and frame times, and what each built chunk
// holds: draws and triangles of everything in it (main and shadow-only),
// whatever the camera sees.
async function overall({ frames }) {
  const g = window.__hv.game;
  const r = g.renderer;
  const texs = new Set();
  g.scene.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      for (const k of ['map', 'gradientMap', 'emissiveMap', 'alphaMap']) if (m[k]) texs.add(m[k]);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value?.isTexture) texs.add(u.value);
    }
  });
  let bytes = 0;
  for (const t of texs) {
    const i = t.image;
    const w = i?.width || 0;
    const h = i?.height || 0;
    const bpp = t.format === 1028 /* RedFormat */ ? 1 : 4;
    bytes += w * h * bpp * (t.generateMipmaps ? 1.33 : 1);
  }
  const tu = [];
  const tl = [];
  const ou = g.update;
  const ol = g.loop;
  g.update = function (dt) {
    const a = performance.now();
    ou.call(this, dt);
    tu.push(performance.now() - a);
  };
  g.loop = () => {
    const a = performance.now();
    ol();
    tl.push(performance.now() - a);
  };
  await new Promise((res) => {
    const t0 = performance.now();
    const chk = () => (tl.length >= frames || performance.now() - t0 > 30000 ? res() : setTimeout(chk, 50));
    chk();
  });
  g.loop = ol;
  g.update = ou;
  const st = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
    return { p50: q(0.5), p95: q(0.95) };
  };
  const tri = (o) => ((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
  const chunks = [];
  for (const ch of g.town?.chunks.values() ?? []) {
    if (!ch.lod) continue;
    // Scenery (ground, grass, everything merged) and statics (buildings,
    // gates, waystones, lakes…) apart: they have budgets of their own.
    // The tiles drawn only near the camera (ink within 40 m, small detail
    // and grass within 48 m) are counted apart: they never all show at once.
    const tiled = new Set((ch.lod.merge.tiles ?? []).map((t) => t.mesh));
    const count = (root) => {
      const c = { draws: 0, tris: 0, shadowDraws: 0, shadowTris: 0, tileDraws: 0, tileTris: 0 };
      root.traverse((o) => {
        if (!o.isMesh || !o.material?.visible || o.layers.mask === 4) return; // (tap targets aren't drawn)
        for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) return;
        if (tiled.has(o)) (c.tileDraws++, (c.tileTris += tri(o)));
        else if (o.layers.mask & 1) (c.draws++, (c.tris += tri(o)));
        if (o.castShadow && o.layers.mask & 32) (c.shadowDraws++, (c.shadowTris += tri(o)));
      });
      return c;
    };
    chunks.push({ key: ch.key, level: ch.lod.level, scenery: count(ch.lod.group), statics: count(ch.fixed) });
  }
  return { programs: r.info.programs?.length ?? 0, textureMiB: +(bytes / 1048576).toFixed(1), update: st(tu), frame: st(tl), chunks };
}

// The longest main-thread task while walking about for a few seconds.
async function walk({ ms }) {
  const g = window.__hv.game;
  const long = [];
  const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
  obs.observe({ type: 'longtask' });
  const me = g.me.local;
  const legs = [[24, 0], [0, 24], [-24, 0], [0, -24]];
  const t0 = performance.now();
  for (let i = 0; performance.now() - t0 < ms; i++) {
    const [dx, dz] = legs[i % legs.length];
    g.walkTo(me.x + dx, me.z + dz);
    await new Promise((r) => setTimeout(r, 1500));
  }
  obs.disconnect();
  return Math.round(Math.max(0, ...long));
}

async function crowd() {
  const g = window.__hv.game;
  const me = g.me.local;
  const hats = ['wizard', 'crown', 'beanie', 'straw', 'bandana', 'leaf', 'none', 'wizard'];
  const backs = ['cape', 'backpack', 'wings', 'none'];
  for (let i = 0; i < 8; i++)
    g.addPlayer({ id: 90000 + i, name: 'Crowd' + i, level: 3, avatar: { hat: hats[i], back: backs[i % 4], hairStyle: ['long', 'bun', 'spiky', 'ponytail'][i % 4], outfit: ['robe', 'tunic', 'adventurer', 'overalls', 'vest'][i % 5] }, equip: { weapon: 'sword_wood', axe: 'axe_wood' }, x: me.x + Math.cos(i) * 3, z: me.z + Math.sin(i) * 3, rot: 0, act: 'idle' });
}
async function uncrowd() {
  const g = window.__hv.game;
  for (let i = 0; i < 8; i++) g.removePlayer(90000 + i);
}

// ── Running it ───────────────────────────────────────────────────────────
function spots(map) {
  const out = [['spawn', 0, 8], ['whisperwood', -48, 6], ['wilds', 0, -60]];
  if (QUICK) return out;
  // Gate G3's places in Amberfold and on the Westmarch road.
  if (map !== 'stress') return [...out, ['amberfold_square', -534, -50], ['amberfold_yard', -557, -76], ['amberwood', -620, -95], ['westmarch_mid', -300, 0], ['elder_oak', -598, -28], ['warren_door', -603, -10]];
  for (const [id, x, z] of [['amberfold', -540, -54], ['rimeholt', -520, -654], ['sandmere', 560, -554], ['starfall', 40, -1134], ['fourways', 0, -630]]) out.push([id, x, z]);
  for (const [id, x, z] of [['road_westmarch', -270, -4], ['road_thornback', -470, -320], ['road_midmarch_w', -260, -688], ['road_midmarch_e', 250, -620], ['road_skystair', 40, -900], ['road_causeway', 5, -250]]) out.push([id, x, z]);
  return out;
}

async function main() {
  if (!args.includes('--no-build')) execSync('npx vite build --logLevel error', { cwd: ROOT, stdio: 'inherit' });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'census-'));
  if (MAP === 'stress') {
    fs.mkdirSync(path.join(data, 'maps'));
    fs.copyFileSync(path.join(ROOT, 'maps', 'fixtures', 'stress.json'), path.join(data, 'maps', 'world.json'));
  }
  const port = 8800 + Math.floor(Math.random() * 100);
  const server = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: { ...process.env, OPEN_SIGNUP: '1', PORT: String(port), DATA_DIR: data }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/health')).ok) break;
    } catch {}
    await sleep(100);
  }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { map: MAP, at: new Date().toISOString(), spots: {}, misses: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const P = await ctx.newPage();
    const errors = [];
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(base);
    await P.click('text=Join with invite');
    await P.fill('input[placeholder=username]', 'census' + (Date.now() % 100000));
    await P.fill('input[type=password]', 'secret123');
    await P.click('button[type=submit]');
    await P.waitForSelector('.creator', { timeout: 60000 });
    // First load: everything downloaded before the game's first frame.
    await P.evaluate(() => performance.clearResourceTimings());
    await P.fill('input[placeholder="Hero name"]', 'Census');
    await P.click('text=Begin your journey');
    await P.waitForFunction(() => window.__hv?.game?.me && window.__hv.game.renderer.info.render.frame > 0 && !document.querySelector('.loading'), null, { timeout: 120000, polling: 50 });
    report.firstLoadMB = await P.evaluate(() => +(performance.getEntriesByType('resource').reduce((n, e) => n + (e.transferSize || 0), 0) / 1048576).toFixed(2));
    await sleep(4000);
    await P.keyboard.press('Escape').catch(() => {});
    report.walkLongestTaskMs = await P.evaluate(walk, { ms: QUICK ? 6000 : 12000 });
    const chunks = new Map();
    for (const [id, x, z] of spots(MAP)) {
      await P.evaluate(([x, z]) => window.__hv.sock.rpc('owner.teleport', { x, z }), [x, z]).catch((e) => errors.push(`teleport ${id}: ${e.message}`));
      await P.evaluate(() => Object.assign(window.__hv.game.cam, { yaw: Math.PI, dist: 16 }));
      await sleep(3500);
      const s = { default: await P.evaluate(measure, { frames: 30 }) };
      await P.evaluate(() => (window.__hv.game.cam.dist = 34));
      await sleep(2500);
      s.zoomed = await P.evaluate(measure, { frames: 20 });
      await P.evaluate(() => (window.__hv.game.cam.dist = 16));
      if (id === 'spawn' || !QUICK) {
        await P.evaluate(crowd);
        await sleep(1500);
        s.crowd = await P.evaluate(measure, { frames: 20 });
        await P.evaluate(uncrowd);
      }
      Object.assign(s, await P.evaluate(overall, { frames: 40 }));
      for (const c of s.chunks) if (!chunks.has(c.key) || c.level === 'near') chunks.set(c.key, c);
      delete s.chunks;
      report.spots[id] = s;
      console.log(`${id.padEnd(16)} ${s.default.draws} draws (${s.default.main.draws} main, ${s.default.heroes.draws} heroes; shadow frame ${s.default.shadowFrame.shadowDraws}) · ${Math.round(s.default.tris / 1000)}k tris · zoomed ${s.zoomed.draws} · crowd ${s.crowd?.draws ?? '-'} · ${s.programs} programs · ${s.textureMiB} MiB`);
    }
    report.chunks = [...chunks.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    report.errors = errors;
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
  // ── Against the budgets
  const B = BUDGET;
  const miss = (what, v, max) => v > max && report.misses.push(`${what}: ${v} > ${max}`);
  miss('first load (MB)', report.firstLoadMB, B.firstLoadMB);
  miss('longest task while walking (ms)', report.walkLongestTaskMs, B.longTaskMs);
  for (const [id, s] of Object.entries(report.spots)) {
    const d = s.default;
    miss(`${id}: draws`, d.draws, B.draws);
    miss(`${id}: main draws`, d.main.draws, B.drawsMain);
    miss(`${id}: hero draws`, d.heroes.draws, B.drawsHeroes);
    miss(`${id}: shadow draws`, d.shadowFrame.shadowDraws, B.drawsShadow);
    miss(`${id}: triangles`, d.tris, B.tris);
    miss(`${id}: main triangles`, d.main.tris, B.trisMain);
    miss(`${id}: shadow triangles`, d.shadowFrame.shadowTris, B.trisShadow);
    miss(`${id}: zoomed-out draws`, s.zoomed.draws, B.drawsWorst);
    miss(`${id}: zoomed-out triangles`, s.zoomed.tris, B.trisWorst);
    if (s.crowd) miss(`${id}: crowd draws`, s.crowd.draws, B.drawsWorst), miss(`${id}: crowd triangles`, s.crowd.tris, B.trisWorst);
    miss(`${id}: shader programs`, s.programs, B.programs);
    miss(`${id}: textures (MiB)`, s.textureMiB, B.textureMiB);
    miss(`${id}: update ms (median)`, s.update.p50, B.updateMs);
  }
  for (const c of report.chunks) {
    const [S, T] = [c.scenery, c.statics];
    // (Shadow-only meshes are in 24 m tiles, and only those under the sun's
    // small view are drawn: the shadow budget is checked per frame, above.)
    if (c.level === 'near') miss(`chunk ${c.key}: scenery draws`, S.draws, B.chunkNear.draws);
    else miss(`chunk ${c.key} (far): scenery draws`, S.draws, B.chunkFar.draws);
    miss(`chunk ${c.key}: statics draws`, T.draws, B.chunkStatics.draws);
  }
  if (report.errors.length) report.misses.push(...report.errors.map((e) => `page error: ${e}`));
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(`\nfirst load ${report.firstLoadMB} MB · longest task walking ${report.walkLongestTaskMs} ms · ${report.chunks.length} chunks → ${path.relative(ROOT, OUT)}`);
  if (report.misses.length) {
    console.log(`\n${report.misses.length} budget misses:\n- ${report.misses.join('\n- ')}`);
    process.exit(1);
  }
  console.log('\nAll within budget.');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
