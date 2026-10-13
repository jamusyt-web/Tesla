// Coming back (SPEC §5.6). After 12 hours away the hero gets a digest of
// what *happened* (never what they missed): shop sales, market fills and
// storage by town, orders and jobs, friends' big moments, today's twist.
// Any time away also fills the Hearth Rest pool: xp grants pay +50% from it
// until it is empty (server/heroes.js restTake).
import { todayStrip } from '../shared/almanac.js';
import { register } from './rpc.js';
import { townName } from './towns.js';

export const DIGEST_AFTER_MS = 12 * 3600_000;
export const REST_MAX_HOURS = 48;
export const restPerHour = (level) => 20 + 10 * level;
export const restCap = (level) => REST_MAX_HOURS * restPerHour(level);

export class Digest {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      storage: p('SELECT town, COUNT(*) AS kinds, SUM(qty) AS n FROM town_storage WHERE account_id = ? AND qty > 0 GROUP BY town'),
    };
  }

  // On connect: fill the rest pool for the time away, and say what happened
  // if it's been 12 hours. (away: ms since they were last active.)
  onConnect(c, away, now = Date.now()) {
    const hours = Math.min(REST_MAX_HOURS, Math.floor(away / 3600_000));
    if (hours >= 1) {
      const add = hours * restPerHour(c.hero.level);
      c.hero.rested = Math.min(restCap(c.hero.level), (c.hero.rested || 0) + add);
      this.game.heroes.setField(c.hero.id, 'rested', c.hero.rested);
    }
    if (away >= DIGEST_AFTER_MS) c.send({ t: 'digest', ...this.build(c, now - away, now) });
  }

  // What happened since `since`.
  build(c, since, now = Date.now()) {
    const g = this.game;
    const id = c.hero.id;
    const notices = g.notices.unseen(id);
    const shop = g.shops.awaySummary(id, now, since);
    const fills = {};
    for (const n of notices.filter((n) => n.kind === 'fill')) fills[n.town ?? 'hearthvale'] = (fills[n.town ?? 'hearthvale'] ?? 0) + 1;
    const storage = this.q.storage.all(id).map((r) => ({ town: r.town, name: townName(r.town), kinds: r.kinds, n: r.n }));
    const lines = notices.filter((n) => n.text && n.kind !== 'highlight').map((n) => ({ kind: n.kind, text: n.text, at: n.at }));
    const friends = g.notices.since(0, since).filter((n) => n.kind === 'highlight').slice(-8).map((n) => ({ text: n.text, at: n.at }));
    return {
      since,
      away: now - since,
      rested: c.hero.rested || 0,
      shop: shop ? { count: shop.count, net: shop.net } : null,
      fills: Object.entries(fills).map(([town, n]) => ({ town, name: townName(town), n })),
      storage,
      lines,
      friends,
      today: todayStrip(now),
      upto: notices.length ? Math.max(...notices.map((n) => n.id)) : 0,
    };
  }

  ack(c, upto) {
    return this.game.notices.ack(c.hero.id, upto);
  }
}

// A big moment worth telling friends who were away (a legendary fish, a
// dungeon conquered, a Big Order filled): kept as a server-wide notice.
export function highlight(game, text, data = {}) {
  game.notices?.add(0, 'highlight', data, text);
}

register('digest.get', (g, c) => g.digest.build(c, (g.lastActive.get(c.hero.id) ?? Date.now()) - 1), { inRun: true });
register('digest.ack', (g, c, a) => g.digest.ack(c, a.upto), { inRun: true });
