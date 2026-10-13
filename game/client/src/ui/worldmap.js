import { grid, hasBit, regionCells, cellCentre, CELL } from '../../../shared/journal.js';
import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';
import { paintWorld, tierLabel } from './mapdraw.js';
import { LANDS, EXTENT, STONES, ENTRANCES, LANDMARKS, placeAt, stoneNear, stoneFront, travelFee } from '../../../shared/world.js';
import { travelToll, nowarpItem } from '../../../shared/travel.js';
import { ITEMS } from '../../../shared/items.js';

export { tierLabel };
const PIN = { vista: '🔭', ruin: '🏛️', shrine: '⛩️', cache: '🎁', secret: '🔍', curio: '✨', npc: '🧑', landmark: '🚩' };

// The full world map (M, or tap the minimap): every land, town, path and
// waystone, where you and the other heroes are, and fast travel. Tap a
// waystone for travel, or anywhere on land to walk there. Drag to pan; wheel
// or pinch to zoom.
export class WorldMap {
  constructor(hud) {
    this.hud = hud;
    this.el = null;
  }
  get isOpen() {
    return !!this.el;
  }
  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  // opts.select: a waystone to show the travel card for.
  open(opts = {}) {
    const g = this.hud.game;
    if (this.el || !g?.me) return;
    if (g.battle) return this.hud.toast("You're in a battle!", 'err');
    if (g.craft || this.hud.fight) return this.hud.toast("You're busy right now.", 'err');
    if (g.room) return this.hud.toast('Step out of the shop to see the world map.', 'err');
    this.hud.panels.close();
    this.canvas = h('canvas');
    this.card = h('div.wm-card.hidden');
    this.where = h('div.wm-where');
    const zoomBtn = (ic, label, k) => h('button.wm-zb', { 'aria-label': label, title: label, on: { click: () => this.#zoomBy(k) } }, ic);
    this.el = h(
      'div.worldmap',
      h(
        'div.wm-frame',
        h('div.panel-head', h('h3', glyph('map'), 'World Map'), this.where, h('button.close', { 'aria-label': 'Close', on: { click: () => this.close() } }, '✕')),
        h(
          'div.wm-view',
          this.canvas,
          h('div.wm-zoom', zoomBtn('+', 'Zoom in', 1.4), zoomBtn('−', 'Zoom out', 1 / 1.4), h('button.wm-zb', { 'aria-label': 'Find me', title: 'Find me', on: { click: () => this.#centerOnMe() } }, glyph('compass'))),
          h('div.wm-legend', h('span', h('i.lg-stone'), 'Waystone'), h('span', h('i.lg-dim'), 'Not visited'), h('span', h('i.lg-camp'), 'Monsters'), h('span', h('i.lg-crypt'), 'Dungeon')),
          this.card,
        ),
      ),
    );
    this.hud.el.append(this.el);
    this.sel = null;
    this.#bind();
    this.#resize(true);
    this.#updateWhere();
    this.timer = setInterval(() => this.draw(), 250); // other heroes move
    sfx.pop();
    const here = this.#here();
    const pick = opts.select && opts.select !== here?.id ? opts.select : here?.id;
    if (pick) this.#select({ stone: pick });
  }

  close() {
    if (!this.el) return;
    clearInterval(this.timer);
    removeEventListener('resize', this.onResize);
    this.el.remove();
    this.el = null;
  }

  // Attunement or gold changed while open: redraw and refresh the card.
  refresh() {
    if (!this.el) return;
    this.draw();
    this.#renderCard();
  }

  // ── View ─────────────────────────────────────────────────────────────
  #resize(fit = false) {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.dpr = dpr;
    const E = EXTENT;
    // Fitting the whole world is as far out as you can zoom (with room at
    // the top for region names and at the bottom for the card).
    this.minS = Math.max(0.05, Math.min((this.W - 40) / (E.x1 - E.x0), (this.H - 120) / (E.z1 - E.z0)));
    if (fit || !this.s) {
      this.s = this.minS;
      this.cx = (E.x0 + E.x1) / 2;
      this.cz = (E.z0 + E.z1) / 2 - 25 / this.s;
    }
    this.#clamp();
    this.draw();
  }
  #clamp() {
    const E = EXTENT;
    this.s = Math.max(this.minS, Math.min(8, this.s));
    this.cx = Math.max(E.x0, Math.min(E.x1, this.cx));
    this.cz = Math.max(E.z0, Math.min(E.z1, this.cz));
  }
  #zoomBy(k, sx = this.W / 2, sy = this.H / 2) {
    // Keep the world point under (sx, sy) where it is.
    const [wx, wz] = this.#toWorld(sx, sy);
    this.s *= k;
    this.#clamp();
    this.cx = wx - (sx - this.W / 2) / this.s;
    this.cz = wz - (sy - this.H / 2) / this.s;
    this.#clamp();
    this.draw();
  }
  #centerOnMe() {
    const p = this.hud.game.myPos();
    this.cx = p.x;
    this.cz = p.z;
    this.s = Math.max(this.s, Math.min(4, this.minS * 3));
    this.#clamp();
    this.draw();
  }
  #toWorld(sx, sy) {
    return [this.cx + (sx - this.W / 2) / this.s, this.cz + (sy - this.H / 2) / this.s];
  }
  #toScreen(x, z) {
    return [this.W / 2 + (x - this.cx) * this.s, this.H / 2 + (z - this.cz) * this.s];
  }

  #bind() {
    const c = this.canvas;
    const ptrs = new Map();
    let drag = null;
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (ptrs.size === 1) drag = { x: e.offsetX, y: e.offsetY, cx: this.cx, cz: this.cz, t: performance.now(), moved: false };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.s };
        drag = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.#zoomBy((pinch.s * (d / pinch.d)) / this.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      if (!drag) return;
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (Math.hypot(dx, dy) > 8) drag.moved = true;
      if (drag.moved) {
        this.cx = drag.cx - dx / this.s;
        this.cz = drag.cz - dy / this.s;
        this.#clamp();
        this.draw();
      }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && !drag.moved && e.type === 'pointerup' && performance.now() - drag.t < 600) this.#tap(e.offsetX, e.offsetY);
      if (!ptrs.size) drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY);
    }, { passive: false });
    this.onResize = () => this.#resize();
    addEventListener('resize', this.onResize);
  }

  #tap(sx, sy) {
    // A waystone under the finger (generous: they're small on screen)?
    let best = null;
    for (const st of STONES) {
      const [x, y] = this.#toScreen(st.x, st.z);
      const d = Math.hypot(x - sx, y - sy);
      if (d < 22 && (!best || d < best.d)) best = { st, d };
    }
    if (best) return this.#select({ stone: best.st.id });
    // A dungeon: open its panel (you can walk there from it).
    for (const e of ENTRANCES) {
      const [x, y] = this.#toScreen(e.x, e.z);
      if (Math.hypot(x - sx, y - sy) < 22) return (this.close(), this.hud.game.goCrypt(e.id));
    }
    const [wx, wz] = this.#toWorld(sx, sy);
    if (LANDS.some((l) => Math.hypot(wx - l.x, wz - l.z) < l.r)) return this.#select({ x: wx, z: wz });
    this.#select(null);
  }
  #select(sel) {
    this.sel = sel;
    sfx.tap();
    this.draw();
    this.#renderCard();
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  draw() {
    if (!this.el) return;
    const x = this.canvas.getContext('2d');
    paintWorld(x, this, { known: new Set(this.hud.me.stones ?? []), picked: this.sel?.stone, here: this.#here()?.id });
    const g = this.hud.game;
    const me = g.myPos();
    this.#fog(x);
    // A picked spot to walk to.
    if (this.sel && !this.sel.stone) {
      const [sx, sy] = this.#toScreen(this.sel.x, this.sel.z);
      x.beginPath();
      x.arc(sx, sy, 6, 0, Math.PI * 2);
      x.fillStyle = '#ffe9a8';
      x.fill();
      x.lineWidth = 2;
      x.strokeStyle = '#4a3622';
      x.stroke();
    }
    // Other heroes, then you (an arrow facing where the camera looks).
    for (const pv of g.players.values()) {
      if (pv.isMe || pv.hidden) continue;
      const [sx, sy] = this.#toScreen(pv.x, pv.z);
      x.beginPath();
      x.arc(sx, sy, 4.5, 0, Math.PI * 2);
      x.fillStyle = '#5aa0e0';
      x.fill();
      x.lineWidth = 2;
      x.strokeStyle = '#fff';
      x.stroke();
    }
    const [mx, my] = this.#toScreen(me.x, me.z);
    x.save();
    x.translate(mx, my);
    x.rotate(-(g.cam.curYaw ?? g.cam.yaw));
    x.beginPath();
    x.moveTo(0, -11);
    x.lineTo(8, 8);
    x.lineTo(0, 4);
    x.lineTo(-8, 8);
    x.closePath();
    x.fillStyle = '#ffd84a';
    x.fill();
    x.lineWidth = 2.5;
    x.strokeStyle = '#5a2e10';
    x.stroke();
    x.restore();
  }

  // Fog over land you haven't walked yet, and the places you've found (or
  // seen from a view) as pins.
  #fog(x) {
    const C = this.hud.goal.compass;
    if (!C?.bits) return;
    const G = grid();
    const w = CELL * this.s;
    x.fillStyle = 'rgba(28, 34, 42, 0.62)';
    for (const list of regionCells().values())
      for (const k of list) {
        if (hasBit(C.bits, k)) continue;
        const c = cellCentre(G, k);
        const [sx, sy] = this.#toScreen(c.x - CELL / 2, c.z - CELL / 2);
        x.fillRect(sx - 0.5, sy - 0.5, w + 1, w + 1);
      }
    x.font = `${Math.max(12, Math.min(22, 7 * this.s))}px sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (const l of LANDMARKS) {
      const found = C.found.has(l.id);
      if (!found && !C.seen.has(l.id)) continue;
      const [sx, sy] = this.#toScreen(l.x, l.z);
      x.globalAlpha = found ? 1 : 0.6;
      x.fillText(PIN[l.kind] ?? '📍', sx, sy);
    }
    x.globalAlpha = 1;
  }

  // ── The card at the bottom: travel / walk ────────────────────────────
  #here() {
    const p = this.hud.game.myPos();
    return stoneNear(p.x, p.z);
  }
  #updateWhere() {
    const p = this.hud.game.myPos();
    const { zone, region } = placeAt(p.x, p.z);
    this.where.textContent = [region?.name, zone?.label].filter(Boolean).join(' · ');
  }

  #renderCard() {
    const card = this.card;
    clear(card);
    const sel = this.sel;
    card.classList.toggle('hidden', !sel);
    if (!sel) return;
    const g = this.hud.game;
    const me = g.myPos();
    const close = h('button.wm-x', { 'aria-label': 'Close', on: { click: () => this.#select(null) } }, '✕');
    if (!sel.stone) {
      const { zone, region } = placeAt(sel.x, sel.z);
      const d = Math.round(Math.hypot(sel.x - me.x, sel.z - me.z));
      card.append(
        close,
        h('div.t', zone?.label || region?.name || 'Open country'),
        h('div.s', `${d} m away${region && zone ? ` · ${region.name}` : ''}`),
        h('div.row', h('button.btn.small.green', { on: { click: () => this.#walk(sel.x, sel.z) } }, glyph('run'), 'Walk here'), this.#ownerJump(sel.x, sel.z)),
      );
      return;
    }
    const st = STONES.find((s) => s.id === sel.stone);
    if (!st) return card.classList.add('hidden');
    const known = (this.hud.me.stones ?? []).includes(st.id);
    const here = this.#here();
    const { region } = placeAt(st.x, st.z);
    const sub = [region ? `${region.name} · ${tierLabel(region.tier)}` : null, `${Math.round(Math.hypot(st.x - me.x, st.z - me.z))} m away`].filter(Boolean).join(' · ');
    card.append(close, h('div.t', glyph('waystone'), known ? st.name : 'Undiscovered waystone'), h('div.s', sub));
    if (this.hud.me.admin && here?.id !== st.id) card.append(h('div.row', this.#ownerJump(...stoneFront(st))));
    if (here?.id === st.id) return card.append(h('div.note', "You're here. Tap another glowing waystone to travel to it."));
    const row = h('div.row');
    card.append(row);
    const walkBtn = (label = 'Walk there') => h('button.btn.small.plain', { on: { click: () => this.#walkToStone(st) } }, glyph('run'), label);
    if (!known) {
      card.append(h('div.note', 'Walk up to it once to attune to it; then you can travel here from any waystone.'));
      row.append(walkBtn());
      return;
    }
    if (!here) {
      const near = this.#nearestStone(me);
      card.append(h('div.note', 'Fast travel works from a waystone. Walk to one, then pick where to go.'));
      if (near && near.id !== st.id) row.append(h('button.btn.small.blue', { on: { click: () => this.#walkToStone(near, { reopen: { select: st.id } }) } }, glyph('waystone'), `Nearest: ${near.name}`));
      row.append(walkBtn());
      return;
    }
    const bag = this.hud.me.inv ?? {};
    const nw = nowarpItem(bag);
    if (nw) {
      card.append(h('div.note.bad', `The waystones won't carry your ${ITEMS[nw].name}. You'll have to walk.`));
      row.append(walkBtn());
      return;
    }
    // The fee, plus the toll on raw goods you carry (leave them in storage to skip it).
    const toll = travelToll(bag);
    const fee = travelFee(here, st) + toll;
    const gold = this.hud.me.gold ?? 0;
    const go = h('button.btn.small.green', { disabled: gold < fee || g.travelling, on: { click: () => this.#travel(st, go) } }, glyph('waystone'), `Travel · ${fmt(fee)} 🪙`);
    row.append(go, walkBtn('Walk instead'));
    if (toll) card.append(h('div.note', `Includes a ${fmt(toll)} 🪙 toll on the raw goods you're carrying.`));
    if (gold < fee) card.append(h('div.note.bad', `You need ${fmt(fee - gold)} more 🪙.`));
  }

  // Owners can jump anywhere, free (to check on their building work).
  #ownerJump(x, z) {
    if (!this.hud.me.admin) return null;
    return h('button.btn.small.purple', { title: 'Server owners only', on: { click: async () => (await this.hud.game.ownerTeleport(x, z)) && this.close() } }, glyph('bolt'), 'Teleport (owner)');
  }

  #nearestStone(p) {
    let best = null;
    for (const st of STONES) {
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      if (!best || d < best.d) best = { st, d };
    }
    return best?.st ?? null;
  }
  #walk(x, z) {
    if (!this.hud.game.walkTo(x, z, true)) return this.hud.toast("Can't find a way there.", 'err');
    this.close();
  }
  #walkToStone(st, { reopen = false } = {}) {
    if (!this.hud.game.goStone(st.id, { openMap: reopen })) return this.hud.toast("Can't find a way there.", 'err');
    this.close();
  }
  async #travel(st, btn) {
    btn.disabled = true;
    const ok = await this.hud.game.travelTo(st.id);
    if (ok) this.close();
    else if (this.el) this.#renderCard();
  }
}
