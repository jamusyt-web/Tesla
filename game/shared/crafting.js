// Hands-on crafting: you do the job with your finger. Every step is one real
// motion: tap the glowing spot (hammer, rivet, chisel, drop in an
// ingredient), hold and let go at the right moment (heat, pour, quench,
// simmer), saw back and forth along a line, carve along a dotted path, or
// stir round the pot.
// The server builds the step list (a "spec") for each craft; the client
// plays it and sends back what your finger did ([tick, down/move/up, x, y]);
// the server replays those inputs through this exact code to get the score
// (same anti-cheat idea as fishing). Integer ticks at 60 Hz, and a stage
// 1000 wide by 600 tall. Only plain arithmetic and Math.sqrt are used, so
// every browser and the server get the same answer.
import { ITEMS, qualityId, QUALITY, QUALITY_BASES } from './items.js';

export const CRAFT_TICK = 1000 / 60;
export const READY = 45; // a moment to get ready
export const STAGE_W = 1000;
export const STAGE_H = 600;
const GAP = 14; // pause between steps
const TAP_GAP = 8; // hammer blows come quicker
const SWITCH = 10; // extra pause when the motion changes
const IGNORE = 4; // input right as a step starts is ignored
const HOLD_IDLE = 600; // a hold nobody starts within 10 s is a miss
export const CRAFT_MAX_TICKS = 8400;
export const MAX_INPUTS = 1200;

const PTS = { P: 100, G: 75, W: 40, M: 0 };
// Hold steps: perfect / good / weak (± ticks from the right moment).
const WIN = { 1: [4, 9, 15], 2: [4, 8, 14], 3: [3, 8, 13], 4: [3, 7, 12] };
const PRESS_F = { 1: 96, 2: 88, 3: 80, 4: 72 };
// Tiers 5–7 keep tier 4's numbers; they're harder by having more steps.
for (const T of [WIN, PRESS_F]) for (const t of [5, 6, 7]) T[t] = T[4];
export const MAX_TIER = 7;
// Hand steps, by tier 1–4: how far off you can be (stage units; the tap
// spot's radius, or the average distance from the line), and how long you get.
const TOL = { tap: [95, 88, 80, 72], saw: [80, 72, 64, 56], carve: [70, 64, 58, 52], stir: [110, 100, 92, 85] };
const LIMIT = { tap: [180, 160, 140, 120], saw: 720, carve: 600, stir: 720 };
// Within this share of the tolerance (per mille) is Perfect, then Good;
// anything up to the whole tolerance is Weak.
const P_FRAC = 400;
const G_FRAC = 720;
const HEAT_MOD = { P: 1, G: 0, W: -1, M: -1 }; // a good heat makes the hammer spots bigger
export const GRADE_BONUS = { S: 0.2, A: 0.12, B: 0.05, C: 0, D: 0 };
export const XP_MULT = { S: 1.4, A: 1.2, B: 1.0, C: 0.9, D: 0.75 };

// Where each recipe is made. Stations stand in the Workshop yard.
export const STATIONS = {
  forge: { label: 'Forge', verb: 'Smelt', icon: '🔥' },
  anvil: { label: 'Anvil', verb: 'Forge', icon: '⚒️' },
  workbench: { label: 'Workbench', verb: 'Craft', icon: '🪚' },
  grindstone: { label: 'Grindstone', verb: 'Grind', icon: '⚙️' },
  cookpot: { label: 'Cookpot', verb: 'Cook', icon: '🍲' },
  // Each new town's signature station (in its yard only).
  smokehouse: { label: 'Smokehouse', verb: 'Smoke', icon: '🍖' },
  quench_trough: { label: 'Quench Trough', verb: 'Temper', icon: '💧' },
  glassworks: { label: 'Glassworks', verb: 'Blow', icon: '🔮' },
  starforge: { label: 'Starforge', verb: 'Forge', icon: '✨' },
};

