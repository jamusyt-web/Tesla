// Hands-on crafting ("Forge It"): a deterministic minigame the server can
// replay. The server builds a step list (a "spec") for each craft; the client
// plays it and sends back only the ticks where the player pressed/released;
// the server replays those inputs through this exact code to get the score.
// Same anti-cheat pattern as fishing (shared/fishing.js). Integer ticks, 60 Hz.
import { ITEMS, qualityId, QUALITY } from './items.js';

export const CRAFT_TICK = 1000 / 60;
export const READY = 60; // 1 s to get ready
const GAP = 18; // pause between steps
const SWITCH = 12; // extra pause when the kind of step changes
const IGNORE = 8; // presses right after a step starts are ignored
const EARLY = 12; // a press this far before a strike window is a whiff (miss)
const PRESS_IDLE = 600; // a press step nobody starts within 10 s is a miss
export const CRAFT_MAX_TICKS = 3600;

const PTS = { P: 100, G: 75, W: 40, M: 0 };
const WIN = { 1: [4, 9, 15], 2: [4, 8, 14], 3: [3, 8, 13], 4: [3, 7, 12] }; // perfect / good / weak (± ticks)
const LEAD = { 1: 54, 2: 48, 3: 44, 4: 40 };
const SWEEP_H = { 1: 78, 2: 70, 3: 62, 4: 56 };
const PRESS_F = { 1: 96, 2: 88, 3: 80, 4: 72 };
const HEAT_MOD = { P: 1, G: 0, W: -1, M: -1 }; // a good heat makes the hammer windows kinder
export const GRADE_BONUS = { S: 0.2, A: 0.12, B: 0.05, C: 0, D: 0 };
export const XP_MULT = { S: 1.4, A: 1.2, B: 1.0, C: 0.9, D: 0.75 };

// Where each recipe is made. Stations stand in the Workshop yard.
export const STATIONS = {
  forge: { label: 'Forge', verb: 'Smelt', icon: '🔥' },
  anvil: { label: 'Anvil', verb: 'Forge', icon: '⚒️' },
  workbench: { label: 'Workbench', verb: 'Craft', icon: '🪚' },
  grindstone: { label: 'Grindstone', verb: 'Grind', icon: '⚙️' },
  cookpot: { label: 'Cookpot', verb: 'Cook', icon: '🍲' },
};

// What each step is called on screen, by its "skin".
export const STEP_TEXT = {
  bellows: 'Pump the bellows',
  pour: 'Pour the metal',
  mark: 'Mark the line',
  saw: 'Saw',
  scrape: 'Scrape the hide',
  grind: 'Grind',
  heat: 'Heat the bar',
  reheat: 'Reheat',
  hammer: 'Hammer',
  quench: 'Quench',
  rivet: 'Rivet',
  cut: 'Cut',
  stitch: 'Stitch',
  tighten: 'Tighten',
  fit: 'Fit',
  peg: 'Peg',
  string: 'String',
  facet: 'Cut a facet',
  set: 'Set the stone',
  crimp: 'Crimp',
  sear: 'Sear',
  flip: 'Flip',
  add: 'Add an ingredient',
  stir: 'Stir',
  simmer: 'Simmer',
  boil: 'Boil',
  distill: 'Distill',
};

