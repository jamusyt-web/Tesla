// A screenshot tour of every screen at phone size (390×844), for checking the
// look after UI changes. Log in as a hero that has a few logs and a rod
// (an owner account, so it can teleport), then:
//   NODE_PATH=$(npm root -g) node scripts/ui-tour.cjs http://127.0.0.1:8790 <username> <password> <outdir>
// It saves t_<screen>.png files: creator, goal, toasts, every panel and tab,
// the world map, the shop, a craft and its result, a battle, and fishing.
// Prints any page errors at the end. Needs Playwright (npm i -g playwright).
const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');
const [base, user, pass, out] = process.argv.slice(2);
const post = (p, b, t) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t || ''}` }, body: JSON.stringify(b) }).then((r) => r.json());
(async () => {
  const token = (await post('/api/login', { username: user, password: pass })).token;
  if (!token) throw new Error('login failed');
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const errors = [];
  const shot = async (pg, name) => { await pg.waitForTimeout(700); await pg.screenshot({ path: `${out}/t_${name}.png` }); console.log('shot', name); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAILED', name, e.message.split('\n')[0]); } };
  // Character creator (a new account with no hero).
  await step('creator', async () => {
    const s = await post('/api/signup', { username: `new${Date.now() % 100000}`, password: 'secret1' });
    const pg = await br.newPage(opts);
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.addInitScript((t) => localStorage.setItem('hv_token', t), s.token);
    await pg.goto(base);
    await pg.waitForTimeout(6000);
    await shot(pg, 'creator');
    await pg.close();
  });
  const pg = await br.newPage(opts);
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.addInitScript((t) => localStorage.setItem('hv_token', t), token);
  await pg.goto(base);
  await pg.waitForFunction(() => window.__hv?.game?.me, null, { timeout: 90000 });
  await pg.waitForTimeout(5000);
  const ev = (f, a) => pg.evaluate(f, a);
  await ev(() => { const h = window.__hv.hud; h.levelup?.close?.(); h.panels.close(); });
  await step('goal', async () => { await ev(() => document.querySelector('.goal .ghead')?.click()); await shot(pg, 'goal_open'); await ev(() => document.querySelector('.goal .ghead')?.click()); });
  await step('toasts', async () => { await ev(() => { const h = window.__hv.hud; h.toast('Not enough Oak Log.', 'err'); h.toast('Equipped Copper Pickaxe!', 'good'); h.toast('Sold 4× Oak Plank: +40', 'gold'); }); await shot(pg, 'toasts'); });
  const panels = [
    ['bag', (h) => h.panels.open('bag'), null],
    ['bag_hero', (h) => h.panels.open('bag'), 'Hero'],
    ['craft', (h) => h.openPlace('craft'), 'Anvil'],
    ['market', (h) => h.openPlace('market'), null],
    ['market2', (h) => h.openPlace('market'), 2],
    ['book_today', (h) => h.panels.open('book'), 'Today'],
    ['book_journal', (h) => h.panels.open('book'), 'Journal'],
    ['town_standing', (h) => h.openPlace('townhall'), 'Standing'],
    ['town_invites', (h) => h.openPlace('townhall'), 'Invites'],
    ['town_econ', (h) => h.openPlace('townhall'), 'Economy'],
  ];
  for (const [name, fn, tab] of panels)
    await step(name, async () => {
      await ev(`(${fn})(window.__hv.hud)`);
      await pg.waitForTimeout(1200);
      if (typeof tab === 'string') await ev((t) => [...document.querySelectorAll('.panel .tabs button')].find((b) => b.textContent.trim().includes(t))?.click(), tab);
      if (typeof tab === 'number') await ev((i) => document.querySelectorAll('.panel .tabs button')[i]?.click(), tab);
      await pg.waitForTimeout(900);
      await shot(pg, name);
      await ev(() => window.__hv.hud.panels.close());
    });
  await step('map', async () => { await ev(() => window.__hv.hud.toggleMap()); await pg.waitForTimeout(1500); await shot(pg, 'map'); await ev(() => window.__hv.hud.toggleMap()); });
  await step('shop', async () => {
    await ev(() => window.__hv.game.enterShop(window.__hv.hud.myId));
    await pg.waitForTimeout(4000);
    await shot(pg, 'shop_room');
    await ev(() => window.__hv.hud.panels.open('ledger'));
    await shot(pg, 'shop_ledger');
    await ev(() => { window.__hv.hud.panels.close(); window.__hv.game.exitShop(); });
    await pg.waitForTimeout(4000);
  });
  await step('craft game', async () => {
    await ev(() => window.__hv.game.goCraft('oak_plank'));
    await pg.waitForFunction(() => window.__hv.hud.craftGame?.s.phase === 'wait', null, { timeout: 60000 });
    await shot(pg, 'craftgame');
    await ev(() => { const c = window.__hv.hud.craftGame; c.scrim.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true })); });
    await pg.waitForTimeout(500);
    // Stop it (hold the stop button) and look at the result card.
    await ev(() => window.__hv.hud.craftGame && window.__hv.hud.craftGame.scrim.querySelector('button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await pg.waitForFunction(() => window.__hv.hud.craftGame?.scrim.classList.contains('result'), null, { timeout: 20000 });
    await shot(pg, 'craft_result');
    await ev(() => window.__hv.hud.craftGame.close());
  });
  await step('battle', async () => {
    const id = await ev(() => { const g = window.__hv.game; const L = g.me.local; let best = null; for (const [id, m] of g.mobs) if (m.state !== 'dead' && (!best || Math.hypot(m.x - L.x, m.z - L.z) < best.d)) best = { id, d: Math.hypot(m.x - L.x, m.z - L.z), x: m.x, z: m.z }; if (best) g.ownerTeleport(best.x + 3, best.z); return best?.id; });
    await pg.waitForTimeout(3500);
    await ev((id) => window.__hv.game.goMob(id), id);
    await pg.waitForFunction(() => window.__hv.game.battle, null, { timeout: 30000 });
    await pg.waitForTimeout(2500);
    await shot(pg, 'battle');
    for (let i = 0; i < 40; i++) {
      const done = await ev(() => { const g = window.__hv.game; if (!g.battle) return true; window.__hv.sock.send({ t: 'bact', a: 'attack' }); return false; });
      if (done) break;
      await pg.waitForTimeout(1500);
      if (i === 1) await shot(pg, 'battle_mid');
    }
    await pg.waitForTimeout(1500);
    await shot(pg, 'battle_end');
    await ev(() => window.__hv.hud.panels.close());
  });
  await step('fishing', async () => {
    const { NODE_TYPES } = await import(path.resolve(__dirname, '../shared/nodes.js'));
    const map = await fetch(base + '/api/map').then((r) => r.json());
    const fish = (map.nodes ?? map.map?.nodes ?? []).filter((n) => NODE_TYPES[n.type]?.kind === 'fish');
    const id = await ev((fish) => { const g = window.__hv.game; const L = g.me.local; let best = null; for (const n of fish) if (!best || Math.hypot(n.x - L.x, n.z - L.z) < best.d) best = { id: n.id, d: Math.hypot(n.x - L.x, n.z - L.z), x: n.x, z: n.z }; if (best) g.ownerTeleport(best.x + 3, best.z); return best?.id ?? null; }, fish);
    console.log('fish node', id);
    if (!id) return;
    await pg.waitForTimeout(3500);
    await ev((id) => window.__hv.game.goNode(id), id);
    await pg.waitForTimeout(3000);
    await shot(pg, 'fish_wait');
    await pg.waitForFunction(() => document.querySelector('.fishcall:not(.hidden), .fight-scrim'), null, { timeout: 40000 });
    await shot(pg, 'fish_bite');
  });
  console.log('page errors:', errors.slice(0, 8));
  await br.close();
})().catch((e) => (console.error(e), process.exit(1)));