// What each step asks for on screen, by its "skin".
export const STEP_TEXT = {
  bellows: 'Hold to pump the bellows — let go when it glows white',
  skim: 'Tap the slag to skim it off',
  pour: 'Hold to pour — let go at the line',
  mark: 'Trace the line to mark the cut',
  saw: 'Saw back and forth along the line',
  scrape: 'Scrape along the line',
  chisel: 'Tap the marks to chisel',
  grind: 'Hold it to the wheel — let go when it shines',
  heat: 'Hold to heat the bar — let go when it glows orange',
  reheat: 'Hold to reheat — let go when it glows orange',
  hammer: 'Tap the hot spot to hammer it',
  quench: 'Hold it in the water — let go when the hiss stops',
  rivet: 'Tap each rivet',
  sharpen: 'Draw along the edge to sharpen it',
  cut: 'Trace the line to cut the leather',
  stitch: 'Trace the seam to stitch it',
  tighten: 'Hold to pull the laces tight — let go in the band',
  carve: 'Carve along the line',
  peg: 'Tap to knock the peg in',
  string: 'Draw the string from end to end',
  facet: 'Tap the glint to cut a facet',
  set: 'Hold to press the stone in — let go in the band',
  crimp: 'Tap to crimp the setting',
  sear: 'Hold to sear — let go when it’s golden',
  flip: 'Tap the fish to flip it',
  add: 'Tap the ingredient to drop it in',
  stir: 'Stir round the pot',
  simmer: 'Hold to simmer — let go in the band',
  boil: 'Hold to boil — let go in the band',
  distill: 'Hold to distill — let go in the band',
  chill: 'Hold to cool it — let go in the band',
};
// The four kinds of motion, for words on screen.
export const MOTION = { tap: 'tap', hold: 'hold', saw: 'drag', carve: 'drag', stir: 'drag' };

const S = (k, skin, o = {}) => ({ k, skin, ...o });
const rep = (n, st) => Array.from({ length: n }, () => st);
// (t: tier 1–4, x: extra work for a big batch)
const PATTERNS = {
  smelt: (t, x) => [S('hold', 'bellows', { heat: 1 }), S('tap', 'skim'), S('hold', 'pour'), ...rep(x, S('hold', 'pour'))],
  saw: (t, x) => [S('carve', 'mark'), S('saw', 'saw', { n: 3 + Math.min(2, t - 1) }), ...rep(x, S('saw', 'saw', { n: 3 }))],
  scrape: (t, x) => rep(2 + x, S('carve', 'scrape')),
  dress: (t, x) => [...rep(3 + x, S('tap', 'chisel')), S('hold', 'grind', { w: 2 })],
  forge_tool: (t) => forged(3 + Math.ceil(t / 2), t),
  forge_blade: (t) => [...forged(4 + Math.ceil(t / 2), t), S('carve', 'sharpen', { w: 2 })],
  forge_plate: () => [S('hold', 'heat', { heat: 1 }), ...rep(4, S('tap', 'hammer')), ...rep(3, S('tap', 'rivet')), S('hold', 'quench', { w: 2 })],
  stitch: () => [S('carve', 'cut'), S('carve', 'stitch'), S('carve', 'stitch'), S('hold', 'tighten', { w: 2 })],
  assemble: () => [S('carve', 'carve'), S('carve', 'carve'), ...rep(2, S('tap', 'peg')), S('carve', 'string', { w: 2 })],
  facet: () => [...rep(3, S('tap', 'facet')), S('hold', 'set', { w: 2 }), ...rep(2, S('tap', 'crimp'))],
  grill: (t, x) => [S('hold', 'sear'), S('tap', 'flip'), S('hold', 'sear'), ...rep(x, S('tap', 'flip'))],
  stew: (t, x) => [...rep(3, S('tap', 'add')), S('stir', 'stir', { n: 2 + x }), S('hold', 'simmer', { w: 2 })],
  brew: (t, x) => [...rep(2, S('tap', 'add')), S('stir', 'stir', { n: 3 + x }), S('hold', 'boil', { w: 2 })],
  elixir: (t, x) => [...rep(3, S('tap', 'add')), S('stir', 'stir', { n: 3 + x }), S('hold', 'distill', { w: 2 })],
};
// Heat, hammer (a reheat halfway for higher tiers), quench.
function forged(n, t) {
  const h = Math.ceil(n / 2);
  return [S('hold', 'heat', { heat: 1 }), ...rep(t >= 3 ? h : n, S('tap', 'hammer')), ...(t >= 3 ? [S('hold', 'reheat', { heat: 1 }), ...rep(n - h, S('tap', 'hammer'))] : []), S('hold', 'quench', { w: 2 })];
}
// Where a tap spot can appear, by skin: [x0, y0, x1, y1] for its centre.
const AREA = {
  hammer: [320, 270, 680, 320],
  rivet: [300, 230, 700, 370],
  skim: [390, 250, 610, 320],
  chisel: [330, 220, 670, 380],
  facet: [410, 220, 590, 380],
  crimp: [370, 200, 630, 400],
  peg: [300, 250, 700, 350],
  flip: [430, 260, 570, 340],
  add: [330, 190, 670, 410],
};
const AREA_ANY = [300, 220, 700, 380];

