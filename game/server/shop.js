import { ITEMS, isItem } from '../shared/items.js';
import { SHOP, CUSTOMERS, demandCap, fillNow, npcBuyChance, buyQtyMax, footfall, poisson, pickDisplay } from '../shared/shop.js';
import { tx, fail } from './db.js';

// Walk-in player shops. The owner puts goods on 8 displays with a price and
// leaves; NPC customers (simulated here, every 10 s, online or not) buy over
// time, and other players can walk in and buy. Sales go into the shop's till.
// All rules and numbers live in shared/shop.js.
export class Shops {
  constructor(db, heroes) {
    this.db = db;
    this.heroes = heroes;
    const p = (sql) => db.prepare(sql);
    const unseen = 'id > (SELECT seen_upto FROM shops WHERE account_id = ?)';
    this.q = {
      ensure: p('INSERT OR IGNORE INTO shops (account_id, created_at) VALUES (?, ?)'),
      info: p('SELECT p.*, h.name AS hero_name FROM shops p JOIN heroes h ON h.account_id = p.account_id WHERE p.account_id = ?'),
      slots: p('SELECT slot, item, qty, price FROM shop_slots WHERE account_id = ? ORDER BY slot'),
      slot: p('SELECT slot, item, qty, price FROM shop_slots WHERE account_id = ? AND slot = ?'),
      upsert: p('INSERT INTO shop_slots (account_id, slot, item, qty, price) VALUES (?,?,?,?,?) ON CONFLICT(account_id, slot) DO UPDATE SET qty = excluded.qty, price = excluded.price, item = excluded.item'),
      del: p('DELETE FROM shop_slots WHERE account_id = ? AND slot = ?'),
      setQty: p('UPDATE shop_slots SET qty = ? WHERE account_id = ? AND slot = ?'),
      stockedOpen: p('SELECT s.account_id AS owner, COUNT(DISTINCT s.item) AS n FROM shop_slots s JOIN shops p ON p.account_id = s.account_id WHERE p.open = 1 GROUP BY s.account_id'),
      credit: p('UPDATE shops SET till = till + ?, sales = sales + ?, earned = earned + ?, last_sale_at = ? WHERE account_id = ?'),
      log: p('INSERT INTO shop_log (account_id, item, qty, price, buyer, ts, kind, buyer_id, fee, slot, seen) VALUES (?,?,?,?,?,?,?,?,?,?,1)'),
      demandGet: p('SELECT fill, at FROM npc_demand WHERE item = ?'),
      demandSet: p('INSERT INTO npc_demand (item, fill, at) VALUES (?,?,?) ON CONFLICT(item) DO UPDATE SET fill = excluded.fill, at = excluded.at'),
      metaGet: p('SELECT value FROM meta WHERE key = ?'),
      metaSet: p('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      till: p('SELECT till FROM shops WHERE account_id = ?'),
      emptyTill: p('UPDATE shops SET till = 0 WHERE account_id = ?'),
      setup: p('UPDATE shops SET name = ?, open = ? WHERE account_id = ?'),
      ledger: p('SELECT id, ts, kind, buyer, item, qty, price AS gross, fee FROM shop_log WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      day: p('SELECT COUNT(*) AS count, COALESCE(SUM(price), 0) AS gross, COALESCE(SUM(fee), 0) AS fee FROM shop_log WHERE account_id = ? AND ts > ?'),
      ack: p('UPDATE shops SET seen_upto = MAX(seen_upto, MIN(?, (SELECT COALESCE(MAX(id), 0) FROM shop_log WHERE account_id = ?))) WHERE account_id = ?'),
      awayAgg: p(`SELECT COUNT(*) AS count, COALESCE(SUM(price), 0) AS gross, COALESCE(SUM(fee), 0) AS fee, MIN(ts) AS since, MAX(id) AS upto FROM shop_log WHERE account_id = ? AND ${unseen}`),
      awayTop: p(`SELECT item, SUM(qty) AS qty, SUM(price - fee) AS gold FROM shop_log WHERE account_id = ? AND ${unseen} GROUP BY item ORDER BY gold DESC LIMIT 3`),
      awayPlayers: p(`SELECT buyer AS name, item, qty, price - fee AS gold FROM shop_log WHERE account_id = ? AND kind = 'player' AND ${unseen} ORDER BY id DESC LIMIT 5`),
      prune: p(`DELETE FROM shop_log WHERE account_id = ? AND id <= (SELECT seen_upto FROM shops WHERE account_id = ?) AND id < (SELECT id FROM shop_log WHERE account_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${SHOP.LEDGER_KEEP - 1})`),
      directory: p(`SELECT p.account_id AS owner, p.name, p.open, p.last_sale_at, h.name AS hero_name, h.avatar, COUNT(s.slot) AS displays, COALESCE(SUM(s.qty), 0) AS items
        FROM shops p JOIN heroes h ON h.account_id = p.account_id LEFT JOIN shop_slots s ON s.account_id = p.account_id
        GROUP BY p.account_id HAVING displays > 0 OR p.account_id = ? ORDER BY p.last_sale_at DESC LIMIT 60`),
    };
  }

  // Every shop owner gets a row the first time they touch their shop.
  ensure(id) {
    this.q.ensure.run(id, Date.now());
  }
  info(id) {
    return this.q.info.get(id) || null;
  }
  displayName(info) {
    return info?.name || `${info?.hero_name || 'A'}'s Shop`;
  }
  slots(id) {
    return this.q.slots.all(id);
  }
  slot(id, slot) {
    return this.q.slot.get(id, slot) || null;
  }
  till(id) {
    return this.q.till.get(id)?.till ?? 0;
  }

  // Town-wide NPC demand for one item: fill (0..1), pool size, units available.
  demand(item, t = Date.now()) {
    const fill = fillNow(this.q.demandGet.get(item), t);
    const cap = demandCap(ITEMS[item].value);
    return { fill, cap, avail: Math.floor(fill * cap + 1e-9) };
  }
  demandMap(items, t = Date.now()) {
    return Object.fromEntries([...new Set(items)].map((it) => [it, this.demand(it, t).fill]));
  }

  // What a visitor (or the owner, with private extras) sees.
  state(owner, viewerId) {
    if (viewerId === owner) this.ensure(owner);
    const info = this.info(owner);
    if (!info) fail('No such shop.');
    const slots = this.slots(owner);
    // The owner gets town demand for everything (to price new stock); visitors just what's shown.
    const out = { owner, name: this.displayName(info), open: !!info.open, slots, demand: this.demandMap(viewerId === owner ? Object.keys(ITEMS) : slots.map((s) => s.item)) };
    if (viewerId === owner) Object.assign(out, { till: info.till, stats: { sales: info.sales, earned: info.earned } });
    return out;
  }

  stock(id, { slot, item, qty, price }) {
    slot = Number(slot);
    qty = Number(qty);
    price = Number(price);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP.SLOTS) fail('Bad display.');
    if (!isItem(item)) fail('Unknown item.');
    if (!Number.isInteger(qty) || qty < 1) fail('Bad quantity.');
    if (!Number.isInteger(price) || price < 1 || price > SHOP.MAX_PRICE) fail('Bad price.');
    return tx(this.db, () => {
      this.ensure(id);
      const cur = this.slot(id, slot);
      if (cur && cur.item !== item) fail('That display holds something else. Clear it first.');
      if ((cur?.qty || 0) + qty > SHOP.SLOT_MAX_QTY) fail(`A display holds at most ${SHOP.SLOT_MAX_QTY}.`);
      this.heroes.takeItem(id, item, qty, { keepEquipped: true });
      this.q.upsert.run(id, slot, item, (cur?.qty || 0) + qty, price);
      return this.slot(id, slot);
    });
  }

  unstock(id, slot, qty = null) {
    return tx(this.db, () => {
      const cur = this.slot(id, Number(slot));
      if (!cur) fail('That display is empty now.');
      const n = qty == null ? cur.qty : Number(qty);
      if (!Number.isInteger(n) || n < 1 || n > cur.qty) fail('Bad quantity.');
      this.heroes.addItem(id, cur.item, n);
      if (n < cur.qty) this.q.setQty.run(cur.qty - n, id, cur.slot);
      else this.q.del.run(id, cur.slot);
      return this.slot(id, cur.slot);
    });
  }

  setPrice(id, slot, price) {
    price = Number(price);
    if (!Number.isInteger(price) || price < 1 || price > SHOP.MAX_PRICE) fail('Bad price.');
    const cur = this.slot(id, Number(slot));
    if (!cur) fail('That display is empty now.');
    this.q.upsert.run(id, cur.slot, cur.item, cur.qty, price);
    return this.slot(id, cur.slot);
  }

  setup(id, { name, open } = {}) {
    this.ensure(id);
    const info = this.info(id);
    let nm = info.name;
    if (name !== undefined) {
      nm = String(name ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, SHOP.NAME_MAX) || null;
    }
    const op = open === undefined ? info.open : open ? 1 : 0;
    this.q.setup.run(nm, op, id);
    return this.info(id);
  }

  // Another player buys at the displayed price. They echo the item and price
  // they saw, so a price change in between can't catch them out.
  buy(buyerId, buyerName, ownerId, { slot, qty, price, item }, now = Date.now()) {
    slot = Number(slot);
    qty = Number(qty);
    price = Number(price);
    if (buyerId === ownerId) fail("That's your own shop!");
    if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP.SLOTS) fail('Bad display.');
    if (!Number.isInteger(qty) || qty < 1) fail('Bad quantity.');
    return tx(this.db, () => {
      if (!this.info(ownerId)?.open) fail('That shop is closed right now.');
      const s = this.slot(ownerId, slot);
      if (!s) fail('That display is empty now.');
      if (s.item !== item || s.price !== price) fail('The price just changed — have another look.');
      if (s.qty < qty) fail(`Only ${s.qty} left.`);
      this.heroes.addGold(buyerId, -s.price * qty, 'shopBuy'); // throws "Not enough gold." → full rollback
      this.heroes.addItem(buyerId, s.item, qty);
      const sale = this.#sell(ownerId, s, qty, { kind: 'player', buyer: buyerName, buyerId, feePm: SHOP.P2P_FEE_PM, now });
      return { sale, s: this.slot(ownerId, slot) };
    });
  }

