// Trading: the Grand Market's order book, selling to the town merchant, and
// the bulletin board's paid jobs between players.
import { ITEMS, isItem } from '../shared/items.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';
import { jobText } from './jobs.js';

const NPC_SELL_RATE = 0.6; // instant-sell to the town merchant pays 60% of value

export function npcSell(g, c, item, qty) {
  qty = Number(qty);
  if (!isItem(item) || !Number.isInteger(qty) || qty < 1) fail('Bad sale.');
  const equipped = Object.values(c.hero.equip).includes(item);
  if (equipped && g.heroes.count(c.hero.id, item) - qty < 1) fail("Keep one — it's equipped.");
  const gold = Math.max(1, Math.floor(ITEMS[item].value * NPC_SELL_RATE)) * qty;
  g.db.exec('BEGIN IMMEDIATE');
  try {
    g.heroes.takeItem(c.hero.id, item, qty);
    g.heroes.addGold(c.hero.id, gold, 'npcSell');
    g.db.exec('COMMIT');
  } catch (e) {
    g.db.exec('ROLLBACK');
    throw e;
  }
  c.pushInventory();
  emit(c, 'sell', { item, qty, gold });
  return { gold };
}

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

register('npcSell', (g, c, a) => npcSell(g, c, a.item, a.qty));

// Market (allowed in a dungeon run: you can trade from anywhere)
const inRun = { inRun: true };
register('market.summary', (g) => g.market.summary(), inRun);
register('market.book', (g, c, a) => g.market.book(a.item), inRun);
register('market.mine', (g, c) => g.market.mine(c.hero.id), inRun);
register(
  'market.place',
  (g, c, a) => {
    const r = g.market.place(c.hero.id, a);
    for (const id of r.notify) {
      const o = g.online.get(id);
      if (id !== c.hero.id) emit(o ?? null, 'marketFill', { id, item: a.item, side: a.side === 'buy' ? 'sell' : 'buy' });
      if (!o) continue;
      o.pushInventory();
      if (id !== c.hero.id) o.send({ t: 'toast', kind: 'good', text: `Your ${a.side === 'buy' ? 'sell' : 'buy'} order for ${ITEMS[a.item].name} was filled!` });
    }
    if (r.filledQty) emit(c, 'trade', { item: a.item, side: a.side, qty: r.filledQty, fills: r.fills });
    return { order: r.order, fills: r.fills, filledQty: r.filledQty };
  },
  inRun,
);
register(
  'market.cancel',
  (g, c, a) => {
    g.market.cancel(c.hero.id, a.id);
    c.pushInventory();
  },
  inRun,
);

// Bulletin board (server/jobs.js)
register('jobs.list', (g, c) => ({ open: g.jobs.list(), mine: g.jobs.mine(c.hero.id), now: Date.now() }), inRun);
register('jobs.post', (g, c, a) => {
  const j = g.jobs.post(c.hero.id, a);
  c.pushInventory();
  g.announce(`${c.hero.name} posted a job on the board: ${jobText(j)} at ${j.per} 🪙 each.`);
  return j;
});
register('jobs.deliver', (g, c, a) => {
  const r = g.jobs.deliver(c.hero.id, a.id, a.qty);
  c.pushInventory();
  const o = g.online.get(r.poster);
  if (o) {
    o.pushInventory();
    o.send({ t: 'toast', kind: 'good', text: `${c.hero.name} delivered ${r.qty}× ${ITEMS[r.item].name} for your job${r.left ? ` (${r.left} still wanted)` : '. Job done!'}` });
  }
  emit(c, 'deliver', { job: r.job, item: r.item, qty: r.qty, paid: r.paid });
  emit(o ?? null, 'jobDelivered', { job: r.job, poster: r.poster, item: r.item, qty: r.qty, left: r.left });
  return r;
});
register('jobs.cancel', (g, c, a) => {
  const r = g.jobs.cancel(c.hero.id, a.id);
  c.pushInventory();
  return r;
});