export const recipeTier = (r) => (r.lvl <= 2 ? 1 : r.lvl <= 5 ? 2 : r.lvl <= 8 ? 3 : r.lvl <= 12 ? 4 : r.lvl <= 20 ? 5 : r.lvl <= 28 ? 6 : 7);
// Tiers 5–7 add steps: a reheat (for metal) and another group of the
// recipe's main motion (5), a chill (6), and one more group (7). A craft
// never runs past MAX_STEPS: a long one (a blade) skips the extra groups.
export const MAX_STEPS = 11;
function harder(steps, t) {
  if (t < 5) return steps;
  const tap = [...steps].reverse().find((st) => st.k === 'tap');
  const drag = [...steps].reverse().find((st) => st.k === 'saw' || st.k === 'carve' || st.k === 'stir');
  const group = () => (tap ? rep(2, S('tap', tap.skin)) : drag ? [S(drag.k, drag.skin, drag.n ? { n: drag.n } : {})] : [S('hold', 'chill')]);
  // What to add, most wanted first; what fits goes on in the usual order.
  const heat = steps.some((st) => st.heat) ? [S('hold', 'reheat', { heat: 1 })] : [];
  const extras = [...(t >= 6 ? [['chill', [S('hold', 'chill')]]] : []), ['reheat', heat], ['group', group()], ...(t >= 7 ? [['group2', group()]] : [])];
  let room = MAX_STEPS - steps.length;
  const take = new Set();
  for (const [k, list] of extras) if (list.length <= room) (take.add(k), (room -= list.length));
  const add = (k) => (take.has(k) ? extras.find((e) => e[0] === k)[1] : []);
  return [...steps, ...add('reheat'), ...add('group'), ...add('chill'), ...add('group2')];
}
export const isStackable = (r) => ['material', 'consumable'].includes(ITEMS[r.out].cat);
// How many you can make in one sitting (grows with Crafting level; extra:
// the Crafting 15 milestone's +5).
export function batchCap(r, lvl, extra = 0) {
  const cat = ITEMS[r.out].cat;
  if (cat === 'material') return Math.min(25, 5 + 2 * (lvl - 1)) + extra;
  if (cat === 'consumable') return Math.min(10, 3 + (lvl - 1)) + extra;
  return 1;
}
// Bigger batches take a little more work.
export function extraSteps(r, batch) {
  const cat = ITEMS[r.out].cat;
  if (cat === 'material') return Math.min(2, Math.floor((batch - 1) / 8));
  if (cat === 'consumable') return Math.min(2, Math.floor((batch - 1) / 4));
  return 0;
}
// How forgiving a craft is. P/G/W: ticks for hold steps. p/g: the Perfect
// and Good share of a hand step's tolerance (per mille). k: the tolerance
// itself, scaled (per mille). Crafting well above a recipe's level is
// kinder; bonus { P, G } comes from perks (Smith's perfectTick; Steady
// Hands), never past the next window out.
export function windows(tier, over, bonus = {}) {
  let [P, G, W] = WIN[tier];
  const b = over >= 15 ? 2 : over >= 5 ? 1 : 0;
  P = Math.min(6, P + b);
  G = Math.min(11, G + b);
  G = Math.min(W - 1, G + (bonus.G || 0));
  P = Math.min(G - 1, P + (bonus.P || 0));
  const g = Math.min(900, G_FRAC + 60 * (bonus.G || 0));
  const p = Math.min(g - 60, P_FRAC + 60 * (bonus.P || 0));
  return { P, G, W, p, g, k: 1000 + 100 * b };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A dotted line to trace, left to right: [[x, y], …].
function pathFor(skin, ri) {
  if (skin === 'mark') {
    const y = ri(270, 330);
    return [[180, y], [500, y], [820, y]];
  }
  if (skin === 'sharpen') {
    const a = ri(250, 350);
    const b = ri(250, 350);
    return [[180, a], [500, (a + b) >> 1], [820, b]];
  }
  if (skin === 'stitch') {
    const y = ri(260, 340);
    return [180, 340, 500, 660, 820].map((x, i) => [x, y + (i % 2 ? -36 : 36)]);
  }
  if (skin === 'string') return [[220, ri(150, 200)], [500, ri(280, 320)], [780, ri(400, 450)]];
  const y = ri(220, 380);
  return [200, 400, 600, 800].map((x) => [x, Math.max(200, Math.min(400, y + ri(-70, 70)))]);
}

// The step list for one craft (JSON; the server stores it and replays it as stored).
export function buildSpec(r, { lvl = 1, batch = 1, seed = 1, sid = '', bonus = {} } = {}) {
  const rng = mulberry32(seed);
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const tier = recipeTier(r);
  const ti = Math.min(tier, 4) - 1;
  const win = windows(tier, lvl - r.lvl, bonus);
  const tol = (k) => Math.round((TOL[k][ti] * win.k) / 1000);
  let markY = null; // a saw follows the line you marked
  const steps = harder(PATTERNS[r.pattern](Math.min(tier, 4), extraSteps(r, batch)), tier).map((st) => {
    const base = { k: st.k, skin: st.skin, w: st.w || 1, ...(st.heat ? { heat: 1 } : {}) };
    if (st.k === 'tap') {
      const a = AREA[st.skin] ?? AREA_ANY;
      return { ...base, x: ri(a[0], a[2]), y: ri(a[1], a[3]), r: tol('tap'), T: LIMIT.tap[ti] };
    }
    if (st.k === 'saw') return { ...base, y: markY ?? ri(270, 330), x0: 150, x1: 850, n: st.n || 3, tol: tol('saw'), T: LIMIT.saw };
    if (st.k === 'carve') {
      const pts = pathFor(st.skin, ri);
      if (st.skin === 'mark') markY = pts[0][1];
      return { ...base, pts, tol: tol('carve'), T: LIMIT.carve };
    }
    if (st.k === 'stir') return { ...base, cx: 500, cy: 300, R: 190, n: st.n || 3, tol: tol('stir'), T: LIMIT.stir };
    const F = PRESS_F[tier];
    const lo = Math.round(F * 0.55);
    const hi = F - win.W - 4;
    return { ...base, F, at: lo + Math.floor(rng() * (hi - lo + 1)) };
  });
  return { v: 2, sid, seed, recipe: r.id, batch, tier, win, steps };
}

// ── Lines and judging ──
// A traced path's total length and the nearest point on it: { d, along }.
export function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.sqrt((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2);
  return L;
}
export function nearest(pts, x, y) {
  let best = { d: 1e9, along: 0 };
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const L = Math.sqrt(L2);
    let u = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + u * dx - x;
    const py = ay + u * dy - y;
    const d = Math.sqrt(px * px + py * py);
    if (d < best.d) best = { d, along: run + u * L };
    run += L;
  }
  return best;
}
// The point at a distance along a path (for drawing).
export function pointAt(pts, along) {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const L = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    if (run + L >= along || i === pts.length - 1) {
      const u = L ? Math.max(0, Math.min(1, (along - run) / L)) : 0;
      return [ax + u * (bx - ax), ay + u * (by - ay)];
    }
    run += L;
  }
  return pts[0];
}
const judgeT = (d, w) => (d <= w.P ? 'P' : d <= w.G ? 'G' : d <= w.W ? 'W' : 'M');
// d: how far off (or the average of how far off), against a tolerance.
const judgeD = (d, tol, w) => (d * 1000 <= w.p * tol ? 'P' : d * 1000 <= w.g * tol ? 'G' : d <= tol ? 'W' : 'M');
const worse = { P: 'G', G: 'W', W: 'W', M: 'M' };
// A tap spot's radius, after the last heat.
export const tapRadius = (s, st) => (st.r * (1000 + 120 * s.hm)) / 1000;
export const sawLen = (st) => Math.round(((st.x1 - st.x0) * 3) / 10);

