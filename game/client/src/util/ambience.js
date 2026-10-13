// Each biome's background music (SPEC §2.2): a soft, endlessly varying tune
// in the biome's instrument, scale and tempo, with an outdoor sound under it
// (a river, wind, crows, chimes). Synthesized, so nothing to download. The
// meadow and the Wilds have none (today's sounds only).
//
// ambience.set(name) switches to a preset (or null for silence), fading.
import { sfx } from './sfx.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  drone: [0, 7],
};
// inst: the oscillator and how a note fades; extra: what plays underneath.
export const PRESETS = {
  autumn: { inst: 'lute', root: 'D', scale: 'pentatonic', bpm: 84, extra: 'river' },
  alpine: { inst: 'celesta', root: 'A', scale: 'minor', bpm: 70, extra: 'wind' },
  heath: { inst: 'drone', root: 'D', scale: 'drone', bpm: 50, extra: 'crows' },
  desert: { inst: 'oud', root: 'E', scale: 'phrygianDominant', bpm: 92, extra: null },
  crystal: { inst: 'glass', root: 'F', scale: 'lydian', bpm: 66, extra: 'chimes' },
};
const INST = {
  lute: { type: 'triangle', decay: 0.9, vol: 0.05 },
  celesta: { type: 'sine', decay: 1.6, vol: 0.05 },
  drone: { type: 'sawtooth', decay: 6, vol: 0.012 },
  oud: { type: 'triangle', decay: 0.7, vol: 0.05 },
  glass: { type: 'sine', decay: 2.4, vol: 0.04 },
};

let cur = null; // { name, gain, timer, extraSrc }

function stop(fade = 1.5) {
  if (!cur) return;
  const { gain, timer, extraSrc, ctx } = cur;
  clearInterval(timer);
  gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
  setTimeout(() => (extraSrc?.stop(), gain.disconnect()), fade * 1000 + 200);
  cur = null;
}

function note(ctx, out, p, beat) {
  const inst = INST[p.inst];
  const scale = SCALES[p.scale];
  const step = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
  const midi = 57 + NOTE[p.root] + step; // around A3–A4
  const t = ctx.currentTime + Math.random() * beat * 0.1;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = inst.type;
  o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(inst.vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + inst.decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + inst.decay + 0.05);
}

// A looping filtered noise for the outdoor sound.
function bed(ctx, out, kind) {
  if (!kind || kind === 'crows' || kind === 'chimes') return null;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = kind === 'river' ? 'bandpass' : 'lowpass';
  f.frequency.value = kind === 'river' ? 900 : 400;
  const g = ctx.createGain();
  g.gain.value = 0.02;
  s.connect(f).connect(g).connect(out);
  s.start();
  return s;
}

export const ambience = {
  get name() {
    return cur?.name ?? null;
  },
  set(name) {
    if ((cur?.name ?? null) === (name ?? null)) return;
    stop();
    const p = name && PRESETS[name];
    const o = p && sfx.output();
    if (!o) return;
    const { ctx, out } = o;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
    gain.connect(out);
    const beat = 60 / p.bpm;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (Math.random() < (p.inst === 'drone' ? 0.15 : 0.55)) note(ctx, gain, p, beat);
      if (p.extra === 'crows' && Math.random() < 0.02) note(ctx, gain, { ...p, inst: 'oud', root: 'C' }, beat);
      if (p.extra === 'chimes' && Math.random() < 0.08) note(ctx, gain, { ...p, inst: 'glass' }, beat);
    }, beat * 1000);
    cur = { name, gain, timer, ctx, extraSrc: bed(ctx, gain, p.extra) };
  },
};
