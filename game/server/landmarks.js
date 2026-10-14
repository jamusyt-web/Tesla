// Landmarks (SPEC §5.5): views, ruins, shrines, caches, secrets, curios and
// townsfolk out in the world, used from the context button (landmark.use).
// Each kind resets its own way (landmark_uses): once, weekly (caches), a
// 30-minute rest (shrines), or never (people to talk to).
import { ITEMS } from '../shared/items.js';
import { NODE_TYPES } from '../shared/nodes.js';
import { LANDMARKS, NODES, REGIONS, mulberry32 } from '../shared/world.js';
import { weekIndex } from '../shared/dungeon.js';
import { regionAt, townAt } from '../shared/places.js';
import { LANDMARK_INFO, LANDMARK_RANGE, cacheLoot, glimmers, atlasDrop, atlasPage, ATLAS, ATLAS_END, discoverables } from '../shared/journal.js';
import { tx, fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';
import { needTown } from './towns.js';
import * as rep from './rep.js';

const CURIO_REP = 30;

// The raw goods a region grows (cache loot draws from these).
const MATS = new Map();
function materialsOf(region) {
  if (!MATS.has(region)) MATS.set(region, [...new Set(NODES.filter((n) => regionAt(n.x, n.z)?.id === region).map((n) => NODE_TYPES[n.type]?.drops?.[0]?.id).filter(Boolean))]);
  return MATS.get(region);
}
export const landmarksChanged = () => MATS.clear();

export class Landmarks {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      use: p('SELECT period, at FROM landmark_uses WHERE account_id = ? AND landmark = ?'),
      put: p('INSERT INTO landmark_uses (account_id, landmark, period, at) VALUES (?,?,?,?) ON CONFLICT(account_id, landmark) DO UPDATE SET period = excluded.period, at = excluded.at'),
    };
  }

  // Can this hero use it now? null if yes, else the reason.
  waitReason(heroId, lm, now = Date.now()) {
    const info = LANDMARK_INFO[lm.kind];
    const last = this.q.use.get(heroId, lm.id);
    if (!last || info.reset === 'none') return null;
    const reset = lm.reset ?? info.reset;
    if (reset === 'once') return lm.kind === 'vista' ? null : 'You have already been here.';
    if (reset === 'weekly' && last.period === weekIndex(now)) return 'Empty. It fills again next week.';
    if (reset === 'cooldown' && now - last.at < info.ms) return `The shrine is quiet. Come back in ${Math.ceil((info.ms - (now - last.at)) / 60_000)} min.`;
    return null;
  }

  use(c, id, now = Date.now()) {
    const lm = LANDMARKS.find((l) => l.id === id);
    if (!lm) fail('Nothing here.');
    const info = LANDMARK_INFO[lm.kind];
    if (!info?.verb) fail('Just a place to find.');
    if (c.battle) fail("You're in a battle!");
    if (c.ch?.isRun) fail('Leave the dungeon first.');
    if (Math.hypot(c.ent.x - lm.x, c.ent.z - lm.z) > LANDMARK_RANGE + (lm.r ?? 0) * 0.25) fail('Walk up to it first.');
    const wait = this.waitReason(c.hero.id, lm, now);
    if (wait) fail(wait);
    const first = !this.q.use.get(c.hero.id, lm.id);
    const region = regionAt(lm.x, lm.z);
    const tier = region?.tier ?? 1;
    const H = this.game.heroes;
    const J = this.game.journal;
    const out = { kind: lm.kind, name: lm.name ?? lm.id };
    tx(this.game.db, () => {
      this.q.put.run(c.hero.id, lm.id, weekIndex(now), now);
      if (lm.kind === 'vista') {
        // Every place in the region goes on your map.
        out.look = lm.look ?? 0;
        out.pins = discoverables()
          .filter((d) => d.region === region?.id && d.id !== lm.id)
          .map((d) => (J.note(c.hero.id, 'seen', d.id, { now }), d.id));
      } else if (lm.kind === 'ruin') {
        out.lore = lm.lore ?? 'The stones are worn smooth. Whatever was written here is long gone.';
        J.note(c.hero.id, 'lore', lm.id, { now });
        if (first) out.loot = this.#give(c, cacheLoot(Math.max(1, Math.round(tier / 2)), materialsOf(region?.id), Math.random));
      } else if (lm.kind === 'shrine') {
        c.giveBoon('blessing');
        out.boon = 'blessing';
      } else if (lm.kind === 'cache') {
        const glim = glimmers(weekIndex(now)).includes(lm.id);
        out.loot = this.#give(c, cacheLoot(tier, materialsOf(region?.id), Math.random, glim));
        out.glimmer = glim;
      } else if (lm.kind === 'secret') {
        out.lore = lm.lore ?? 'You find a hollow, and in it something somebody hid long ago.';
        J.note(c.hero.id, 'lore', lm.id, { now });
        out.loot = this.#give(c, { gold: 0, items: lm.loot && ITEMS[lm.loot] ? { [lm.loot]: 1 } : {} });
      } else if (lm.kind === 'curio') {
        if (!lm.item || !ITEMS[lm.item]) fail('There is nothing to pick up.');
        H.addItem(c.hero.id, lm.item, 1, 'curio');
        out.loot = { gold: 0, items: { [lm.item]: 1 } };
        out.lore = ITEMS[lm.item].text ?? null;
      } else if (lm.kind === 'npc') {
        out.lines = lm.lines ?? [lm.lore ?? 'Good day to you!'];
      }
      // Ysolde's Atlas: the next page, if you hold the one before.
      const pages = new Set(ATLAS.map((_, i) => i + 1).filter((n) => H.count(c.hero.id, atlasPage(n)) > 0));
      const n = atlasDrop(lm.id, pages);
      const canStart = n !== 1 || c.questsDone?.has('hv_intro');
      if (n && canStart) {
        H.addItem(c.hero.id, atlasPage(n), 1, 'atlas');
        out.page = { n, riddle: ATLAS[n - 1].riddle };
        if (lm.kind === 'npc') out.lines = ['Ah, you have the look of someone who finishes things. Here: the first page of Ysolde’s Atlas. Old Ysolde mapped every corner of these lands, and hid the rest of her map along the way.', ATLAS[0].riddle];
      } else if (n === 1 && lm.kind === 'npc') out.lines = [...(out.lines ?? []), 'Come back when you know the island better. Finish your welcome first.'];
      if (lm.id === ATLAS_END && pages.has(ATLAS.length)) {
        out.atlasDone = true;
        this.game.journal.unlockTitle(c, 'Cartographer');
      }
    });
    c.pushInventory();
    emit(c, 'landmark', { id: lm.id, kind: lm.kind, region: region?.id ?? null });
    return out;
  }

  #give(c, loot) {
    const H = this.game.heroes;
    if (loot.gold) H.addGold(c.hero.id, loot.gold, 'cache');
    for (const [it, n] of Object.entries(loot.items ?? {})) if (ITEMS[it]) H.addItem(c.hero.id, it, n, 'cache');
    return loot;
  }

  // At a town hall: hand in the curios found around this town (for
  // reputation) and deliver any letters addressed to it (a quest step).
  returnCurios(c) {
    const town = needTown(this.game, c);
    const H = this.game.heroes;
    const bag = H.inventory(c.hero.id);
    const mine = (tag) => Object.keys(bag).filter((id) => bag[id] > 0 && ITEMS[id]?.tag === tag && (ITEMS[id].town ?? 'hearthvale') === town);
    const back = mine('curio');
    const letters = mine('letter');
    if (!back.length && !letters.length) fail('You have nothing for this town hall.');
    tx(this.game.db, () => {
      for (const id of [...back, ...letters]) H.takeItem(c.hero.id, id, bag[id], { kind: ITEMS[id].tag });
      if (back.length) rep.add(c.hero.id, town, CURIO_REP * back.length);
    });
    for (const id of letters) emit(c, 'deliver', { item: id, qty: 1, town });
    c.pushInventory();
    return { items: back, letters, rep: CURIO_REP * back.length };
  }

  // What the hero can see of each landmark's state: { id: wait reason | null }
  // (the client greys out ones that are resting).
  states(c, now = Date.now()) {
    const out = {};
    for (const lm of LANDMARKS) if (LANDMARK_INFO[lm.kind]?.verb) out[lm.id] = this.waitReason(c.hero.id, lm, now);
    return { states: out, glimmers: glimmers(weekIndex(now)).map((id) => regionAt(LANDMARKS.find((l) => l.id === id)?.x ?? 0, LANDMARKS.find((l) => l.id === id)?.z ?? 0)?.name).filter(Boolean) };
  }
}

register('landmark.use', (g, c, a) => g.landmarks.use(c, String(a.id ?? '')));
register('landmark.states', (g, c) => g.landmarks.states(c), { inRun: true });
register('curio.return', (g, c) => g.landmarks.returnCurios(c));
