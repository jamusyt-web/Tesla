// Town orders and the Big Order (SPEC §5.4), on the server.
//
// Orders: each hero holds at most 4 open orders per town (order_slots), each
// for 3 days. A new day fills only the empty slots, from the board's 4 for
// the day (the same 4 for everyone; each hero fills their own copy). Goods
// orders take the goods as you hand them in and pay as you go; hunts count
// your kills and pay when you turn them in.
//
// The Big Order: one per town per day, shared by everyone, paid per unit as
// you give. When it fills, everyone in that town gets Festive and everyone
// who gave gets reputation.
import { ITEMS } from '../shared/items.js';
import { MONSTERS } from '../shared/monsters.js';
import { SLOTS, LASTS_DAYS, BIG_REP, seedOrders, templateOf, orderOf, orderText, bigOrderOf } from '../shared/orders.js';
import { dayIndex } from '../shared/dungeon.js';
import { townAt } from '../shared/places.js';
import { tx, fail } from './db.js';
import { emit, on } from './events.js';
import { register } from './rpc.js';
import { needTown, browseTown, townName, towns } from './towns.js';
import * as rep from './rep.js';
import { highlight } from './digest.js';

export class Orders {
  constructor(game) {
    this.game = game;
    this.db = game.db;
    const p = (s) => this.db.prepare(s);
    this.q = {
      slots: p('SELECT slot, order_key, day, got, state FROM order_slots WHERE account_id = ? AND town = ? ORDER BY slot'),
      open: p("SELECT town, slot, order_key, day, got FROM order_slots WHERE account_id = ? AND state = 'open'"),
      put: p("INSERT INTO order_slots (account_id, town, slot, order_key, day, got, state) VALUES (?,?,?,?,?,0,'open') ON CONFLICT(account_id, town, slot) DO UPDATE SET order_key = excluded.order_key, day = excluded.day, got = 0, state = 'open'"),
      got: p('UPDATE order_slots SET got = ? WHERE account_id = ? AND town = ? AND slot = ?'),
      state: p('UPDATE order_slots SET state = ? WHERE account_id = ? AND town = ? AND slot = ?'),
      big: p('SELECT item, need, got, done_at FROM big_orders WHERE town = ? AND day = ?'),
      bigNew: p('INSERT OR IGNORE INTO big_orders (town, day, item, need) VALUES (?,?,?,?)'),
      bigGot: p('UPDATE big_orders SET got = got + ? WHERE town = ? AND day = ?'),
      bigDone: p('UPDATE big_orders SET done_at = ? WHERE town = ? AND day = ? AND done_at IS NULL'),
      share: p('INSERT INTO big_order_shares (town, day, account_id, qty) VALUES (?,?,?,?) ON CONFLICT(town, day, account_id) DO UPDATE SET qty = qty + excluded.qty'),
      myShare: p('SELECT qty FROM big_order_shares WHERE town = ? AND day = ? AND account_id = ?'),
      givers: p('SELECT account_id, qty FROM big_order_shares WHERE town = ? AND day = ?'),
    };
  }

  // Bring a hero's slots in a town up to today: expire old ones (with a
  // notice), then fill the empty slots from today's board.
  refresh(heroId, town, now = Date.now()) {
    const today = dayIndex(now);
    const rows = this.q.slots.all(heroId, town);
    const bySlot = new Map(rows.map((r) => [r.slot, r]));
    tx(this.db, () => {
      for (const r of rows)
        if (r.state === 'open' && today - r.day >= LASTS_DAYS) {
          this.q.state.run('expired', heroId, town, r.slot);
          r.state = 'expired';
          const o = orderOf(templateOf(town, r.order_key));
          this.game.notices?.add(heroId, 'order', { town, key: r.order_key, state: 'expired' }, `An order in ${townName(town)} ran out of time: ${orderText(o)}.`, now);
        }
      const taken = new Set(rows.filter((r) => r.day === today).map((r) => r.order_key));
      const fresh = seedOrders(town, today).filter((k) => !taken.has(k));
      for (let s = 0; s < SLOTS && fresh.length; s++) {
        const r = bySlot.get(s);
        if (r && (r.state === 'open' || r.day === today)) continue; // busy, or done today already
        this.q.put.run(heroId, town, s, fresh.shift(), today);
      }
    });
  }

