// Offline notices (SPEC §5.6): things that happen to a hero while they may
// not be looking (a job delivered, an order expired, a market order filled,
// a Big Order done). Each is kept until seen, sent at once to a hero who is
// online, and listed in the welcome-back digest. The systems call add();
// a hero who is online and already got a toast gets no second one.
import { register } from './rpc.js';

const KEEP = 200; // notices kept per hero (the oldest seen ones go first)

export class Notices {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      add: p('INSERT INTO notices (account_id, kind, data, at) VALUES (?,?,?,?)'),
      unseen: p('SELECT id, kind, data, at FROM notices WHERE account_id = ? AND seen = 0 ORDER BY id'),
      since: p('SELECT id, kind, data, at FROM notices WHERE account_id = ? AND at >= ? ORDER BY id'),
      ack: p('UPDATE notices SET seen = 1 WHERE account_id = ? AND id <= ?'),
      prune: p('DELETE FROM notices WHERE account_id = ? AND seen = 1 AND id <= (SELECT id FROM notices WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    };
  }

  // Keep a notice for a hero; if they're online, show it now too.
  add(heroId, kind, data = {}, text = null, now = Date.now()) {
    const id = Number(this.q.add.run(heroId, kind, JSON.stringify({ ...data, text }), now).lastInsertRowid);
    this.q.prune.run(heroId, heroId, KEEP);
    if (text) this.game.online.get(heroId)?.send({ t: 'notice', kind, text, id });
    return id;
  }
  unseen(heroId) {
    return this.q.unseen.all(heroId).map(parse);
  }
  since(heroId, t) {
    return this.q.since.all(heroId, t).map(parse);
  }
  ack(heroId, upto) {
    upto = Number(upto);
    if (!Number.isFinite(upto)) return { ok: false };
    this.q.ack.run(heroId, upto);
    return { ok: true };
  }
}

const parse = (r) => {
  let data = {};
  try {
    data = JSON.parse(r.data);
  } catch {}
  return { id: r.id, kind: r.kind, at: r.at, ...data };
};

register('notices.ack', (g, c, a) => g.notices.ack(c.hero.id, a.upto), { inRun: true });
