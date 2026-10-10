import { ITEMS, isItem } from '../shared/items.js';
import { tx, fail } from './db.js';

export const MARKET_TAX = 0.04; // paid by the seller on every fill — the economy's main gold sink
export const MAX_OPEN_ORDERS = 25;
const MAX_PRICE = 10_000_000;
const MAX_QTY = 9_999;

// Albion-style order book. Orders escrow their goods/gold on placement and
// match immediately against the best opposite orders at the *resting* order's
// price (price-time priority). All inside one SQLite transaction.
export class Market {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    this.q = {
      bestBuy: db.prepare(`SELECT * FROM market_orders WHERE item = ? AND side = 'buy' AND status = 'open' AND price >= ? AND account_id != ? ORDER BY price DESC, id ASC LIMIT 1`),
      bestSell: db.prepare(`SELECT * FROM market_orders WHERE item = ? AND side = 'sell' AND status = 'open' AND price <= ? AND account_id != ? ORDER BY price ASC, id ASC LIMIT 1`),
      fill: db.prepare(`UPDATE market_orders SET filled = filled + ?, status = CASE WHEN filled + ? >= qty THEN 'filled' ELSE status END WHERE id = ?`),
      insert: db.prepare(`INSERT INTO market_orders (account_id, side, item, price, qty, filled, status, created_at) VALUES (?,?,?,?,?,?,?,?)`),
      trade: db.prepare(`INSERT INTO market_trades (item, price, qty, buyer, seller, ts) VALUES (?,?,?,?,?,?)`),
      get: db.prepare(`SELECT * FROM market_orders WHERE id = ?`),
      cancel: db.prepare(`UPDATE market_orders SET status = 'cancelled' WHERE id = ?`),
      openCount: db.prepare(`SELECT COUNT(*) AS n FROM market_orders WHERE account_id = ? AND status = 'open'`),
      mine: db.prepare(`SELECT * FROM market_orders WHERE account_id = ? AND (status = 'open' OR created_at > ?) ORDER BY status = 'open' DESC, created_at DESC LIMIT 60`),
      depth: db.prepare(`SELECT price, SUM(qty - filled) AS qty, COUNT(*) AS orders FROM market_orders WHERE item = ? AND side = ? AND status = 'open' GROUP BY price ORDER BY CASE WHEN ? = 'sell' THEN price ELSE -price END LIMIT 10`),
      history: db.prepare(`SELECT price, qty, ts FROM market_trades WHERE item = ? ORDER BY ts DESC LIMIT 60`),
      summary: db.prepare(`
        SELECT i.item,
          (SELECT MIN(price) FROM market_orders WHERE item = i.item AND side='sell' AND status='open') AS ask,
          (SELECT SUM(qty-filled) FROM market_orders WHERE item = i.item AND side='sell' AND status='open') AS supply,
          (SELECT MAX(price) FROM market_orders WHERE item = i.item AND side='buy' AND status='open') AS bid,
          (SELECT SUM(qty-filled) FROM market_orders WHERE item = i.item AND side='buy' AND status='open') AS demand,
          (SELECT price FROM market_trades WHERE item = i.item ORDER BY ts DESC LIMIT 1) AS last,
          (SELECT SUM(qty) FROM market_trades WHERE item = i.item AND ts > ?) AS vol
        FROM (SELECT DISTINCT item FROM market_orders UNION SELECT DISTINCT item FROM market_trades) i`),
    };
  }

  // Returns { order, fills, notify: Set<accountId> }
  place(accountId, { side, item, price, qty, ioc = false }) {
    price = Number(price);
    qty = Number(qty);
    if (side !== 'buy' && side !== 'sell') fail('Bad order side.');
    if (!isItem(item)) fail('Unknown item.');
    if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) fail('Price must be a whole number of gold.');
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) fail('Quantity must be between 1 and 9999.');
    if (!ioc && this.q.openCount.get(accountId).n >= MAX_OPEN_ORDERS) fail(`You can have at most ${MAX_OPEN_ORDERS} open orders.`);

    return tx(this.db, () => {
      const H = this.heroes;
      const notify = new Set([accountId]);
      const fills = [];
      let remaining = qty;
      if (side === 'sell') {
        H.takeItem(accountId, item, qty); // escrow goods
        for (;;) {
          if (!remaining) break;
          const o = this.q.bestBuy.get(item, price, accountId);
          if (!o) break;
          const n = Math.min(remaining, o.qty - o.filled);
          this.#execute(item, o.price, n, o.account_id, accountId);
          this.q.fill.run(n, n, o.id);
          notify.add(o.account_id);
          fills.push({ price: o.price, qty: n });
          remaining -= n;
        }
        if (remaining && ioc) H.addItem(accountId, item, remaining);
      } else {
        H.addGold(accountId, -price * qty); // escrow gold at the limit price
        for (;;) {
          if (!remaining) break;
          const o = this.q.bestSell.get(item, price, accountId);
          if (!o) break;
          const n = Math.min(remaining, o.qty - o.filled);
          this.#execute(item, o.price, n, accountId, o.account_id);
          if (price > o.price) H.addGold(accountId, (price - o.price) * n); // refund price improvement
          this.q.fill.run(n, n, o.id);
          notify.add(o.account_id);
          fills.push({ price: o.price, qty: n });
          remaining -= n;
        }
        if (remaining && ioc) H.addGold(accountId, price * remaining);
      }
      let order = null;
      if (remaining && !ioc) {
        const r = this.q.insert.run(accountId, side, item, price, qty, qty - remaining, 'open', Date.now());
        order = this.q.get.get(Number(r.lastInsertRowid));
      }
      if (ioc && !fills.length) fail(side === 'buy' ? 'Nobody is selling at that price anymore.' : 'Nobody is buying at that price anymore.');
      return { order, fills, filledQty: qty - remaining, notify };
    });
  }

  // Seller receives gold minus tax; buyer receives the goods. Buyer's gold and
  // seller's goods are already in escrow by the time we get here.
  #execute(item, price, qty, buyer, seller) {
    const gross = price * qty;
    const tax = Math.floor(gross * MARKET_TAX);
    this.heroes.addGold(seller, gross - tax);
    this.heroes.addItem(buyer, item, qty);
    this.q.trade.run(item, price, qty, buyer, seller, Date.now());
  }

  cancel(accountId, orderId) {
    return tx(this.db, () => {
      const o = this.q.get.get(Number(orderId));
      if (!o || o.account_id !== accountId) fail('Order not found.');
      if (o.status !== 'open') fail('That order is already closed.');
      const left = o.qty - o.filled;
      if (o.side === 'sell') this.heroes.addItem(accountId, o.item, left);
      else this.heroes.addGold(accountId, o.price * left);
      this.q.cancel.run(o.id);
      return o;
    });
  }

  book(item) {
    if (!isItem(item)) fail('Unknown item.');
    const day = Date.now() - 86400_000;
    const history = this.q.history.all(item).reverse();
    const recent = history.filter((h) => h.ts > day);
    const vol = recent.reduce((s, h) => s + h.qty, 0);
    const avg = vol ? Math.round(recent.reduce((s, h) => s + h.price * h.qty, 0) / vol) : null;
    return {
      item,
      asks: this.q.depth.all(item, 'sell', 'sell'),
      bids: this.q.depth.all(item, 'buy', 'buy'),
      history,
      avg24: avg,
      vol24: vol,
      npc: ITEMS[item].value,
    };
  }

  summary() {
    const rows = this.q.summary.all(Date.now() - 86400_000);
    return Object.fromEntries(rows.filter((r) => isItem(r.item)).map((r) => [r.item, { ask: r.ask, bid: r.bid, supply: r.supply || 0, demand: r.demand || 0, last: r.last, vol: r.vol || 0 }]));
  }

  mine(accountId) {
    return this.q.mine.all(accountId, Date.now() - 6 * 3600_000);
  }
}
