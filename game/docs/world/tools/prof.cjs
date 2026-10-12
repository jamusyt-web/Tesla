// CPU profile of the running game at spawn (phone viewport), using an unminified
// client build served via request interception, to see which functions cost the most.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8795';
const W = '/tmp/claude-0/-home-user-Tesla/999fe43b-342b-54e8-910a-bb752a28088d/scratchpad/world';
const UNMIN = path.join(W, 'dist-unmin');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api') || u.pathname.startsWith('/ws') || u.pathname.startsWith('/models')) return route.continue();
    const f = u.pathname === '/' || !path.extname(u.pathname) ? path.join(UNMIN, 'index.html') : path.join(UNMIN, u.pathname);
    if (!fs.existsSync(f)) return route.continue();
    const ext = path.extname(f);
    route.fulfill({ status: 200, body: fs.readFileSync(f), contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream' });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`PAGEERROR: ${e.message}`));
  await P.goto(BASE);
  await P.click('text=Join with invite');
  await P.fill('input[placeholder=username]', 'perfq' + (Date.now() % 100000));
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForSelector('.creator', { timeout: 60000 });
  await P.fill('input[placeholder="Hero name"]', 'Pq' + (Date.now() % 1000));
  await P.click('text=Begin your journey');
  await P.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(5000);
  const cdp = await ctx.newCDPSession(P);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await sleep(15000);
  const { profile } = await cdp.send('Profiler.stop');
  // Self time per function, and inclusive time for a few entry points.
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const counts = new Map();
  for (const s of profile.samples) counts.set(s, (counts.get(s) || 0) + 1);
  const total = profile.samples.length;
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map();
  for (const [id, c] of counts) {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${path.basename(f.url)}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + c);
    const seen = new Set();
    for (let p = id; p != null; p = parent.get(p)) {
      const pf = byId.get(p).callFrame;
      const k2 = `${pf.functionName || '(anon)'} ${path.basename(pf.url)}`;
      if (seen.has(k2)) continue;
      seen.add(k2);
      incl.set(k2, (incl.get(k2) || 0) + c);
    }
  }
  const pct = (c) => ((100 * c) / total).toFixed(1) + '%';
  console.log('samples', total);
  console.log('--- top self');
  for (const [k, c] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(pct(c).padStart(6), k);
  console.log('--- inclusive (selected)');
  const want = /^(loop|update|render|renderBufferDirect|projectObject|renderObject|renderObjects|frame|setProgram|getProgram|refreshUniformsCommon|upload|updateLabels|#updateLabels|stepPath|sample|fadeOccluders|#fadeOccluders|update[A-Z]\w*) /;
  for (const [k, c] of [...incl].sort((a, b) => b[1] - a[1]).filter(([k]) => want.test(k)).slice(0, 40)) console.log(pct(c).padStart(6), k);
  fs.writeFileSync(path.join(W, 'perf-out', 'profile.cpuprofile'), JSON.stringify(profile));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
