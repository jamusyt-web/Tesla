// A phone-sized play-through for Gate G2 (SPEC §10): a new hero plays for a
// while by pressing the context button and "Take me there" on the goal
// card, and we check every second that the context button is never blank
// while they're out in the world.
//
//   OPEN_SIGNUP=1 PORT=8790 DATA_DIR=/tmp/hv node --no-warnings server/index.js
//   NODE_PATH=$(npm root -g) node scripts/smoke-mobile.cjs http://127.0.0.1:8790 600
//
// Needs Playwright (npm i -g playwright). Prints a summary and exits 1 if the
// button was ever blank.
const { createRequire } = require('node:module');
const { chromium } = createRequire(process.env.NODE_PATH + '/')('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8790';
const seconds = Number(process.argv[3] || 600);
const post = (p, b, t) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t || ''}` }, body: JSON.stringify(b) }).then((r) => r.json());

(async () => {
  const name = `Smoke${Date.now() % 10000}`;
  const s = await post('/api/signup', { username: name.toLowerCase(), password: 'secret1' });
  if (!s.token) throw new Error(`signup failed: ${JSON.stringify(s)} (is OPEN_SIGNUP=1 set?)`);
  await post('/api/hero', { name, avatar: {} }, s.token);
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.addInitScript((t) => localStorage.setItem('hv_token', t), s.token);
  await pg.goto(base);
  await pg.waitForFunction(() => window.__hv?.game?.me, null, { timeout: 90000 });
  await pg.waitForTimeout(4000);
  const out = { samples: 0, blank: 0, presses: 0, takes: 0, labels: new Map(), errors };
  const until = Date.now() + seconds * 1000;
  let tick = 0;
  while (Date.now() < until) {
    tick++;
    const st = await pg.evaluate(() => {
      const { game: g, hud } = window.__hv;
      const btn = document.querySelector('.ctxbtn');
      const world = !g.dungeon && !g.room && !g.battle && !hud.fight;
      return { world, busy: !!(g.gather || g.fishing || g.craft || g.me.local.path), panel: !!hud.panels.cur || !!hud.craftGame || !!hud.fight, battle: !!g.battle, label: btn && !btn.classList.contains('hidden') ? btn.innerText.trim() : '', level: hud.me.level };
    });
    if (st.world && !st.panel) {
      out.samples++;
      if (!st.label) out.blank++;
      else out.labels.set(st.label.replace(/\d+/g, '#'), (out.labels.get(st.label.replace(/\d+/g, '#')) ?? 0) + 1);
    }
    // Play: fight when fighting, close what opens, else press the button (or
    // now and then the goal card's "Take me there").
    await pg.evaluate(async ({ tick, st }) => {
      const { game: g, hud, sock } = window.__hv;
      if (st.battle) return sock.send({ t: 'bact', a: 'attack' });
      // Inside the shop (the goal card sent us to stock it): put something on a shelf, then out.
      if (g.room) {
        const item = Object.keys(hud.me.inv ?? {}).find((id) => hud.me.inv[id] > 1 && !/^(axe|pick|rod|sword)_/.test(id));
        if (item) await sock.rpc('shop.stock', { slot: tick % 8, item, qty: 1, price: 5 }).catch(() => {});
        hud.panels.close();
        return g.exitShop();
      }
      if (hud.craftGame) return hud.craftGame.scrim?.classList.contains('result') ? hud.craftGame.close() : null; // let the craft play out, then close its result
      if (hud.panels.cur) return hud.panels.close();
      if (hud.levelup?.el && !hud.levelup.el.classList.contains('hidden')) hud.levelup.close();
      if (st.busy) {
        if (g.gather) g.swing();
        return;
      }
      if (tick % 4 === 0) document.querySelector('.quest.goal .gbtns .btn.green')?.click();
      else hud.context.press();
    }, { tick, st });
    if (st.world && !st.busy && !st.panel) out[tick % 4 === 0 ? 'takes' : 'presses']++;
    await pg.waitForTimeout(1000);
  }
  const level = await pg.evaluate(() => window.__hv.hud.me.level);
  await br.close();
  console.log(`Smoke run ${seconds} s: context button blank in ${out.blank}/${out.samples} samples; ${out.presses} presses, ${out.takes} "Take me there"; hero level ${level}.`);
  console.log('Most seen labels:', [...out.labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, n]) => `${l} ×${n}`).join(' · '));
  if (errors.length) console.log('Page errors:', errors.slice(0, 5));
  process.exit(out.blank || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
