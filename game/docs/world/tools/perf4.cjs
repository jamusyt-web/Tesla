// Worst-case camera framings per place (owner account so we can teleport): draw calls/tris
// at the default view, zoomed-out low pitch, and close top-down, for 4 yaws each.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8795';
const OUTDIR = '/tmp/claude-0/-home-user-Tesla/999fe43b-342b-54e8-910a-bb752a28088d/scratchpad/world/perf-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await P.goto(BASE);
  await P.fill('input[placeholder=username]', process.argv[2]);
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(3000);
  const count = () =>
    P.evaluate(async () => {
      const g = window.__hv.game;
      const r = g.renderer;
      const raf = () => new Promise((x) => requestAnimationFrame(x));
      // Shadow draws separately: count calls made with a null scene (the shadow pass).
      const orig = r.renderBufferDirect;
      let sh = 0;
      r.renderBufferDirect = function (c, s, ...rest) { if (s === null) sh++; return orig.call(this, c, s, ...rest); };
      r.info.autoReset = false;
      await raf();
      r.info.reset();
      sh = 0;
      await raf();
      const o = { calls: r.info.render.calls, shadow: sh, tris: r.info.render.triangles, chunks: g.town.chunks.size, mobs: [...g.mobs.values()].filter((m) => m.mob.root.visible).length };
      r.info.autoReset = true;
      r.renderBufferDirect = orig;
      return o;
    });
  const out = {};
  const places = { spawn: [0, 8], forest: [-48, 4], quarry: [50, 4], wilds: [0, -58], lake: [14, 40] };
  const views = { default: { dist: 16, pitch: 0.8 }, zoomedOutLow: { dist: 34, pitch: 0.45 }, closeTop: { dist: 9, pitch: 1.3 } };
  for (const [pn, [x, z]] of Object.entries(places)) {
    const tp = await P.evaluate(async ([x, z]) => { try { await window.__hv.sock.rpc('owner.teleport', { x, z }); return 'ok'; } catch (e) { return e.message; } }, [x, z]);
    await sleep(2500);
    for (const [vn, v] of Object.entries(views)) {
      const rows = [];
      for (let k = 0; k < 4; k++) {
        await P.evaluate(([v, k]) => { const c = window.__hv.game.cam; c.dist = v.dist; c.pitch = v.pitch; c.yaw = (k * Math.PI) / 2; }, [v, k]);
        await sleep(1600);
        rows.push(await count());
      }
      const max = rows.reduce((a, b) => (b.calls > a.calls ? b : a));
      out[`${pn}/${vn}`] = { tp, max, all: rows.map((r) => r.calls) };
      console.log(`${pn}/${vn}`.padEnd(24), tp, JSON.stringify(max), JSON.stringify(rows.map((r) => r.calls)));
      await P.screenshot({ path: `${OUTDIR}/view-${pn}-${vn}.png` });
    }
  }
  fs.writeFileSync(`${OUTDIR}/views.json`, JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