const S = (k, skin, o = {}) => ({ k, skin, ...o });
const rep = (n, st) => Array.from({ length: n }, () => st);
const PATTERNS = {
  smelt: (t, x) => [S('press', 'bellows'), S('sweep', 'pour'), ...rep(x, S('sweep', 'pour'))],
  saw: (t, x) => [S('sweep', 'mark'), ...rep(3 + x, S('strike', 'saw', { tempo: 1.2 }))],
  scrape: (t, x) => rep(2 + x, S('press', 'scrape')),
  dress: (t, x) => rep(2 + x, S('press', 'grind')),
  forge_tool: (t) => forged(4 + t, t),
  forge_blade: (t) => forged(5 + t, t),
  forge_plate: () => [S('press', 'heat', { heat: 1 }), ...rep(4, S('strike', 'hammer')), S('press', 'reheat', { heat: 1 }), ...rep(4, S('strike', 'hammer')), ...rep(3, S('strike', 'rivet', { tempo: 1.2 })), S('sweep', 'quench', { w: 2 })],
  stitch: () => [S('sweep', 'cut'), ...rep(6, S('strike', 'stitch', { tempo: 1.15 })), S('press', 'tighten', { w: 2 })],
  assemble: () => [S('sweep', 'fit'), S('sweep', 'fit'), ...rep(4, S('strike', 'peg')), S('press', 'string', { w: 2 })],
  facet: () => [...rep(3, S('press', 'facet')), S('sweep', 'set', { w: 2 }), ...rep(3, S('strike', 'crimp'))],
  grill: (t, x) => [S('press', 'sear'), S('sweep', 'flip'), S('press', 'sear'), ...rep(x, S('sweep', 'flip'))],
  stew: (t, x) => [...rep(3, S('sweep', 'add')), ...rep(3 + x, S('strike', 'stir')), S('press', 'simmer', { w: 2 })],
  brew: (t, x) => [...rep(2, S('sweep', 'add')), ...rep(4 + x, S('strike', 'stir')), S('press', 'boil', { w: 2 })],
  elixir: (t, x) => [...rep(3, S('sweep', 'add')), ...rep(5 + x, S('strike', 'stir', { tempo: 1.15 })), S('press', 'distill', { w: 2 })],
};
// Heat, hammer (a reheat halfway for higher tiers), quench.
function forged(n, t) {
  const h = Math.ceil(n / 2);
  return [S('press', 'heat', { heat: 1 }), ...rep(t >= 3 ? h : n, S('strike', 'hammer')), ...(t >= 3 ? [S('press', 'reheat', { heat: 1 }), ...rep(n - h, S('strike', 'hammer'))] : []), S('sweep', 'quench', { w: 2 })];
}

