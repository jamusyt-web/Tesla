// Chunk build cost, leak check on rebuild, and frame hitches on dungeon entry (phone viewport).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8795';
const OUTDIR = '/tmp/claude-0/-home-user-Tesla/999fe43b-342b-54e8-910a-bb752a28088d/scratchpad/world/perf-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await P.goto(BASE);
  await P.click('text=Join with invite');
  await P.fill('input[placeholder=username]', 'perfz' + (Date.now() % 100000));
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForSelector('.creator', { timeout: 60000 });
  await P.fill('input[placeholder="Hero name"]', 'Pz' + (Date.now() % 1000));
  await P.click('text=Begin your journey');
  await P.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(4000);
  const out = {};
  if (process.argv[2] !== 'hitch') {
  // Rebuild every chunk one at a time, timing each build. Repeat 4 times to look for leaks.
  out.rebuild = await P.evaluate(async () => {
    const g = window.__hv.game;
    const T = g.town;
    const L = g.me.local;
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      T.viewRadius = -1000;
      T.focus(L.x, L.z, 0); // drops everything
      const dropped = T.chunks.size;
      T.viewRadius = 120;
      const per = [];
      for (let k = 0; k < 40; k++) {
        const before = T.chunks.size;
        const a = performance.now();
        T.focus(L.x, L.z, 0); // budget 0 → exactly one square per call
        const ms = performance.now() - a;
        if (T.chunks.size === before) break;
        const key = [...T.chunks.keys()].pop();
        per.push([key, +ms.toFixed(1)]);
      }
      await new Promise((r) => setTimeout(r, 500));
      if (window.gc) window.gc();
      rounds.push({ dropped, built: per.length, per, mem: { ...g.renderer.info.memory }, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) });
    }
    return rounds;
  });
  for (const r of out.rebuild) console.log('round', r.dropped, r.built, JSON.stringify(r.mem), r.heapMB, JSON.stringify(r.per));
  }
  // Frame hitches while entering the dungeon (shader compiles, building the level).
  const hitch = async (label, fn, waitMs) => {
    await P.evaluate(() => { const g = window.__hv.game; const o = g.loop; window.__ft = []; g.__ol = o; const r = g.renderer; const T0 = performance.now();
      g.loop = () => { const p0 = r.info.programs.length; const a = performance.now(); o(); const ms = performance.now() - a; window.__ft.push([+((a - T0) / 1000).toFixed(1), +ms.toFixed(0), r.info.programs.length - p0, !!g.dungeon]); }; });
    await P.evaluate(fn);
    await sleep(waitMs);
    const r = await P.evaluate(() => { const g = window.__hv.game; g.loop = g.__ol; const f = window.__ft; return { frames: f.length, long: f.filter((x) => x[1] > 50), programs: g.renderer.info.programs.length, mem: { ...g.renderer.info.memory } }; });
    console.log(label, JSON.stringify(r));
    out[label] = r;
  };
  await hitch('walk+enterCrypt', () => window.__hv.game.enterCrypt('hollow_crypt', { tier: 1 }), 30000);
  await hitch('leaveCrypt', () => window.__hv.sock.rpc('dungeon.leave', {}), 8000);
  await hitch('enterCrypt2', () => window.__hv.game.enterCrypt('hollow_crypt', { tier: 1 }), 10000);
  fs.writeFileSync(`${OUTDIR}/${process.argv[2] === 'hitch' ? 'hitch' : 'chunks'}.json`, JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
