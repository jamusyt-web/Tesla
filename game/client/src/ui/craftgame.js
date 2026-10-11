import { h, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS, RARITY, QUALITY } from '../../../shared/items.js';
import { RECIPE_BY_ID } from '../../../shared/recipes.js';
import { newCraft, stepCraft, winFor, CRAFT_TICK, CRAFT_MAX_TICKS, STEP_TEXT, STATIONS } from '../../../shared/crafting.js';
import { iconEl } from './panels.js';

// The crafting minigame card. Plays the server's step list with the shared
// sim, recording only when you pressed and released; the server replays the
// same inputs to grade the craft. One button for everything: tap anywhere
// (or Space/Enter), and for "hold" steps, hold and let go in the band.
const OFF = [2, 1]; // small latency allowance: shifts the windows, never widens them
const MARK = { P: ['★ PERFECT', '#ffd84a'], G: ['● GOOD', '#7ed957'], W: ['◐ WEAK', '#f3a56b'], M: ['✕ MISS', '#ea5a4f'] };
const touch = () => matchMedia('(pointer: coarse)').matches;

export class CraftGame {
  constructor(hud, start, { onDone, onStop, onStep } = {}) {
    this.hud = hud;
    this.start = start;
    this.r = RECIPE_BY_ID[start.spec.recipe];
    this.s = newCraft(start.spec, OFF);
    this.toggles = [];
    this.edges = [];
    this.held = false;
    this.onDone = onDone;
    this.onStop = onStop;
    this.onStep = onStep;
    this.sent = false;
    const it = ITEMS[this.r.out];
    this.canvas = h('canvas.craft-cv');
    this.stepEl = h('div.craft-step', 'Get ready…');
    this.pips = h('div.craft-pips', ...start.spec.steps.map((st) => h('i', { title: STEP_TEXT[st.skin] || st.skin })));
    this.markEl = h('div.craft-mark');
    this.icon = h('div.craft-icon', iconEl(this.r.out, '64px'));
    const stopBtn = h('button.btn.plain.small', 'Hold to stop');
    let stopT = null;
    stopBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      stopT = setTimeout(() => this.#finish(true), 600);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) stopBtn.addEventListener(ev, (e) => (e.stopPropagation(), clearTimeout(stopT)));
    this.card = h(
      'div.craft-card',
      h('div.craft-head', this.icon, h('div.grow', h('b', `${STATIONS[this.r.station].verb}: ${it.name}${start.spec.batch > 1 ? ` ×${start.spec.batch}` : ''}`), h('div.muted', touch() ? 'Tap anywhere — hold for the gauge steps' : 'Click or Space — hold for the gauge steps'))),
      this.stepEl,
      h('div.craft-stage', this.canvas, this.markEl),
      this.pips,
      stopBtn,
    );
    this.scrim = h('div.craft-scrim', this.card);
    const down = (e) => {
      if (e.cancelable) e.preventDefault();
      this.edges.push(true);
    };
    const up = (e) => {
      if (e.cancelable) e.preventDefault();
      this.edges.push(false);
    };
    this.scrim.addEventListener('pointerdown', down);
    this.scrim.addEventListener('pointerup', up);
    this.scrim.addEventListener('pointercancel', up);
    this.scrim.addEventListener('contextmenu', (e) => e.preventDefault());
    this.key = (e) => {
      if (!(e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this.edges.push(e.type === 'keydown');
    };
    addEventListener('keydown', this.key, true);
    addEventListener('keyup', this.key, true);
    hud.el.append(this.scrim);
    this.last = performance.now();
    this.acc = 0;
    this.prevRes = 0;
    requestAnimationFrame(this.loop);
  }

  loop = () => {
    if (this.closed) return;
    const s = this.s;
    const now = performance.now();
    // Real time, but never more than 100 ms per frame: a slow phone slows the
    // game down rather than skipping your window.
    this.acc += Math.min(100, now - this.last);
    this.last = now;
    while (this.acc >= CRAFT_TICK && !s.done) {
      // One press/release per tick, recorded at the tick it takes effect.
      if (this.edges.length) {
        const want = this.edges.shift();
        if (want !== this.held) {
          this.held = want;
          this.toggles.push(s.tick);
        }
      }
      stepCraft(s, this.held);
      this.acc -= CRAFT_TICK;
      if (s.res.length > this.prevRes) this.#resolved(s.res[s.res.length - 1], s.spec.steps[s.res.length - 1]);
    }
    this.#draw();
    if (s.done) return this.#finish(false);
    requestAnimationFrame(this.loop);
  };

  #resolved(q, st) {
    this.prevRes = this.s.res.length;
    const pip = this.pips.children[this.prevRes - 1];
    pip.className = 'q' + q;
    const [txt, col] = MARK[q];
    this.markEl.textContent = txt;
    this.markEl.style.color = col;
    this.markEl.classList.remove('pop');
    void this.markEl.offsetWidth;
    this.markEl.classList.add('pop');
    if (navigator.vibrate) navigator.vibrate(q === 'P' ? 35 : q === 'M' ? 10 : 20);
    if (q === 'M') sfx.tap();
    else sfx.clang ? sfx.clang(q) : sfx.chop(q === 'P');
    // The item takes shape as you work.
    const k = this.prevRes / this.s.spec.steps.length;
    this.icon.style.filter = `grayscale(${Math.round((1 - k) * 100)}%) blur(${((1 - k) * 2).toFixed(1)}px)`;
    this.onStep?.(st, q);
  }

  #draw() {
    const s = this.s;
    const cv = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.clientWidth || 320;
    const H = cv.clientHeight || 150;
    if (cv.width !== Math.round(W * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    if (s.phase === 'ready') {
      this.stepEl.textContent = `Get ready… ${Math.ceil((60 - s.tick) / 60)}`;
      return;
    }
    if (s.phase === 'done') return;
    const st = s.spec.steps[Math.min(s.i, s.spec.steps.length - 1)];
    this.stepEl.textContent = (STEP_TEXT[st.skin] || st.skin) + (s.phase === 'gap' ? '' : st.k === 'press' ? (s.p === null ? ' — hold!' : ' — let go in the band!') : st.k === 'sweep' ? ' — tap on the mark!' : ' — tap as the ring closes!');
    if (s.phase === 'gap') return;
    const w = winFor(s, st);
    const t = s.tick - OFF[0];
    if (st.k === 'strike') {
      // A ring closing on the target: tap as they meet.
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.22;
      const left = s.T - t;
      x.lineWidth = 10;
      x.strokeStyle = 'rgba(255,255,255,0.12)';
      x.beginPath();
      x.arc(cx, cy, R, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = Math.max(6, (w.G / 60) * 400 * 0.25);
      x.strokeStyle = 'rgba(126,217,87,0.55)';
      x.beginPath();
      x.arc(cx, cy, R, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 6;
      x.strokeStyle = left <= w.P && left >= -w.P ? '#ffd84a' : '#fff2d6';
      const rr = R + Math.max(-R * 0.5, left * 2.2);
      x.beginPath();
      x.arc(cx, cy, Math.max(4, rr), 0, Math.PI * 2);
      x.stroke();
      x.fillStyle = '#ff9a3c';
      x.beginPath();
      x.arc(cx, cy, R * 0.35, 0, Math.PI * 2);
      x.fill();
    } else if (st.k === 'sweep') {
      // A marker sliding back and forth: tap as it crosses the mark.
      const x0 = W * 0.08;
      const bw = W * 0.84;
      const y = H / 2 - 22;
      const ph = Math.max(0, t - s.s0);
      const cyc = Math.floor(ph / st.H);
      const f = (ph % st.H) / st.H;
      const pos = cyc % 2 === 0 ? f : 1 - f;
      const mx = x0 + (st.c / st.H) * bw;
      const band = (n, col) => {
        x.fillStyle = col;
        x.fillRect(mx - (n / st.H) * bw, y, (2 * n * bw) / st.H, 44);
      };
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(x0, y, bw, 44);
      band(w.W, 'rgba(243,165,107,0.45)');
      band(w.G, 'rgba(126,217,87,0.6)');
      band(w.P, 'rgba(255,216,74,0.9)');
      x.fillStyle = '#fff';
      x.fillRect(x0 + pos * bw - 3, y - 8, 6, 60);
    } else {
      // A gauge that fills while you hold: let go in the band.
      const gx = W / 2 - 24;
      const gh = H - 24;
      const gy = 12;
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(gx, gy, 48, gh);
      const at = st.at;
      const yOf = (v) => gy + gh - (v / st.F) * gh;
      const zone = (n, col) => {
        x.fillStyle = col;
        x.fillRect(gx - 6, yOf(at + n), 60, (2 * n * gh) / st.F);
      };
      zone(w.W, 'rgba(243,165,107,0.45)');
      zone(w.G, 'rgba(126,217,87,0.6)');
      zone(w.P, 'rgba(255,216,74,0.95)');
      if (s.p !== null) {
        const v = Math.min(st.F, s.tick - OFF[1] - s.p);
        const g = x.createLinearGradient(0, gy + gh, 0, gy);
        g.addColorStop(0, '#7d776e');
        g.addColorStop(0.5, '#e2574c');
        g.addColorStop(0.8, '#ff9a3c');
        g.addColorStop(1, '#ffe27a');
        x.fillStyle = g;
        x.fillRect(gx + 8, yOf(v), 32, gy + gh - yOf(v));
      }
    }
  }

  #finish(stop) {
    if (this.sent) return;
    this.sent = true;
    const s = this.s;
    this.stepEl.textContent = '…';
    (stop ? this.onStop : this.onDone)?.({ sid: this.start.sid, toggles: this.toggles, end: Math.max(0, Math.min(CRAFT_MAX_TICKS, s.tick)), off: OFF, stop });
  }

  // The result card (server-graded).
  showResult(res, { onAgain, onEquip } = {}) {
    const o = res.out;
    const it = ITEMS[o.item];
    const pips = h('div.craft-pips.big', ...res.steps.map((q) => h('i.q' + q)));
    const quality = o.q ? h('div.craft-quality.q' + o.q, `${QUALITY[o.q].label}!`, h('span', it.atk ? ` ATK ${it.atk}` : it.def ? ` DEF ${it.def}` : it.speed ? ` ${it.speed} ms swing` : '')) : null;
    this.card.replaceChildren(
      h('div.craft-grade.g' + res.grade, res.grade),
      h('div', { style: { textAlign: 'center' } }, h('b', `${fmt(o.qty)}× ${it.name}`), o.bonus ? h('div.gold', `+${o.bonus} bonus for good work`) : null, quality, h('div.muted', `Score ${res.score}${res.flawless ? ' · flawless!' : ''}${res.xp ? ` · +${res.xp.amount} Crafting XP` : ''}`)),
      h('div.craft-icon.done', iconEl(o.item, '72px')),
      pips,
      res.mastery && this.r && o.q === 0 && ['material', 'consumable'].includes(ITEMS[this.r.out].cat) ? h('div.muted', { style: { textAlign: 'center' } }, res.mastery.quick ? '⚡ Quick crafting unlocked for this recipe' : `Make it ${Math.max(0, 3 - res.mastery.n)} more time${3 - res.mastery.n === 1 ? '' : 's'} at grade B+ to unlock Quick`) : null,
      h('div.row', { style: { justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' } }, onAgain ? h('button.btn.green.small', { on: { click: (e) => (e.stopPropagation(), onAgain()) } }, 'Again') : null, onEquip && (it.slot || it.tool) ? h('button.btn.blue.small', { on: { click: (e) => (e.stopPropagation(), onEquip(o.item)) } }, 'Equip') : null, h('button.btn.small', { on: { click: (e) => (e.stopPropagation(), this.close()) } }, 'Done')),
    );
    this.card.style.borderColor = RARITY[it.rarity]?.color || '';
    this.scrim.classList.add('result');
    if (res.grade === 'S' || o.q === 2) sfx.rare();
    else sfx.loot();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    removeEventListener('keydown', this.key, true);
    removeEventListener('keyup', this.key, true);
    this.scrim.remove();
    this.hud.craftGame = null;
  }
}
