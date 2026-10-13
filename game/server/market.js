import { isItem } from '../shared/items.js';
import { tx, fail } from './db.js';
import { MARKET_TAX } from '../shared/economy.js';
import { stash } from './storage.js';

export { MARKET_TAX }; // paid by the seller on every fill — the economy's main gold sink
export const MAX_OPEN_ORDERS = 25;
const MAX_PRICE = 10_000_000;
const MAX_QTY = 9_999;

// Albion-style order books, one per town. Orders escrow their goods/gold on
// placement and match immediately against the best opposite orders in the
// same town at the *resting* order's price (price-time priority). All inside
// one SQLite transaction. Gold is global; goods never teleport: whoever's
// order was resting gets their goods in that town's storage.
export class Market {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    this.q = {
      bestBuy: db.prepare(`SELECT * FROM market_orders WHERE town = ? AND item = ? AND side = 'buy' AND status = 'open' AND price >= ? AND account_id != ? ORDER BY price DESC, id ASC LIMIT 1`),
      bestSell: db.prepare(`SELECT * FROM market_orders WHERE town = ? AND item = ? AND side = 'sell' AND status = 'open' AND price <= ? AND account_id != ? ORDER BY price ASC, id ASC LIMIT 1`),
      fill: db.prepare(`UPDATE market_orders SET filled = filled + ?, status = CASE WHEN filled + ? >= qty THEN 'filled' ELSE status END WHERE id = ?`),
      insert: db.prepare(`INSERT INTO market_orders (account_id, side, item, price, qty, filled, status, created_at, town) VALUES (?,?,?,?,?,?,?,?,?)`),
      trade: db.prepare(`INSERT INTO market_trades (item, price, qty, buyer, seller, ts, town) VALUES (?,?,?,?,?,?,?)`),
      get: db.prepare(`SELECT * FROM market_orders WHERE id = ?`),
      cancel: db.prepare(`UPDATE market_orders SET status = 'cancelled' WHERE id = ?`),
      openCount: db.prepare(`SELECT COUNT(*) AS n FROM market_orders WHERE account_id = ? AND status = 'open'`),
      mine: db.prepare(`SELECT * FROM market_orders WHERE account_id = ? AND (status = 'open' OR created_at > ?) ORDER BY status = 'open' DESC, created_at DESC LIMIT 60`),
      depth: db.prepare(`SELECT price, SUM(qty - filled) AS qty, COUNT(*) AS orders FROM market_orders WHERE town = ? AND item = ? AND side = ? AND status = 'open' GROUP BY price ORDER BY CASE WHEN ? = 'sell' THEN price ELSE -price END LIMIT 10`),
      history: db.prepare(`SELECT price, qty, ts FROM market_trades WHERE town = ? AND item = ? ORDER BY ts DESC LIMIT 60`),
      last: db.prepare(`SELECT price FROM market_trades WHERE town = ? AND item = ? ORDER BY ts DESC LIMIT 1`),
      summary: db.prepare(`
        SELECT i.item,
          (SELECT MIN(price) FROM market_orders WHERE town = ?1 AND item = i.item AND side='sell' AND status='open') AS ask,
          (SELECT SUM(qty-filled) FROM market_orders WHERE town = ?1 AND item = i.item AND side='sell' AND status='open') AS supply,
          (SELECT MAX(price) FROM market_orders WHERE town = ?1 AND item = i.item AND side='buy' AND status='open') AS bid,
          (SELECT SUM(qty-filled) FROM market_orders WHERE town = ?1 AND item = i.item AND side='buy' AND status='open') AS demand,
          (SELECT price FROM market_trades WHERE town = ?1 AND item = i.item ORDER BY ts DESC LIMIT 1) AS last,
          (SELECT SUM(qty) FROM market_trades WHERE town = ?1 AND item = i.item AND ts > ?2) AS vol
        FROM (SELECT DISTINCT item FROM market_orders WHERE town = ?1 UNION SELECT DISTINCT item FROM market_trades WHERE town = ?1) i`),
    };
  }

  // In `town`'s book. Returns { order, fills, notify: Set<accountId> }
  place(accountId, { side, item, price, qty, ioc = false }, town = 'hearthvale') {
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
        H.takeItem(accountId, item, qty, { keepEquipped: true }); // escrow goods
        for (;;) {
          if (!remaining) break;
          const o = this.q.bestBuy.get(town, item, price, accountId);
          if (!o) break;
          const n = Math.min(remaining, o.qty - o.filled);
          this.#execute(town, item, o.price, n, o.account_id, accountId, false);
          this.q.fill.run(n, n, o.id);
          notify.add(o.account_id);
          fills.push({ price: o.price, qty: n });
          remaining -= n;
        }
        if (remaining && ioc) H.addItem(accountId, item, remaining);
      } else {
        H.addGold(accountId, -price * qty, 'marketEscrow'); // escrow gold at the limit price
        for (;;) {
          if (!remaining) break;
          const o = this.q.bestSell.get(town, item, price, accountId);
          if (!o) break;
          const n = Math.min(remaining, o.qty - o.filled);
          this.#execute(town, item, o.price, n, accountId, o.account_id, true);
          if (price > o.price) H.addGold(accountId, (price - o.price) * n, 'marketRefund'); // refund price improvement
          this.q.fill.run(n, n, o.id);
          notify.add(o.account_id);
          fills.push({ price: o.price, qty: n });
          remaining -= n;
        }
        if (remaining && ioc) H.addGold(accountId, price * remaining, 'marketRefund');
      }
      let order = null;
      if (remaining && !ioc) {
        const r = this.q.insert.run(accountId, side, item, price, qty, qty - remaining, 'open', Date.now(), town);
        order = this.q.get.get(Number(r.lastInsertRowid));
      }
      if (ioc && !fills.length) fail(side === 'buy' ? 'Nobody is selling at that price anymore.' : 'Nobody is buying at that price anymore.');
      return { order, fills, filledQty: qty - remaining, notify };
    });
  }

  // Seller receives gold minus tax; buyer receives the goods: into the bag if
  // they're the one placing the order (standing right here), else into
  // storage in this town. Buyer's gold and seller's goods are already in
  // escrow by the time we get here.
  #execute(town, item, price, qty, buyer, seller, buyerHere) {
    const gross = price * qty;
    const tax = Math.floor(gross * MARKET_TAX);
    this.heroes.addGold(seller, gross - tax, 'marketSale');
    if (buyerHere) this.heroes.addItem(buyer, item, qty);
    else stash(this.db, buyer, town, item, qty);
    this.q.trade.run(item, price, qty, buyer, seller, Date.now(), town);
  }

  // Cancel an order. Unsold goods go back to the bag when you're in the
  // order's town (here), else into storage there; held gold comes straight back.
  cancel(accountId, orderId, here = null) {
    return tx(this.db, () => {
      const o = this.q.get.get(Number(orderId));
      if (!o || o.account_id !== accountId) fail('Order not found.');
      if (o.status !== 'open') fail('That order is already closed.');
      const left = o.qty - o.filled;
      if (o.side === 'sell' && here === o.town) this.heroes.addItem(accountId, o.item, left);
      else if (o.side === 'sell') stash(this.db, accountId, o.town, o.item, left);
      else this.heroes.addGold(accountId, o.price * left, 'marketRefund');
      this.q.cancel.run(o.id);
      return { ...o, stored: o.side === 'sell' && here !== o.town };
    });
  }

  book(item, town = 'hearthvale') {
    if (!isItem(item)) fail('Unknown item.');
    const day = Date.now() - 86400_000;
    const history = this.q.history.all(town, item).reverse();
    const recent = history.filter((h) => h.ts > day);
    const vol = recent.reduce((s, h) => s + h.qty, 0);
    const avg = vol ? Math.round(recent.reduce((s, h) => s + h.price * h.qty, 0) / vol) : null;
    return {
      town,
      item,
      asks: this.q.depth.all(town, item, 'sell', 'sell'),
      bids: this.q.depth.all(town, item, 'buy', 'buy'),
      history,
      last: history.length ? history[history.length - 1].price : null,
      avg24: avg,
      vol24: vol,
    };
  }
  last(item, town) {
    return this.q.last.get(town, item)?.price ?? null;
  }

  summary(town = 'hearthvale') {
    const rows = this.q.summary.all(town, Date.now() - 86400_000);
    return Object.fromEntries(rows.filter((r) => isItem(r.item)).map((r) => [r.item, { ask: r.ask, bid: r.bid, supply: r.supply || 0, demand: r.demand || 0, last: r.last, vol: r.vol || 0 }]));
  }

  mine(accountId) {
    return this.q.mine.all(accountId, Date.now() - 6 * 3600_000);
  }
}
