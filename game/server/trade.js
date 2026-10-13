// Trading, town by town (SPEC §6.1): each town's market book, its merchant
// and supplier stall, your storage there, and its bulletin board of paid
// jobs. Looking works from anywhere; trading only in the town itself.
import { ITEMS, isItem } from '../shared/items.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';
import { jobText } from './jobs.js';
import { hereTown, browseTown, needTown, towns, townName } from './towns.js';
import * as storage from './storage.js';

const inRun = { inRun: true };

// ── The town merchant ──
export function npcSell(g, c, item, qty) {
  const town = needTown(g, c);
  qty = Number(qty);
  if (!isItem(item) || !Number.isInteger(qty) || qty < 1) fail('Bad sale.');
  const equipped = Object.values(c.hero.equip).includes(item);
  if (equipped && g.heroes.count(c.hero.id, item) - qty < 1) fail("Keep one — it's equipped.");
  const r = g.merchant.sell(c.hero.id, town, item, qty);
  c.pushInventory();
  emit(c, 'sell', { item, qty, gold: r.gold, town });
  return r;
}
register('npcSell', (g, c, a) => npcSell(g, c, a.item, a.qty));
register('merchant.quote', (g, c, a) => g.merchant.quote(browseTown(g, c), a.item, a.qty ?? 1), inRun);

// ── The supplier stall ──
register('supplier.list', (g, c) => {
  const town = browseTown(g, c);
  return { town, stock: g.merchant.stock(town) };
}, inRun);
register('supplier.buy', (g, c, a) => {
  const town = needTown(g, c);
  const r = g.merchant.buy(c.hero.id, town, String(a.item ?? ''), a.qty);
  c.pushInventory();
  emit(c, 'supply', { item: r.item, qty: r.qty, gold: r.gold, town });
  return r;
});

// ── Storage ──
// Tell the hero what's waiting for them in storage, per town.
export function pushStorage(g, c) {
  c.send({ t: 'storage', waiting: storage.waiting(g.db, c.hero.id) });
}
register('storage.get', (g, c, a) => {
  const town = typeof a.town === 'string' && towns().some((t) => t.id === a.town) ? a.town : browseTown(g, c);
  return { town, items: storage.list(g.db, c.hero.id, town), waiting: storage.waiting(g.db, c.hero.id) };
}, inRun);
const moved = (g, c, town, items) => (c.pushInventory(), pushStorage(g, c), { town, items: storage.list(g.db, c.hero.id, town), moved: items });
register('storage.collect', (g, c) => {
  const town = needTown(g, c);
  return moved(g, c, town, storage.collect(g.db, g.heroes, c.hero.id, town));
});
register('storage.deposit', (g, c, a) => {
  const town = needTown(g, c);
  const r = storage.put(g.db, g.heroes, c.hero.id, town, String(a.item ?? ''), a.qty);
  return moved(g, c, town, { [r.item]: r.qty });
});
register('storage.withdraw', (g, c, a) => {
  const town = needTown(g, c);
  const r = storage.take(g.db, g.heroes, c.hero.id, town, String(a.item ?? ''), a.qty);
  return moved(g, c, town, { [r.item]: r.qty });
});

