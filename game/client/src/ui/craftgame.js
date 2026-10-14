import { h, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS, RARITY, QUALITY } from '../../../shared/items.js';
import { RECIPE_BY_ID } from '../../../shared/recipes.js';
import { newCraft, advance, input, stepProgress, tapRadius, pointAt, packInputs, CRAFT_TICK, CRAFT_MAX_TICKS, MAX_INPUTS, STAGE_W, STAGE_H, STEP_TEXT, STATIONS } from '../../../shared/crafting.js';
import { iconEl } from './panels.js';

// The crafting card: you do the job with your finger. The stage shows the
// thing you're making (a hot bar on the anvil, a plank, a pot) and each step
// asks for one real motion: tap the glowing spot, hold and let go, saw,
// carve along the line, or stir. It plays the server's step list with the
// shared rules and records what your finger did; the server replays the
// same inputs to grade the craft.
const OFF = [2, 1]; // a little latency allowance for letting go (never widens the window)
const MARK = { P: ['PERFECT', '#f3d589'], G: ['GOOD', '#8fd46a'], W: ['WEAK', '#d9925a'], M: ['MISS', '#d0584a'] };
const touch = () => matchMedia('(pointer: coarse)').matches;
const lerp = (a, b, k) => a + (b - a) * k;
// Older phones' canvases lack roundRect: square corners will do there.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect)
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) {
    this.rect(x, y, w, h);
  };
const TAU = Math.PI * 2;

// What sits on the stage for each pattern.
const PIECE = { smelt: 'crucible', saw: 'plank', scrape: 'hide', dress: 'stone', forge_tool: 'bar', forge_blade: 'bar', forge_plate: 'plate', stitch: 'leather', assemble: 'blank', facet: 'gem', grill: 'pan', stew: 'pot', brew: 'pot', elixir: 'pot' };
const BROTH = { stew: ['#b0652e', '#d48a45'], brew: ['#5f9e4a', '#8fd46a'], elixir: ['#6b4aa8', '#b58cf0'] };
// The tool in your hand for drag steps.
const TOOL = { mark: '✏️', saw: '🪚', scrape: '🔪', cut: '🔪', stitch: '🪡', carve: '🔪', sharpen: '🪨', string: '🧵', stir: '🥄' };
const TAP_ICON = { hammer: '🔨', rivet: '🔨', chisel: '🔨', crimp: '🔨', peg: '🔨', facet: '💎', skim: '🥄', flip: '🍳' };

// Metal colour by heat (0 cold … 0.75 orange … 1 white-hot).
const HEAT_STOPS = [[0, [107, 101, 96]], [0.35, [138, 42, 26]], [0.6, [230, 90, 30]], [0.75, [255, 140, 40]], [0.9, [255, 216, 74]], [1, [255, 246, 208]]];
function heatCol(v, a = 1) {
  v = Math.max(0, Math.min(1, v));
  let i = 1;
  while (i < HEAT_STOPS.length - 1 && v > HEAT_STOPS[i][0]) i++;
  const [v0, c0] = HEAT_STOPS[i - 1];
  const [v1, c1] = HEAT_STOPS[i];
  const k = (v - v0) / (v1 - v0 || 1);
  return `rgba(${c0.map((c, j) => Math.round(lerp(c, c1[j], k))).join(',')},${a})`;
}