// ── The live/replayed craft ──
// off: [tap, hold] latency allowance in ticks (0..8); only holds use it.
export function newCraft(spec, off = [0, 0]) {
  return { spec, off, tick: 0, i: 0, phase: 'ready', s0: 0, next: READY, res: [], done: false, hm: 0, down: false, x: 0, y: 0, a: null };
}
function resolve(s, q) {
  const st = s.spec.steps[s.i];
  if (st.heat) s.hm = HEAT_MOD[q];
  s.res.push(q);
  s.i++;
  s.a = null;
  if (s.i >= s.spec.steps.length) {
    s.done = true;
    s.phase = 'done';
    return;
  }
  const nx = s.spec.steps[s.i];
  s.phase = 'gap';
  s.next = s.tick + (st.k === 'tap' && nx.k === 'tap' ? TAP_GAP : GAP) + (nx.k !== st.k ? SWITCH : 0);
}
function begin(s) {
  const st = s.spec.steps[s.i];
  s.phase = 'wait';
  s.s0 = s.tick;
  if (st.k === 'hold') s.a = { armed: !s.down, p: null };
  else if (st.k === 'saw') s.a = { strokes: 0, dir: 0, from: s.x, ext: s.x, dev: 0, nd: 0 };
  else if (st.k === 'carve') s.a = { len: pathLen(st.pts), prog: 0, started: false, dev: 0, nd: 0 };
  else if (st.k === 'stir') s.a = { q: null, quarters: 0, dev: 0, nd: 0 };
  else s.a = {};
}
// When the next thing happens on its own (a step starts, or one runs out of time).
function dueAt(s) {
  if (s.done) return Infinity;
  if (s.phase !== 'wait') return s.next;
  const st = s.spec.steps[s.i];
  if (st.k === 'hold') return s.a.p === null ? s.s0 + HOLD_IDLE : s.a.p + st.F; // held too long: overdone
  return s.s0 + st.T;
}
// Move time on to tick t. Things happen at their own tick, so moving on in
// one jump or many small ones comes out the same.
export function advance(s, t) {
  t = Math.min(t, CRAFT_MAX_TICKS);
  for (let due = dueAt(s); due <= t; due = dueAt(s)) {
    s.tick = Math.max(s.tick, due);
    if (s.phase === 'wait') resolve(s, 'M');
    else begin(s);
  }
  if (t > s.tick) s.tick = t;
  if (!s.done && s.tick >= CRAFT_MAX_TICKS) while (!s.done) resolve(s, 'M');
  return s;
}
// One input: [tick, 0 down | 1 move | 2 up, x, y]. Ticks never go backwards.
export function input(s, [t, e, x, y]) {
  advance(s, t);
  if (s.done) return s;
  if (e === 0) s.down = true;
  else if (e === 2) s.down = false;
  s.x = x;
  s.y = y;
  if (s.phase !== 'wait') return s;
  const st = s.spec.steps[s.i];
  const a = s.a;
  const w = s.spec.win;
  if (st.k === 'tap') {
    if (e !== 0 || t < s.s0 + IGNORE) return s;
    const r = tapRadius(s, st);
    const d = Math.sqrt((x - st.x) ** 2 + (y - st.y) ** 2);
    if (d > 2 * r) return s; // nowhere near it: not a swing
    const q = judgeD(d, r, w);
    resolve(s, (t - s.s0) * 5 > st.T * 3 ? worse[q] : q); // late: the metal's cooling
  } else if (st.k === 'hold') {
    if (a.p === null) {
      if (e === 2) a.armed = true;
      else if (e === 0 && a.armed && t >= s.s0 + IGNORE) a.p = t;
    } else if (e === 2) resolve(s, judgeT(Math.abs(t - s.off[1] - (a.p + st.at)), w));
  } else if (st.k === 'saw') {
    if (e === 0) Object.assign(a, { dir: 0, from: x, ext: x });
    if (e !== 2 && s.down) {
      a.dev += Math.min(Math.abs(y - st.y), 3 * st.tol);
      a.nd++;
    }
    const L = sawLen(st);
    if (e === 1 && s.down) {
      if (a.dir === 0) {
        if (Math.abs(x - a.from) > 25) Object.assign(a, { dir: x > a.from ? 1 : -1, ext: x });
      } else if ((x - a.ext) * a.dir >= 0) a.ext = x;
      else if ((a.ext - x) * a.dir > 25) {
        if ((a.ext - a.from) * a.dir >= L) a.strokes++;
        Object.assign(a, { from: a.ext, dir: -a.dir, ext: x });
      }
    } else if (e === 2) {
      if (a.dir && (a.ext - a.from) * a.dir >= L) a.strokes++;
      a.dir = 0;
    }
    if (a.strokes >= st.n) resolve(s, a.nd ? judgeD(a.dev / a.nd, st.tol, w) : 'M');
  } else if (st.k === 'carve') {
    if (!s.down && e !== 2) return s;
    const { d, along } = nearest(st.pts, x, y);
    if (!a.started) {
      if (along > 120 || d > 2 * st.tol) return s;
      a.started = true;
      a.prog = along;
    } else if (d <= 2 * st.tol && along > a.prog && along <= a.prog + 200) a.prog = along;
    a.dev += Math.min(d, 2 * st.tol);
    a.nd++;
    if (a.prog >= a.len - 30) resolve(s, judgeD(a.dev / a.nd, st.tol, w));
  } else if (st.k === 'stir') {
    if (e === 0) a.q = null;
    if (!s.down && e !== 2) return s;
    const dx = x - st.cx;
    const dy = y - st.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    a.dev += Math.min(Math.abs(dist - st.R), 2 * st.tol);
    a.nd++;
    if (dist * 100 >= st.R * 35) {
      const q = dx >= 0 ? (dy >= 0 ? 0 : 3) : dy >= 0 ? 1 : 2;
      if (a.q !== null) {
        const diff = (q - a.q + 4) % 4;
        if (diff === 1) a.quarters++;
        else if (diff === 3) a.quarters--;
      }
      a.q = q;
    }
    if (Math.abs(a.quarters) >= 4 * st.n) resolve(s, judgeD(a.dev / a.nd, st.tol, w));
  }
  return s;
}

