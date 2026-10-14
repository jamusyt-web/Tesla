// Synthesized sound effects (no asset downloads). Kept tiny and punchy.
let ctx = null;
let master = null;
let muted = false;
try {
  muted = localStorage.getItem('hv_muted') === '1';
} catch {}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.5, slide = 0, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.4, freq = 1200, q = 1, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

export const sfx = {
  unlock: () => ac(),
  // The audio graph, for the ambience: { ctx, out } or null when muted.
  output: () => (muted || !ac() ? null : { ctx, out: master }),
  get muted() {
    return muted;
  },
  toggle() {
    muted = !muted;
    try {
      localStorage.setItem('hv_muted', muted ? '1' : '0');
    } catch {}
    return muted;
  },
  tap: () => tone(660, 0.06, { type: 'triangle', vol: 0.15 }),
  chop: (perfect) => {
    noise(0.12, { vol: 0.9, freq: 700, q: 2 });
    tone(140, 0.12, { type: 'square', vol: 0.18, slide: -60 });
    if (perfect) tone(1320, 0.18, { type: 'triangle', vol: 0.25, delay: 0.03 });
  },
  mine: (perfect) => {
    tone(1900, 0.08, { type: 'square', vol: 0.12 });
    noise(0.1, { vol: 0.7, freq: 2600, q: 4 });
    if (perfect) tone(2400, 0.2, { type: 'triangle', vol: 0.22, delay: 0.03 });
  },
  timber: () => {
    noise(0.5, { vol: 0.8, freq: 300, q: 0.7 });
    tone(110, 0.5, { type: 'sawtooth', vol: 0.12, slide: -60 });
  },
  crumble: () => noise(0.45, { vol: 0.9, freq: 900, q: 0.6 }),
  // Crafting: metal, wood, water and fire.
  clang: (q) => {
    tone(q === 'P' ? 1760 : 1320, 0.4, { type: 'triangle', vol: 0.22 });
    tone(q === 'P' ? 2640 : 1980, 0.3, { type: 'sine', vol: 0.12, delay: 0.005 });
    noise(0.06, { vol: 0.8, freq: 3000, q: 1.5 });
  },
  thud: () => {
    tone(110, 0.12, { type: 'square', vol: 0.16, slide: -40 });
    noise(0.08, { vol: 0.5, freq: 400, q: 1 });
  },
  knock: () => {
    tone(520, 0.06, { type: 'square', vol: 0.14 });
    noise(0.05, { vol: 0.6, freq: 900, q: 2 });
  },
  rasp: () => noise(0.16, { vol: 0.5, freq: 2200, q: 0.9 }),
  scrape: () => noise(0.07, { vol: 0.25, freq: 3200, q: 1.2 }),
  sizzle: () => noise(0.8, { vol: 0.45, freq: 5000, q: 0.4 }),
  whoosh: () => noise(0.45, { vol: 0.6, freq: 600, q: 0.5 }),
  plop: () => {
    tone(300, 0.14, { type: 'sine', vol: 0.3, slide: -180 });
    noise(0.12, { vol: 0.3, freq: 700, q: 1 });
  },
  pick: () => {
    tone(880, 0.07, { type: 'sine', vol: 0.25 });
    tone(1320, 0.1, { type: 'sine', vol: 0.2, delay: 0.06 });
  },
  coin: () => {
    tone(988, 0.08, { type: 'square', vol: 0.12 });
    tone(1318, 0.22, { type: 'square', vol: 0.12, delay: 0.08 });
  },
  loot: () => [523, 659, 784].forEach((f, i) => tone(f, 0.15, { type: 'triangle', vol: 0.2, delay: i * 0.06 })),
  rare: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.08 })),
  level: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, { type: 'square', vol: 0.1, delay: i * 0.1 })),
  splash: () => noise(0.35, { vol: 0.7, freq: 500, q: 0.5 }),
  bite: () => [880, 880].forEach((f, i) => tone(f, 0.08, { type: 'square', vol: 0.2, delay: i * 0.12 })),
  hit: () => {
    noise(0.12, { vol: 0.9, freq: 400, q: 1 });
    tone(220, 0.1, { type: 'square', vol: 0.15, slide: -120 });
  },
  crit: () => {
    noise(0.15, { vol: 1, freq: 600, q: 1 });
    tone(880, 0.25, { type: 'sawtooth', vol: 0.15, slide: 600 });
  },
  hurt: () => tone(300, 0.2, { type: 'sawtooth', vol: 0.15, slide: -200 }),
  heal: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.15, { type: 'sine', vol: 0.2, delay: i * 0.05 })),
  victory: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.1, delay: i * 0.11 })),
  defeat: () => [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.18 })),
  bell: () => {
    tone(1568, 0.5, { type: 'sine', vol: 0.25 });
    tone(2093, 0.4, { type: 'sine', vol: 0.12, delay: 0.02 });
  },
  pop: () => tone(520, 0.08, { type: 'sine', vol: 0.25, slide: 400 }),
  warp: () => [392, 587, 880].forEach((f, i) => tone(f, 0.4, { type: 'sine', vol: 0.16, slide: f, delay: i * 0.07 })),
  chat: () => tone(1046, 0.06, { type: 'sine', vol: 0.12 }),
};