export const recipeTier = (r) => (r.lvl <= 2 ? 1 : r.lvl <= 5 ? 2 : r.lvl <= 8 ? 3 : 4);
export const isStackable = (r) => ['material', 'consumable'].includes(ITEMS[r.out].cat);
// How many you can make in one sitting (grows with Crafting level).
export function batchCap(r, lvl) {
  const cat = ITEMS[r.out].cat;
  if (cat === 'material') return Math.min(25, 5 + 2 * (lvl - 1));
  if (cat === 'consumable') return Math.min(10, 3 + (lvl - 1));
  return 1;
}
// Bigger batches take a little more work.
export function extraSteps(r, batch) {
  const cat = ITEMS[r.out].cat;
  if (cat === 'material') return Math.min(2, Math.floor((batch - 1) / 8));
  if (cat === 'consumable') return Math.min(2, Math.floor((batch - 1) / 4));
  return 0;
}
// Timing windows; crafting well above a recipe's level makes them kinder.
export function windows(tier, over) {
  let [P, G, W] = WIN[tier];
  const b = over >= 15 ? 2 : over >= 5 ? 1 : 0;
  P = Math.min(6, P + b);
  G = Math.min(11, G + b);
  return { P, G, W };
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

// The step list for one craft (JSON; the server stores it and replays it as stored).
export function buildSpec(r, { lvl = 1, batch = 1, seed = 1, sid = '' } = {}) {
  const rng = mulberry32(seed);
  const tier = recipeTier(r);
  const win = windows(tier, lvl - r.lvl);
  const { W } = win;
  const steps = PATTERNS[r.pattern](tier, extraSteps(r, batch)).map((st) => {
    const base = { k: st.k, skin: st.skin, w: st.w || 1, ...(st.heat ? { heat: 1 } : {}) };
    if (st.k === 'strike') return { ...base, lead: Math.max(W + EARLY + IGNORE + 2, Math.round((LEAD[tier] / (st.tempo || 1)) * (0.9 + rng() * 0.2))) };
    if (st.k === 'sweep') {
      const H = Math.max(2 * W + 14, Math.round(SWEEP_H[tier] * (0.9 + rng() * 0.2)));
      const lo = W + 6;
      const hi = H - W - 6;
      return { ...base, H, c: lo + Math.floor(rng() * (hi - lo + 1)), n: 4 };
    }
    const F = PRESS_F[tier];
    const lo = Math.round(F * 0.55);
    const hi = F - W - 4;
    return { ...base, F, at: lo + Math.floor(rng() * (hi - lo + 1)) };
  });
  return { v: 1, sid, seed, recipe: r.id, batch, tier, win, steps };
}

const judge = (d, w) => (d <= w.P ? 'P' : d <= w.G ? 'G' : d <= w.W ? 'W' : 'M');
// A sweep's marker crosses the mark n times (back and forth).
export function crossings(st, s0) {
  const out = [];
  for (let j = 0; j < st.n; j++) out.push(s0 + j * st.H + (j % 2 === 0 ? st.c : st.H - st.c));
  return out;
}

// off: [tap, hold] latency offsets in ticks (0..8) — only shift the windows.
export function newCraft(spec, off = [0, 0]) {
  return { spec, off, tick: 0, held: false, i: 0, phase: 'ready', s0: 0, next: 0, T: 0, X: null, p: null, armed: false, res: [], done: false, hm: 0 };
}
function resolve(s, q) {
  const st = s.spec.steps[s.i];
  if (st.heat) s.hm = HEAT_MOD[q];
  s.res.push(q);
  s.i++;
  if (s.i >= s.spec.steps.length) {
    s.done = true;
    s.phase = 'done';
    return;
  }
  s.phase = 'gap';
  s.next = s.tick + GAP + (s.spec.steps[s.i].k !== s.spec.steps[s.i - 1].k ? SWITCH : 0);
}
function begin(s) {
  const st = s.spec.steps[s.i];
  s.phase = 'wait';
  s.s0 = s.tick;
  s.p = null;
  s.armed = !s.held;
  if (st.k === 'strike') s.T = s.s0 + st.lead;
  if (st.k === 'sweep') s.X = crossings(st, s.s0);
}
export function winFor(s, st) {
  const w = s.spec.win;
  if (st.k !== 'strike' || !s.hm) return w;
  const P = Math.max(2, w.P + s.hm);
  return { P, G: Math.max(P + 2, w.G + s.hm), W: w.W };
}
export function stepCraft(s, held) {
  if (s.done) return s;
  const down = held && !s.held;
  const up = !held && s.held;
  s.held = held;
  if (s.phase === 'ready' && s.tick >= READY) {
    s.i = 0;
    begin(s);
  } else if (s.phase === 'gap' && s.tick >= s.next) begin(s);
  if (s.phase === 'wait') {
    const st = s.spec.steps[s.i];
    const w = winFor(s, st);
    if (st.k === 'strike') {
      const e = s.tick - s.off[0];
      if (down && s.tick >= s.s0 + IGNORE && e >= s.T - w.W - EARLY) {
        if (e < s.T - w.W) resolve(s, 'M');
        else resolve(s, judge(Math.abs(e - s.T), w));
      } else if (e > s.T + w.W) resolve(s, 'M');
    } else if (st.k === 'sweep') {
      const e = s.tick - s.off[0];
      if (down && s.tick >= s.s0 + IGNORE) {
        let d = 1e9;
        for (const x of s.X) d = Math.min(d, Math.abs(e - x));
        resolve(s, judge(d, w));
      } else if (e > s.X[s.X.length - 1] + w.W) resolve(s, 'M');
    } else {
      if (!held) s.armed = true;
      if (s.p === null) {
        if (down && s.armed && s.tick >= s.s0 + IGNORE) s.p = s.tick;
        else if (s.tick > s.s0 + PRESS_IDLE) resolve(s, 'M');
      } else {
        const e = s.tick - s.off[1];
        if (up) resolve(s, judge(Math.abs(e - (s.p + st.at)), w));
        else if (s.tick >= s.p + st.F) resolve(s, 'M'); // held too long: overheated
      }
    }
  }
  s.tick++;
  if (!s.done && s.tick >= CRAFT_MAX_TICKS) while (!s.done) resolve(s, 'M');
  return s;
}

// The server's replay of the client's recorded press/release ticks.
export function replayCraft(spec, toggles, end, off = [0, 0]) {
  const s = newCraft(spec, off);
  let held = false;
  let k = 0;
  const E = Math.min(CRAFT_MAX_TICKS, end);
  while (!s.done && s.tick < E) {
    while (k < toggles.length && toggles[k] <= s.tick) {
      held = !held;
      k++;
    }
    stepCraft(s, held);
  }
  return s;
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
export function outcomeOf({ r, batch, score, flawless, over }, rng = Math.random) {
  const grade = gradeOf(score);
  const xpMult = XP_MULT[grade];
  if (isStackable(r)) {
    const base = r.qty * batch;
    const raw = base * GRADE_BONUS[grade];
    const bonus = Math.floor(raw) + (rng() < raw - Math.floor(raw) ? 1 : 0);
    return { grade, item: r.out, q: 0, base, bonus, qty: base + bonus, xpMult, mw: false };
  }
  let q = 0;
  if (grade === 'S' && rng() < Math.min(0.5, (0.15 + 0.01 * Math.max(0, Math.min(10, over))) * (flawless ? 2 : 1))) q = 2;
  else if (score >= 85) q = 1;
  return { grade, item: qualityId(r.out, q), q, base: r.qty, bonus: 0, qty: r.qty, xpMult, mw: q === 2, quality: QUALITY[q].label };
}
