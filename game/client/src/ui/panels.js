import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { portrait, itemIcon } from './portrait.js';
import { ITEMS, RARITY, CATEGORIES, baseOf, qOf } from '../../../shared/items.js';
import { RECIPES } from '../../../shared/recipes.js';
import { STATIONS, batchCap, isStackable } from '../../../shared/crafting.js';
import { SKILLS, SKILL_IDS, levelProgress, levelFromXp } from '../../../shared/skills.js';
import { MARKET_TAX as TAX } from '../../../shared/economy.js';
import { SHOP_PANELS } from './shop-panels.js';
import { glyph } from './glyphs.js';
import { BUILDINGS, doorPoint } from '../../../shared/world.js';
import { inYard, spotsOf } from '../../../shared/stations.js';

const NPC_RATE = 0.6;

// 3D-rendered icon when the item has a model, emoji otherwise.
// Fine / Masterwork versions use their base item's picture plus a star.
export const iconEl = (id, size = null) => {
  const q = qOf(id);
  const src = itemIcon(baseOf(id));
  const pic = src ? h('img.icon3d', { src, alt: ITEMS[id]?.name || id, style: size ? { width: size, height: size } : null }) : ITEMS[id]?.icon || '❔';
  return q ? h('span.qicon', pic, h('i.qbadge.q' + q, q === 2 ? '✦' : '★')) : pic;
};

const itemSlot = (id, qty, { sel = false, eq = false, on } = {}) =>
  h('div.slot' + (sel ? '.sel' : ''), { 'data-r': ITEMS[id]?.rarity, 'data-q': qOf(id) || null, title: ITEMS[id]?.name, on: on ? { click: on } : null }, iconEl(id), qty != null ? h('span.q', fmt(qty)) : null, eq ? h('span.eq', 'E') : null);

const qtyInput = (value, max) => {
  const inp = h('input', { type: 'number', min: 1, max, value, inputMode: 'numeric' });
  return inp;
};

function itemDesc(it) {
  const bits = [];
  if (it.tool) bits.push(`Tier ${it.tier} ${it.tool === 'axe' ? 'axe' : it.tool === 'pick' ? 'pickaxe' : 'rod'} · Power ${it.power}${it.speed ? ` · ${(1000 / it.speed).toFixed(1)} swings/s` : ''}`);
  if (it.atk) bits.push(`+${it.atk} ATK`);
  if (it.def) bits.push(`+${it.def} DEF`);
  if (it.hp) bits.push(`+${it.hp} HP`);
  if (it.heal) bits.push(`Heals ${it.heal} HP in battle`);
  return bits.join(' · ');
}

export class Panels {
  constructor(hud) {
    this.hud = hud;
    this.cur = null;
  }
  get sock() {
    return this.hud.sock;
  }
  get me() {
    return this.hud.me;
  }

  open(name, args = {}) {
    this.close();
    this.hud.worldMap?.close();
    const body = h('div.panel-body');
    const titleEl = h('h3');
    const place = this.#placeFor(name, args);
    const walk = place ? h('button.walk', { title: `Walk to the ${place.label}`, on: { click: () => (this.close(), this.hud.travel(place.id)) } }, glyph('run'), h('span', 'Walk there')) : null;
    const panel = h('div.panel' + (['profile', 'result'].includes(name) ? '.narrow' : ''), h('div.panel-head', titleEl, walk, h('button.close', { 'aria-label': 'Close', on: { click: () => this.close() } }, '✕')), body);
    const scrim = h('div.scrim', { on: { pointerdown: (e) => e.target === scrim && this.close() } }, panel);
    this.hud.el.append(scrim);
    this.cur = { name, scrim, body, titleEl, args, refresh: null, onClose: null };
    const fn = this['p_' + name] || SHOP_PANELS[name];
    if (fn) fn.call(this, this.cur, args);
    sfx.pop();
  }