// How far along the current step is, 0..1 (for drawing).
export function stepProgress(s) {
  const st = s.spec.steps[s.i];
  const a = s.a;
  if (!st || !a || s.phase !== 'wait') return 0;
  if (st.k === 'saw') return a.strokes / st.n;
  if (st.k === 'carve') return a.len ? a.prog / a.len : 0;
  if (st.k === 'stir') return Math.min(1, Math.abs(a.quarters) / (4 * st.n));
  return 0;
}

// Inputs travel packed flat: [dt, e, x, y, dt, e, x, y, …] (dt: ticks since
// the one before). unpack checks them and returns null if anything is off.
export function packInputs(list) {
  const out = [];
  let t = 0;
  for (const [tt, e, x, y] of list) {
    out.push(tt - t, e, x, y);
    t = tt;
  }
  return out;
}
export function unpackInputs(flat, end) {
  if (!Array.isArray(flat) || flat.length % 4 || flat.length > MAX_INPUTS * 4) return null;
  const out = [];
  let t = 0;
  for (let i = 0; i < flat.length; i += 4) {
    const [dt, e, x, y] = flat.slice(i, i + 4);
    if (![dt, e, x, y].every(Number.isInteger) || dt < 0 || e < 0 || e > 2 || x < -500 || x > 1500 || y < -500 || y > 1100) return null;
    t += dt;
    if (t > end) return null;
    out.push([t, e, x, y]);
  }
  return out;
}

