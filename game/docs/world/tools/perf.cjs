// Mobile perf baseline for Hearthvale (read-only measurement against our own server on :8795).
// Usage: node perf.cjs [phone|desktop] [cpuThrottle]
const { chromium } = require('playwright');
const fs = require('fs');
const MODE = process.argv[2] || 'phone';
const THROTTLE = +(process.argv[3] || 1);
const BASE = 'http://localhost:8795';
const OUTDIR = '/tmp/claude-0/-home-user-Tesla/999fe43b-342b-54e8-910a-bb752a28088d/scratchpad/world/perf-out';
fs.mkdirSync(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page: one-frame draw breakdown + scene stats + timings.
const SNAP = async ({ label, frames }) => {
  const g = window.__hv.game;
  const r = g.renderer;
  const raf = () => new Promise((res) => requestAnimationFrame(res));
  // Categorise every object by which part of the game owns it.
  const cat = new Map();
  const tag = (root, name) => root && root.traverse((o) => cat.set(o, name));
  tag(g.scene, 'other');
  if (g.town?.root) {
    tag(g.town.root, 'town-static');
    for (const ch of g.town.chunks.values()) {
      ch.group.children.forEach((c) => {
        const kind = c.userData.ground ? 'chunk-ground' : c.isInstancedMesh && c.geometry.type === 'ConeGeometry' ? 'chunk-grass' : c.isInstancedMesh && c.geometry.type === 'CylinderGeometry' ? 'chunk-stones' : 'chunk-props';
        tag(c, kind);
      });
    }
    for (const n of g.town.nodes.values()) tag(n.root, 'nodes');
  }
  if (g.folk?.root) tag(g.folk.root, 'folk');
  if (g.dungeon?.root) tag(g.dungeon.root, 'dungeon');
  for (const pv of g.players.values()) tag(pv.av.root, 'players');
  for (const mv of g.mobs.values()) tag(mv.mob.root, 'mobs');
  // Scene census
  const census = { objects: 0, meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, skinned: 0, lights: 0, points: 0, sprites: 0, lines: 0, outlineMeshes: 0, castShadow: 0 };
  const mats = new Set();
  const geos = new Set();
  const texs = new Set();
  const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  g.scene.traverse((o) => {
    census.objects++;
    if (o.isLight) census.lights++;
    if (o.isPoints) census.points++;
    if (o.isSprite) census.sprites++;
    if (o.isLine) census.lines++;
    if (o.isMesh) {
      census.meshes++;
      if (visibleChain(o)) census.visibleMeshes++;
      if (o.isInstancedMesh) { census.instanced++; census.instances += o.count; }
      if (o.isSkinnedMesh) census.skinned++;
      if (o.castShadow) census.castShadow++;
      const ms = [].concat(o.material);
      if (ms[0]?.side === 1 && ms[0]?.customProgramCacheKey && ms[0].customProgramCacheKey().startsWith('outline')) census.outlineMeshes++;
      for (const m of ms) {
        mats.add(m);
        for (const k of ['map', 'gradientMap', 'emissiveMap', 'alphaMap', 'normalMap']) if (m[k]) texs.add(m[k]);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value?.isTexture) texs.add(u.value);
      }
      geos.add(o.geometry);
    }
  });
  let texBytes = 0;
  const texList = [];
  for (const t of texs) {
    const img = t.image;
    const w = img?.width || img?.data?.width || 0;
    const h = img?.height || img?.data?.height || 0;
    const b = w * h * 4 * (t.generateMipmaps && t.minFilter !== 1003 ? 1.33 : 1);
    texBytes += b;
    texList.push(`${w}x${h}`);
  }
  let geoBytes = 0;
  for (const gg of geos) { for (const a of Object.values(gg.attributes)) geoBytes += a.array.byteLength; if (gg.index) geoBytes += gg.index.array.byteLength; }
  // One frame's draw breakdown.
  const origRBD = r.renderBufferDirect;
  const origRender = r.render;
  let pass = 'main';
  const draws = {};
  const add = (k, tri, inst) => { const d = (draws[k] ??= { calls: 0, tris: 0, inst: 0 }); d.calls++; d.tris += tri; d.inst += inst; };
  let recording = false;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const t0 = r.info.render.triangles;
    origRBD.call(this, camera, scene, geometry, material, object, group);
    if (!recording) return;
    const tri = r.info.render.triangles - t0;
    const isShadow = scene === null;
    const isOutline = material.side === 1 && material.customProgramCacheKey && material.customProgramCacheKey().startsWith('outline');
    const p = isShadow ? 'shadow' : pass;
    add(`${p}|${cat.get(object) || 'unknown'}|${isOutline ? 'outline' : 'solid'}`, tri, object.isInstancedMesh ? object.count : 1);
    add(`${p}|*`, tri, 0);
    if (!isShadow && isOutline) add(`outline|*`, tri, 0);
  };
  let callIdx = 0;
  r.render = function (s, c) {
    pass = callIdx === 0 ? 'main' : s.overrideMaterial ? 'silhouette' : 'heroes';
    callIdx++;
    return origRender.call(this, s, c);
  };
  r.info.autoReset = false;
  await raf();
  r.info.reset();
  callIdx = 0;
  recording = true;
  await raf();
  recording = false;
  const total = { calls: r.info.render.calls, tris: r.info.render.triangles, lines: r.info.render.lines, points: r.info.render.points, renders: callIdx };
  r.renderBufferDirect = origRBD;
  r.render = origRender;
  r.info.autoReset = true;
  // Timings over N frames: update(), the three render() calls, whole loop, rAF interval.
  const origUpdate = g.update;
  const origTownUpdate = g.town?.update;
  const tu = [], tr = [], tl = [], tt = [], dts = [];
  let rAcc = 0;
  g.update = function (dt) { const a = performance.now(); origUpdate.call(this, dt); tu.push(performance.now() - a); };
  if (g.town) g.town.update = function (...a) { const s = performance.now(); origTownUpdate.apply(this, a); tt.push(performance.now() - s); };
  r.render = function (s, c) { const a = performance.now(); origRender.call(this, s, c); rAcc += performance.now() - a; };
  const origLoop = g.loop;
  let last = performance.now();
  g.loop = () => { const a = performance.now(); dts.push(a - last); last = a; rAcc = 0; origLoop(); tl.push(performance.now() - a); tr.push(rAcc); };
  await new Promise((res) => { const t0 = performance.now(); const chk = () => (tl.length >= frames || performance.now() - t0 > 60000 ? res() : setTimeout(chk, 50)); chk(); });
  g.loop = origLoop; // the next rAF picks the original back up
  g.update = origUpdate;
  if (g.town) g.town.update = origTownUpdate;
  r.render = origRender;
  const st = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
  const pos = g.myPos?.() ?? null;
  return {
    label,
    low: g.low,
    dpr: devicePixelRatio,
    pixelRatio: r.getPixelRatio(),
    buffer: [r.domElement.width, r.domElement.height],
    shadowMap: g.sun.shadow.mapSize.x,
    fog: [g.scene.fog.near, g.scene.fog.far],
    camDist: g.cam.dist,
    pos,
    chunks: g.town ? [...g.town.chunks.keys()] : null,
    viewRadius: g.town?.viewRadius,
    players: g.players.size,
    mobs: g.mobs.size,
    census,
    materials: mats.size,
    geometriesInScene: geos.size,
    geoMB: +(geoBytes / 1048576).toFixed(1),
    texturesInScene: texs.size,
    texMB: +(texBytes / 1048576).toFixed(1),
    texSizes: texList.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {}),
    memory: { ...r.info.memory },
    programs: r.info.programs?.length,
    total,
    draws,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    heapTotalMB: performance.memory ? +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) : null,
    timing: { update: st(tu), townUpdate: st(tt), render3: st(tr), loop: st(tl), frameInterval: st(dts) },
  };
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
  const ctxOpts = MODE === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext(ctxOpts);
  const P = await ctx.newPage();
  const cdp = await ctx.newCDPSession(P);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const net = new Map();
  const urls = new Map();
  cdp.on('Network.responseReceived', (e) => urls.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => net.set(e.requestId, e.encodedDataLength));
  const netSum = () => {
    const byKind = {};
    for (const [id, b] of net) {
      const u = urls.get(id) || '';
      const k = /\/models\//.test(u) ? (/\.png$/.test(u) ? 'model-tex' : 'models') : /\/assets\/.*\.js/.test(u) ? 'js' : /\.css/.test(u) ? 'css' : /\/ui\//.test(u) ? 'ui' : /\/api\//.test(u) ? 'api' : 'other';
      const d = (byKind[k] ??= { n: 0, kb: 0 });
      d.n++;
      d.kb += b / 1024;
    }
    for (const d of Object.values(byKind)) d.kb = Math.round(d.kb);
    return byKind;
  };
  P.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  P.on('console', (m) => m.type() === 'error' && console.log('ERR', m.text()));
  const results = { mode: MODE, throttle: THROTTLE, ctxOpts };
  const T0 = Date.now();
  await P.goto(BASE);
  await P.click('text=Join with invite');
  await P.fill('input[placeholder=username]', (MODE === 'phone' ? 'perfp' : 'perfd') + (Date.now() % 100000));
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForSelector('.creator', { timeout: 60000 });
  await P.fill('input[placeholder="Hero name"]', 'Perf' + (Date.now() % 1000));
  net.clear();
  const T1 = Date.now();
  await P.click('text=Begin your journey');
  await P.waitForFunction(() => window.__hv?.game, null, { timeout: 120000, polling: 50 });
  const T2 = Date.now();
  await P.waitForFunction(() => window.__hv?.game?.me && window.__hv.game.renderer.info.render.frame > 0 && !document.querySelector('.loading'), null, { timeout: 120000, polling: 50 });
  const T3 = Date.now();
  results.load = { authToCreatorMs: T1 - T0, clickToGameObjectMs: T2 - T1, clickToFirstFrameMs: T3 - T1, netAfterCreator: netSum() };
  console.log('load', JSON.stringify(results.load));
  await sleep(4000); // let streaming settle
  const owner = await P.evaluate(() => window.__hv.hud?.me?.owner ?? window.__hv.game.me?.owner ?? null);
  results.ownerFlag = owner;
  const heapCdp = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const x of m.metrics) if (['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'ScriptDuration', 'TaskDuration'].includes(x.name)) o[x.name] = x.name.startsWith('JSHeap') ? +(x.value / 1048576).toFixed(1) : +x.value.toFixed?.(2) ?? x.value; return o; };
  // Close any popups the onboarding opened.
  await P.keyboard.press('Escape').catch(() => {});
  const snap = async (label) => {
    const s = await P.evaluate(SNAP, { label, frames: 120 });
    s.cdp = await heapCdp();
    await P.screenshot({ path: `${OUTDIR}/${MODE}-t${THROTTLE}-${label}.png` });
    console.log(label, JSON.stringify({ calls: s.total, chunks: s.chunks?.length, heap: s.heapMB, tex: s.texMB, upd: s.timing.update, rend: s.timing.render3 }));
    return s;
  };
  results.spawn = await snap('spawn');
  // Spin the camera through 4 yaws at spawn: worst-case draw calls.
  const yawCalls = [];
  for (let k = 0; k < 4; k++) {
    await P.evaluate((k) => { window.__hv.game.cam.yaw = (k * Math.PI) / 2; }, k);
    await sleep(1500);
    yawCalls.push(await P.evaluate(async () => { const r = window.__hv.game.renderer; r.info.autoReset = false; await new Promise((x) => requestAnimationFrame(x)); r.info.reset(); await new Promise((x) => requestAnimationFrame(x)); const o = { calls: r.info.render.calls, tris: r.info.render.triangles, chunks: window.__hv.game.town.chunks.size }; r.info.autoReset = true; return o; }));
  }
  results.spawnYaws = yawCalls;
  console.log('yaws', JSON.stringify(yawCalls));
  // The Wilds via owner teleport, with timing of the frames right after the jump.
  const tp = await P.evaluate(async () => { try { await window.__hv.sock.rpc('owner.teleport', { x: 0, z: -60 }); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
  results.teleport = tp;
  const jump = await P.evaluate(async () => {
    const g = window.__hv.game; const u = []; const orig = g.update;
    g.update = function (dt) { const a = performance.now(); orig.call(this, dt); u.push(performance.now() - a); };
    await new Promise((r) => setTimeout(r, 4000));
    g.update = orig;
    return { frames: u.length, max: Math.max(...u).toFixed(1), over16: u.filter((x) => x > 16).length, top5: [...u].sort((a, b) => b - a).slice(0, 5).map((x) => +x.toFixed(1)) };
  });
  results.wildsJump = jump;
  console.log('tp', tp, JSON.stringify(jump));
  await P.evaluate(() => { window.__hv.game.cam.yaw = Math.PI; });
  await sleep(2500);
  results.wilds = await snap('wilds');
  // Far corners of the land: how many chunks, how much heap after streaming around.
  const ext = await P.evaluate(() => { const g = window.__hv.game; return g.town.chunks.size; });
  results.wildsChunks = ext;
  // Dungeon
  await P.evaluate(() => window.__hv.game.enterCrypt('hollow_crypt', { tier: 1 }));
  const t = Date.now();
  let inDun = false;
  while (Date.now() - t < 40000) { if (await P.evaluate(() => !!window.__hv.game.dungeon && !window.__hv.game.swapping)) { inDun = true; break; } await sleep(250); }
  results.dungeonEnterMs = Date.now() - t;
  console.log('dungeon', inDun, results.dungeonEnterMs);
  await sleep(3000);
  if (inDun) {
    results.dungeon = await snap('dungeon');
    await P.evaluate(() => { const g = window.__hv.game; g.cam.dist = 22; g.cam.pitch = 1.0; });
    await sleep(1500);
    results.dungeonHigh = await snap('dungeon-high');
  }
  // Leave the dungeon and see whether memory comes back.
  const left = await P.evaluate(async () => { const g = window.__hv.game; try { await window.__hv.sock.rpc('dungeon.leave', {}); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
  await sleep(5000);
  results.afterLeave = await P.evaluate(() => { const g = window.__hv.game; return { left: !g.dungeon, mem: { ...g.renderer.info.memory }, programs: g.renderer.info.programs.length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, chunks: g.town.chunks.size }; });
  results.afterLeave.how = left;
  console.log('afterLeave', JSON.stringify(results.afterLeave));
  results.netTotal = netSum();
  // Cold reload as a returning player (token stored), cache disabled.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  net.clear();
  const R0 = Date.now();
  await P.reload();
  await P.waitForFunction(() => window.__hv?.game?.me && window.__hv.game.renderer.info.render.frame > 0 && !document.querySelector('.loading'), null, { timeout: 120000, polling: 50 });
  results.coldReloadMs = Date.now() - R0;
  results.coldReloadNet = netSum();
  console.log('coldReload', results.coldReloadMs, JSON.stringify(results.coldReloadNet));
  // Same with a 4G-ish link (10 Mbps down, 60 ms RTT).
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 });
  const R1 = Date.now();
  await P.reload();
  await P.waitForFunction(() => window.__hv?.game?.me && window.__hv.game.renderer.info.render.frame > 0 && !document.querySelector('.loading'), null, { timeout: 180000, polling: 100 });
  results.reload4gMs = Date.now() - R1;
  console.log('reload4g', results.reload4gMs);
  fs.writeFileSync(`${OUTDIR}/${MODE}-t${THROTTLE}.json`, JSON.stringify(results, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
