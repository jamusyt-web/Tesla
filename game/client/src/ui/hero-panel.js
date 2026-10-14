// The Bag (items and the Hero tab) and other heroes' profiles.
import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { portrait } from './portrait.js';
import { ITEMS, RARITY, CATEGORIES } from '../../../shared/items.js';
import { SKILLS, SKILL_IDS, levelProgress, levelFromXp } from '../../../shared/skills.js';
import { townCount } from '../../../shared/places.js';
import { iconEl, itemSlot, qtyInput, itemDesc, fxText } from './itemui.js';

// Panel builders are called as fn.call(panels, c, args) (see panels.js), so
// `this` is the Panels; the helpers below are called the same way.
export const HERO_PANELS = {
  bag(c, args) {
    this.title(c, 'Bag', 'bag');
    let tab = args.tab || 'items';
    let cat = 'all';
    let sel = null;
    const render = () => {
      clear(c.body);
      c.body.append(
        h('div.tabs', ...[['items', 'Items'], ['hero', 'Hero']].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), render()) } }, l))),
      );
      if (tab === 'hero') return heroTab.call(this, c.body);
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
      if (sel && this.me.inv[sel] > 0) c.body.append(itemDetail.call(this, sel, equipped.has(sel)));
    };
    c.refresh = render;
    render();
  },

  profile(c, { id }) {
    this.title(c, 'Hero', 'helm');
    c.body.append(h('div.empty', 'Loading…'));
    this.sock
      .rpc('profile', { id })
      .then((p) => {
        clear(c.body);
        this.title(c, p.name);
        c.body.append(
          h('div', { style: { textAlign: 'center' } }, h('img', { src: portrait(p.avatar, { full: true }), style: { width: '140px', height: '175px', background: '#cdeefa', borderRadius: '6px', border: '1px solid #8a6a3a' } })),
          h('div', { style: { textAlign: 'center', margin: '6px 0 10px' } }, h('b', `Level ${p.level}`), h('div.muted', p.online ? (p.dungeon ? `Online · in ${p.dungeon}` : `Online · Channel ${p.channel}`) : 'Offline', p.sameParty ? ' · in your party' : '')),
          ...SKILL_IDS.map((k) => h('div.kv', h('span', `${SKILLS[k].icon} ${SKILLS[k].name}`), h('b', `Lv ${levelFromXp(p.skills[k] || 0)}`))),
          h(
            'div.row',
            { style: { marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' } },
            h('button.btn.small', { on: { click: () => (this.hud.game?.sendEmote('wave'), this.close()) } }, 'Wave'),
            p.shop && (p.shopOpen || p.id === this.hud.myId) ? h('button.btn.green.small', { on: { click: () => (this.close(), this.hud.game?.enterShop(p.id)) } }, 'Visit shop') : null,
            p.online && p.channel && p.channel !== this.hud.channel && !this.hud.game?.dungeon ? h('button.btn.blue.small', { on: { click: () => this.rpc('channel.switch', { id: p.channel }).then(() => this.close()) } }, 'Join their channel') : null,
            p.canInvite ? h('button.btn.green.small', { on: { click: () => this.rpc('party.invite', { id: p.id }, `Invited ${p.name} to your party.`) } }, 'Invite to party') : null,
          ),
        );
      })
      .catch((e) => this.hud.toast(e.message, 'err'));
  },
};

function itemDetail(id, isEq) {
  const it = ITEMS[id];
  const have = this.me.inv[id];
  // The merchant's price here and now (it drops as you sell, and differs by town).
  const npcEl = h('b.gold', '…');
  this.sock
    .rpc('merchant.quote', { item: id, qty: 1 })
    .then((qt) => (npcEl.textContent = qt.unit ? `${qt.unit} 🪙 each${qt.full ? ' (full up)' : qt.glut && townCount() > 1 ? ' (plenty here)' : ''}` : "Won't buy"))
    .catch(() => (npcEl.textContent = '—'));
  const sellable = isEq ? have - 1 : have;
  const q = qtyInput(Math.max(1, sellable), Math.max(1, sellable));
  const box = h(
    'div.detail',
    h('div.row', h('div', { style: { fontSize: '40px' } }, iconEl(id, '56px')), h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 700, fontSize: '18px' } }, it.name), h('div', { style: { fontWeight: 700, fontSize: '13px' } }, h('span', { style: { background: RARITY[it.rarity].color, color: '#fff', padding: '1px 8px', borderRadius: '999px' } }, RARITY[it.rarity].label), ' · ' + CATEGORIES[it.cat]), h('div.muted', itemDesc(it)))),
    h('div.kv', h('span', 'You own'), h('b', fmt(have))),
    h('div.kv', h('span', 'Base value'), h('b.gold', `${it.value} 🪙`)),
    h('div.kv', h('span', 'Merchant pays'), npcEl),
    h(
      'div.row',
      { style: { marginTop: '10px', flexWrap: 'wrap' } },
      (it.cat === 'tool' || it.slot) && !isEq ? h('button.btn.green.small', { on: { click: () => this.rpc('equip', { item: id }, `Equipped ${it.name}!`) } }, 'Equip') : null,
      isEq ? h('span.chip.on', 'Equipped') : null,
      id === 'hearth_charm' && have > 0 ? h('button.btn.green.small', { on: { click: () => (this.close(), this.hud.game?.travelHome()) } }, 'Go home') : null,
      it.buff && have > 0 ? h('button.btn.green.small', { on: { click: () => this.rpc('use', { item: id }, `${it.name}: ${fxText(it.buff.fx)}`) } }, 'Use') : null,
      it.reveal && have > 0 ? h('button.btn.green.small', { on: { click: () => this.sock.rpc('use', { item: id }).then((r) => this.hud.toast(r.places?.length ? `This week's glimmering caches: ${r.places.slice(0, 3).join(', ')}.` : 'The map is too smudged to read.', 'gold')).catch((e) => this.hud.toast(e.message, 'err')) } }, 'Read') : null,
      sellable > 0 ? h('div.qty', q) : null,
      sellable > 0 ? h('button.btn.small', { on: { click: () => npcSell.call(this, id, +q.value) } }, 'Sell to merchant') : null,
      h('button.btn.blue.small', { on: { click: () => this.open('market', { item: id }) } }, 'Market'),
    ),
  );
  return box;
}