// The server's replay of the client's recorded inputs.
export function replayCraft(spec, inputs, end, off = [0, 0]) {
  const s = newCraft(spec, off);
  const E = Math.min(CRAFT_MAX_TICKS, end);
  for (const ev of inputs) {
    if (ev[0] > E || s.done) break;
    input(s, ev);
  }
  return advance(s, E);
}
// Steps not reached count as misses (stopping early never helps).
export function finalizeCraft(s) {
  while (s.i < s.spec.steps.length) {
    s.res.push('M');
    s.i++;
  }
  s.done = true;
  return s;
}
export function scoreOf(s) {
  let a = 0;
  let b = 0;
  s.spec.steps.forEach((st, i) => {
    a += st.w * PTS[s.res[i] || 'M'];
    b += st.w;
  });
  return Math.round(a / b);
}
export const gradeOf = (v) => (v >= 92 ? 'S' : v >= 85 ? 'A' : v >= 70 ? 'B' : v >= 50 ? 'C' : 'D');
export const isFlawless = (s) => s.res.length > 0 && s.res.every((q) => q === 'P');

// What comes out. Never less than the plain recipe; refining and food get
// bonus yield, tools and gear can come out Fine or (rarely, server-rolled)
// Masterwork. rng is injected so tests are deterministic.
// E: the crafter's effects (shared/perks.js): bonusPlank/bonusBar/
// bonusConsumable (a chance of one more per unit) and masterworkPct.
export function outcomeOf({ r, batch, score, flawless, over, E = {} }, rng = Math.random) {
  const grade = gradeOf(score);
  const xpMult = XP_MULT[grade];
  if (isStackable(r)) {
    const base = r.qty * batch;
    const raw = base * GRADE_BONUS[grade];
    let bonus = Math.floor(raw) + (rng() < raw - Math.floor(raw) ? 1 : 0);
    const tag = ITEMS[r.out].tag;
    const extra = tag === 'plank' ? E.bonusPlank : tag === 'bar' ? E.bonusBar : ITEMS[r.out].cat === 'consumable' ? E.bonusConsumable : 0;
    if (extra) for (let i = 0; i < base; i++) if (rng() < extra) bonus++;
    return { grade, item: r.out, q: 0, base, bonus, qty: base + bonus, xpMult, mw: false };
  }
  let q = 0;
  // Kits, charms and set pieces come in one quality only.
  if (!QUALITY_BASES.includes(r.out)) return { grade, item: r.out, q, base: r.qty, bonus: 0, qty: r.qty, xpMult, mw: false, quality: QUALITY[0].label };
  if (grade === 'S' && rng() < Math.min(0.5, (0.15 + 0.01 * Math.max(0, Math.min(10, over))) * (flawless ? 2 : 1) + (E.masterworkPct || 0))) q = 2;
  else if (score >= 85) q = 1;
  return { grade, item: qualityId(r.out, q), q, base: r.qty, bonus: 0, qty: r.qty, xpMult, mw: q === 2, quality: QUALITY[q].label };
}
