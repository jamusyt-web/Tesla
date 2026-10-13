import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS } from '../../../shared/items.js';
import { RECIPES } from '../../../shared/recipes.js';
import { STATIONS, batchCap, isStackable } from '../../../shared/crafting.js';
import { levelFromXp } from '../../../shared/skills.js';
import { SHOP_PANELS } from './shop-panels.js';
import { DUNGEON_PANELS } from './dungeon-panels.js';
import { HERO_PANELS } from './hero-panel.js';
import { MARKET_PANELS } from './market.js';
import { BOARD_PANELS } from './board.js';
import { BATTLE_PANELS } from './battle-panels.js';
import { glyph } from './glyphs.js';
import { townBuilding } from '../../../shared/places.js';
import { doorPoint } from '../../../shared/world.js';
import { inYard, spotsOf, stationsOf } from '../../../shared/stations.js';
import { effectsOf } from '../../../shared/perks.js';
import { iconEl, itemDesc } from './itemui.js';

export { iconEl }; // (other UI files import it from here)

// Every panel by name: fn.call(panels, c, args) fills panel c. The Workshop
// and Town Hall live in this file (p_craft, p_townhall); the rest in their own.
const PANELS = { ...HERO_PANELS, ...MARKET_PANELS, ...BOARD_PANELS, ...BATTLE_PANELS, ...SHOP_PANELS, ...DUNGEON_PANELS };