  // A building panel opened from afar (the dock opens them anywhere): the
  // nearest building it belongs to, so you can still walk over.
  #placeFor(name, args) {
    const g = this.hud.game;
    if (!g?.me || g.room) return null;
    const p = g.myPos();
    if (name === 'craft' && (args.station || inYard(p.x, p.z))) return null; // already at the stations
    let best = null;
    for (const b of BUILDINGS) {
      if (b.deco || b.action !== name || b.action === 'shop') continue;
      const [dx, dz] = doorPoint(b);
      const d = Math.hypot(dx - p.x, dz - p.z);
      if (!best || d < best.d) best = { b, d };
    }
    return best && best.d > 8 ? best.b : null;
  }

  close() {
    if (!this.cur) return;
    this.cur.onClose?.();
    this.cur.scrim.remove();
    this.cur = null;
  }

  refresh(name) {
    if (!this.cur || (name && this.cur.name !== name)) return;
    // Don't yank an input out from under someone who is typing a price.
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT' && this.cur.scrim.contains(a)) return;
    this.cur.refresh?.();
  }

  title(c, t, g) {
    c.titleEl.replaceChildren(...(g ? [glyph(g)] : []), t);
  }

  // ── Bag & Hero ─────────────────────────────────────────────────────
  p_bag(c, args) {
    this.title(c, 'Bag', 'bag');
    let tab = args.tab || 'items';
    let cat = 'all';
    let sel = null;
    const render = () => {
      clear(c.body);
      c.body.append(
        h('div.tabs', ...[['items', 'Items'], ['hero', 'Hero']].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), render()) } }, l))),
      );
      if (tab === 'hero') return this.#heroTab(c.body);
      const inv = Object.entries(this.me.inv).filter(([id, n]) => n > 0 && ITEMS[id] && (cat === 'all' || ITEMS[id].cat === cat));
      c.body.append(
        h('div.filters', ...[['all', 'All'], ...Object.entries(CATEGORIES)].map(([k, l]) => h('button.chip' + (cat === k ? '.on' : ''), { on: { click: () => ((cat = k), render()) } }, l))),
      );
      if (!inv.length) {
        c.body.append(h('div.empty', h('div.big', '🍃'), 'Nothing here yet. Go chop, mine, pick and fish!'));
        return;
      }
      const equipped = new Set(Object.values(this.me.equip));
      c.body.append(h('div.grid', ...inv.map(([id, n]) => itemSlot(id, n, { sel: sel === id, eq: equipped.has(id), on: () => ((sel = id), render()) }))));
      if (sel && this.me.inv[sel] > 0) c.body.append(this.#itemDetail(sel, equipped.has(sel)));
    };
    c.refresh = render;
    render();
  }

  #itemDetail(id, isEq) {
    const it = ITEMS[id];
    const have = this.me.inv[id];
    const npc = Math.max(1, Math.floor(it.value * NPC_RATE));
    const sellable = isEq ? have - 1 : have;
    const q = qtyInput(Math.max(1, sellable), Math.max(1, sellable));
    const box = h(
      'div.detail',
      h('div.row', h('div', { style: { fontSize: '40px' } }, iconEl(id, '56px')), h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 700, fontSize: '18px' } }, it.name), h('div', { style: { fontWeight: 700, fontSize: '13px' } }, h('span', { style: { background: '#2a2018', color: RARITY[it.rarity].color, padding: '1px 6px', borderRadius: '3px' } }, RARITY[it.rarity].label), ' · ' + CATEGORIES[it.cat]), h('div.muted', itemDesc(it)))),
      h('div.kv', h('span', 'You own'), h('b', fmt(have))),
      h('div.kv', h('span', 'Base value'), h('b.gold', `${it.value} 🪙`)),
      h('div.kv', h('span', 'Merchant pays'), h('b.gold', `${npc} 🪙 each`)),
      h(
        'div.row',
        { style: { marginTop: '10px', flexWrap: 'wrap' } },
        (it.cat === 'tool' || it.slot) && !isEq ? h('button.btn.green.small', { on: { click: () => this.#rpc('equip', { item: id }, `Equipped ${it.name}!`) } }, 'Equip') : null,
        isEq ? h('span.chip.on', 'Equipped') : null,
        sellable > 0 ? h('div.qty', q) : null,
        sellable > 0 ? h('button.btn.small', { on: { click: () => this.#npcSell(id, +q.value) } }, 'Sell to merchant') : null,
        h('button.btn.blue.small', { on: { click: () => this.open('market', { item: id }) } }, 'Market'),
      ),
    );
    return box;
  }

  async #npcSell(item, qty) {
    try {
      const r = await this.sock.rpc('npcSell', { item, qty });
      sfx.coin();
      this.hud.toast(`Sold for ${r.gold} 🪙`, 'gold');
    } catch (e) {
      this.hud.toast(e.message, 'err');
    }
  }

  rpc(m, a, okText) {
    return this.#rpc(m, a, okText);
  }

  // Quick craft happens in the Workshop yard: opened from afar (the dock),
  // walk over first, then make it.
  #quickCraft(r, n, out, load) {
    const go = () =>
      this.rpc('craft.quick', { recipe: r.id, times: n })
        .then((res) => (this.hud.toast(`${res.qty}× ${out.name} (fee ${res.fee} 🪙)`, 'good'), this.hud.onXp(res.xp), this.cur?.name === 'craft' && load()))
        .catch(() => {});
    const g = this.hud.game;
    const p = g.myPos();
    if (inYard(p.x, p.z)) return go();
    const sp = spotsOf(r.station)[0];
    this.close();
    if (!g.walkTo(sp.x, sp.z, true, go)) return this.hud.toast("Can't reach the Workshop yard.", 'err');
    this.hud.toast('Off to the Workshop yard…');
  }

  async #rpc(m, a, okText) {
    try {
      const r = await this.sock.rpc(m, a);
      if (okText) this.hud.toast(okText, 'good');
      return r;
    } catch (e) {
      this.hud.toast(e.message, 'err');
      throw e;
    }
  }

  #heroTab(body) {
    const me = this.me;
    const st = me.stats || { atk: 0, def: 0, hp: 0 };
    body.append(
      h(
        'div.row',
        { style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
        h('img', { src: portrait(this.hud.myAvatar, { full: true }), style: { width: '130px', height: '162px', background: 'radial-gradient(circle at 50% 35%, #4a3a2c, #1e1814)', borderRadius: '6px', border: '1px solid #8a6a3a' } }),
        h(
          'div',
          { style: { flex: 1, minWidth: '200px' } },
          h('div', { style: { fontWeight: 700, fontSize: '22px' } }, this.hud.myName),
          h('div.muted', `Hero level ${me.level}`),
          h('div.statgrid', { style: { margin: '10px 0' } }, h('div.stat', h('b', st.atk), h('span', 'Attack')), h('div.stat', h('b', st.def), h('span', 'Defense')), h('div.stat', h('b', st.hp), h('span', 'Health'))),
          h('button.btn.purple.small', { on: { click: () => (this.close(), this.hud.onCustomize?.()) } }, 'Customize look'),
        ),
      ),
      h('div.section-title', 'Equipment'),
      h(
        'div.grid',
        ...['weapon', 'armor', 'trinket', 'axe', 'pick', 'rod'].map((slot) => {
          const id = me.equip[slot];
          return h('div', { style: { textAlign: 'center' } }, id ? itemSlot(id, null) : h('div.slot', { style: { opacity: 0.4 } }, '—'), h('div.muted', slot === 'pick' ? 'pickaxe' : slot));
        }),
      ),
      h('div.section-title', 'Skills'),
      ...SKILL_IDS.map((k) => {
        const p = levelProgress(me.skills[k] || 0);
        return h('div.skillrow', h('span', SKILLS[k].icon), h('div', h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '14px' } }, h('span', SKILLS[k].name), h('span.muted', `${fmt(p.into)}/${fmt(p.need)}`)), h('div.bar', h('i', { style: { width: `${p.pct * 100}%` } }))), h('b', `Lv ${p.level}`));
      }),
    );
  }

  // ── Workshop ───────────────────────────────────────────────────────
  // The Workshop: pick a recipe at one of the five stations, then go and
  // make it by hand (client/src/ui/craftgame.js). Mastered refining/cooking
  // recipes can be Quick-crafted.
  p_craft(c, args = {}) {
    this.title(c, 'Workshop', 'anvil');
    let tab = args.station || 'workbench';
    let info = null;
    let pick = null;
    const batches = {};
    const render = () => {
      clear(c.body);
      const lvl = levelFromXp(this.me.skills.crafting || 0);
      c.body.append(
        h('div.muted', { style: { marginBottom: '8px' } }, `Crafting level ${lvl}. Pick a recipe, walk to its station and make it yourself — good timing gives bonus materials or Fine and Masterwork gear.`),
        h('div.tabs', { style: { flexWrap: 'wrap' } }, ...Object.entries(STATIONS).map(([k, st]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), (pick = null), render()) } }, `${st.icon} ${st.label}`))),
      );
      for (const r of RECIPES.filter((x) => x.station === tab)) {
        const out = ITEMS[r.out];
        const locked = lvl < r.lvl;
        const cap = batchCap(r, lvl);
        const afford = Math.min(cap, ...Object.entries(r.in).map(([id, n]) => Math.floor((this.me.inv[id] || 0) / n)));
        const m = info?.mastery?.[r.id];
        const open = pick === r.id;
        const row = h(
          'div.rowcard' + (locked ? '.locked' : '') + (open ? '.open' : ''),
          { on: { click: () => !locked && ((pick = open ? null : r.id), render()) } },
          h('div.ic', iconEl(r.out, '44px')),
          h(
            'div.grow',
            h('div.t', out.name, h('span.muted', `  · worth ${out.value} 🪙`)),
            h('div', ...Object.entries(r.in).map(([id, n]) => h('span.need' + ((this.me.inv[id] || 0) < n ? '.short' : ''), `${ITEMS[id].icon} ${this.me.inv[id] || 0}/${n}`))),
            out.cat === 'tool' || out.cat === 'gear' ? h('div.s', itemDesc(out)) : null,
            locked ? h('div.s', `Requires Crafting ${r.lvl}`) : m ? h('div.s', `Best ${m.best} · made well ${m.n}×${m.quick ? ' · ⚡ Quick' : ''}`) : null,
          ),
        );
        c.body.append(row);
        if (!open) continue;
        const stackable = isStackable(r);
        let n = Math.max(1, Math.min(batches[r.id] || afford || 1, cap));
        const qtyEl = h('b', String(n));
        const yieldEl = h('span.muted');
        const upd = () => {
          batches[r.id] = n;
          qtyEl.textContent = String(n);
          yieldEl.textContent = stackable ? `→ ${n * r.qty}, up to ${Math.ceil(n * r.qty * 1.2)} with great timing` : 'Great timing can make it Fine or even Masterwork';
        };
        upd();
        const step = (d) => (e) => (e.stopPropagation(), (n = Math.max(1, Math.min(cap, n + d))), upd());
        c.body.append(
          h(
            'div.detail',
            stackable && cap > 1 ? h('div.row', h('button.btn.small', { on: { click: step(-1) } }, '−'), qtyEl, h('button.btn.small', { on: { click: step(1) } }, '+'), h('button.chip', { on: { click: (e) => (e.stopPropagation(), (n = Math.max(1, afford)), upd()) } }, `Max (${Math.max(1, afford)})`)) : null,
            yieldEl,
            h(
              'div.row.wrap',
              h('button.btn.green', { disabled: afford < 1, on: { click: (e) => (e.stopPropagation(), this.close(), this.hud.game?.goCraft(r.id, n)) } }, `${STATIONS[r.station].icon} ${STATIONS[r.station].verb} it`),
              stackable && m?.quick
                ? h('button.btn.blue.small', { disabled: afford < 1, on: { click: (e) => (e.stopPropagation(), this.#quickCraft(r, n, out, load)) } }, `Quick ×${n}`)
                : null,
            ),
          ),
        );
      }
    };
    const load = () =>
      this.sock
        .rpc('craft.info')
        .then((r) => ((info = r), render()))
        .catch(() => {});
    c.refresh = render;
    render();
    load();
  }

  // ── Grand Market ───────────────────────────────────────────────────
  p_market(c, args) {
    this.title(c, 'Grand Market', 'scales');
    const st = { tab: 'browse', cat: 'all', q: '', item: args.item || null, side: 'buy', summary: {}, book: null };
    const load = async () => {
      try {
        st.summary = await this.sock.rpc('market.summary');
      } catch {}
      render();
    };
    const render = () => {
      clear(c.body);
      if (st.item) return this.#marketItem(c, st, render);
      c.body.append(
        h('div.tabs', ...[['browse', 'Browse'], ['mine', 'My Orders']].map(([k, l]) => h('button' + (st.tab === k ? '.on' : ''), { on: { click: () => ((st.tab = k), render()) } }, l))),
      );
      if (st.tab === 'mine') return this.#myOrders(c.body, render);
      const search = h('input.search', { placeholder: 'Search items…', value: st.q });
      search.addEventListener('input', () => {
        st.q = search.value;
        list();
      });
      const listEl = h('div');
      const list = () => {
        clear(listEl);
        // Fine/Masterwork versions only show up once someone's trading them, you own one, or you search for them.
        const listed = (id) => !ITEMS[id].q || st.summary[id] || this.me.inv[id] > 0 || st.q;
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
      c.body.append(search, h('div.filters', ...[['all', 'All'], ...Object.entries(CATEGORIES)].map(([k, l]) => h('button.chip' + (st.cat === k ? '.on' : ''), { on: { click: () => ((st.cat = k), render()) } }, l))), listEl);
      list();
    };
    c.refresh = () => {
      if (st.item && st.refreshItem) st.refreshItem();
    };
    render();
    load();
  }

  async #myOrders(body, back) {
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
          h('div.grow', h('div.t', `${o.side === 'buy' ? 'Buying' : 'Selling'} ${it?.name}`), h('div.s', `${o.price} 🪙 each · ${o.filled}/${o.qty} filled · ${o.status}`)),
          o.status === 'open'
            ? h('button.btn.red.small', {
                on: {
                  click: async () => {
                    try {
                      await this.sock.rpc('market.cancel', { id: o.id });
                      this.hud.toast('Order cancelled — escrow returned.', 'good');
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

  #marketItem(c, st, back) {
    const id = st.item;
    const it = ITEMS[id];
    const body = c.body;
    body.append(h('button.btn.plain.small', { style: { marginBottom: '10px' }, on: { click: () => ((st.item = null), back()) } }, '← All items'));
    const head = h('div.row', h('div', { style: { fontSize: '44px' } }, iconEl(id, '60px')), h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 700, fontSize: '20px' } }, it.name), h('div.muted', `Base value ${it.value} 🪙 · Merchant pays ${Math.floor(it.value * NPC_RATE)} 🪙`)));
    const stats = h('div.muted', { style: { margin: '6px 0' } }, 'Loading…');
    const chart = h('canvas.chart', { width: 600, height: 160 });
    const bookEl = h('div.book');
    const trade = h('div.detail');
    body.append(head, stats, chart, h('div.section-title', 'Order book'), bookEl, trade);

    const drawBook = (b) => {
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
        const b = await this.sock.rpc('market.book', { item: id });
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

  // ── Your Shop ──────────────────────────────────────────────────────
  // ── Town Hall ──────────────────────────────────────────────────────
  // ── Bulletin board: paid jobs between players (server/jobs.js) ────────
  p_jobs(c, args = {}) {
    this.title(c, 'Bulletin Board', 'scroll');
    let tab = args.tab || 'board';
    let data = null;
    let post = { item: 'oak_log', qty: 20, per: null };
    const left = (t) => {
      const ms = t - (data?.now ?? Date.now());
      const hrs = Math.max(0, Math.round(ms / 3600_000));
      return hrs >= 24 ? `${Math.round(hrs / 24)}d left` : hrs >= 1 ? `${hrs}h left` : 'ending soon';
    };
    const load = async () => {
      try {
        data = await this.sock.rpc('jobs.list');
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      if (this.cur === c) render();
    };
    const act = async (m, a, ok) => {
      try {
        const r = await this.sock.rpc(m, a);
        sfx.coin();
        this.hud.toast(ok(r), 'gold');
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      load();
    };
    const render = () => {
      clear(c.body);
      const tabs = [['board', 'Jobs'], ['mine', 'My jobs'], ['post', 'Post a job']];
      c.body.append(h('div.tabs', ...tabs.map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), render()) } }, l))));
      if (tab === 'post') return this.#jobForm(c.body, post, () => ((tab = 'mine'), load()));
      if (!data) return c.body.append(h('div.empty', 'Reading the board…'));
      if (tab === 'board') {
        c.body.append(h('p.muted', 'Bring what someone asks for and get paid on the spot (4% tax). You can deliver part of a job.'));
        if (!data.open.length) return c.body.append(h('div.empty', h('div.big', '📜'), 'No jobs posted right now. Post one yourself!'));
        for (const j of data.open) {
          const it = ITEMS[j.item];
          const mine = j.poster === this.hud.myId;
          const have = this.me.inv[j.item] || 0;
          const n = Math.min(have, j.left);
          const q = qtyInput(Math.max(1, n), Math.max(1, n));
          const right = mine
            ? h('span.chip.on', 'Yours')
            : have > 0
              ? h('div.row', q, h('button.btn.green.small', { on: { click: () => act('jobs.deliver', { id: j.id, qty: +q.value }, (r) => `Delivered ${r.qty}× ${it.name}: +${r.paid} 🪙`) } }, 'Deliver'))
              : h('span.muted', 'You have none');
          c.body.append(
            h('div.rowcard', h('div.ic', iconEl(j.item, '40px')), h('div.grow', h('div.t', `${j.left}× ${it.name}`, j.left < j.qty ? h('span.muted', ` (of ${j.qty})`) : null), h('div.s', `${fmt(j.per)} 🪙 each · ${fmt(j.left * j.per)} 🪙 in all · by ${j.posterName} · ${left(j.expiresAt)}`)), right),
          );
        }
        return;
      }
      // My jobs
      const mine = data.mine;
      if (!mine.length) return c.body.append(h('div.empty', h('div.big', '🪶'), "You haven't posted any jobs. Post one and others will gather or craft it for you."));
      for (const j of mine) {
        const it = ITEMS[j.item];
        const got = j.qty - j.left;
        const state = { open: left(j.expiresAt), done: 'Done!', cancelled: 'Cancelled', expired: 'Ran out' }[j.status];
        c.body.append(
          h(
            'div.rowcard' + (j.status === 'open' ? '.open' : '.locked'),
            h('div.ic', iconEl(j.item, '40px')),
            h('div.grow', h('div.t', `${it.name}: ${got} of ${j.qty} delivered`), h('div.s', `${fmt(j.per)} 🪙 each · ${state}`)),
            j.status === 'open' ? h('button.btn.red.small', { on: { click: () => act('jobs.cancel', { id: j.id }, (r) => `Job taken down${r.refund ? `: ${r.refund} 🪙 back` : ''}.`) } }, 'Cancel') : null,
          ),
        );
      }
    };
    c.refresh = () => tab !== 'post' && render();
    render();
    load();
  }
  #jobForm(body, post, done) {
    const items = Object.entries(ITEMS).filter(([id]) => !qOf(id)).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const pick = h('select', ...Object.entries(CATEGORIES).map(([cat, label]) => h('optgroup', { label }, ...items.filter(([, it]) => it.cat === cat).map(([id, it]) => h('option', { value: id, selected: id === post.item }, it.name)))));
    const qty = h('input', { type: 'number', min: 1, max: 999, value: post.qty, inputMode: 'numeric' });
    const per = h('input', { type: 'number', min: 1, value: post.per ?? Math.ceil(ITEMS[post.item].value * 1.25), inputMode: 'numeric' });
    const total = h('div.t');
    const hint = h('div.s');
    const btn = h('button.btn.green', 'Post job');
    const upd = () => {
      post.item = pick.value;
      post.qty = Math.max(1, Math.floor(+qty.value || 1));
      post.per = Math.max(1, Math.floor(+per.value || 1));
      const sum = post.qty * post.per;
      total.textContent = `Pays ${fmt(sum)} 🪙 in all`;
      hint.textContent = `Base value ${ITEMS[post.item].value} 🪙 each. Paying a bit more gets it done sooner. The gold is held now and refunded for anything not delivered.`;
      btn.disabled = sum > (this.me.gold ?? 0);
    };
    pick.onchange = () => ((per.value = Math.ceil(ITEMS[pick.value].value * 1.25)), upd());
    qty.oninput = per.oninput = upd;
    btn.onclick = async () => {
      upd();
      btn.disabled = true;
      try {
        await this.sock.rpc('jobs.post', { item: post.item, qty: post.qty, per: post.per });
        sfx.coin();
        this.hud.toast('Job posted on the board!', 'gold');
        done();
      } catch (e) {
        this.hud.toast(e.message, 'err');
        upd();
      }
    };
    const field = (label, el) => h('label.jobf', h('span', label), el);
    body.append(
      h('div.jobform', field('Item wanted', pick), h('div.row', field('How many', qty), field('Pay per item 🪙', per)), h('div.rowcard', h('div.grow', total, hint))),
      h('div.row', btn, h('span.muted', 'Jobs stay up for 3 days. You can have 5 at once.')),
    );
    upd();
  }

  p_townhall(c, args) {
    this.title(c, 'Town Hall', 'castle');
    let tab = args.tab || 'online';
    let info = null;
    const tabs = [['online', 'Online'], ['jobs', 'Jobs'], ['shops', 'Shops'], ['leaders', 'Leaders'], ['channels', 'Channels'], ['invites', 'Invites']];
    const render = () => {
      clear(c.body);
      if (this.hud.me.admin)
        c.body.append(h('div.rowcard', h('div.grow', h('div.t', 'Server owner'), h('div.s', 'Change the world map: place, move and remove anything.')), h('button.btn.small', { on: { click: () => (location.href = '/?editor') } }, 'Edit the world')));
      c.body.append(h('div.tabs', { style: { flexWrap: 'wrap' } }, ...tabs.map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => (k === 'jobs' ? this.open('jobs') : ((tab = k), render())) } }, l))));
      if (!info) return c.body.append(h('div.empty', 'Loading…'));
      if (tab === 'online') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, `${info.online.length} of ${info.heroes} heroes online`));
        for (const p of info.online)
          c.body.append(h('div.rowcard', h('div.ic', '🧑'), h('div.grow', h('div.t', p.name, p.id === this.hud.myId ? ' (you)' : ''), h('div.s', `Level ${p.level} · Channel ${p.channel}`)), p.id !== this.hud.myId ? h('button.btn.small', { on: { click: () => this.open('profile', { id: p.id }) } }, 'View') : null));
      } else if (tab === 'shops') {
        return this.open('shops');
      } else if (tab === 'leaders') {
        c.body.append(h('div.section-title', 'Richest'), ...info.rich.map((r, i) => h('div.kv', h('span', `${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${r.name}`), h('b.gold', `${fmt(r.gold)} 🪙`))));
        c.body.append(h('div.section-title', 'Most experienced'), ...info.levels.map((r, i) => h('div.kv', h('span', `${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${r.name}`), h('b', `${fmt(r.total)} XP`))));
      } else if (tab === 'channels') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, 'Each channel is a live copy of town. New players join the busiest channel with room, so friends end up together.'));
        for (const ch of info.channels)
          c.body.append(h('div.rowcard', h('div.ic', '🌐'), h('div.grow', h('div.t', `Channel ${ch.id}`, ch.id === this.hud.channel ? ' (you are here)' : ''), h('div.s', `${ch.players}/${ch.cap} heroes`)), ch.id !== this.hud.channel ? h('button.btn.small', { on: { click: () => this.#rpc('channel.switch', { id: ch.id }).then(() => this.close()) } }, 'Join') : null));
      } else if (tab === 'invites') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, 'Hearthvale is invite-only. Each hero can invite up to 5 friends.'));
        for (const inv of info.invites)
          c.body.append(h('div.rowcard', h('div.ic', '🎟️'), h('div.grow', h('div.t', { style: { fontFamily: 'monospace', fontSize: '18px', userSelect: 'all' } }, inv.code), h('div.s', inv.used_by ? `Used by ${inv.used_name || 'a friend'}` : 'Unused')), !inv.used_by ? h('button.btn.small', { on: { click: () => this.#copy(`Join me in Hearthvale! ${location.origin} — invite code: ${inv.code}`) } }, 'Copy') : null));
        if (info.invites.length < 5)
          c.body.append(h('button.btn.green', { on: { click: () => this.#rpc('invite.create', {}, 'Invite created!').then(load) } }, '＋ Create invite'));
      }
      c.body.append(h('div.muted', { style: { marginTop: '16px', fontSize: '12px', textAlign: 'center' } }, 'Models by Kenney (CC0) · Icons by Lorc, Delapouite & contributors, game-icons.net (CC BY 3.0)'));
    };
    const load = async () => {
      try {
        info = await this.sock.rpc('town.info');
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      render();
    };
    render();
    load();
  }

  async #copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.hud.toast('Copied! Send it to a friend.', 'good');
    } catch {
      prompt('Copy this:', text);
    }
  }

  // ── Player profile ─────────────────────────────────────────────────
  p_profile(c, { id }) {
    this.title(c, 'Hero', 'helm');
    c.body.append(h('div.empty', 'Loading…'));
    this.sock
      .rpc('profile', { id })
      .then((p) => {
        clear(c.body);
        this.title(c, p.name);
        c.body.append(
          h('div', { style: { textAlign: 'center' } }, h('img', { src: portrait(p.avatar, { full: true }), style: { width: '140px', height: '175px', background: 'radial-gradient(circle at 50% 35%, #4a3a2c, #1e1814)', borderRadius: '6px', border: '1px solid #8a6a3a' } })),
          h('div', { style: { textAlign: 'center', margin: '6px 0 10px' } }, h('b', `Level ${p.level}`), h('div.muted', p.online ? `Online · Channel ${p.channel}` : 'Offline')),
          ...SKILL_IDS.map((k) => h('div.kv', h('span', `${SKILLS[k].icon} ${SKILLS[k].name}`), h('b', `Lv ${levelFromXp(p.skills[k] || 0)}`))),
          h(
            'div.row',
            { style: { marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
            h('button.btn.small', { on: { click: () => (this.hud.game?.sendEmote('wave'), this.close()) } }, 'Wave'),
            p.shop && (p.shopOpen || p.id === this.hud.myId) ? h('button.btn.green.small', { on: { click: () => (this.close(), this.hud.game?.enterShop(p.id)) } }, 'Visit shop') : null,
            p.online && p.channel !== this.hud.channel ? h('button.btn.blue.small', { on: { click: () => this.#rpc('channel.switch', { id: p.channel }).then(() => this.close()) } }, 'Join their channel') : null,
          ),
        );
      })
      .catch((e) => this.hud.toast(e.message, 'err'));
  }

  // ── Battle results ─────────────────────────────────────────────────
  p_result(c, r) {
    this.title(c, r.victory ? 'Victory' : 'Defeat', r.victory ? 'trophy' : 'skull');
    if (r.victory) {
      c.body.append(
        h('div.result', h('div.big', 'Victory'), h('div', { style: { fontWeight: 700, fontSize: '20px' } }, `+${r.gold} 🪙  ·  +${r.xp?.amount || 0} Combat XP`)),
        h('div.loot-row', ...Object.entries(r.loot || {}).map(([id, n], i) => {
          const s = itemSlot(id, n);
          s.style.animationDelay = i * 0.12 + 's';
          return s;
        })),
        h('button.btn.green.block.big', { on: { click: () => this.close() } }, 'Continue'),
      );
    } else {
      c.body.append(h('div.result.lose', h('div.big', 'Defeat'), h('p', 'You’re driven back. Mend your wounds, better your gear, and bring allies — anyone can join your fight.')), h('button.btn.block.big', { on: { click: () => this.close() } }, 'OK'));
    }
  }
}
