// How the game runs on this device, reported every 60 s (SPEC §9.4): frames
// per second (median and the worst 5%), draw calls and triangles (95th
// percentile) and how long loading took, tagged with the region you're in and
// a device class (the graphics chip's name, hashed, plus phone or not). The
// owner sees the summary in the Town Hall (owner.perf).
import { regionAt } from '../../../shared/places.js';

const EVERY = 60_000;
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
function deviceClass(renderer, low) {
  let name = 'unknown';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || name;
  } catch {}
  let h = 7;
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `${(h >>> 0).toString(16)}-${low ? 'low' : 'high'}`;
}

export class PerfBeacon {
  constructor(g) {
    this.g = g;
    this.device = deviceClass(g.renderer, g.low);
    this.loadMs = null;
    this.reset(performance.now());
  }
  reset(now) {
    this.dts = [];
    this.draws = [];
    this.tris = [];
    this.last = now;
    this.next = now + EVERY;
  }
  // After each frame is drawn (renderer.info holds the whole frame's counts).
  frame() {
    const now = performance.now();
    this.loadMs ??= Math.round(now);
    const dt = now - this.last;
    this.last = now;
    if (document.hidden || dt > 1000) return; // a hidden tab or a stall is not a frame rate
    const r = this.g.renderer.info.render;
    this.dts.push(dt);
    this.draws.push(r.calls);
    this.tris.push(r.triangles);
    if (now < this.next) return;
    const me = this.g.me?.local;
    const sample = {
      device: this.device,
      region: this.g.dungeon ? 'dungeon' : (me && regionAt(me.x, me.z)?.id) || 'wild',
      fps50: Math.round(1000 / pct(this.dts, 0.5)),
      fps5: Math.round(1000 / pct(this.dts, 0.95)),
      draws95: pct(this.draws, 0.95),
      tris95: pct(this.tris, 0.95),
      loadMs: this.loadMs,
    };
    this.reset(now);
    this.g.sock.rpc('perf.sample', sample).catch(() => {});
  }
}
