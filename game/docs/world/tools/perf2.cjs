// What-if experiments at spawn on a phone viewport: crowd of heroes, shadows frozen,
// no silhouette pass, no outlines, smaller view radius, texture duplication, CPU throttle.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8795';
const OUTDIR = '/tmp/claude-0/-home-user-Tesla/999fe43b-342b-54e8-910a-bb752a28088d/scratchpad/world/perf-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Count draws/tris for one frame, then time N frames of the 3 render() calls + update().
const MEASURE = async ({ frames }) => {
  const g = window.__hv.game;
  const r = g.renderer;
  const raf = () => new Promise((res) => requestAnimationFrame(res));
  r.info.autoReset = false;
  await raf();
  r.info.reset();
  await raf();
  const calls = r.info.render.calls;
  const tris = r.info.render.triangles;
  r.info.autoReset = true;
  const origRender = g.__origRender || r.render;
  const tr = [], tu = [];
  let acc = 0;
  const myRender = r.render;
  r.render = function (s, c) { const a = performance.now(); myRender.call(this, s, c); acc += performance.now() - a; };
  const origUpdate = g.update;
  g.update = function (dt) { const a = performance.now(); origUpdate.call(this, dt); tu.push(performance.now() - a); };
  const origLoop = g.loop;
  g.loop = () => { acc = 0; origLoop(); tr.push(acc); };
  await new Promise((res) => { const t0 = performance.now(); const chk = () => (tr.length >= frames || performance.now() - t0 > 90000 ? res() : setTimeout(chk, 50)); chk(); });
  g.loop = origLoop;
  g.update = origUpdate;
  r.render = myRender;
  const mean = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
  const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.floor(0.95 * (s.length - 1))] ?? 0).toFixed(2); };
  return { calls, tris, chunks: g.town.chunks.size, renderMs: mean(tr), renderP95: p95(tr), updateMs: mean(tu), updateP95: p95(tu), frames: tr.length, programs: r.info.programs.length, mem: { ...r.info.memory } };
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const P = await ctx.newPage();
  const cdp = await ctx.newCDPSession(P);
  P.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await P.goto(BASE);
  await P.click('text=Join with invite');
  await P.fill('input[placeholder=username]', 'perfx' + (Date.now() % 100000));
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForSelector('.creator', { timeout: 60000 });
  await P.fill('input[placeholder="Hero name"]', 'Px' + (Date.now() % 1000));
  await P.click('text=Begin your journey');
  await P.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(4000);
  const out = {};
  const run = async (name, setup, frames = 60) => {
    if (setup) await P.evaluate(setup);
    await sleep(800);
    out[name] = await P.evaluate(MEASURE, { frames });
    console.log(name.padEnd(28), JSON.stringify(out[name]));
  };
  // Texture duplication census.
  out.textures = await P.evaluate(() => {
    const g = window.__hv.game;
    const seen = new Map();
    g.scene.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) for (const k of ['map', 'emissiveMap']) if (m[k]) seen.set(m[k].uuid, m[k]); });
    const byName = {};
    let sources = new Set();
    for (const t of seen.values()) { const key = `${t.name || '(unnamed)'} ${t.image?.width}x${t.image?.height}`; byName[key] = (byName[key] || 0) + 1; sources.add(t.source.uuid); }
    let outlineMats = new Set(), toonMats = new Set();
    g.scene.traverse((o) => { if (!o.isMesh) return; const m = [].concat(o.material)[0]; if (m.side === 1 && m.customProgramCacheKey?.().startsWith('outline')) outlineMats.add(m.customProgramCacheKey()); else if (m.isMeshToonMaterial) toonMats.add(m); });
    return { textureObjects: seen.size, distinctSources: sources.size, byName, outlineThicknessVariants: outlineMats.size, toonMaterials: toonMats.size };
  });
  console.log('textures', JSON.stringify(out.textures));
  await run('baseline', null);
  // Crowd: 8 more heroes standing around the plaza (client-only fakes).
  await run('crowd8', () => {
    const g = window.__hv.game;
    const me = g.me;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.addPlayer({ id: 'fake' + i, name: 'Fake' + i, level: 3, avatar: me.info.avatar, equip: me.info.equip || {}, x: me.local.x + Math.sin(a) * 4, z: me.local.z + Math.cos(a) * 4, rot: a, act: 'idle' });
    }
  });
  // Shadows frozen (rendered once, never updated again).
  await run('crowd8+shadowFrozen', () => {
    const r = window.__hv.game.renderer;
    Object.defineProperty(r.shadowMap, 'needsUpdate', { configurable: true, get: () => false, set: () => {} });
  });
  // No silhouette pass.
  await run('..+noSilhouette', () => {
    const g = window.__hv.game;
    const r = g.renderer;
    const orig = r.render;
    r.render = function (s, c) { if (s.overrideMaterial) return; return orig.call(this, s, c); };
  });
  // No outline hulls anywhere.
  await run('..+noOutlines', () => {
    const g = window.__hv.game;
    g.scene.traverse((o) => { if (o.isMesh) { const m = [].concat(o.material)[0]; if (m.side === 1 && m.customProgramCacheKey?.().startsWith('outline')) o.visible = false; } });
  });
  // Undo all of that, back to the crowd only, then try a smaller view radius + nearer fog.
  await P.evaluate(() => {
    const g = window.__hv.game;
    const r = g.renderer;
    delete r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = true;
    delete r.render; // the instance property; falls back to... (re-assigned below)
  }).catch(() => {});
  await browser.close();
  // Fresh page for the radius tests (cleaner than undoing patches).
  const b2 = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const c2 = await b2.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const Q = await c2.newPage();
  const cdp2 = await c2.newCDPSession(Q);
  await Q.goto(BASE);
  await Q.click('text=Join with invite');
  await Q.fill('input[placeholder=username]', 'perfy' + (Date.now() % 100000));
  await Q.fill('input[type=password]', 'secret123');
  await Q.click('button[type=submit]');
  await Q.waitForSelector('.creator', { timeout: 60000 });
  await Q.fill('input[placeholder="Hero name"]', 'Py' + (Date.now() % 1000));
  await Q.click('text=Begin your journey');
  await Q.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(4000);
  const run2 = async (name, setup, frames = 60) => {
    if (setup) await Q.evaluate(setup);
    await sleep(1500);
    out[name] = await Q.evaluate(MEASURE, { frames });
    console.log(name.padEnd(28), JSON.stringify(out[name]));
  };
  await run2('baseline2', null);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await run2('baseline2@4xCPU', null, 30);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await run2('viewRadius72', () => { const g = window.__hv.game; g.town.viewRadius = 72; g.town.focus(g.me.local.x, g.me.local.z, Infinity); });
  await run2('+shadowBox20', () => { const sc = window.__hv.game.sun.shadow.camera; sc.left = sc.bottom = -20; sc.right = sc.top = 20; sc.updateProjectionMatrix(); });
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await run2('radius72+box20@4xCPU', null, 30);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  fs.writeFileSync(`${OUTDIR}/whatif.json`, JSON.stringify(out, null, 1));
  await b2.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
