// The field guide on the server (Living wilds): the guide built from a
// hero's journal rows (shared/fieldguide.js), and its page rewards. Claims
// share the journal's claims table, as page 'guide:<id>', so each pays once.
import { buildGuide, guideReward, GUIDE_STEPS, GUIDE_PAGES } from '../shared/fieldguide.js';
import { tx, fail } from './db.js';
import { register } from './rpc.js';

// A hero's journal rows, as the guide reads them.
function rowsOf(g, id) {
  const J = g.journal;
  return { variant: J.rows(id, 'variant'), node: J.ids(id, 'node'), fish: J.rows(id, 'fish'), creature: J.rows(id, 'creature') };
}

export function guideOf(g, c) {
  const claims = g.journal.q.claims
    .all(c.hero.id)
    .filter((r) => r.page.startsWith('guide:'))
    .map((r) => `${r.page.slice(6)}:${r.pct}`);
  const unlocks = g.journal.ids(c.hero.id, 'unlock');
  return { pages: buildGuide(rowsOf(g, c.hero.id)), claims, cloaks: GUIDE_PAGES.filter((p) => unlocks.has(`cloak:${p.cloak}`)).map((p) => p.cloak) };
}

export function claimGuide(g, c, page, pct, now = Date.now()) {
  pct = Number(pct);
  if (!GUIDE_STEPS.includes(pct)) fail('No such reward.');
  const p = buildGuide(rowsOf(g, c.hero.id)).find((x) => x.id === page);
  if (!p) fail('No such page.');
  if (p.pct < pct) fail(`Fill ${pct}% of the page first.`);
  const reward = guideReward(page, pct);
  const id = c.hero.id;
  tx(g.db, () => {
    try {
      g.journal.q.claim.run(id, `guide:${page}`, pct, now);
    } catch {
      fail('Already claimed.');
    }
    if (reward.gold) g.heroes.addGold(id, reward.gold, 'guide');
    if (reward.cloak) g.journal.note(id, 'unlock', `cloak:${reward.cloak}`);
  });
  for (const [skill, n] of Object.entries(reward.xp ?? {})) c.send({ t: 'xp', xp: g.heroes.addXp(c.hero, skill, n) });
  if (reward.title) g.journal.unlockTitle(c, reward.title);
  c.pushInventory();
  return { reward, ...guideOf(g, c) };
}

const inRun = { inRun: true };
register('guide.get', (g, c) => guideOf(g, c), inRun);
register('guide.claim', (g, c, a) => claimGuide(g, c, String(a.page ?? ''), a.pct), inRun);
