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
      add: p('INSERT INTO notices (account_id, kind, data, at, seen) VALUES (?,?,?,?,?)'),
      unseen: p('SELECT id, kind, data, at FROM notices WHERE account_id = ? AND seen = 0 ORDER BY id'),
      since: p('SELECT id, kind, data, at FROM notices WHERE account_id = ? AND at >= ? ORDER BY id'),
      ack: p('UPDATE notices SET seen = 1 WHERE account_id = ? AND id <= ?'),
      prune: p('DELETE FROM notices WHERE account_id = ? AND seen = 1 AND id <= (SELECT id FROM notices WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    };
  }

  // Keep a notice for a hero; if they're online, show it now too.
  // Shown live (online, with words) or a server-wide highlight (account 0):
  // kept as seen, so it isn't told twice and old ones get trimmed.
  add(heroId, kind, data = {}, text = null, now = Date.now()) {
    const c = text ? this.game.online.get(heroId) : null;
    const seen = heroId === 0 || !!c ? 1 : 0;
    const id = Number(this.q.add.run(heroId, kind, JSON.stringify({ ...data, text }), now, seen).lastInsertRowid);
    this.q.prune.run(heroId, heroId, KEEP);
    c?.send({ t: 'notice', kind, text, id });
    return id;
  }
  // Back after a short while (no digest): what's waiting, as a few toasts.
  showWaiting(c) {
    const list = this.unseen(c.hero.id);
    if (!list.length) return;
    for (const n of list.filter((x) => x.text).slice(-5)) c.send({ t: 'notice', kind: n.kind, text: n.text, id: n.id });
    const fills = list.filter((x) => x.kind === 'fill').length;
    if (fills) c.send({ t: 'notice', kind: 'fill', text: `${fills} of your market order${fills === 1 ? ' was' : 's were'} filled while you were away.` });
    this.ack(c.hero.id, Math.max(...list.map((x) => x.id)));
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
