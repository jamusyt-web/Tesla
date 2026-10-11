import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';
import { MONSTERS } from '../../../shared/monsters.js';
import {
  LANDS, EXTENT, REGIONS, ZONES, LAKES, PLAZAS, BUILDINGS, GATES, DOCKS, SPAWNS, STONES,
  pathSegments, placeAt, stoneNear, travelFee,
} from '../../../shared/world.js';

export const TIER_NAMES = ['', 'Starter', 'Novice', 'Adept', 'Veteran', 'Elite'];
export const tierLabel = (t) => `Tier ${t}${TIER_NAMES[t] ? ` · ${TIER_NAMES[t]}` : ''}`;

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

  open() {
    const g = this.hud.game;
    if (this.el || !g?.me) return;
    if (g.battle) return this.hud.toast("You're in a battle!", 'err');
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
          h('div.wm-legend', h('span', h('i.lg-stone'), 'Waystone'), h('span', h('i.lg-dim'), 'Not visited'), h('span', h('i.lg-camp'), 'Monsters')),
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
    if (here) this.#select({ stone: here.id });
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
    const s = this.s;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.fillStyle = '#2b4955';
    x.fillRect(0, 0, this.W, this.H);
    // Faint 50 m grid over the sea, like an old chart.
    x.strokeStyle = 'rgba(220, 230, 220, 0.07)';
    x.lineWidth = 1;
    const step = 50 * s >= 24 ? 50 : 250;
    const [gx0, gz0] = this.#toWorld(0, 0);
    const [gx1, gz1] = this.#toWorld(this.W, this.H);
    x.beginPath();
    for (let v = Math.ceil(gx0 / step) * step; v < gx1; v += step) {
      const [px] = this.#toScreen(v, 0);
      x.moveTo(px, 0);
      x.lineTo(px, this.H);
    }
    for (let v = Math.ceil(gz0 / step) * step; v < gz1; v += step) {
      const [, py] = this.#toScreen(0, v);
      x.moveTo(0, py);
      x.lineTo(this.W, py);
    }
    x.stroke();

    x.save();
    x.translate(this.W / 2 - this.cx * s, this.H / 2 - this.cz * s);
    x.scale(s, s);
    const px = 1 / s; // one screen pixel, in metres
    const disc = (o, r = o.r) => {
      x.beginPath();
      x.arc(o.x, o.z, r, 0, Math.PI * 2);
    };
    // Shallows, then an inked coastline: stroke every circle, then fill them
    // all over the inner strokes so only the outer edge of the union shows.
    x.fillStyle = '#3d6878';
    for (const l of LANDS) disc(l, l.r + 5), x.fill();
    x.strokeStyle = '#4a3622';
    x.lineWidth = 3 * px;
    for (const l of LANDS) disc(l), x.stroke();
    x.fillStyle = '#d9c79c';
    for (const l of LANDS) disc(l), x.fill();
    // Zones tinted by their ground colour.
    x.globalAlpha = 0.38;
    for (const z of ZONES) (x.fillStyle = z.ground || '#74a04c'), disc(z), x.fill();
    x.globalAlpha = 1;
    // Monster camps: a hatched red patch.
    x.fillStyle = 'rgba(150, 40, 30, 0.16)';
    for (const sp of SPAWNS) disc(sp), x.fill();
    x.strokeStyle = '#a58457';
    x.lineCap = 'round';
    for (const [ax, az, bx, bz, w] of pathSegments()) {
      x.lineWidth = Math.max(1.6 * px, w * 1.6);
      x.beginPath();
      x.moveTo(ax, az);
      x.lineTo(bx, bz);
      x.stroke();
    }
    x.fillStyle = '#bfae8c';
    for (const p of PLAZAS) disc(p), x.fill();
    x.fillStyle = '#6a9cab';
    x.strokeStyle = '#3d5f6a';
    x.lineWidth = 1.5 * px;
    for (const l of LAKES) disc(l), x.fill(), x.stroke();
    x.fillStyle = '#9a7448';
    for (const d of DOCKS) x.fillRect(d.x - d.w / 2, d.z - d.d / 2, d.w, d.d);
    x.strokeStyle = '#2a2018';
    x.lineWidth = 1.2 * px;
    for (const b of BUILDINGS) {
      x.fillStyle = b.deco ? '#b08a5e' : b.roof || '#8a4b3a';
      x.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
      x.strokeRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
    }
    x.fillStyle = '#5d564c';
    for (const gt of GATES) {
      const sc = gt.scale ?? 4.5;
      x.fillRect(gt.x - 3.5 * sc, gt.z - sc / 2, 7 * sc, sc);
    }
    x.restore();

    // Labels and markers, in screen space so they stay crisp.
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const text = (str, sx, sy, font, fill, stroke = 'rgba(30, 20, 12, 0.85)', w = 3) => {
      x.font = font;
      x.lineJoin = 'round';
      x.strokeStyle = stroke;
      x.lineWidth = w;
      x.strokeText(str, sx, sy);
      x.fillStyle = fill;
      x.fillText(str, sx, sy);
    };
    // Region names sit just above each region's northern edge, clear of what's inside.
    for (const r of REGIONS) {
      const size = Math.round(Math.max(15, Math.min(28, r.r * s * 0.2)));
      const [sx, sy] = this.#toScreen(r.x, r.z - r.r);
      text(r.name.toUpperCase(), sx, sy - size - 10, `700 ${size}px Cinzel, Georgia, serif`, '#f1dfb4');
      text(tierLabel(r.tier), sx, sy - 10, '700 12px "Alegreya Sans", sans-serif', '#e8c983');
    }
    if (s > 2.2) {
      for (const z of ZONES) {
        const [sx, sy] = this.#toScreen(z.x, z.z);
        text(z.label, sx, sy, 'italic 600 14px "Alegreya Sans", sans-serif', '#fff6e0', 'rgba(40, 28, 16, 0.75)');
      }
      for (const b of BUILDINGS) {
        if (b.deco) continue;
        const [sx, sy] = this.#toScreen(b.x, b.z + b.d / 2 + 2.5);
        text(b.label, sx, sy, '700 12px "Alegreya Sans", sans-serif', '#fff6e0', 'rgba(40, 28, 16, 0.8)');
      }
    }
    if (s > 3) {
      for (const sp of SPAWNS) {
        const m = MONSTERS[sp.monster];
        if (!m) continue;
        const [sx, sy] = this.#toScreen(sp.x, sp.z);
        text(`${m.name} · Lv ${m.lvl}`, sx, sy, '700 11px "Alegreya Sans", sans-serif', '#ffb4a0', 'rgba(40, 10, 6, 0.85)');
      }
    }

    const g = this.hud.game;
    const known = new Set(this.hud.me.stones ?? []);
    const me = g.myPos();
    const here = this.#here();
    for (const st of STONES) {
      const [sx, sy] = this.#toScreen(st.x, st.z);
      const on = known.has(st.id);
      const picked = this.sel?.stone === st.id;
      x.save();
      x.translate(sx, sy);
      if (on) {
        x.shadowColor = '#6fe0ff';
        x.shadowBlur = 12;
      }
      x.beginPath();
      x.moveTo(0, -9);
      x.lineTo(7, 0);
      x.lineTo(0, 9);
      x.lineTo(-7, 0);
      x.closePath();
      x.fillStyle = on ? '#8fe8ff' : '#8c8f94';
      x.fill();
      x.shadowBlur = 0;
      x.lineWidth = 2;
      x.strokeStyle = '#14202a';
      x.stroke();
      if (picked || st === here) {
        x.beginPath();
        x.arc(0, 0, 14, 0, Math.PI * 2);
        x.strokeStyle = picked ? '#ffe9a8' : 'rgba(143, 232, 255, 0.8)';
        x.lineWidth = 2;
        x.stroke();
      }
      x.restore();
      if (on || s > 2.2) text(on ? st.name : '?', sx, sy + 19, '700 12px "Alegreya Sans", sans-serif', on ? '#dff8ff' : '#c8c8c8', 'rgba(10, 20, 28, 0.9)');
    }
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
    x.rotate(-g.cam.yaw + Math.PI);
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
        h('div.row', h('button.btn.small.green', { on: { click: () => this.#walk(sel.x, sel.z) } }, glyph('run'), 'Walk here')),
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
      if (near && near.id !== st.id) row.append(h('button.btn.small.blue', { on: { click: () => this.#walkToStone(near, { reopen: true }) } }, glyph('waystone'), `Nearest: ${near.name}`));
      row.append(walkBtn());
      return;
    }
    const fee = travelFee(here, st);
    const gold = this.hud.me.gold ?? 0;
    const go = h('button.btn.small.green', { disabled: gold < fee || g.travelling, on: { click: () => this.#travel(st, go) } }, glyph('waystone'), `Travel · ${fmt(fee)} 🪙`);
    row.append(go, walkBtn('Walk instead'));
    if (gold < fee) card.append(h('div.note.bad', `You need ${fmt(fee - gold)} more 🪙.`));
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