async function npcSell(item, qty) {
  try {
    const r = await this.sock.rpc('npcSell', { item, qty });
    sfx.coin();
    this.hud.toast(`Sold for ${r.gold} 🪙${r.full ? '. The merchant has had their fill of these: try another town.' : ''}`, 'gold');
  } catch (e) {
    this.hud.toast(e.message, 'err');
  }
}

function heroTab(body) {
  const me = this.me;
  const st = me.stats || { atk: 0, def: 0, hp: 0 };
  body.append(
    h(
      'div.row',
      { style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
      h('img', { src: portrait(this.hud.myAvatar, { full: true }), style: { width: '130px', height: '162px', background: '#cdeefa', borderRadius: '6px', border: '1px solid #8a6a3a' } }),
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
      ...['weapon', 'armor', 'trinket', 'charm', 'axe', 'pick', 'rod'].map((slot) => {
        const id = me.equip[slot];
        return h('div', { style: { textAlign: 'center' } }, id ? itemSlot(id, null) : h('div.slot', { style: { opacity: 0.4 } }, '—'), h('div.muted', slot === 'pick' ? 'pickaxe' : slot));
      }),
    ),
    ...buffRows(me.buffs),
    h('div.section-title', 'Skills'),
    ...SKILL_IDS.map((k) => {
      const p = levelProgress(me.skills[k] || 0);
      return h('div.skillrow', h('span', SKILLS[k].icon), h('div', h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '14px' } }, h('span', SKILLS[k].name), h('span.muted', `${fmt(p.into)}/${fmt(p.need)}`)), h('div.bar', h('i', { style: { width: `${p.pct * 100}%` } }))), h('b', `Lv ${p.level}`));
    }),
  );
}

// Meals, tonics and lures in effect, and how long they last.
function buffRows(buffs = {}) {
  const on = Object.entries(buffs).filter(([, b]) => b && (b.until ? b.until > Date.now() : b.left > 0));
  if (!on.length) return [];
  return [
    h('div.section-title', 'Buffs'),
    ...on.map(([slot, b]) => h('div.kv', h('span', `${slot[0].toUpperCase() + slot.slice(1)}: ${ITEMS[b.item]?.name ?? b.item}`), h('b', `${fxText(b.fx)} · ${b.until ? `${Math.max(1, Math.round((b.until - Date.now()) / 60000))} min` : `${b.left} left`}`))),
  ];
}
