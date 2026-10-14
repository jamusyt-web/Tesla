// The journal on the server (SPEC §5.5): everything a hero has found, one
// row per thing (table journal: kind, id, first seen, best, count), and the
// region pages built from it. Kinds:
//   place (discovered) · seen (pinned by a view) · creature (kills) ·
//   node (rich:<type> / ancient:<type> seen) · fish (best kg) · recipe ·
//   lore (ruins read) · title · unlock (cloak:<biome>, discount:<region>, plaque:<region>, pins:<region>)
import { ITEMS } from '../shared/items.js';
import { MONSTERS } from '../shared/monsters.js';
import { NODE_TYPES } from '../shared/nodes.js';
import { RECIPES } from '../shared/recipes.js';
import { FISH, tableOf } from '../shared/fishing.js';
import { DUNGEONS } from '../shared/dungeon.js';
import { REGIONS, SPAWNS, NODES, LAKES, ENTRANCES } from '../shared/world.js';
import { regionAt, townAt } from '../shared/places.js';
import { regionCells, discoverables, pagePct, hasBit, PAGE_STEPS, WHOLE_STEPS, pageReward, wholeReward, JOURNAL_REP } from '../shared/journal.js';
import { tx, fail } from './db.js';
import { on } from './events.js';
import { register } from './rpc.js';
import * as rep from './rep.js';