  collect(id) {
    return tx(this.db, () => {
      const gold = this.till(id);
      if (!gold) fail('Nothing in the till yet.');
      this.q.emptyTill.run(id);
      this.heroes.addGold(id, gold, 'shopTill');
      return { gold };
    });
  }

  ledger(id, before = null) {
    const b = Number.isInteger(Number(before)) && before != null ? Number(before) : Number.MAX_SAFE_INTEGER;
    return { rows: this.q.ledger.all(id, b, SHOP.LEDGER_PAGE), day: this.q.day.get(id, Date.now() - 86_400_000), till: this.till(id) };
  }

  ack(id, upto) {
    upto = Number(upto);
    if (!Number.isInteger(upto)) return;
    this.q.ack.run(upto, id, id);
  }

  // "While you were away": every sale the owner hasn't been shown yet.
  awaySummary(id, now, lastActive) {
    this.ensure(id);
    const a = this.q.awayAgg.get(id, id);
    if (!a.count) return null;
    const awayMs = Math.max(0, now - (lastActive || now));
    return {
      count: a.count,
      gross: a.gross,
      net: a.gross - a.fee,
      since: a.since,
      upto: a.upto,
      till: this.till(id),
      top: this.q.awayTop.all(id, id),
      players: this.q.awayPlayers.all(id, id),
      awayMs,
      paused: awayMs > SHOP.AWAY_MS,
    };
  }
  // Keep the newest 500 ledger rows; never drop ones the owner hasn't seen.
  prune(id) {
    this.q.prune.run(id, id, id);
  }

