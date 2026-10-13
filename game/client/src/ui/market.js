// A town's market: browse its book, an item's orders and price history (and
// what it fetches in other towns), placing and cancelling orders, the
// supplier stall and your storage in this town. Out of town you can look
// but not trade.
import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS, CATEGORIES } from '../../../shared/items.js';
import { MARKET_TAX as TAX } from '../../../shared/economy.js';
import { iconEl, qtyInput } from './itemui.js';
import { townName, townCount } from '../../../shared/places.js';

// Panel builders are called as fn.call(panels, c, args) (see panels.js), so
// `this` is the Panels; the helpers below are called the same way.
export const MARKET_PANELS = {
  market(c, args) {
    this.title(c, 'Grand Market', 'scales');
    const st = { tab: args.tab || 'browse', cat: 'all', q: '', item: args.item || null, side: 'buy', summary: {}, book: null, town: null, browseOnly: false, waiting: 0 };
    const load = async () => {
      try {
        const s = await this.sock.rpc('market.summary');
        Object.assign(st, { summary: s.items, town: s.town, browseOnly: s.browseOnly, waiting: s.waiting?.[s.town] ?? 0 });
        // Hearthvale's is the Grand Market; the others go by their town.
        if (townCount() > 1 && s.town !== 'hearthvale') this.title(c, `${townName(s.town)} Market`, 'scales');
      } catch {}
      if (this.cur === c) render();
    };
    st.reload = load;
    const render = () => {
      clear(c.body);
      if (st.browseOnly) c.body.append(h('div.note.away', `You're looking from afar. Head to ${townName(st.town)} to trade here.`));
      if (st.item) return marketItem.call(this, c, st, render);
      const tabs = [['browse', 'Browse'], ['mine', 'My Orders'], ['supplier', 'Stall'], ['storage', st.waiting ? `Storage (${fmt(st.waiting)})` : 'Storage']];
      c.body.append(h('div.tabs', ...tabs.map(([k, l]) => h('button' + (st.tab === k ? '.on' : ''), { on: { click: () => ((st.tab = k), render()) } }, l))));
      if (st.tab === 'mine') return myOrders.call(this, c.body, render);
      if (st.tab === 'supplier') return supplierTab.call(this, c.body, st, render);
      if (st.tab === 'storage') return storageTab.call(this, c.body, st, render);
      const search = h('input.search', { placeholder: 'Search items…', value: st.q });
      search.addEventListener('input', () => {
        st.q = search.value;
        list();
      });
      const listEl = h('div');
      const list = () => {
        clear(listEl);
        // Fine/Masterwork versions only show up once someone's trading them, you own one, or you search for them.
        const listed = (id) => !ITEMS[id].bound && (!ITEMS[id].q || st.summary[id] || this.me.inv[id] > 0 || st.q);
        const ids = Object.keys(ITEMS).filter((id) => listed(id) && (st.cat === 'all' || ITEMS[id].cat === st.cat) && ITEMS[id].name.toLowerCase().includes(st.q.toLowerCase()));
        ids.sort((a, b) => (st.summary[b]?.vol || 0) + (st.summary[b] ? 1 : 0) - ((st.summary[a]?.vol || 0) + (st.summary[a] ? 1 : 0)) || ITEMS[a].value - ITEMS[b].value);
        for (const id of ids) {
          const s = st.summary[id] || {};
          const it = ITEMS[id];
          listEl.append(
            h(
              'div.rowcard',
              { style: { cursor: 'pointer' }, on: { click: () => ((st.item = id), render()) } },
              h('div.ic', iconEl(id, '44px')),
              h('div.grow', h('div.t', it.name), h('div.s', s.last ? `Last ${s.last} 🪙 · ${fmt(s.vol)} traded today` : `No trades yet · base ${it.value} 🪙`), this.me.inv[id] ? h('div.s', `You have ${fmt(this.me.inv[id])}`) : null),
              h('div', { style: { textAlign: 'right', fontSize: '13px', fontWeight: 600 } }, h('div', { style: { color: '#a63a2e' } }, s.ask ? `Sell ${s.ask} 🪙 (${fmt(s.supply)})` : 'No sellers'), h('div', { style: { color: '#437a36' } }, s.bid ? `Buy ${s.bid} 🪙 (${fmt(s.demand)})` : 'No buyers')),
            ),
          );
        }
      };
      c.body.append(search, h('div.filters', ...[['all', 'All'], ...Object.entries(CATEGORIES).filter(([k]) => k !== 'special')].map(([k, l]) => h('button.chip' + (st.cat === k ? '.on' : ''), { on: { click: () => ((st.cat = k), render()) } }, l))), listEl);
      list();
    };
    c.refresh = () => {
      if (st.item && st.refreshItem) st.refreshItem();
    };
    render();
    load();
  },
};