export class CraftGame {
  constructor(hud, start, { onDone, onStop, onStep } = {}) {
    this.hud = hud;
    this.start = start;
    this.spec = start.spec;
    this.r = RECIPE_BY_ID[start.spec.recipe];
    this.s = newCraft(start.spec, OFF);
    this.inputs = [];
    this.queue = [];
    this.pid = null;
    this.down = false;
    this.px = 500;
    this.py = 300;
    this.lastRec = null;
    this.onDone = onDone;
    this.onStop = onStop;
    this.onStep = onStep;
    this.sent = false;
    this.piece = PIECE[this.r.pattern] ?? 'bar';
    // How the work looks so far.
    this.look = { heat: 0, hits: [], rivets: [], chips: [], facets: [], cuts: [], sawn: 0, poured: 0, added: [], swirl: 0, brown: 0, flip: 0, skimmed: 0 };
    this.fx = []; // sparks, shavings, steam
    this.swing = null; // the hammer coming down
    this.shake = 0;
    this.prevRes = 0;
    this.prevStrokes = 0;
    this.prevProg = 0;
    this.prevQuarters = 0;
    this.lastScrape = 0;
    const it = ITEMS[this.r.out];
    this.canvas = h('canvas.craft-cv');
    this.stepEl = h('div.craft-step', 'Get ready…');
    this.pips = h('div.craft-pips', ...this.spec.steps.map((st) => h('i', { title: STEP_TEXT[st.skin] || st.skin })));
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
      h('div.craft-head', this.icon, h('div.grow', h('b', `${STATIONS[this.r.station].verb}: ${it.name}${this.spec.batch > 1 ? ` ×${this.spec.batch}` : ''}`), h('div.muted', touch() ? 'Do what each step says with your finger' : 'Use the mouse (Space works for hold steps)'))),
      this.stepEl,
      h('div.craft-stage', this.canvas, this.markEl),
      this.pips,
      stopBtn,
    );
    this.scrim = h('div.craft-scrim', this.card);
    const pos = (e) => {
      const b = this.canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - b.left) / (b.width || 1)) * STAGE_W);
      const y = Math.round(((e.clientY - b.top) / (b.height || 1)) * STAGE_H);
      return { x: Math.max(-500, Math.min(1500, x)), y: Math.max(-500, Math.min(1100, y)) };
    };
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      if (this.pid !== null) return;
      this.pid = e.pointerId;
      try {
        this.scrim.setPointerCapture(e.pointerId);
      } catch {}
      this.queue.push({ e: 0, ...pos(e) });
    });
    this.scrim.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      const p = pos(e);
      this.px = p.x;
      this.py = p.y;
      this.queue.push({ e: 1, ...p });
    });
    const up = (e) => {
      if (e.pointerId !== this.pid) return;
      if (e.cancelable) e.preventDefault();
      this.pid = null;
      this.queue.push({ e: 2, ...pos(e) });
    };
    this.scrim.addEventListener('pointerup', up);
    this.scrim.addEventListener('pointercancel', up);
    this.scrim.addEventListener('contextmenu', (e) => e.preventDefault());
    this.key = (e) => {
      if (!(e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || this.pid !== null) return;
      // Keys only work the hold steps (a tap or a line needs aiming).
      const down = e.type === 'keydown';
      if (down && this.spec.steps[this.s.i]?.k !== 'hold') return;
      if (!down && !this.keyHeld) return;
      this.keyHeld = down;
      this.queue.push({ e: down ? 0 : 2, x: 500, y: 300 });
    };
    addEventListener('keydown', this.key, true);
    addEventListener('keyup', this.key, true);
    hud.el.append(this.scrim);
    this.last = performance.now();
    this.tickF = 0;
    requestAnimationFrame(this.loop);
  }

  // Record one input and play it straight away (the server will play the same).
  #rec(t, e, x, y) {
    if (this.inputs.length >= MAX_INPUTS || (e === 1 && this.inputs.length >= MAX_INPUTS - 8)) return;
    const ev = [t, e, x, y];
    this.inputs.push(ev);
    if (e === 0) this.down = true;
    if (e === 2) this.down = false;
    this.lastRec = ev;
    input(this.s, ev);
  }

  loop = () => {
    if (this.closed) return;
    const s = this.s;
    const now = performance.now();
    // Real time, but never more than 100 ms per frame: a slow phone slows the
    // craft down rather than skipping your moment.
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.tickF += dt / CRAFT_TICK;
    const t = Math.min(CRAFT_MAX_TICKS, Math.floor(this.tickF));
    // Moves are kept to one every other tick and only when the finger
    // really moved, so a whole craft fits in one small message.
    let move = null;
    for (const q of this.queue) {
      if (q.e === 1) {
        move = q;
        continue;
      }
      if (move) this.#move(t, move);
      move = null;
      this.#rec(t, q.e, q.x, q.y);
    }
    if (move) this.#move(t, move);
    this.queue.length = 0;
    advance(s, t);
    this.#feedback();
    this.#draw(dt / 1000);
    if (s.done) return this.#finish(false);
    requestAnimationFrame(this.loop);
  };
  #move(t, m) {
    const L = this.lastRec;
    if (!this.down || !L) return;
    if (t - L[0] < 2 && L[1] === 1) return;
    if (Math.abs(m.x - L[2]) + Math.abs(m.y - L[3]) < 6) return;
    this.#rec(t, 1, m.x, m.y);
  }

  // Sound, buzz and bits flying, as the work goes.
  #feedback() {
    const s = this.s;
    while (s.res.length > this.prevRes) this.#resolved(s.res[this.prevRes], this.spec.steps[this.prevRes]);
    const st = this.spec.steps[s.i];
    const a = s.a;
    if (!st || !a || s.phase !== 'wait') {
      this.prevStrokes = 0;
      this.prevProg = 0;
      this.prevQuarters = 0;
      return;
    }
    if (st.k === 'saw' && a.strokes > this.prevStrokes) {
      this.prevStrokes = a.strokes;
      sfx.rasp();
      this.#buzz(8);
      this.#burst(this.px, st.y + 20, 10, ['#e8c99a', '#c89a62'], { up: 0.5, spread: 3 });
    }
    if (st.k === 'carve' && a.prog > this.prevProg + 22) {
      this.prevProg = a.prog;
      const [x, y] = pointAt(st.pts, a.prog);
      this.#burst(x, y, 2, st.skin === 'sharpen' ? ['#fff1a8', '#ffd84a'] : st.skin === 'stitch' || st.skin === 'string' ? ['#f1e6c8'] : ['#e8c99a', '#d9b27a', '#b5874f'], { up: 1, spread: 2, size: 7, life: 0.7 });
      if (performance.now() - this.lastScrape > 110) {
        this.lastScrape = performance.now();
        sfx.scrape();
      }
    }
    if (st.k === 'stir' && Math.abs(a.quarters) > this.prevQuarters) {
      this.prevQuarters = Math.abs(a.quarters);
      this.look.swirl += Math.PI / 2;
      if (this.prevQuarters % 2 === 0) this.#burst(this.px, this.py, 3, ['#ffffff', '#d9f3ff'], { up: 0.6, spread: 1.5, size: 6 });
      if (this.prevQuarters % 4 === 0) sfx.plop();
    }
  }

  #buzz(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }
  // Particles in stage units: n bits from (x, y).
  #burst(x, y, n, cols, { up = 2, spread = 4, size = 8, life = 0.5, g = 900 } = {}) {
    for (let i = 0; i < n; i++)
      this.fx.push({ x, y, vx: (Math.random() - 0.5) * 220 * spread, vy: -Math.random() * 260 * up - 40, life, max: life, col: cols[i % cols.length], size: size * (0.6 + Math.random() * 0.8), g });
  }

  #resolved(q, st) {
    this.prevRes++;
    const pip = this.pips.children[this.prevRes - 1];
    pip.className = 'q' + q;
    const [txt, col] = MARK[q];
    this.markEl.textContent = txt;
    this.markEl.style.color = col;
    this.markEl.classList.remove('pop');
    void this.markEl.offsetWidth;
    this.markEl.classList.add('pop');
    this.#buzz(q === 'P' ? 35 : q === 'M' ? 10 : 20);
    const L = this.look;
    const good = q !== 'M';
    const hot = ['#fff1a8', '#ffd84a', '#ff9a3c'];
    if (st.k === 'tap') {
      const x = this.s.x;
      const y = this.s.y;
      if (['hammer', 'rivet', 'chisel', 'crimp', 'peg'].includes(st.skin)) this.swing = { x: good ? st.x : x, y: good ? st.y : y, t: 0 };
      if (st.skin === 'hammer') {
        if (good) L.hits.push([st.x, st.y, q]);
        this.#burst(st.x, st.y, q === 'P' ? 22 : good ? 12 : 3, hot, { up: 2.2, spread: 3 });
        this.shake = q === 'P' ? 10 : 5;
        good ? sfx.clang(q) : sfx.thud();
      } else if (st.skin === 'rivet' || st.skin === 'crimp') {
        if (good) L.rivets.push([st.x, st.y]);
        this.#burst(st.x, st.y, good ? 8 : 2, hot, { up: 1.5 });
        good ? sfx.clang(q) : sfx.thud();
      } else if (st.skin === 'chisel') {
        if (good) L.chips.push([st.x, st.y]);
        this.#burst(st.x, st.y, good ? 12 : 3, ['#b8b2a8', '#8c867c', '#e0dbd2'], { up: 1.6, spread: 2.5 });
        this.shake = good ? 4 : 2;
        good ? sfx.mine(q === 'P') : sfx.thud();
      } else if (st.skin === 'peg') {
        if (good) L.rivets.push([st.x, st.y]);
        good ? sfx.knock() : sfx.thud();
      } else if (st.skin === 'facet') {
        if (good) L.facets.push([st.x, st.y]);
        this.#burst(st.x, st.y, good ? 10 : 2, ['#ffffff', '#bfe8ff', '#8fc4e8'], { up: 1, spread: 2, size: 6 });
        good ? sfx.mine(q === 'P') : sfx.thud();
      } else if (st.skin === 'add') {
        L.added.push(this.#ingredient(L.added.length));
        this.#burst(st.x, st.y, 10, ['#ffffff', '#d9f3ff'], { up: 1.6, spread: 2 });
        sfx.plop();
      } else if (st.skin === 'skim') {
        L.skimmed++;
        sfx.plop();
      } else if (st.skin === 'flip') {
        L.flip = 1;
        sfx.sizzle();
      }
    } else if (st.k === 'hold') {
      const h = this.#holdLevel(st);
      if (st.skin === 'heat' || st.skin === 'reheat' || st.skin === 'bellows') {
        L.heat = Math.max(L.heat, Math.min(1, h * (st.skin === 'bellows' ? 0.92 : 0.75)));
        sfx.whoosh();
      } else if (st.skin === 'quench') {
        L.heat = 0;
        this.#burst(500, 300, 18, ['rgba(255,255,255,0.8)', 'rgba(230,240,255,0.7)'], { up: 1.2, spread: 2.5, size: 18, life: 1.2, g: -60 });
        sfx.sizzle();
      } else if (st.skin === 'pour') {
        L.poured++;
        sfx.plop();
      } else if (st.skin === 'sear') {
        L.brown = Math.min(1, L.brown + 0.5);
        sfx.sizzle();
      } else sfx.pop();
      this.hold = null;
    } else {
      if (st.k === 'carve') L.cuts.push({ pts: st.pts, skin: st.skin, q });
      if (st.k === 'saw') L.sawn++;
      good ? sfx.pick() : sfx.thud();
    }
    // The item takes shape as you work.
    const k = this.prevRes / this.spec.steps.length;
    this.icon.style.filter = `grayscale(${Math.round((1 - k) * 100)}%) blur(${((1 - k) * 2).toFixed(1)}px)`;
    this.onStep?.(st, q);
  }
  #ingredient(i) {
    const ids = Object.keys(this.r.in);
    return ITEMS[ids[i % ids.length]]?.icon || '🌿';
  }
  // How far a hold has gone, where 1 is the right moment.
  #holdLevel(st) {
    const a = this.s.a;
    if (!a || a.p === null) return this.hold ?? 0;
    return Math.max(0, (this.s.tick - OFF[1] - a.p) / st.at);
  }

  // ── Drawing (all in stage units, 1000 × 600) ──
  #draw(dt) {
    const s = this.s;
    const cv = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.clientWidth || 320;
    const H = cv.clientHeight || 192;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const x = cv.getContext('2d');
    const sc = (W / STAGE_W) * dpr;
    this.shake = Math.max(0, this.shake - dt * 60);
    const jx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const jy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    x.setTransform(sc, 0, 0, (H / STAGE_H) * dpr, jx * sc, jy * sc);
    x.clearRect(-50, -50, STAGE_W + 100, STAGE_H + 100);
    const st = this.spec.steps[Math.min(s.i, this.spec.steps.length - 1)];
    const live = s.phase === 'wait' ? st : null;
    // A hold in progress drives the look (the bar glows as you hold, and so on).
    if (live?.k === 'hold' && s.a?.p !== null) this.hold = this.#holdLevel(live);
    // Cooling between heats.
    if (!(live?.k === 'hold' && live.heat)) this.look.heat = Math.max(0, this.look.heat - dt * 0.025);
    this.#scene(x, live);
    if (live) {
      if (live.k === 'tap') this.#tap(x, live);
      else if (live.k === 'hold') this.#gauge(x, live);
      else if (live.k === 'saw') this.#saw(x, live);
      else if (live.k === 'carve') this.#carve(x, live);
      else if (live.k === 'stir') this.#stir(x, live);
    }
    this.#hammer(x, dt);
    this.#particles(x, dt);
    if (s.phase === 'ready') this.stepEl.textContent = `Get ready… ${STEP_TEXT[this.spec.steps[0].skin] || ''}`;
    else if (s.phase === 'wait' || s.phase === 'gap') this.stepEl.textContent = STEP_TEXT[st.skin] || st.skin;
  }

  // The station and the thing being made.
  #scene(x, live) {
    const L = this.look;
    const p = this.piece;
    const holdV = live?.k === 'hold' ? this.hold ?? 0 : 0;
    const heatNow = live?.k === 'hold' && live.heat ? Math.max(L.heat, Math.min(1, holdV * (live.skin === 'bellows' ? 0.92 : 0.75))) : L.heat;
    if (p === 'bar' || p === 'plate') {
      // The anvil.
      x.fillStyle = '#3c3a40';
      x.beginPath();
      x.moveTo(110, 330);
      x.lineTo(240, 330);
      x.lineTo(240, 380);
      x.closePath();
      x.fill();
      x.fillStyle = '#4c4a52';
      x.fillRect(230, 330, 560, 40);
      x.fillStyle = '#34323a';
      x.fillRect(360, 370, 300, 120);
      x.fillRect(300, 490, 420, 50);
      x.fillStyle = 'rgba(255,255,255,0.08)';
      x.fillRect(230, 330, 560, 6);
      // The bar: longer and flatter with every good blow.
      const k = Math.min(1, L.hits.length / 7);
      const len = p === 'plate' ? 440 : lerp(380, 540, k);
      const th = p === 'plate' ? 110 : lerp(58, 34, k);
      const top = 330 - th;
      if (heatNow > 0.3) {
        x.shadowColor = heatCol(heatNow);
        x.shadowBlur = 40 * heatNow;
      }
      x.fillStyle = heatCol(heatNow);
      x.beginPath();
      x.roundRect(500 - len / 2, top, len, th, p === 'plate' ? 10 : [4, 18, 18, 4]);
      x.fill();
      x.shadowBlur = 0;
      x.fillStyle = 'rgba(255,255,255,0.18)';
      x.fillRect(500 - len / 2 + 8, top + 4, len - 30, 5);
      for (const [hx, hy, q] of L.hits) {
        x.fillStyle = q === 'P' ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
        x.beginPath();
        x.ellipse(hx, Math.min(325, Math.max(top + 8, hy)), 22, 7, 0, 0, TAU);
        x.fill();
      }
      for (const [rx, ry] of L.rivets) this.#dot(x, rx, ry, 11, '#c9c4bc', '#7d776e');
    } else if (p === 'crucible') {
      // Fire, crucible and mould.
      const glow = Math.max(heatNow, 0.25);
      for (let i = 0; i < 6; i++) {
        const fx = 400 + i * 40;
        const fh = 50 + 40 * glow + Math.sin(performance.now() / 90 + i) * 12;
        x.fillStyle = i % 2 ? '#ff9a3c' : '#ffd84a';
        x.beginPath();
        x.moveTo(fx - 22, 420);
        x.lineTo(fx, 420 - fh);
        x.lineTo(fx + 22, 420);
        x.fill();
      }
      x.fillStyle = '#4a4440';
      x.beginPath();
      x.ellipse(500, 300, 150, 110, 0, 0, Math.PI);
      x.fill();
      x.shadowColor = heatCol(glow);
      x.shadowBlur = 30 * glow;
      x.fillStyle = heatCol(glow);
      x.beginPath();
      x.ellipse(500, 290, 140, 38, 0, 0, TAU);
      x.fill();
      x.shadowBlur = 0;
      const slag = this.spec.steps.find((st) => st.skin === 'skim');
      if (slag && !L.skimmed) this.#dot(x, slag.x, slag.y, 18, '#3a3532', '#26221f');
      x.fillStyle = '#2e2b2a';
      x.fillRect(360, 500, 280, 50);
      const fill = live?.skin === 'pour' ? Math.min(1, holdV * 0.8) : Math.min(1, L.poured ? 0.8 : 0);
      x.fillStyle = heatCol(0.85);
      x.fillRect(372, 540 - 40 * fill, 256, 40 * fill);
      if (live?.skin === 'pour' && this.s.a?.p !== null) {
        x.strokeStyle = heatCol(0.9);
        x.lineWidth = 14;
        x.beginPath();
        x.moveTo(620, 300);
        x.quadraticCurveTo(660, 420, 560, 520);
        x.stroke();
      }
      x.strokeStyle = '#fff';
      x.setLineDash([10, 8]);
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(372, 508);
      x.lineTo(628, 508);
      x.stroke();
      x.setLineDash([]);
    } else if (p === 'plank' || p === 'blank') {
      this.#wood(x, 150, p === 'plank' ? 220 : 190, 700, p === 'plank' ? 160 : 220);
      if (p === 'plank' && L.sawn) {
        x.fillStyle = '#2a1d14';
        const y = this.spec.steps.find((st) => st.k === 'saw')?.y ?? 300;
        x.fillRect(150, y - 3, 700, 6);
      }
      for (const [rx, ry] of L.rivets) this.#dot(x, rx, ry, 12, '#8a5a32', '#5a3a22');
    } else if (p === 'hide' || p === 'leather') {
      x.fillStyle = p === 'hide' ? '#7a4e30' : '#9a6a40';
      x.beginPath();
      if (p === 'hide') {
        x.moveTo(170, 300);
        x.bezierCurveTo(180, 130, 420, 150, 500, 140);
        x.bezierCurveTo(620, 130, 830, 150, 830, 300);
        x.bezierCurveTo(840, 460, 600, 460, 500, 460);
        x.bezierCurveTo(380, 470, 160, 450, 170, 300);
      } else x.roundRect(170, 150, 660, 300, 24);
      x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.25)';
      x.lineWidth = 4;
      x.stroke();
    } else if (p === 'stone') {
      x.fillStyle = '#8c867c';
      x.beginPath();
      x.roundRect(290, 190, 420, 220, 12);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,0.12)';
      x.fillRect(300, 196, 400, 10);
      for (const [cx, cy] of L.chips) {
        x.fillStyle = '#5c574f';
        x.beginPath();
        x.moveTo(cx - 18, cy - 10);
        x.lineTo(cx + 16, cy - 4);
        x.lineTo(cx - 4, cy + 16);
        x.fill();
      }
    } else if (p === 'gem') {
      const col = this.r.in.sapphire ? '#3d7ad6' : '#5fd4c0';
      x.fillStyle = '#c8a050';
      x.beginPath();
      x.arc(500, 300, 150, 0, TAU);
      x.fill();
      x.fillStyle = col;
      x.beginPath();
      for (let i = 0; i < 8; i++) x.lineTo(500 + Math.cos((i / 8) * TAU) * 110, 300 + Math.sin((i / 8) * TAU) * 110);
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.6)';
      x.lineWidth = 3;
      for (const [fx, fy] of L.facets) {
        x.beginPath();
        x.moveTo(500, 300);
        x.lineTo(fx, fy);
        x.stroke();
      }
      for (const [rx, ry] of L.rivets) this.#dot(x, rx, ry, 10, '#f3d589', '#a07a30');
    } else if (p === 'pan') {
      x.fillStyle = '#2b2a2e';
      x.fillRect(720, 290, 240, 30);
      x.beginPath();
      x.arc(500, 310, 220, 0, TAU);
      x.fill();
      x.fillStyle = '#3c3b40';
      x.beginPath();
      x.arc(500, 310, 196, 0, TAU);
      x.fill();
      // The fish browns while it sears (golden at the right moment).
      const b = live?.skin === 'sear' ? Math.max(L.brown, Math.min(1.2, L.brown + holdV * 0.5)) : L.brown;
      const c0 = [200, 200, 205];
      const c1 = b <= 1 ? [214, 160, 70] : [90, 50, 20];
      const k = b <= 1 ? b : Math.min(1, (b - 1) * 4);
      const fc = b <= 1 ? c0.map((c, i) => Math.round(lerp(c, c1[i], k))) : [214, 160, 70].map((c, i) => Math.round(lerp(c, c1[i], k)));
      L.flip = Math.max(0, L.flip - 0.06);
      x.save();
      x.translate(500, 300);
      x.scale(1, 1 - 1.6 * Math.sin(L.flip * Math.PI) * 0.6);
      x.fillStyle = `rgb(${fc.join(',')})`;
      x.beginPath();
      x.ellipse(0, 0, 110, 52, 0, 0, TAU);
      x.fill();
      x.beginPath();
      x.moveTo(100, 0);
      x.lineTo(160, -42);
      x.lineTo(160, 42);
      x.fill();
      x.fillStyle = '#222';
      x.beginPath();
      x.arc(-70, -10, 7, 0, TAU);
      x.fill();
      x.restore();
    } else if (p === 'pot') {
      const [c0, c1] = BROTH[this.r.pattern] ?? BROTH.stew;
      x.fillStyle = '#26252a';
      x.beginPath();
      x.arc(500, 300, 262, 0, TAU);
      x.fill();
      x.fillStyle = c0;
      x.beginPath();
      x.arc(500, 300, 236, 0, TAU);
      x.fill();
      // The swirl turns as you stir; the ingredients go round with it.
      const ang = this.look.swirl + performance.now() / 4000;
      x.strokeStyle = c1;
      x.lineWidth = 10;
      for (let i = 0; i < 3; i++) {
        x.beginPath();
        x.arc(500, 300, 70 + i * 50, ang + i, ang + i + 1.4);
        x.stroke();
      }
      x.font = '44px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      L.added.forEach((ic, i) => {
        const a = ang * 1.3 + (i / Math.max(1, L.added.length)) * TAU;
        x.fillText(ic, 500 + Math.cos(a) * 120, 300 + Math.sin(a) * 120);
      });
      // Bubbles while it simmers or boils.
      if (live?.k === 'hold' && this.s.a?.p !== null && Math.random() < 0.3 + holdV * 0.6) this.#burst(500 + (Math.random() - 0.5) * 360, 300 + (Math.random() - 0.5) * 300, 1, ['rgba(255,255,255,0.7)'], { up: 0.3, spread: 0.2, size: 10, life: 0.4, g: -40 });
    }
    // Finished cuts and lines stay on the work.
    for (const c of L.cuts) this.#groove(x, c.pts, c.skin, 1e9, c.q);
    // Steam while quenching (it stops at the right moment).
    if (live?.skin === 'quench' && this.s.a?.p !== null && Math.random() < Math.max(0, 1 - holdV) * 0.9) this.#burst(400 + Math.random() * 200, 290, 1, ['rgba(255,255,255,0.75)'], { up: 0.6, spread: 0.8, size: 22, life: 1, g: -80 });
    // Sparks off the wheel while grinding.
    if (live?.skin === 'grind' && this.s.a?.p !== null) this.#burst(700, 300, 2, ['#ffd84a', '#ff9a3c'], { up: 1.2, spread: 2.5, size: 5, life: 0.35 });
  }

  #wood(x, X, Y, w, hh) {
    x.fillStyle = '#c89a62';
    x.beginPath();
    x.roundRect(X, Y, w, hh, 10);
    x.fill();
    x.strokeStyle = 'rgba(110,70,35,0.35)';
    x.lineWidth = 3;
    for (let i = 1; i < 6; i++) {
      x.beginPath();
      x.moveTo(X + 10, Y + (hh * i) / 6);
      x.bezierCurveTo(X + w * 0.3, Y + (hh * i) / 6 + 8, X + w * 0.6, Y + (hh * i) / 6 - 8, X + w - 10, Y + (hh * i) / 6);
      x.stroke();
    }
  }
  #dot(x, cx, cy, r, c0, c1) {
    x.fillStyle = c1;
    x.beginPath();
    x.arc(cx, cy + 3, r, 0, TAU);
    x.fill();
    x.fillStyle = c0;
    x.beginPath();
    x.arc(cx, cy, r, 0, TAU);
    x.fill();
  }
  // A line that's been worked (cut, carved, stitched, scraped), up to `upto` along it.
  #groove(x, pts, skin, upto, q) {
    const step = 12;
    const path = [];
    for (let d = 0; ; d += step) {
      path.push(pointAt(pts, Math.min(d, upto)));
      if (d >= upto || path.length > 400) break;
      const end = pointAt(pts, d + step);
      if (end[0] === path[path.length - 1][0] && end[1] === path[path.length - 1][1]) break;
    }
    if (path.length < 2) return;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    if (skin === 'stitch') {
      x.strokeStyle = '#f1e6c8';
      x.lineWidth = 6;
      for (let i = 1; i < path.length; i += 2) {
        const [ax, ay] = path[i - 1];
        const [bx, by] = path[i];
        x.beginPath();
        x.moveTo(ax - 8, ay - 8);
        x.lineTo(bx + 8, by + 8);
        x.stroke();
      }
      return;
    }
    const style = { mark: ['#3a3a3a', 5], scrape: ['#c49a6c', 34], sharpen: ['#fff6d0', 8], string: ['#f1e6c8', 5], cut: ['#2a1a10', 7], carve: ['#e8c99a', 26] }[skin] ?? ['#2a1a10', 8];
    x.strokeStyle = q === 'M' ? 'rgba(80,40,30,0.6)' : style[0];
    x.lineWidth = style[1];
    x.beginPath();
    path.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.stroke();
  }

  // ── Steps ──
  #tap(x, st) {
    const s = this.s;
    const r = tapRadius(s, st);
    const age = (s.tick - s.s0) / st.T; // 0 → 1 as the spot cools
    const pulse = 1 + Math.sin(performance.now() / 120) * 0.06;
    if (st.skin === 'add') {
      // The ingredient bobs over the pot: tap it to drop it in.
      x.font = `${Math.round(r * 1.3)}px sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(this.#ingredient(this.look.added.length), st.x, st.y + Math.sin(performance.now() / 200) * 8);
    } else {
      const g = x.createRadialGradient(st.x, st.y, 0, st.x, st.y, r * pulse);
      const hot = st.skin === 'facet' ? '255,255,255' : st.skin === 'chisel' || st.skin === 'peg' ? '255,240,200' : '255,240,170';
      g.addColorStop(0, `rgba(${hot},${0.95 - age * 0.5})`);
      g.addColorStop(0.4, `rgba(${hot},${0.6 - age * 0.3})`);
      g.addColorStop(1, `rgba(${hot},0)`);
      x.fillStyle = g;
      x.beginPath();
      x.arc(st.x, st.y, r * pulse, 0, TAU);
      x.fill();
      if (st.skin === 'chisel') {
        x.strokeStyle = '#f5f1e8';
        x.lineWidth = 6;
        x.beginPath();
        x.moveTo(st.x - 18, st.y - 18);
        x.lineTo(st.x + 18, st.y + 18);
        x.moveTo(st.x + 18, st.y - 18);
        x.lineTo(st.x - 18, st.y + 18);
        x.stroke();
      }
    }
    // The ring shrinks as time runs out (amber once it's late).
    x.strokeStyle = age > 0.6 ? 'rgba(217,146,90,0.9)' : 'rgba(255,255,255,0.75)';
    x.lineWidth = 5;
    x.beginPath();
    x.arc(st.x, st.y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - age));
    x.stroke();
  }

  // Holds: a gauge on the right with the band to let go in.
  #gauge(x, st) {
    const s = this.s;
    const w = this.spec.win;
    const gx = 900;
    const gy = 60;
    const gh = 480;
    const yOf = (v) => gy + gh - (v / st.F) * gh;
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.beginPath();
    x.roundRect(gx - 8, gy - 8, 76, gh + 16, 12);
    x.fill();
    const zone = (n, col) => {
      x.fillStyle = col;
      x.fillRect(gx - 4, yOf(st.at + n), 68, (2 * n * gh) / st.F);
    };
    zone(w.W, 'rgba(243,165,107,0.5)');
    zone(w.G, 'rgba(126,217,87,0.65)');
    zone(w.P, 'rgba(255,216,74,0.95)');
    if (s.a?.p !== null) {
      const v = Math.min(st.F, s.tick - OFF[1] - s.a.p);
      const g = x.createLinearGradient(0, gy + gh, 0, gy);
      g.addColorStop(0, '#7d776e');
      g.addColorStop(0.5, '#e2574c');
      g.addColorStop(0.8, '#ff9a3c');
      g.addColorStop(1, '#ffe27a');
      x.fillStyle = g;
      x.fillRect(gx + 10, yOf(v), 40, gy + gh - yOf(v));
    } else {
      x.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(performance.now() / 160) * 0.3})`;
      x.font = 'bold 54px sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('HOLD', 500, 120);
    }
  }

  #saw(x, st) {
    const s = this.s;
    const a = s.a;
    // The pencil line, and the cut getting deeper with each stroke.
    x.strokeStyle = 'rgba(40,30,20,0.8)';
    x.setLineDash([16, 12]);
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(st.x0, st.y);
    x.lineTo(st.x1, st.y);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = 'rgba(30,20,12,0.9)';
    const k = a ? a.strokes / st.n : 0;
    x.fillRect(st.x0, st.y - 2 - 4 * k, (st.x1 - st.x0) * k, 4 + 8 * k);
    // The saw follows your finger.
    const sx = this.down ? this.px : s.x || 500;
    x.save();
    x.translate(Math.max(st.x0 + 40, Math.min(st.x1 - 40, sx)), st.y);
    x.fillStyle = '#c9ccd2';
    x.beginPath();
    x.moveTo(-200, -6);
    x.lineTo(150, -6);
    x.lineTo(150, -70);
    x.lineTo(-200, -40);
    x.closePath();
    x.fill();
    x.fillStyle = '#9aa0a8';
    for (let i = -200; i < 150; i += 16) {
      x.beginPath();
      x.moveTo(i, -6);
      x.lineTo(i + 8, 6);
      x.lineTo(i + 16, -6);
      x.fill();
    }
    x.fillStyle = '#8a5a32';
    x.beginPath();
    x.roundRect(150, -80, 70, 60, 14);
    x.fill();
    x.restore();
    this.#count(x, `${a?.strokes ?? 0} / ${st.n}`, !this.down && !a?.strokes ? '⟵  saw  ⟶' : null);
  }

  #carve(x, st) {
    const a = this.s.a;
    // The dotted line to follow, the part done so far, and where to start.
    x.strokeStyle = 'rgba(255,255,255,0.85)';
    x.setLineDash([14, 12]);
    x.lineWidth = 5;
    x.beginPath();
    st.pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.stroke();
    x.setLineDash([]);
    if (a?.started) this.#groove(x, st.pts, st.skin, a.prog, 'G');
    else {
      const [sx, sy] = st.pts[0];
      x.fillStyle = `rgba(255,216,74,${0.6 + Math.sin(performance.now() / 150) * 0.3})`;
      x.beginPath();
      x.arc(sx, sy, 26, 0, TAU);
      x.fill();
      const [ex, ey] = st.pts[st.pts.length - 1];
      x.fillStyle = 'rgba(255,255,255,0.8)';
      x.beginPath();
      x.arc(ex, ey, 12, 0, TAU);
      x.fill();
    }
    // Width of "close enough".
    x.strokeStyle = 'rgba(255,255,255,0.08)';
    x.lineWidth = st.tol * 2;
    x.beginPath();
    st.pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.stroke();
    this.#toolAt(x, st.skin);
  }

  #stir(x, st) {
    const a = this.s.a;
    x.strokeStyle = 'rgba(255,255,255,0.18)';
    x.lineWidth = st.tol * 2;
    x.beginPath();
    x.arc(st.cx, st.cy, st.R, 0, TAU);
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.7)';
    x.setLineDash([16, 14]);
    x.lineWidth = 4;
    x.beginPath();
    x.arc(st.cx, st.cy, st.R, 0, TAU);
    x.stroke();
    x.setLineDash([]);
    const k = stepProgress(this.s);
    x.strokeStyle = '#ffd84a';
    x.lineWidth = 10;
    x.beginPath();
    x.arc(st.cx, st.cy, st.R, -Math.PI / 2, -Math.PI / 2 + TAU * k);
    x.stroke();
    this.#toolAt(x, 'stir');
    this.#count(x, `${Math.floor(Math.abs(a?.quarters ?? 0) / 4)} / ${st.n} turns`, !this.down && !a?.quarters ? '⟳  stir' : null);
  }

  #toolAt(x, skin) {
    if (!this.down) return;
    x.font = '70px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(TOOL[skin] || '🔪', this.px + 30, this.py - 40);
  }
  #count(x, txt, hint) {
    x.font = 'bold 34px sans-serif';
    x.textAlign = 'left';
    x.textBaseline = 'top';
    x.fillStyle = 'rgba(0,0,0,0.5)';
    x.fillText(txt, 22, 22);
    x.fillStyle = '#f3d589';
    x.fillText(txt, 20, 20);
    if (hint) {
      x.font = 'bold 48px sans-serif';
      x.textAlign = 'center';
      x.fillStyle = `rgba(255,255,255,${0.55 + Math.sin(performance.now() / 160) * 0.3})`;
      x.fillText(hint, 500, 470);
    }
  }

  // The hammer (or mallet) coming down where you tapped.
  #hammer(x, dt) {
    const sw = this.swing;
    if (!sw) return;
    sw.t += dt;
    const d = sw.t < 0.06 ? 1 - sw.t / 0.06 : Math.min(1, (sw.t - 0.06) / 0.2);
    if (sw.t > 0.3) return (this.swing = null);
    x.save();
    x.translate(sw.x + 40, sw.y - 30 - d * 120);
    x.rotate(-0.5 - d * 0.6);
    x.font = '120px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(TAP_ICON[this.spec.steps[this.prevRes - 1]?.skin] || '🔨', 0, 0);
    x.restore();
  }

  #particles(x, dt) {
    const keep = [];
    for (const p of this.fx) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      x.globalAlpha = Math.max(0, p.life / p.max);
      x.fillStyle = p.col;
      x.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      keep.push(p);
    }
    x.globalAlpha = 1;
    this.fx = keep.length > 300 ? keep.slice(-300) : keep;
  }

  #finish(stop) {
    if (this.sent) return;
    this.sent = true;
    const s = this.s;
    this.stepEl.textContent = '…';
    (stop ? this.onStop : this.onDone)?.({ sid: this.start.sid, inputs: packInputs(this.inputs), end: Math.max(0, Math.min(CRAFT_MAX_TICKS, s.tick)), off: OFF, stop });
  }

  // The result card (server-graded).
  showResult(res, { onAgain, onEquip, onSell, useIn } = {}) {
    const o = res.out;
    const it = ITEMS[o.item];
    const pips = h('div.craft-pips.big', ...res.steps.map((q) => h('i.q' + q)));
    const quality = o.q ? h('div.craft-quality.q' + o.q, `${QUALITY[o.q].label}!`, h('span', it.atk ? ` ATK ${it.atk}` : it.def ? ` DEF ${it.def}` : it.speed ? ` ${it.speed} ms swing` : '')) : null;
    const parts = [
      h('div.craft-grade.g' + res.grade, res.grade),
      h('div', { style: { textAlign: 'center' } }, h('b', `${fmt(o.qty)}× ${it.name}`), o.bonus ? h('div.gold', `+${o.bonus} bonus for good work`) : null, quality, h('div.muted', `Score ${res.score}${res.flawless ? ' · flawless!' : ''}${res.xp ? ` · +${res.xp.amount} Crafting XP` : ''}`)),
      h('div.craft-icon.done', iconEl(o.item, '72px')),
      pips,
      res.mastery && this.r && o.q === 0 && ['material', 'consumable'].includes(ITEMS[this.r.out].cat) ? h('div.muted', { style: { textAlign: 'center' } }, res.mastery.quick ? '⚡ Quick crafting unlocked for this recipe' : `Make it ${Math.max(0, 3 - res.mastery.n)} more time${3 - res.mastery.n === 1 ? '' : 's'} at grade B+ to unlock Quick`) : null,
      h('div.row', { style: { justifyContent: 'center', marginTop: '8px', flexWrap: 'wrap' } }, onAgain ? h('button.btn.green.small', { on: { click: (e) => (e.stopPropagation(), onAgain()) } }, 'Again') : null, onEquip && (it.slot || it.tool) ? h('button.btn.blue.small', { on: { click: (e) => (e.stopPropagation(), onEquip(o.item)) } }, 'Equip') : null, onSell ? h('button.btn.small', { on: { click: (e) => (e.stopPropagation(), onSell.run()) } }, onSell.label) : null, useIn ? h('button.btn.small', { on: { click: (e) => (e.stopPropagation(), useIn.run()) } }, useIn.label) : null, h('button.btn.small', { on: { click: (e) => (e.stopPropagation(), this.close()) } }, 'Done')),
    ];
    this.card.replaceChildren(...parts.filter(Boolean));
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
