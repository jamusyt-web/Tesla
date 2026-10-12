const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const P = await ctx.newPage();
  await P.goto('http://localhost:8795');
  await P.fill('input[placeholder=username]', process.argv[2]);
  await P.fill('input[type=password]', 'secret123');
  await P.click('button[type=submit]');
  await P.waitForFunction(() => window.__hv?.game?.me && !document.querySelector('.loading'), null, { timeout: 120000, polling: 100 });
  await sleep(3000);
  const r = await P.evaluate(() => {
    const g = window.__hv.game; const T = g.town;
    const chunkGroups = new Set([...T.chunks.values()].map((c) => c.group));
    const nodeRoots = new Set([...T.nodes.values()].map((n) => n.root));
    const rows = {};
    for (const c of T.root.children) {
      if (chunkGroups.has(c) || nodeRoots.has(c)) continue;
      let meshes = 0, casters = 0, outl = 0;
      c.traverse((o) => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; const m = [].concat(o.material)[0]; if (m.side === 1) outl++; } });
      const k = (c.name || c.type) + (c.userData?.kind ? ':' + c.userData.kind : '');
      const row = (rows[k] ??= { n: 0, meshes: 0, casters: 0, outlines: 0 });
      row.n++; row.meshes += meshes; row.casters += casters; row.outlines += outl;
    }
    // nodes
    let nm = 0, nc = 0; for (const n of T.nodes.values()) n.root.traverse((o) => { if (o.isMesh) { nm++; if (o.castShadow) nc++; } });
    // per-chunk instanced groups
    const per = [...T.chunks.entries()].map(([k, c]) => { let im = 0, cast = 0, plain = 0; c.group.traverse((o) => { if (o.isInstancedMesh) { im++; if (o.castShadow) cast++; } else if (o.isMesh) plain++; }); return [k, im, cast, plain]; });
    // mobs / folk meshes
    let mobMeshes = 0, mobCast = 0; for (const mv of g.mobs.values()) mv.mob.root.traverse((o) => { if (o.isMesh) { mobMeshes++; if (o.castShadow) mobCast++; } });
    let folkMeshes = 0, folkCast = 0; g.folk.root.traverse((o) => { if (o.isMesh) { folkMeshes++; if (o.castShadow) folkCast++; } });
    let heroMeshes = 0; g.me.av.root.traverse((o) => o.isMesh && heroMeshes++);
    return { rows, nodes: { count: T.nodes.size, meshes: nm, casters: nc }, per, mobs: { n: g.mobs.size, meshes: mobMeshes, casters: mobCast }, folk: { meshes: folkMeshes, casters: folkCast }, heroMeshes, labels: g.staticLabels.length };
  });
  console.log(JSON.stringify(r, null, 0));
  await browser.close();
})();