async function myOrders(body, back) {
  const wrap = h('div', h('div.empty', 'Loading…'));
  body.append(wrap);
  let orders = [];
  try {
    orders = await this.sock.rpc('market.mine');
  } catch (e) {
    return this.hud.toast(e.message, 'err');
  }
  clear(wrap);
  if (!orders.length) return wrap.append(h('div.empty', h('div.big', '📋'), 'No orders yet. Place buy or sell orders from any item page.'));
  for (const o of orders) {
    const it = ITEMS[o.item];
    wrap.append(
      h(
        'div.rowcard',
        h('div.ic', it?.icon),
        h('div.grow', h('div.t', `${o.side === 'buy' ? 'Buying' : 'Selling'} ${it?.name}`), h('div.s', `${o.price} 🪙 each · ${o.filled}/${o.qty} filled · ${o.status}${townCount() > 1 ? ` · ${townName(o.town)}` : ''}`)),
        o.status === 'open'
          ? h('button.btn.red.small', {
              on: {
                click: async () => {
                  try {
                    const r = await this.sock.rpc('market.cancel', { id: o.id });
                    this.hud.toast(r?.stored ? `Order cancelled. The goods wait in your storage in ${townName(r.stored)}.` : 'Order cancelled — escrow returned.', 'good');
                    back();
                  } catch (e) {
                    this.hud.toast(e.message, 'err');
                  }
                },
              },
            }, 'Cancel')
          : null,
      ),
    );
  }
}