// ── The market ──
// The book you're looking at: this town's, or (browsing) the nearest town's.
register('market.summary', (g, c) => {
  const here = hereTown(g, c);
  const town = here ?? browseTown(g, c);
  return { town, browseOnly: !here, items: g.market.summary(town), waiting: storage.waiting(g.db, c.hero.id) };
}, inRun);
register('market.book', (g, c, a) => {
  const town = typeof a.town === 'string' && towns().some((t) => t.id === a.town) ? a.town : browseTown(g, c);
  return { ...g.market.book(a.item, town), npcBid: g.merchant.bid(town, a.item), supplierAsk: g.merchant.ask(town, a.item) };
}, inRun);
// Every town's prices for one item: the price board ("Other towns").
register('market.board', (g, c, a) => {
  if (!isItem(a.item)) fail('Unknown item.');
  return { item: a.item, towns: towns().map((t) => ({ town: t.id, name: t.name, last: g.market.last(a.item, t.id), npcBid: g.merchant.bid(t.id, a.item), ask: g.merchant.ask(t.id, a.item) })) };
}, inRun);
register('market.mine', (g, c) => g.market.mine(c.hero.id), inRun);
register('market.place', (g, c, a) => {
  const town = needTown(g, c);
  const r = g.market.place(c.hero.id, a, town);
  for (const id of r.notify) {
    const o = g.online.get(id);
    if (id !== c.hero.id) emit(o ?? null, 'marketFill', { id, item: a.item, side: a.side === 'buy' ? 'sell' : 'buy', town });
    if (!o) continue;
    o.pushInventory();
    if (id === c.hero.id) continue;
    // A resting buy order's goods wait in storage in that town.
    o.send({ t: 'toast', kind: 'good', text: `Your ${a.side === 'buy' ? 'sell' : 'buy'} order for ${ITEMS[a.item].name} in ${townName(town)} was filled!${a.side === 'sell' ? ' Collect it from storage there.' : ''}` });
    if (a.side === 'sell') pushStorage(g, o);
  }
  if (r.filledQty) emit(c, 'trade', { item: a.item, side: a.side, qty: r.filledQty, fills: r.fills, town });
  return { town, order: r.order, fills: r.fills, filledQty: r.filledQty };
});
register('market.cancel', (g, c, a) => {
  const o = g.market.cancel(c.hero.id, a.id, hereTown(g, c));
  c.pushInventory();
  if (o.stored) pushStorage(g, c);
  return { stored: o.stored ? o.town : null };
});

// ── The bulletin board ──
// Jobs here (where you are, or the nearest town), jobs elsewhere, and yours.
register('jobs.list', (g, c) => {
  const town = browseTown(g, c);
  const open = g.jobs.list();
  return { town, here: open.filter((j) => j.town === town), elsewhere: open.filter((j) => j.town !== town), mine: g.jobs.mine(c.hero.id), now: Date.now() };
}, inRun);
register('jobs.post', (g, c, a) => {
  const town = needTown(g, c);
  const j = g.jobs.post(c.hero.id, a, town);
  c.pushInventory();
  g.announce(`${c.hero.name} posted a job on the ${townName(town)} board: ${jobText(j)} at ${j.per} 🪙 each.`);
  return j;
});
register('jobs.deliver', (g, c, a) => {
  const j = g.jobs.get(a.id);
  if (j) needTown(g, c, j.town);
  const here = (id, town) => {
    const o = g.online.get(id);
    return !!o && hereTown(g, o) === town;
  };
  const r = g.jobs.deliver(c.hero.id, a.id, a.qty, Date.now(), here);
  c.pushInventory();
  const o = g.online.get(r.poster);
  if (o) {
    o.pushInventory();
    if (r.stored) pushStorage(g, o);
    o.send({ t: 'toast', kind: 'good', text: `${c.hero.name} delivered ${r.qty}× ${ITEMS[r.item].name} for your job${r.stored ? ` (waiting in storage in ${townName(r.town)})` : ''}${r.left ? ` (${r.left} still wanted)` : '. Job done!'}` });
  }
  emit(c, 'deliver', { job: r.job, item: r.item, qty: r.qty, paid: r.paid, town: r.town });
  emit(o ?? null, 'jobDelivered', { job: r.job, poster: r.poster, item: r.item, qty: r.qty, left: r.left });
  return r;
});
register('jobs.cancel', (g, c, a) => {
  const r = g.jobs.cancel(c.hero.id, a.id);
  c.pushInventory();
  return r;
});

// Bulletin board jobs past their time: refund what's left, tell the poster.
export function expireJobs(g, now = Date.now()) {
  try {
    for (const r of g.jobs.expire(now)) {
      const o = g.online.get(r.poster);
      emit(o ?? null, 'jobExpired', { poster: r.poster, item: r.item, left: r.left, refund: r.refund });
      if (!o) continue;
      o.pushInventory();
      o.send({ t: 'toast', kind: 'gold', text: `Your job for ${ITEMS[r.item]?.name ?? r.item} ran out${r.refund ? `: ${r.refund} 🪙 back` : ''}.` });
    }
  } catch (e) {
    console.error('job expiry error', e);
  }
}