  // A town's board for a hero: { town, slots: [...], big }.
  view(c, town, now = Date.now()) {
    this.refresh(c.hero.id, town, now);
    const today = dayIndex(now);
    const slots = this.q.slots
      .all(c.hero.id, town)
      .map((r) => {
        const o = orderOf(templateOf(town, r.order_key));
        if (!o) return null;
        return { slot: r.slot, key: r.order_key, day: r.day, got: r.got, state: r.state, expiresIn: r.state === 'open' ? (r.day + LASTS_DAYS) * 86_400_000 - now : null, text: orderText(o), ...o };
      })
      .filter(Boolean);
    return { town, name: townName(town), slots, big: this.bigView(c.hero.id, town, today), today };
  }

  // Hand goods to an order (or turn in a finished hunt).
  deliver(c, town, slot, qty, now = Date.now()) {
    this.refresh(c.hero.id, town, now);
    const r = this.q.slots.all(c.hero.id, town).find((x) => x.slot === Number(slot));
    if (!r || r.state !== 'open') fail('That order is not open.');
    const o = orderOf(templateOf(town, r.order_key));
    if (!o) fail('That order is not open.');
    const H = this.game.heroes;
    const id = c.hero.id;
    let got = r.got;
    let paid = 0;
    tx(this.db, () => {
      if (o.kind === 'hunt') {
        if (got < o.qty) fail(`Thin out ${o.qty - got} more ${MONSTERS[o.monster]?.name ?? o.monster} first.`);
        paid = o.pay;
      } else {
        const want = o.qty - got;
        const n = Math.min(want, Math.max(1, Number(qty) || want), H.count(id, o.item));
        if (n <= 0) fail(`You have no ${ITEMS[o.item].name} with you.`);
        H.takeItem(id, o.item, n, { keepEquipped: true, kind: 'order' });
        // Paid as you go, never a coin more than the whole order pays.
        paid = Math.floor((o.pay * (got + n)) / o.qty) - Math.floor((o.pay * got) / o.qty);
        got += n;
        this.q.got.run(got, id, town, r.slot);
      }
      if (paid) H.addGold(id, paid, 'order');
    });
    const done = got >= o.qty;
    let xp = null;
    if (done) {
      this.q.state.run('done', id, town, r.slot);
      rep.add(id, town, o.rep);
      if (o.xp) xp = H.addXp(c.hero, o.xp.skill, o.xp.n);
      emit(c, 'order', { town, key: o.key, kind: o.kind, item: o.item ?? null, monster: o.monster ?? null });
    }
    c.pushInventory();
    return { paid, got, qty: o.qty, done, rep: done ? o.rep : 0, xp };
  }

  // A kill counts toward every open hunt for that monster, in any town.
  onKill(c, monster, now = Date.now()) {
    const today = dayIndex(now);
    for (const r of this.q.open.all(c.hero.id)) {
      if (today - r.day >= LASTS_DAYS) continue; // ran out (the next look at the board marks it)
      const o = orderOf(templateOf(r.town, r.order_key));
      if (o?.kind !== 'hunt' || o.monster !== monster || r.got >= o.qty) continue;
      this.q.got.run(r.got + 1, c.hero.id, r.town, r.slot);
      c.send({ t: 'order', town: r.town, slot: r.slot, got: r.got + 1, qty: o.qty, ready: r.got + 1 >= o.qty });
    }
  }