export class Journal {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      note: p('INSERT INTO journal (account_id, kind, id, first_at, best, n) VALUES (?,?,?,?,?,?) ON CONFLICT(account_id, kind, id) DO UPDATE SET n = n + excluded.n, best = MAX(COALESCE(best, excluded.best), COALESCE(excluded.best, best))'),
      one: p('SELECT first_at, best, n FROM journal WHERE account_id = ? AND kind = ? AND id = ?'),
      kind: p('SELECT id, first_at, best, n FROM journal WHERE account_id = ? AND kind = ?'),
      claims: p('SELECT page, pct FROM journal_claims WHERE account_id = ?'),
      claim: p('INSERT INTO journal_claims (account_id, page, pct, at) VALUES (?,?,?,?)'),
    };
  }

  // Note something: { first (never seen before), best (a new best) }.
  note(heroId, kind, id, { best = null, n = 1, now = Date.now() } = {}) {
    const prev = this.q.one.get(heroId, kind, id);
    this.q.note.run(heroId, kind, id, now, best, n);
    return { first: !prev, best: best != null && (prev?.best == null || best > prev.best), prev: prev?.best ?? null };
  }
  has(heroId, kind, id) {
    return !!this.q.one.get(heroId, kind, id);
  }
  ids(heroId, kind) {
    return new Set(this.q.kind.all(heroId, kind).map((r) => r.id));
  }
  rows(heroId, kind) {
    return new Map(this.q.kind.all(heroId, kind).map((r) => [r.id, r]));
  }

  // A title earned (a quest, a page): kept in the journal, worn at once if
  // the hero had none.
  unlockTitle(c, title) {
    const { first } = this.note(c.hero.id, 'title', title);
    if (!first) return;
    if (!c.hero.title) {
      c.hero.title = title;
      this.game.heroes.setField(c.hero.id, 'title', title);
    }
    c.send({ t: 'title', title, worn: c.hero.title === title });
  }

  // ── Pages ──
  // Every region's page for a hero: { id, name, tier, pct, walked, land, found, places, tabs }.
  pages(c) {
    const id = c.hero.id;
    const bits = this.game.explore?.bitsOf(c);
    const cells = regionCells();
    const found = this.ids(id, 'place');
    const all = discoverables();
    const creatures = this.rows(id, 'creature');
    const fish = this.rows(id, 'fish');
    const recipes = this.rows(id, 'recipe');
    const nodes = this.ids(id, 'node');
    const lore = this.ids(id, 'lore');
    const pins = this.ids(id, 'seen');
    return REGIONS.map((r) => {
      const land = cells.get(r.id) ?? [];
      const walked = bits ? land.filter((k) => hasBit(bits, k)).length : 0;
      const places = all.filter((d) => d.region === r.id);
      const got = places.filter((d) => found.has(d.id));
      const inR = (x, z) => regionAt(x, z)?.id === r.id;
      const mobs = new Set(SPAWNS.filter((s) => inR(s.x, s.z)).map((s) => s.monster));
      for (const e of ENTRANCES.filter((e) => inR(e.x, e.z))) for (const m of [...(DUNGEONS[e.kind]?.pool ?? []), DUNGEONS[e.kind]?.boss?.monster]) if (m) mobs.add(m);
      const types = new Set(NODES.filter((n) => inR(n.x, n.z) && NODE_TYPES[n.type]?.kind !== 'fish').map((n) => n.type));
      const fishes = new Set();
      for (const l of LAKES.filter((l) => inR(l.x, l.z))) for (const f of tableOf(l.fish).fish) if (f.id !== 'old_boot') fishes.add(f.id);
      for (const l of LAKES.filter((l) => inR(l.x, l.z))) for (const f of tableOf(l.fish).legends ?? []) fishes.add(f);
      const town = townAt(r.x, r.z)?.id === r.id ? r.id : null;
      const recs = RECIPES.filter((x) => (x.town ? x.town === r.id : r.id === (REGIONS.find((t) => t.kind === 'town')?.id ?? 'hearthvale')));
      return {
        id: r.id,
        name: r.name,
        tier: r.tier ?? 1,
        kind: r.kind,
        town,
        pct: pagePct(walked, land.length, got.length, places.length),
        walked,
        land: land.length,
        found: got.length,
        places: places.length,
        tabs: {
          places: places.map((d) => ({ id: d.id, kind: d.kind, name: found.has(d.id) || pins.has(d.id) ? d.name : null, found: found.has(d.id), pinned: pins.has(d.id), x: found.has(d.id) || pins.has(d.id) ? d.x : null, z: found.has(d.id) || pins.has(d.id) ? d.z : null })),
          creatures: [...mobs].map((m) => ({ id: m, name: creatures.has(m) ? MONSTERS[m]?.name ?? m : null, n: creatures.get(m)?.n ?? 0 })),
          gatherables: [...types].map((t) => ({ id: t, name: NODE_TYPES[t]?.name ?? t, rich: nodes.has(`rich:${t}`), ancient: nodes.has(`ancient:${t}`) })),
          fish: [...fishes].map((f) => ({ id: f, name: fish.has(f) ? ITEMS[f]?.name ?? f : null, best: fish.get(f)?.best ?? null, legend: !!FISH[f]?.legend })),
          recipes: recs.map((x) => ({ id: x.id, out: x.out, name: recipes.has(x.id) ? ITEMS[x.out]?.name ?? x.id : null, best: recipes.get(x.id)?.best ?? null })),
          secrets: places.filter((d) => ['secret', 'curio', 'ruin'].includes(d.kind)).map((d) => ({ id: d.id, kind: d.kind, name: found.has(d.id) ? d.name : null, read: lore.has(d.id) })),
        },
      };
    });
  }
  // The whole journal's discovery: the average of every page.
  wholePct(pages) {
    return pages.length ? Math.floor(pages.reduce((a, p) => a + p.pct, 0) / pages.length) : 0;
  }

  get(c) {
    const pages = this.pages(c);
    const claims = this.q.claims.all(c.hero.id).map((r) => `${r.page}:${r.pct}`);
    return { pages, whole: this.wholePct(pages), claims, titles: [...this.ids(c.hero.id, 'title')], title: c.hero.title ?? null };
  }

  // Claim a page milestone (or 'whole' for the whole journal).
  claim(c, page, pct, now = Date.now()) {
    pct = Number(pct);
    const pages = this.pages(c);
    const whole = page === 'whole';
    const p = whole ? null : pages.find((x) => x.id === page);
    if (!whole && !p) fail('No such page.');
    if (!(whole ? WHOLE_STEPS : PAGE_STEPS).includes(pct)) fail('No such reward.');
    if ((whole ? this.wholePct(pages) : p.pct) < pct) fail(`Discover ${pct}% first.`);
    const region = whole ? null : REGIONS.find((r) => r.id === page);
    const reward = whole ? wholeReward(pct) : pageReward(region, pct);
    const id = c.hero.id;
    tx(this.game.db, () => {
      try {
        this.q.claim.run(id, page, pct, now);
      } catch {
        fail('Already claimed.');
      }
      for (const [item, n] of Object.entries(reward.items ?? {})) this.game.heroes.addItem(id, item, n, 'journal');
      if (reward.pins) this.note(id, 'unlock', `pins:${page}`);
      if (reward.cloak) this.note(id, 'unlock', `cloak:${reward.cloak}`);
      if (reward.stoneDiscount) this.note(id, 'unlock', `discount:${page}`);
      if (reward.plaque) this.note(id, 'unlock', `plaque:${page}`);
      if (!whole) rep.add(id, townAt(region.x, region.z)?.id ?? 'hearthvale', JOURNAL_REP);
    });
    if (reward.title) this.unlockTitle(c, reward.title);
    if (reward.pins) for (const d of discoverables().filter((d) => d.region === page && (d.kind === 'cache' || d.kind === 'lake'))) this.note(id, 'seen', d.id);
    c.pushInventory();
    return { reward, claimed: `${page}:${pct}` };
  }

  // A shop's trophy wall: regions fully discovered, the best fish records,
  // and a few titles. [lines]
  trophies(heroId) {
    const out = [];
    for (const id of this.ids(heroId, 'unlock')) if (id.startsWith('plaque:')) out.push(`★ ${REGIONS.find((r) => r.id === id.slice(7))?.name ?? id.slice(7)}: every corner found`);
    const fish = [...this.rows(heroId, 'fish').entries()].filter(([, r]) => r.best).sort((a, b) => (ITEMS[b[0]]?.value ?? 0) - (ITEMS[a[0]]?.value ?? 0)).slice(0, 3);
    for (const [id, r] of fish) out.push(`🐟 ${ITEMS[id]?.name ?? id}: ${r.best} kg`);
    for (const t of [...this.ids(heroId, 'title')].slice(0, 2)) out.push(`🎖 ${t}`);
    return out.slice(0, 6);
  }

  // Waystone fees into a region you've fully discovered are halved.
  discount(heroId, region) {
    return this.has(heroId, 'unlock', `discount:${region}`) ? 0.5 : 0;
  }
  // Wear one of your titles (or none).
  setTitle(c, title) {
    if (title && !this.has(c.hero.id, 'title', title)) fail("You haven't earned that title.");
    c.hero.title = title || null;
    this.game.heroes.setField(c.hero.id, 'title', c.hero.title);
    return { title: c.hero.title };
  }
}

// What the journal notices on its own.
on('kill', (c, d) => c?.game?.journal?.note(c.hero.id, 'creature', d.monster));
on('craft', (c, d) => c?.game?.journal?.note(c.hero.id, 'recipe', d.recipe ?? d.out));
on('gather', (c, d) => (d.st === 1 || d.st === 2) && c?.game?.journal?.note(c.hero.id, 'node', `${d.st === 2 ? 'ancient' : 'rich'}:${d.type}`));
on('fish', (c, d) => {
  const J = c?.game?.journal;
  if (!J || d.item === 'old_boot') return;
  const r = J.note(c.hero.id, 'fish', d.item, { best: d.kg });
  if (r.best && r.prev != null) c.send({ t: 'record', item: d.item, kg: d.kg, prev: r.prev });
});

const inRun = { inRun: true };
register('journal.get', (g, c) => g.journal.get(c), inRun);
register('journal.claim', (g, c, a) => g.journal.claim(c, String(a.page ?? ''), a.pct), inRun);
register('title.set', (g, c, a) => g.journal.setTitle(c, a.title ? String(a.title) : null), inRun);
