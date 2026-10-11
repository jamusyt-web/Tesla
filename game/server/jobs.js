import { ITEMS, isItem } from '../shared/items.js';
import { MARKET_TAX_PM } from '../shared/economy.js';
import { tx, fail } from './db.js';

// The bulletin board: paid jobs between players. A job asks for `qty` of an
// item at `per` gold each. The poster's gold is held when the job goes up, so
// it always pays. Anyone (but the poster) can deliver some or all of it and is
// paid on the spot, less the usual 4% tax; the goods go straight into the
// poster's bag, online or not. Unfilled jobs expire after a few days, and
// cancelling or expiring refunds whatever wasn't delivered.
export const JOB_DAYS = 3;
export const MAX_OPEN_JOBS = 5;
const MAX_QTY = 999;
const MAX_PER = 1_000_000;

export class Jobs {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    this.q = {
      insert: db.prepare('INSERT INTO jobs (poster, item, qty, left, per, created_at, expires_at) VALUES (?,?,?,?,?,?,?)'),
      get: db.prepare('SELECT * FROM jobs WHERE id = ?'),
      open: db.prepare(`SELECT j.*, h.name AS poster_name FROM jobs j JOIN heroes h ON h.account_id = j.poster WHERE j.status = 'open' AND j.expires_at > ? ORDER BY j.created_at DESC LIMIT 200`),
      mine: db.prepare(`SELECT * FROM jobs WHERE poster = ? AND (status = 'open' OR closed_at > ?) ORDER BY status = 'open' DESC, created_at DESC LIMIT 30`),
      openCount: db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE poster = ? AND status = 'open'`),
      take: db.prepare(`UPDATE jobs SET left = left - ? WHERE id = ? AND status = 'open' AND left >= ?`),
      close: db.prepare(`UPDATE jobs SET status = ?, closed_at = ? WHERE id = ?`),
      expired: db.prepare(`SELECT * FROM jobs WHERE status = 'open' AND expires_at <= ?`),
    };
  }

  #row(j) {
    return { id: j.id, poster: j.poster, posterName: j.poster_name, item: j.item, qty: j.qty, left: j.left, per: j.per, createdAt: j.created_at, expiresAt: j.expires_at, status: j.status };
  }

  // Close jobs past their time and refund what's left. Returns the posters to tell.
  expire(now = Date.now()) {
    const out = [];
    for (const j of this.q.expired.all(now))
      tx(this.db, () => {
        if (j.left > 0) this.heroes.addGold(j.poster, j.left * j.per);
        this.q.close.run('expired', now, j.id);
        out.push({ poster: j.poster, item: j.item, left: j.left, refund: j.left * j.per });
      });
    return out;
  }

  list(now = Date.now()) {
    return this.q.open.all(now).map((j) => this.#row(j));
  }
  mine(accountId, now = Date.now()) {
    return this.q.mine.all(accountId, now - 24 * 3600_000).map((j) => this.#row(j));
  }

  post(accountId, { item, qty, per }, now = Date.now()) {
    qty = Number(qty);
    per = Number(per);
    if (!isItem(item)) fail('Pick an item for the job.');
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) fail(`Ask for between 1 and ${MAX_QTY}.`);
    if (!Number.isInteger(per) || per < 1 || per > MAX_PER) fail('The pay must be a whole number of gold per item.');
    if (this.q.openCount.get(accountId).n >= MAX_OPEN_JOBS) fail(`You can have at most ${MAX_OPEN_JOBS} jobs up at once.`);
    const total = qty * per;
    if (this.heroes.gold(accountId) < total) fail(`That job pays ${total} gold in all; you don't have that much.`);
    return tx(this.db, () => {
      this.heroes.addGold(accountId, -total); // held until delivered, cancelled or expired
      const id = Number(this.q.insert.run(accountId, item, qty, qty, per, now, now + JOB_DAYS * 86400_000).lastInsertRowid);
      return this.#row(this.q.get.get(id));
    });
  }

  // Hand in up to `qty` for job `id`. Returns what happened, for both sides.
  deliver(accountId, id, qty, now = Date.now()) {
    id = Number(id);
    qty = Number(qty);
    const j = this.q.get.get(id);
    if (!j || j.status !== 'open' || j.expires_at <= now) fail('That job is no longer up.');
    if (j.poster === accountId) fail("That's your own job.");
    if (!Number.isInteger(qty) || qty < 1) fail('Bad amount.');
    qty = Math.min(qty, j.left);
    return tx(this.db, () => {
      const H = this.heroes;
      H.takeItem(accountId, j.item, qty, { keepEquipped: true });
      if (this.q.take.run(qty, id, qty).changes !== 1) fail('That job is no longer up.');
      H.addItem(j.poster, j.item, qty);
      const gross = qty * j.per;
      const tax = H.takeFee(accountId, gross, MARKET_TAX_PM);
      H.addGold(accountId, gross - tax);
      const left = j.left - qty;
      if (left === 0) this.q.close.run('done', now, id);
      return { job: id, poster: j.poster, item: j.item, qty, gross, tax, paid: gross - tax, left };
    });
  }

  cancel(accountId, id, now = Date.now()) {
    const j = this.q.get.get(Number(id));
    if (!j || j.poster !== accountId) fail('Not your job.');
    if (j.status !== 'open') fail('That job is already closed.');
    return tx(this.db, () => {
      const refund = j.left * j.per;
      if (refund) this.heroes.addGold(accountId, refund);
      this.q.close.run('cancelled', now, j.id);
      return { refund, delivered: j.qty - j.left, item: j.item };
    });
  }
}

export const jobText = (j) => `${j.qty}× ${ITEMS[j.item]?.name ?? j.item}`;
