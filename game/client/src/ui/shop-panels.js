import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS, RARITY } from '../../../shared/items.js';
import { SHOP, estimate, refPrice, npcCeil, demandLabel } from '../../../shared/shop.js';
import { MARKET_TAX } from '../../../shared/economy.js';
import { townAt, townName, townCount } from '../../../shared/places.js';
import { portrait } from './portrait.js';
import { iconEl } from './panels.js';

// Panels for walk-in shops. Each builder is called as fn.call(panels, c, args).

const num = (value, max) => h('input', { type: 'number', min: 1, max, value, inputMode: 'numeric' });
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const hours = (h_) => (!isFinite(h_) ? 'not at this price' : h_ < 1 ? `about ${Math.max(1, Math.round(h_ * 60))} min` : `about ${h_ < 10 ? h_.toFixed(1) : Math.round(h_)} h`);

// The sales forecast under a price input: chance per interested customer,
// sales per hour while you're away, when it sells out, and town demand.
function forecast(room, slot, item, qty, price) {
  const slots = [...room.slots.values()].filter((s) => s.slot !== slot).concat([{ slot, item, qty, price }]);
  const fillOf = (it) => room.demand[it] ?? 1;
  const e = estimate(slots, fillOf, 'offline', room.town)[slot];
  const fill = fillOf(item);
  const lines = [];
  if (price > npcCeil(item)) lines.push(h('div.warn', `Townsfolk never pay more than ${npcCeil(item)} 🪙 for this (players still might).`));
  else if (e.shadowed) lines.push(h('div.warn', 'Customers pick your cheaper display of this item first.'));
  else
    lines.push(
      h('div.kv', h('span', 'Chance a shopper buys'), h('b', `${Math.round(e.chance * 100)}%`)),
      h('div.kv', h('span', 'While you’re away'), h('b', `~${e.perHour < 1 ? e.perHour.toFixed(1) : Math.round(e.perHour)} sold / hour`)),
      h('div.kv', h('span', 'Sells out in'), h('b', hours(e.sellOutHours))),
    );
  lines.push(h('div.kv', h('span', 'Town demand'), h('b', `${demandLabel(fill)} · fair price ~${Math.round(refPrice(item, fill))} 🪙`)));
  return h('div.forecast', ...lines);
}