  // What the hero could turn in right now, here: [{ town, slot, text, item? }].
  // (The Compass and the context button read this.)
  ready(heroId, town = null) {
    const out = [];
    const bag = this.game.heroes.inventory(heroId);
    const today = dayIndex();
    for (const r of this.q.open.all(heroId)) {
      if (town && r.town !== town) continue;
      if (today - r.day >= LASTS_DAYS) continue;
      const o = orderOf(templateOf(r.town, r.order_key));
      if (!o) continue;
      const can = o.kind === 'hunt' ? r.got >= o.qty : (bag[o.item] ?? 0) > 0;
      if (can) out.push({ town: r.town, slot: r.slot, text: orderText(o), item: o.item ?? null, full: o.kind === 'hunt' || (bag[o.item] ?? 0) >= o.qty - r.got });
    }
    return out;
  }
  // Every open order (any town), for the Compass and the bots.
  openOrders(heroId) {
    return this.q.open.all(heroId).filter((r) => dayIndex() - r.day < LASTS_DAYS).map((r) => ({ town: r.town, slot: r.slot, got: r.got, ...orderOf(templateOf(r.town, r.order_key)) }));
  }

  // ── The Big Order ──
  bigRow(town, day) {
    const b = bigOrderOf(town, day);
    if (!b) return null;
    this.q.bigNew.run(town, day, b.item, b.need);
    return { ...b, ...this.q.big.get(town, day) };
  }
  bigView(heroId, town, day = dayIndex()) {
    const b = this.bigRow(town, day);
    if (!b) return null;
    return { item: b.item, need: b.need, got: Math.min(b.got, b.need), unit: b.unit, done: !!b.done_at, mine: this.q.myShare.get(town, day, heroId)?.qty ?? 0 };
  }
  giveBig(c, town, qty, now = Date.now()) {
    const day = dayIndex(now);
    const b = this.bigRow(town, day);
    if (!b) fail('There is no Big Order here.');
    if (b.done_at) fail('The Big Order is already filled. Well done, everyone!');
    const H = this.game.heroes;
    const id = c.hero.id;
    const n = Math.min(b.need - b.got, Math.max(1, Number(qty) || 1), H.count(id, b.item));
    if (n <= 0) fail(`You have no ${ITEMS[b.item].name} with you.`);
    const pay = n * b.unit;
    let filled = false;
    tx(this.db, () => {
      H.takeItem(id, b.item, n, { keepEquipped: true, kind: 'order' });
      H.addGold(id, pay, 'bigOrder');
      this.q.bigGot.run(n, town, day);
      this.q.share.run(town, day, id, n);
      filled = b.got + n >= b.need && this.q.bigDone.run(now, town, day).changes > 0;
    });
    c.pushInventory();
    emit(c, 'big', { town, item: b.item, qty: n });
    if (filled) this.#festive(town, day, now);
    return { paid: pay, qty: n, big: this.bigView(id, town, day) };
  }
  // Filled! Festive for everyone in town, reputation for everyone who gave.
  #festive(town, day, now) {
    const g = this.game;
    for (const s of this.q.givers.all(town, day)) {
      rep.add(s.account_id, town, BIG_REP);
      if (!g.online.has(s.account_id)) g.notices?.add(s.account_id, 'big', { town }, `The ${townName(town)} Big Order you gave to was filled! +${BIG_REP} reputation.`, now);
    }
    const text = `The ${townName(town)} Big Order is filled! Festive: +10% xp for everyone in town.`;
    highlight(g, `The ${townName(town)} Big Order was filled.`);
    for (const o of g.online.values()) {
      if (o.ch?.isRun) continue;
      if (townAt(o.ent.x, o.ent.z)?.id === town) o.giveBoon('festive');
      o.send({ t: 'banner', kind: 'big', text, town });
    }
  }
}

// Kills count toward hunts.
on('kill', (c, d) => c?.game?.orders?.onKill(c, d.monster));

const inRun = { inRun: true };
register('orders.list', (g, c, a) => g.orders.view(c, typeof a.town === 'string' && towns().some((t) => t.id === a.town) ? a.town : browseTown(g, c)), inRun);
register('orders.deliver', (g, c, a) => g.orders.deliver(c, needTown(g, c), a.slot, a.qty));
register('big.give', (g, c, a) => g.orders.giveBig(c, needTown(g, c), a.qty));
register('rep.get', (g, c) => rep.standing(c.hero.id), inRun);