// Add panels from another module ({ name: fn }); each name once.
export function registerPanels(table) {
  for (const name of Object.keys(table)) if (PANELS[name]) throw new Error(`Panel "${name}" is defined twice.`);
  Object.assign(PANELS, table);
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
    const panel = h('div.panel' + (['profile', 'result', 'dleave', 'dloot'].includes(name) ? '.narrow' : ''), h('div.panel-head', titleEl, walk, h('button.close', { 'aria-label': 'Close', on: { click: () => this.close() } }, '✕')), body);
    const scrim = h('div.scrim', { on: { pointerdown: (e) => e.target === scrim && this.close() } }, panel);
    this.hud.el.append(scrim);
    this.cur = { name, scrim, body, titleEl, args, refresh: null, onClose: null };
    const fn = this['p_' + name] || PANELS[name];
    if (fn) fn.call(this, this.cur, args);
    sfx.pop();
  }

  // A building panel opened from afar (the dock opens them anywhere): the
  // nearest building it belongs to, so you can still walk over.
  #placeFor(name, args) {
    const g = this.hud.game;
    if (!g?.me || g.room || g.dungeon) return null;
    const p = g.myPos();
    if (name === 'craft' && (args.station || inYard(p.x, p.z))) return null; // already at the stations
    const b = name === 'shop' ? null : townBuilding(name, p.x, p.z);
    if (!b) return null;
    const [dx, dz] = doorPoint(b);
    return Math.hypot(dx - p.x, dz - p.z) > 8 ? b : null;
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
    const sp = spotsOf(r.station, p.x, p.z)[0];
    this.close();
    if (!g.walkTo(sp.x, sp.z, true, go)) return this.hud.toast("Can't reach the Workshop yard.", 'err');
    this.hud.toast('Off to the Workshop yard…');
  }

  // An RPC that toasts its error (and okText on success), for buttons.
  async rpc(m, a, okText) {
    try {
      const r = await this.sock.rpc(m, a);
      if (okText) this.hud.toast(okText, 'good');
      return r;
    } catch (e) {
      this.hud.toast(e.message, 'err');
      throw e;
    }
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
        h('div.tabs', { style: { flexWrap: 'wrap' } }, ...Object.entries(STATIONS).filter(([k]) => stationsOf(k).length).map(([k, st]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), (pick = null), render()) } }, `${st.icon} ${st.label}`))),
      );
      for (const r of RECIPES.filter((x) => x.station === tab)) {
        const out = ITEMS[r.out];
        const locked = lvl < r.lvl;
        const cap = batchCap(r, lvl, effectsOf(this.me).batchCap || 0);
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

  // ── Town Hall ──────────────────────────────────────────────────────

  p_townhall(c, args) {
    this.title(c, 'Town Hall', 'castle');
    let tab = args.tab || 'online';
    let info = null;
    let perf = null;
    const tabs = [['online', 'Online'], ['jobs', 'Jobs'], ['shops', 'Shops'], ['leaders', 'Leaders'], ['channels', 'Channels'], ['invites', 'Invites'], ...(this.hud.me.admin ? [['perf', 'Performance']] : [])];
    const render = () => {
      clear(c.body);
      if (this.hud.me.admin)
        c.body.append(h('div.rowcard', h('div.grow', h('div.t', 'Server owner'), h('div.s', 'Change the world map: place, move and remove anything.')), h('button.btn.small', { on: { click: () => (location.href = '/?editor') } }, 'Edit the world')));
      c.body.append(h('div.tabs', { style: { flexWrap: 'wrap' } }, ...tabs.map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => (k === 'jobs' ? this.open('jobs') : ((tab = k), render())) } }, l))));
      if (!info) return c.body.append(h('div.empty', 'Loading…'));
      if (tab === 'online') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, `${info.online.length} of ${info.heroes} heroes online`));
        const mine = this.hud.party;
        const canInvite = !mine || (mine.leader === this.hud.myId && mine.members.length < 4);
        for (const p of info.online)
          c.body.append(
            h(
              'div.rowcard',
              h('div.ic', '🧑'),
              h('div.grow', h('div.t', p.name, p.id === this.hud.myId ? ' (you)' : ''), h('div.s', `Level ${p.level} · ${p.dungeon ? `In ${p.dungeon}` : `Channel ${p.channel}`}${mine && p.party === mine.id ? ' · your party' : ''}`)),
              p.id !== this.hud.myId && canInvite && !p.party ? h('button.btn.small.green', { on: { click: () => this.rpc('party.invite', { id: p.id }, `Invited ${p.name} to your party.`) } }, 'Invite') : null,
              p.id !== this.hud.myId ? h('button.btn.small', { on: { click: () => this.open('profile', { id: p.id }) } }, 'View') : null,
            ),
          );
      } else if (tab === 'shops') {
        return this.open('shops');
      } else if (tab === 'leaders') {
        c.body.append(h('div.section-title', 'Richest'), ...info.rich.map((r, i) => h('div.kv', h('span', `${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${r.name}`), h('b.gold', `${fmt(r.gold)} 🪙`))));
        c.body.append(h('div.section-title', 'Most experienced'), ...info.levels.map((r, i) => h('div.kv', h('span', `${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${r.name}`), h('b', `${fmt(r.total)} XP`))));
      } else if (tab === 'channels') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, 'Each channel is a live copy of town. New players join the busiest channel with room, so friends end up together.'));
        for (const ch of info.channels)
          c.body.append(h('div.rowcard', h('div.ic', '🌐'), h('div.grow', h('div.t', `Channel ${ch.id}`, ch.id === this.hud.channel ? ' (you are here)' : ''), h('div.s', `${ch.players}/${ch.cap} heroes`)), ch.id !== this.hud.channel ? h('button.btn.small', { on: { click: () => this.rpc('channel.switch', { id: ch.id }).then(() => this.close()) } }, 'Join') : null));
      } else if (tab === 'perf') {
        // Owner only: how the game runs on players' devices, from their reports.
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, 'How smoothly the game runs on players\' devices over the last 7 days, by device and place. Aim for 30+ frames a second normally and 20+ in the worst moments.'));
        if (!perf) {
          c.body.append(h('div.empty', 'Loading…'));
          this.sock.rpc('owner.perf', { days: 7 }).then((r) => ((perf = r.rows), render())).catch((e) => this.hud.toast(e.message, 'err'));
        } else if (!perf.length) c.body.append(h('div.empty', 'No reports yet: each player sends one a minute while playing.'));
        else
          for (const r of perf)
            c.body.append(
              h('div.rowcard', h('div.ic', r.device.endsWith('-low') ? '📱' : '💻'), h('div.grow', h('div.t', `${r.region} · ${r.device.endsWith('-low') ? 'phone' : 'computer'} ${r.device.split('-')[0]}`), h('div.s', `${r.fps50} fps typical, ${r.fps5} in the worst moments (lowest ${r.fps5min}) · ${fmt(r.draws95)} draws · ${fmt(r.tris95)} triangles · loads in ${(r.loadMs / 1000).toFixed(1)} s · ${r.n} reports`))),
            );
      } else if (tab === 'invites') {
        c.body.append(h('div.muted', { style: { marginBottom: '8px' } }, 'Hearthvale is invite-only. Each hero can invite up to 5 friends.'));
        for (const inv of info.invites)
          c.body.append(h('div.rowcard', h('div.ic', '🎟️'), h('div.grow', h('div.t', { style: { fontFamily: 'monospace', fontSize: '18px', userSelect: 'all' } }, inv.code), h('div.s', inv.used_by ? `Used by ${inv.used_name || 'a friend'}` : 'Unused')), !inv.used_by ? h('button.btn.small', { on: { click: () => this.#copy(`Join me in Hearthvale! ${location.origin} — invite code: ${inv.code}`) } }, 'Copy') : null));
        if (info.invites.length < 5)
          c.body.append(h('button.btn.green', { on: { click: () => this.rpc('invite.create', {}, 'Invite created!').then(load) } }, '＋ Create invite'));
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
}