export const SHOP_PANELS = {
  // Owner: stock / reprice / take back one display.
  display(c, { slot, room }) {
    this.title(c, `Display ${slot + 1}`);
    const draw = () => {
      clear(c.body);
      const s = room.slots.get(slot);
      if (s) return drawStocked(s);
      drawEmpty();
    };
    const drawStocked = (s) => {
      const it = ITEMS[s.item];
      const price = num(s.price, SHOP.MAX_PRICE);
      const fc = h('div');
      const upd = () => clear(fc).append(forecast(room, slot, s.item, s.qty, +price.value || s.price));
      price.addEventListener('input', upd);
      upd();
      const have = this.me.inv[s.item] || 0;
      const add = num(Math.max(1, have), Math.max(1, have));
      const back = num(s.qty, s.qty);
      c.body.append(
        h('div.row', h('div', iconEl(s.item, '56px')), h('div.grow', h('b', it.name), h('div.muted', `${fmt(s.qty)} on display · worth ${it.value} 🪙`))),
        h('div.row.wrap', h('label.qty', 'Price ', price), h('button.btn.small', { on: { click: () => this.rpc('shop.price', { slot, price: +price.value }, 'Price updated.').then(draw) } }, 'Set price')),
        h('div.row.wrap', ...[[1, 'Fair'], [1.15, '+15%'], [1.3, '+30%']].map(([m, l]) => h('button.chip', { on: { click: () => ((price.value = Math.max(1, Math.round(refPrice(s.item, room.demand[s.item] ?? 1) * m))), upd()) } }, l))),
        fc,
        have ? h('div.row.wrap', h('label.qty', 'Add ', add), h('button.btn.green.small', { on: { click: () => this.rpc('shop.stock', { slot, item: s.item, qty: +add.value, price: +price.value }, 'Restocked!').then(draw) } }, `Add from bag (${have})`)) : null,
        h('div.row.wrap', h('label.qty', 'Take ', back), h('button.btn.red.small', { on: { click: () => this.rpc('shop.unstock', { slot, qty: +back.value }, 'Back in your bag.').then(draw) } }, 'Take back')),
      );
    };
    const drawEmpty = () => {
      const equipped = Object.values(this.me.equip);
      const inv = Object.entries(this.me.inv).filter(([id, n]) => n > 0 && ITEMS[id] && !(equipped.includes(id) && n <= 1));
      if (!inv.length) return c.body.append(h('div.empty', 'Your bag is empty — gather or craft something to sell!'));
      const form = h('div');
      c.body.append(h('div.muted', 'Pick something to put on this display. Shoppers buy it while you’re out adventuring; the gold goes in your till.'), h('div.grid', { style: { marginTop: '8px' } }, ...inv.map(([id, n]) => h('div.slot', { 'data-r': ITEMS[id].rarity, title: ITEMS[id].name, on: { click: () => pick(id) } }, iconEl(id), h('span.q', fmt(n))))), form);
      const pick = (id) => {
        clear(form);
        const it = ITEMS[id];
        const max = Math.min(SHOP.SLOT_MAX_QTY, this.me.inv[id] - (equipped.includes(id) ? 1 : 0));
        const qty = num(max, max);
        const price = num(Math.max(1, Math.round(refPrice(id, room.demand[id] ?? 1))), SHOP.MAX_PRICE);
        const fc = h('div');
        const upd = () => clear(fc).append(forecast(room, slot, id, +qty.value || 1, +price.value || 1));
        qty.addEventListener('input', upd);
        price.addEventListener('input', upd);
        upd();
        form.append(
          h('div.row.wrap', { style: { marginTop: '10px' } }, iconEl(id, '40px'), h('b', it.name), h('label.qty', 'Qty ', qty), h('label.qty', 'Price ', price)),
          fc,
          h('button.btn.green', { style: { marginTop: '8px' }, on: { click: () => this.rpc('shop.stock', { slot, item: id, qty: +qty.value, price: +price.value }, `${it.name} is on display!`).then(() => (sfx.coin(), this.close())) } }, 'Put on display'),
        );
      };
    };
    c.refresh = draw;
    draw();
  },

  // Visitor: buy from a display at the shown price.
  buy(c, { slot, room }) {
    const draw = () => {
      clear(c.body);
      const s = room.slots.get(slot);
      if (!s) {
        this.title(c, 'Empty display');
        return c.body.append(h('div.empty', 'Someone just bought the last one!'));
      }
      const it = ITEMS[s.item];
      this.title(c, it.name);
      const qty = num(1, s.qty);
      const total = h('b.gold');
      const upd = () => (total.textContent = `${fmt((+qty.value || 1) * s.price)} 🪙`);
      qty.addEventListener('input', upd);
      upd();
      const vs = s.price / it.value;
      c.body.append(
        h('div.row', h('div', iconEl(s.item, '64px')), h('div.grow', h('div', { style: { fontWeight: 700 } }, h('span', { style: { background: '#2a2018', color: RARITY[it.rarity].color, padding: '1px 6px', borderRadius: '3px' } }, RARITY[it.rarity].label)), h('div.muted', `${fmt(s.qty)} in stock · ${s.price} 🪙 each`), h('div.muted', vs <= 1.05 ? 'A fair price.' : vs <= 1.3 ? 'A little above its usual value.' : 'Pricey!'))),
        h('div.row.wrap', { style: { marginTop: '10px' } }, h('label.qty', 'Qty ', qty), h('span', 'Total '), total),
        h('button.btn.green', {
          style: { marginTop: '10px' },
          on: {
            click: async () => {
              const nonce = Math.random().toString(36).slice(2, 12);
              try {
                const r = await this.sock.rpc('shop.buy', { owner: room.owner, slot, qty: +qty.value, price: s.price, item: s.item, nonce });
                sfx.coin();
                this.hud.toast(`Bought ${r.sale.qty}× ${it.name} for ${fmt(r.sale.gross)} 🪙`, 'gold');
                this.close();
              } catch (e) {
                this.hud.toast(e.message, 'err');
                draw();
              }
            },
          },
        }, 'Buy'),
      );
    };
    c.refresh = draw;
    draw();
  },

  // Every shop in town; visit any of them.
  shops(c) {
    this.title(c, 'Shops', 'village');
    c.body.append(h('div.empty', 'Loading…'));
    this.sock
      .rpc('shop.directory')
      .then((list) => {
        clear(c.body);
        if (!list.length) return c.body.append(h('div.empty', 'No shops are stocked yet. Be the first!'));
        for (const s of list) {
          const mine = s.owner === this.hud.myId;
          const f = s.featured ? ITEMS[s.featured.item] : null;
          c.body.append(
            h(
              'div.rowcard',
              h('img', { src: portrait(s.avatar), style: { width: '48px', height: '48px', borderRadius: '10px', background: '#3a2c22' } }),
              h('div.grow', h('div.t', s.name, mine ? ' (yours)' : ''), h('div.s', `${s.online ? '🟢' : '⚪'} ${s.heroName}${townCount() > 1 ? ` · ${townName(s.town)}` : ''} · ${s.displays} displays${s.visitors ? ` · ${s.visitors} inside` : ''}${s.open ? '' : ' · closed'}`), f ? h('div.s', `Featuring ${f.name} · ${fmt(s.featured.price)} 🪙`) : null),
              s.open || mine ? h('button.btn.green.small', { on: { click: () => (this.close(), this.hud.game?.enterShop(s.owner)) } }, mine ? 'Go in' : 'Visit') : h('span.muted', 'Closed'),
            ),
          );
        }
      })
      .catch((e) => this.hud.toast(e.message, 'err'));
  },

  // Owner: till, today's takings, the sales ledger, open/closed, shop name.
  ledger(c) {
    this.title(c, 'Ledger', 'scroll');
    const draw = async () => {
      let L;
      let st;
      try {
        [L, st] = await Promise.all([this.sock.rpc('shop.ledger', {}), this.sock.rpc('shop.state', {})]);
      } catch (e) {
        return this.hud.toast(e.message, 'err');
      }
      clear(c.body);
      const name = h('input', { value: st.name, maxLength: SHOP.NAME_MAX });
      c.body.append(
        h('div.till', h('div', h('div.muted', 'In the till'), h('div.big.gold', `${fmt(L.till)} 🪙`)), h('button.btn.green', { disabled: !L.till, on: { click: () => this.rpc('shop.collect', {}).then((r) => (sfx.coin(), this.hud.toast(`Collected ${fmt(r.gold)} 🪙`, 'gold'), this.hud.setTill?.(0), draw())) } }, 'Collect')),
        h('div.kv', h('span', 'Last 24 hours'), h('b', `${L.day.count} sales · ${fmt(L.day.gross - L.day.fee)} 🪙`)),
        h('div.kv', h('span', 'All time'), h('b', `${fmt(st.stats?.sales || 0)} sold · ${fmt(st.stats?.earned || 0)} 🪙`)),
        ...[homeTown.call(this, st, draw)].filter(Boolean),
        h('div.muted', { style: { fontSize: '12px', margin: '4px 0 8px' } }, `Fees: ${Math.round(MARKET_TAX * 100)}% on sales to players (like the market), ${SHOP.NPC_FEE_PM / 10}% guild levy on sales to townsfolk.`),
        h('div.row.wrap', h('label.qty', 'Name ', name), h('button.btn.small', { on: { click: () => this.rpc('shop.setup', { name: name.value }, 'Renamed!').then(draw) } }, 'Rename'), h('button.btn.small' + (st.open ? '.red' : '.green'), { on: { click: () => this.rpc('shop.setup', { open: !st.open }, st.open ? 'Shop closed.' : 'Shop open!').then(draw) } }, st.open ? 'Close shop' : 'Open shop')),
        h('div.section-title', 'Recent sales'),
        ...(L.rows.length
          ? L.rows.map((r) => h('div.rowcard', h('div.ic', iconEl(r.item, '32px')), h('div.grow', h('div.t', `${r.qty}× ${ITEMS[r.item]?.name || r.item}`), h('div.s', `${r.kind === 'player' ? '' : ''}${r.buyer} · ${ago(r.ts)}`)), h('b.gold', `+${fmt(r.gross - r.fee)}`)))
          : [h('div.empty', 'No sales yet. Stock a display and go adventuring!')]),
      );
    };
    draw();
  },

  // "While you were away".
  away(c, m) {
    this.title(c, 'While you were away', 'shop');
    const top = m.top.map((t) => h('div.kv', h('span', h('span', iconEl(t.item, '24px')), ` ${ITEMS[t.item]?.name} ×${fmt(t.qty)}`), h('b.gold', `+${fmt(t.gold)}`)));
    c.body.append(
      h('div', { style: { textAlign: 'center', margin: '4px 0 10px' } }, h('div.big.gold', `+${fmt(m.net)} 🪙`), h('div.muted', `${m.count} sale${m.count === 1 ? '' : 's'}`)),
      ...top,
      ...m.players.map((p) => h('div.muted', `${p.name} bought ${p.qty}× ${ITEMS[p.item]?.name}`)),
      m.paused ? h('div.warn', 'You were away a long time, so townsfolk stopped visiting after 12 hours. Friends could still buy.') : null,
      h('div.row', { style: { marginTop: '12px', justifyContent: 'center' } }, h('button.btn.green', { disabled: !m.till, on: { click: () => this.rpc('shop.collect', {}).then((r) => (sfx.coin(), this.hud.toast(`Collected ${fmt(r.gold)} 🪙`, 'gold'), this.hud.setTill?.(0), this.close())) } }, `Collect ${fmt(m.till)} 🪙`), h('button.btn', { on: { click: () => this.close() } }, 'Later')),
    );
    c.onClose = () => this.sock.rpc('shop.ack', { upto: m.upto }, { auto: true }).catch(() => {});
  },
};

// Where the shop is (its customers are that town's), and moving it to the
// town you're in, for 500 gold per tier of that town.
function homeTown(st, draw) {
  if (townCount() < 2) return null;
  const p = this.hud.game?.myPos();
  const here = p && townAt(p.x, p.z);
  const fee = here ? 500 * (here.tier ?? 1) : 0;
  return h(
    'div.kv',
    h('span', 'Home town'),
    h('b', townName(st.town)),
    here && here.id !== st.town && !this.hud.game?.dungeon
      ? h('button.btn.small', { on: { click: () => this.rpc('shop.move', { town: here.id }, `Your shop moved to ${here.name}.`).then(draw) } }, `Move to ${here.name} · ${fmt(fee)} 🪙`)
      : null,
  );
}