  directory(viewerId, live = () => ({})) {
    return this.q.directory.all(viewerId).map((r) => {
      const slots = this.slots(r.owner);
      const featured = slots.reduce((b, s) => (!b || ITEMS[s.item].value > ITEMS[b.item].value ? s : b), null);
      return {
        owner: r.owner,
        name: r.name || `${r.hero_name}'s Shop`,
        heroName: r.hero_name,
        avatar: JSON.parse(r.avatar),
        open: !!r.open,
        displays: r.displays,
        items: r.items,
        featured: featured ? { item: featured.item, price: featured.price } : null,
        lastSaleAt: r.last_sale_at,
        ...live(r.owner),
      };
    });
  }

  // ── The NPC customer simulation ─────────────────────────────────────
  // The clock lives in the database (meta.shop_sim_at) and each simulated
  // chunk advances it inside its own transaction, so a restart catches up
  // (at most 30 minutes) and no interval is ever simulated twice.
  simulate(now, presenceOf, rng = Math.random) {
    const start = Number(this.q.metaGet.get('shop_sim_at')?.value ?? now);
    if (now - start < 1000) return { events: [], span: 0, skipped: 0 };
    const from = Math.max(start, now - SHOP.SIM_MAX_SPAN_MS);
    const skipped = from - start;
    const events = [];
    let expected = start;
    for (let t0 = from; t0 < now; ) {
      const dt = Math.min(SHOP.SIM_CHUNK_MS, now - t0);
      const t = t0 + dt;
      const ok = tx(this.db, () => {
        if (Number(this.q.metaGet.get('shop_sim_at')?.value ?? start) !== expected) return false; // someone else moved the clock
        events.push(...this.#step(t, dt, presenceOf, rng));
        this.q.metaSet.run('shop_sim_at', String(t));
        return true;
      });
      if (!ok) break;
      expected = t;
      t0 = t;
    }
    return { events, span: now - from, skipped };
  }

  #step(t, dt, presenceOf, rng) {
    const out = [];
    for (const { owner, n } of this.q.stockedOpen.all()) {
      const pres = presenceOf(owner, t);
      for (let k = poisson((footfall(n, pres) * dt) / 3_600_000, rng); k > 0; k--) out.push(this.#visit(owner, t, rng));
    }
    return out;
  }

  #visit(owner, t, rng) {
    const cust = Math.floor(rng() * CUSTOMERS.length);
    const slots = this.slots(owner);
    const fillOf = (item) => {
      const d = this.demand(item, t);
      return d.avail >= 1 ? d.fill : 0;
    };
    const s = slots.length ? pickDisplay(CUSTOMERS[cust], slots, fillOf, rng) : null;
    if (!s) return { owner, cust, slot: null, sale: null };
    const d = this.demand(s.item, t);
    if (rng() >= npcBuyChance(s.item, s.price, d.fill)) return { owner, cust, slot: s.slot, sale: null };
    const qty = Math.min(s.qty, d.avail, 1 + Math.floor(rng() * buyQtyMax(ITEMS[s.item].value)));
    if (qty < 1) return { owner, cust, slot: s.slot, sale: null };
    this.q.demandSet.run(s.item, d.fill - qty / d.cap, t);
    const sale = this.#sell(owner, s, qty, { kind: 'npc', buyer: CUSTOMERS[cust].name, buyerId: null, feePm: SHOP.NPC_FEE_PM, now: t });
    return { owner, cust, slot: s.slot, sale };
  }

  // Shared by NPC and player sales; runs inside the caller's transaction.
  #sell(owner, row, qty, { kind, buyer, buyerId, feePm, now }) {
    const gross = row.price * qty;
    const fee = this.heroes.takeFee(owner, gross, feePm);
    const net = gross - fee;
    const left = row.qty - qty;
    if (left > 0) this.q.setQty.run(left, owner, row.slot);
    else this.q.del.run(owner, row.slot);
    if (this.q.credit.run(net, qty, net, now, owner).changes !== 1) throw new Error('shops row missing');
    const id = Number(this.q.log.run(owner, row.item, qty, gross, buyer, now, kind, buyerId, fee, row.slot).lastInsertRowid);
    return { id, kind, item: row.item, qty, gross, fee, net, buyer, slot: row.slot, left };
  }
}
