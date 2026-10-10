import { ITEMS, isItem } from '../shared/items.js';
import { tx, fail } from './db.js';

export const SHOP_SLOTS = 8;

export const CUSTOMERS = [
  { name: 'Farmer Bram', face: '👨‍🌾' },
  { name: 'Witch Hazel', face: '🧙‍♀️' },
  { name: 'Sir Gareth', face: '🤴' },
  { name: 'Little Pip', face: '🧒' },
  { name: 'Merchant Ola', face: '🧕' },
  { name: 'Old Tom', face: '👴' },
  { name: 'Bard Lyra', face: '🧝‍♀️' },
  { name: 'Chef Basil', face: '👨‍🍳' },
  { name: 'Ranger Fen', face: '🧝' },
  { name: 'Granny Moss', face: '👵' },
];

// How keen NPCs are to pay `price` for something worth `value`.
// At or below value they're happy; the appetite falls off quickly above +50%.
export function npcAppetite(price, value) {
  const r = price / value;
  if (r <= 1) return 1;
  if (r <= 1.5) return 1 - (r - 1) * 1.6; // 1.0 → 0.2
  return Math.max(0, 0.2 - (r - 1.5) * 0.4);
}

// Shop Titans-style personal shop: stock shelves, NPC customers walk in and
// buy (faster when you're there serving them), other players can buy too.
export class Shops {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    this.q = {
      slots: db.prepare('SELECT slot, item, qty, price FROM shop_slots WHERE account_id = ? ORDER BY slot'),
      slot: db.prepare('SELECT * FROM shop_slots WHERE account_id = ? AND slot = ?'),
      upsert: db.prepare('INSERT INTO shop_slots (account_id, slot, item, qty, price) VALUES (?,?,?,?,?) ON CONFLICT(account_id, slot) DO UPDATE SET qty = excluded.qty, price = excluded.price, item = excluded.item'),
      del: db.prepare('DELETE FROM shop_slots WHERE account_id = ? AND slot = ?'),
      setQty: db.prepare('UPDATE shop_slots SET qty = ? WHERE account_id = ? AND slot = ?'),
      all: db.prepare('SELECT * FROM shop_slots'),
      log: db.prepare('INSERT INTO shop_log (account_id, item, qty, price, buyer, ts) VALUES (?,?,?,?,?,?)'),
      unseen: db.prepare('SELECT item, qty, price, buyer, ts FROM shop_log WHERE account_id = ? AND seen = 0 ORDER BY ts DESC LIMIT 50'),
      markSeen: db.prepare('UPDATE shop_log SET seen = 1 WHERE account_id = ? AND seen = 0'),
      directory: db.prepare(`SELECT h.account_id AS id, h.name, h.avatar, COUNT(s.slot) AS slots, SUM(s.qty) AS items FROM shop_slots s JOIN heroes h ON h.account_id = s.account_id GROUP BY s.account_id ORDER BY items DESC LIMIT 50`),
    };
  }

  slots(id) {
    return this.q.slots.all(id);
  }

  stock(id, { slot, item, qty, price }) {
    slot = Number(slot);
    qty = Number(qty);
    price = Number(price);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP_SLOTS) fail('Bad shelf.');
    if (!isItem(item)) fail('Unknown item.');
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) fail('Bad quantity.');
    if (!Number.isInteger(price) || price < 1 || price > 1_000_000) fail('Bad price.');
    return tx(this.db, () => {
      const cur = this.q.slot.get(id, slot);
      if (cur && cur.item !== item) fail('That shelf holds something else. Clear it first.');
      this.heroes.takeItem(id, item, qty);
      this.q.upsert.run(id, slot, item, (cur?.qty || 0) + qty, price);
    });
  }

  setPrice(id, slot, price) {
    price = Number(price);
    if (!Number.isInteger(price) || price < 1 || price > 1_000_000) fail('Bad price.');
    const cur = this.q.slot.get(id, Number(slot));
    if (!cur) fail('Empty shelf.');
    this.q.upsert.run(id, cur.slot, cur.item, cur.qty, price);
  }

  unstock(id, slot) {
    return tx(this.db, () => {
      const cur = this.q.slot.get(id, Number(slot));
      if (!cur) fail('Empty shelf.');
      this.heroes.addItem(id, cur.item, cur.qty);
      this.q.del.run(id, cur.slot);
    });
  }

  // Remove n of a shelf and pay the owner. Returns sale record.
  #sell(owner, slotRow, n, unitPrice, buyerName) {
    const left = slotRow.qty - n;
    if (left > 0) this.q.setQty.run(left, owner, slotRow.slot);
    else this.q.del.run(owner, slotRow.slot);
    this.heroes.addGold(owner, unitPrice * n);
    this.q.log.run(owner, slotRow.item, n, unitPrice * n, buyerName, Date.now());
    return { item: slotRow.item, qty: n, gold: unitPrice * n, buyer: buyerName };
  }

  // Another player buys from your shelf at your price.
  buyFromPlayer(buyerId, buyerName, ownerId, slot, qty) {
    qty = Number(qty);
    if (buyerId === ownerId) fail("That's your own shop!");
    if (!Number.isInteger(qty) || qty < 1) fail('Bad quantity.');
    return tx(this.db, () => {
      const s = this.q.slot.get(ownerId, Number(slot));
      if (!s) fail('That shelf is empty now.');
      if (s.qty < qty) fail(`Only ${s.qty} left.`);
      this.heroes.addGold(buyerId, -s.price * qty);
      this.heroes.addItem(buyerId, s.item, qty);
      return this.#sell(ownerId, s, qty, s.price, buyerName);
    });
  }

  // A live NPC customer (owner is in their shop serving) — owner chose to sell.
  serveCustomer(ownerId, slot, unitPrice, customerName) {
    return tx(this.db, () => {
      const s = this.q.slot.get(ownerId, Number(slot));
      if (!s) fail('That shelf is empty now.');
      return this.#sell(ownerId, s, 1, unitPrice, customerName);
    });
  }

  // Idle sales while you're away (or out gathering). Returns [{owner, sale}].
  idleTick(rng = Math.random) {
    const sales = [];
    for (const s of this.q.all.all()) {
      const p = 0.07 * npcAppetite(s.price, ITEMS[s.item]?.value || 1);
      if (rng() < p) {
        const c = CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)];
        sales.push({ owner: s.account_id, sale: tx(this.db, () => this.#sell(s.account_id, s, 1, s.price, c.name)) });
      }
    }
    return sales;
  }

  unseenSales(id) {
    const rows = this.q.unseen.all(id);
    this.q.markSeen.run(id);
    return rows;
  }

  directory() {
    return this.q.directory.all().map((r) => ({ ...r, avatar: JSON.parse(r.avatar) }));
  }
}
