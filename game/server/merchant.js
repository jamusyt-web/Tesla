// Each town's merchant (a standing bid for everything, SPEC §6.2) and its
// supplier stall (a few goods for sale, at most 150 of each a day). The
// rules and numbers are in shared/economy.js; this keeps the pools.
import { ITEMS, isItem, isTradeable } from '../shared/items.js';
import { poolNow, unitBid, merchantSale, suppliesOf, supplyAsk, supplyDaily } from '../shared/economy.js';
import { today } from './telemetry.js';
import { tx, fail } from './db.js';

export class Merchant {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    const p = (sql) => db.prepare(sql);
    this.q = {
      pool: p('SELECT floor_left, prem_fill, at FROM merchant_pool WHERE town = ? AND item = ?'),
      setPool: p('INSERT INTO merchant_pool (town, item, floor_left, prem_fill, at) VALUES (?,?,?,?,?) ON CONFLICT(town, item) DO UPDATE SET floor_left = excluded.floor_left, prem_fill = excluded.prem_fill, at = excluded.at'),
      sold: p('SELECT day, sold FROM town_supply WHERE town = ? AND item = ?'),
      setSold: p('INSERT INTO town_supply (town, item, day, sold) VALUES (?,?,?,?) ON CONFLICT(town, item) DO UPDATE SET day = excluded.day, sold = excluded.sold'),
    };
  }

  pool(town, item, now = Date.now()) {
    return poolNow(this.q.pool.get(town, item), town, now);
  }
  // The merchant's bid for one unit right now (0: it won't buy that).
  bid(town, item, now = Date.now()) {
    return isTradeable(item) ? unitBid(town, item, this.pool(town, item, now)) : 0;
  }
  // What selling qty would pay: { unit, total, glut, full }.
  quote(town, item, qty, now = Date.now()) {
    if (!isItem(item)) fail('Unknown item.');
    qty = Number(qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) fail('Bad amount.');
    if (!isTradeable(item)) return { unit: 0, total: 0, glut: false, full: false };
    const r = merchantSale(town, item, qty, this.pool(town, item, now));
    return { unit: r.unit, total: r.total, glut: r.glut, full: r.full };
  }

  // Sell qty from the hero's bag to the merchant in `town`.
  sell(heroId, town, item, qty, now = Date.now()) {
    const q = this.quote(town, item, qty, now);
    if (!q.total) fail("The merchant doesn't buy that.");
    return tx(this.db, () => {
      const r = merchantSale(town, item, qty, this.pool(town, item, now));
      this.heroes.takeItem(heroId, item, qty, { kind: 'npcSell', keepEquipped: true });
      this.heroes.addGold(heroId, r.total, 'npcSell');
      this.q.setPool.run(town, item, r.pool.floorLeft, r.pool.premFill, now);
      return { gold: r.total, unit: r.unit, full: r.full };
    });
  }

  // ── The supplier stall ──
  left(town, item, now = Date.now()) {
    const r = this.q.sold.get(town, item);
    return Math.max(0, supplyDaily() - (r && r.day === today(now) ? r.sold : 0));
  }
  stock(town, now = Date.now()) {
    return suppliesOf(town)
      .filter(isItem)
      .map((item) => ({ item, ask: supplyAsk(item), left: this.left(town, item, now) }));
  }
  ask(town, item) {
    return suppliesOf(town).includes(item) && isItem(item) ? supplyAsk(item) : null;
  }
  buy(heroId, town, item, qty, now = Date.now()) {
    qty = Number(qty);
    if (!Number.isInteger(qty) || qty < 1) fail('Bad amount.');
    const ask = this.ask(town, item);
    if (!ask) fail("The stall doesn't sell that here.");
    const left = this.left(town, item, now);
    if (left < qty) fail(left ? `Only ${left} left today.` : `Sold out of ${ITEMS[item].name} today.`);
    return tx(this.db, () => {
      this.heroes.addGold(heroId, -ask * qty, 'supplier');
      this.heroes.addItem(heroId, item, qty, 'supplier');
      this.q.setSold.run(town, item, today(now), supplyDaily() - left + qty);
      return { item, qty, gold: ask * qty, left: left - qty };
    });
  }
}