function marketItem(c, st, back) {
  const id = st.item;
  const it = ITEMS[id];
  const body = c.body;
  body.append(h('button.btn.plain.small', { style: { marginBottom: '10px' }, on: { click: () => ((st.item = null), back()) } }, '← All items'));
  const prices = h('div.muted', `Base value ${it.value} 🪙`);
  const head = h('div.row', h('div', { style: { fontSize: '44px' } }, iconEl(id, '60px')), h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 700, fontSize: '20px' } }, it.name), prices));
  const stats = h('div.muted', { style: { margin: '6px 0' } }, 'Loading…');
  const chart = h('canvas.chart', { width: 600, height: 160 });
  const bookEl = h('div.book');
  const trade = h('div.detail');
  const others = h('div');
  body.append(head, stats, chart, h('div.section-title', 'Order book'), bookEl, trade, others);
  // The price board: what it fetches in every town (a gap worth a trip?).
  if (townCount() > 1)
    this.sock
      .rpc('market.board', { item: id })
      .then((r) => {
        if (st.item !== id) return;
        others.append(
          h('div.section-title', 'Other towns'),
          ...r.towns.map((t) => h('div.rowcard' + (t.town === st.town ? '.open' : ''), h('div.grow', h('div.t', t.name), h('div.s', [t.last ? `Last ${t.last} 🪙` : 'No trades yet', `merchant pays ${t.npcBid} 🪙`, t.ask ? `stall sells at ${t.ask} 🪙` : null].filter(Boolean).join(' · '))))),
        );
      })
      .catch(() => {});

  const drawBook = (b) => {
    prices.textContent = [`Base value ${it.value} 🪙`, b.npcBid ? `Merchant pays ${b.npcBid} 🪙` : "The merchant won't buy it", b.supplierAsk ? `Stall sells at ${b.supplierAsk} 🪙` : null].filter(Boolean).join(' · ');
    stats.textContent = b.vol24 ? `24h: ${fmt(b.vol24)} traded · avg ${b.avg24} 🪙` : 'No trades in the last 24h — set the price!';
    clear(bookEl);
    const tbl = (rows, cls, title) =>
      h('table.' + cls, h('tr', h('th', title), h('th', 'Qty')), ...(rows.length ? rows.slice(0, 7).map((r) => h('tr', h('td', `${r.price} 🪙`), h('td', fmt(r.qty)))) : [h('tr', h('td.muted', '—'), h('td'))]));
    bookEl.append(h('div', tbl(b.asks, 'ask', 'Sell orders')), h('div', tbl(b.bids, 'bid', 'Buy orders')));
    // Price history chart
    const x = chart.getContext('2d');
    const W = chart.width;
    const H = chart.height;
    x.clearRect(0, 0, W, H);
    const pts = b.history;
    if (pts.length < 2) {
      x.fillStyle = '#8a785e';
      x.font = '700 20px "Alegreya Sans", sans-serif';
      x.textAlign = 'center';
      x.fillText(pts.length ? `Last trade: ${pts[0].price} 🪙` : 'No price history yet', W / 2, H / 2 + 8);
      return;
    }
    const ps = pts.map((p) => p.price);
    const lo = Math.min(...ps, it.value) * 0.9;
    const hi = Math.max(...ps, it.value) * 1.1;
    const Y = (v) => H - 14 - ((v - lo) / (hi - lo)) * (H - 28);
    x.strokeStyle = '#a8946e';
    x.setLineDash([6, 6]);
    x.beginPath();
    x.moveTo(0, Y(it.value));
    x.lineTo(W, Y(it.value));
    x.stroke();
    x.setLineDash([]);
    x.strokeStyle = '#b8862e';
    x.lineWidth = 4;
    x.beginPath();
    pts.forEach((p, i) => {
      const px = 10 + (i / (pts.length - 1)) * (W - 20);
      i ? x.lineTo(px, Y(p.price)) : x.moveTo(px, Y(p.price));
    });
    x.stroke();
    x.fillStyle = '#6b5a46';
    x.font = '700 17px "Alegreya Sans", sans-serif';
    x.fillText(`${Math.round(hi)} 🪙`, 8, 20);
    x.fillText(`${Math.round(lo)} 🪙`, 8, H - 4);
  };

  const drawTrade = (b) => {
    clear(trade);
    const side = st.side;
    const have = this.me.inv[id] || 0;
    const bestAsk = b.asks[0]?.price;
    const bestBid = b.bids[0]?.price;
    const defPrice = side === 'buy' ? bestBid ? bestBid + 1 : Math.max(1, Math.round(it.value * 0.9)) : bestAsk ? Math.max(1, bestAsk - 1) : Math.round(it.value * 1.1);
    const price = qtyInput(st.price ?? defPrice, 10_000_000);
    const qty = qtyInput(st.qty ?? (side === 'sell' ? Math.max(1, have) : 1), 9999);
    const summary = h('div.muted', { style: { margin: '8px 0' } });
    const upd = () => {
      st.price = +price.value;
      st.qty = +qty.value;
      const p = Math.max(0, Math.floor(+price.value || 0));
      const q = Math.max(0, Math.floor(+qty.value || 0));
      summary.textContent = side === 'buy' ? `Reserves ${fmt(p * q)} 🪙 (you have ${fmt(this.me.gold)}). Fills instantly against sellers at or below your price.` : `You receive ${fmt(Math.floor(p * q * (1 - TAX)))} 🪙 after 4% market tax. You have ${fmt(have)}.`;
    };
    price.addEventListener('input', upd);
    qty.addEventListener('input', upd);
    upd();
    // Instant: walk the book to find the price that fills qty.
    const instant = () => {
      const q = Math.floor(+qty.value);
      const levels = side === 'buy' ? b.asks : b.bids;
      let left = q;
      let worst = null;
      let total = 0;
      for (const l of levels) {
        const n = Math.min(left, l.qty);
        total += n * l.price;
        worst = l.price;
        left -= n;
        if (!left) break;
      }
      return { worst, total, filled: q - left };
    };
    const ins = instant();
    if (st.browseOnly) {
      trade.append(h('div.muted', `To buy or sell, come to ${townName(st.town)}.`));
      return;
    }
    const place = async (ioc) => {
      const q = Math.floor(+qty.value);
      const p = ioc ? ins.worst : Math.floor(+price.value);
      if (!q || !p) return this.hud.toast('Enter a price and quantity.', 'err');
      try {
        const r = await this.sock.rpc('market.place', { side, item: id, price: p, qty: q, ioc });
        if (r.filledQty) {
          sfx.coin();
          this.hud.toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${r.filledQty}× ${it.name}!`, 'gold');
        }
        if (r.order) this.hud.toast(`${side === 'buy' ? 'Buy' : 'Sell'} order placed for ${r.order.qty - r.order.filled}.`, 'good');
        st.price = st.qty = undefined;
        refreshItem();
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
    };
    trade.append(
      h('div.tabs', ...[['buy', 'Buy'], ['sell', 'Sell']].map(([k, l]) => h('button' + (side === k ? '.on' : ''), { on: { click: () => ((st.side = k), (st.price = st.qty = undefined), drawTrade(b)) } }, l))),
      h('div.row', { style: { flexWrap: 'wrap' } }, h('label.qty', 'Qty ', qty), h('label.qty', 'Price ', price, ' 🪙')),
      summary,
      h(
        'div.row',
        { style: { flexWrap: 'wrap' } },
        h('button.btn' + (side === 'buy' ? '.green' : '.red'), { on: { click: () => place(false) } }, side === 'buy' ? 'Place buy order' : 'Place sell order'),
        ins.filled
          ? h('button.btn.blue', { on: { click: () => place(true) } }, side === 'buy' ? `Buy ${ins.filled} now · ${fmt(ins.total)} 🪙` : `Sell ${ins.filled} now · ${fmt(Math.floor(ins.total * (1 - TAX)))} 🪙`)
          : h('span.muted', side === 'buy' ? 'Nobody is selling right now.' : 'Nobody is buying right now.'),
      ),
    );
  };

  const refreshItem = async () => {
    try {
      const b = await this.sock.rpc('market.book', { item: id, town: st.town });
      st.book = b;
      if (this.cur?.name !== 'market' || st.item !== id) return;
      drawBook(b);
      drawTrade(b);
    } catch (e) {
      this.hud.toast(e.message, 'err');
    }
  };
  st.refreshItem = refreshItem;
  refreshItem();
}

// The supplier stall: a few goods for sale every day, at a fixed price.
async function supplierTab(body, st, back) {
  const wrap = h('div', h('div.empty', 'Loading…'));
  body.append(wrap);
  let r;
  try {
    r = await this.sock.rpc('supplier.list');
  } catch (e) {
    return this.hud.toast(e.message, 'err');
  }
  clear(wrap);
  wrap.append(h('p.muted', 'The stall sells a few local goods every day at a fixed price. Handy when nobody is selling.'));
  for (const s of r.stock) {
    const it = ITEMS[s.item];
    const q = qtyInput(1, Math.max(1, s.left));
    const buy = async () => {
      try {
        const res = await this.sock.rpc('supplier.buy', { item: s.item, qty: +q.value });
        sfx.coin();
        this.hud.toast(`Bought ${res.qty}× ${it.name} for ${fmt(res.gold)} 🪙`, 'gold');
        back();
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
    };
    wrap.append(
      h(
        'div.rowcard',
        h('div.ic', iconEl(s.item, '44px')),
        h('div.grow', h('div.t', it.name), h('div.s', `${fmt(s.ask)} 🪙 each · ${s.left ? `${fmt(s.left)} left today` : 'sold out today'}`)),
        st.browseOnly || !s.left ? null : h('div.row', q, h('button.btn.green.small', { on: { click: buy } }, 'Buy')),
      ),
    );
  }
}

// Your storage in this town: goods that arrived for you (filled buy orders,
// deliveries, cancelled sell orders) and goods you parked here.
async function storageTab(body, st, back) {
  const wrap = h('div', h('div.empty', 'Loading…'));
  body.append(wrap);
  let r;
  try {
    r = await this.sock.rpc('storage.get', { town: st.town });
  } catch (e) {
    return this.hud.toast(e.message, 'err');
  }
  clear(wrap);
  const act = async (m, a, ok) => {
    try {
      const res = await this.sock.rpc(m, a);
      this.hud.toast(ok(res), 'good');
      await st.reload();
    } catch (e) {
      this.hud.toast(e.message, 'err');
    }
    back();
  };
  const stored = Object.entries(r.items);
  wrap.append(h('p.muted', `Storage is free. Goods you buy or are sent here wait for you, and you can leave goods here to sell later${townCount() > 1 ? ' (and skip the waystone toll)' : ''}.`));
  if (stored.length && !st.browseOnly) wrap.append(h('button.btn.green', { on: { click: () => act('storage.collect', {}, (x) => `Collected ${Object.values(x.moved).reduce((a, b) => a + b, 0)} items.`) } }, 'Collect everything'));
  if (!stored.length) wrap.append(h('div.empty', h('div.big', '📦'), 'Nothing stored here.'));
  for (const [item, n] of stored) {
    const q = qtyInput(n, n);
    wrap.append(h('div.rowcard', h('div.ic', iconEl(item, '40px')), h('div.grow', h('div.t', ITEMS[item].name), h('div.s', `${fmt(n)} stored`)), st.browseOnly ? null : h('div.row', q, h('button.btn.small', { on: { click: () => act('storage.withdraw', { item, qty: +q.value }, () => 'Taken out.') } }, 'Take'))));
  }
  if (st.browseOnly) return;
  // Leave goods here: anything in the bag that isn't worn or held.
  const worn = new Set(Object.values(this.me.equip || {}));
  const bag = Object.entries(this.me.inv).filter(([id, n]) => n > (worn.has(id) ? 1 : 0));
  if (bag.length) wrap.append(h('div.section-title', 'Leave goods here'));
  for (const [item, n] of bag) {
    const max = n - (worn.has(item) ? 1 : 0);
    const q = qtyInput(max, max);
    wrap.append(h('div.rowcard', h('div.ic', iconEl(item, '40px')), h('div.grow', h('div.t', ITEMS[item].name), h('div.s', `${fmt(n)} in your bag`)), h('div.row', q, h('button.btn.small', { on: { click: () => act('storage.deposit', { item, qty: +q.value }, () => 'Stored.') } }, 'Store'))));
  }
}
