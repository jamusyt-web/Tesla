import { newCraft, advance, input, sawLen, pathLen, pointAt, CRAFT_MAX_TICKS } from '../../shared/crafting.js';

// A scripted player. sd: how shaky the hand is (stage units; hold timing is
// off by about sd/12 ticks). Returns the live craft and the inputs it
// recorded, exactly like the real client does.
export function bot(spec, sd, seed = 1, lat = 2) {
  let gs = seed;
  const gr = () => (gs = (gs * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = () => {
    let u = 0;
    while (!u) u = gr();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * gr());
  };
  const s = newCraft(spec, [lat, lat]);
  const inputs = [];
  const R = Math.round;
  const send = (ev) => (inputs.push(ev), input(s, ev));
  while (!s.done && s.tick < CRAFT_MAX_TICKS) {
    if (s.phase !== 'wait') {
      advance(s, s.next);
      continue;
    }
    const i = s.i;
    const st = spec.steps[i];
    let t = s.s0 + 14 + Math.floor(gr() * 8);
    const go = (e, x, y, dt = 2) => {
      // (A finger always comes back up, even after the step is done.)
      if ((s.i === i || (e === 2 && s.down)) && !s.done) send([(t += dt), e, R(x), R(y)]);
    };
    if (st.k === 'tap') {
      const x = st.x + gauss() * sd;
      const y = st.y + gauss() * sd;
      go(0, x, y, 0);
      go(2, x, y, 4);
    } else if (st.k === 'hold') {
      go(0, 500, 300, 0);
      go(2, 500, 300, st.at + R((gauss() * sd) / 12) + lat);
    } else if (st.k === 'saw') {
      const L = sawLen(st);
      const a = 500 - L / 2 - 60;
      const b = 500 + L / 2 + 60;
      go(0, a, st.y + gauss() * sd * 0.5, 0);
      for (let k = 0; k <= st.n && s.i === i; k++) {
        const [from, to] = k % 2 ? [b, a] : [a, b];
        for (let f = 1; f <= 12; f++) go(1, from + ((to - from) * f) / 12, st.y + gauss() * sd * 0.5);
      }
      go(2, a, st.y);
    } else if (st.k === 'carve') {
      const len = pathLen(st.pts);
      const [x0, y0] = st.pts[0];
      go(0, x0 + gauss() * sd * 0.3, y0 + gauss() * sd * 0.5, 0);
      for (let d = 20; d <= len + 20 && s.i === i; d += 20) {
        const [x, y] = pointAt(st.pts, d);
        go(1, x, y + gauss() * sd * 0.5);
      }
      const [x1, y1] = st.pts[st.pts.length - 1];
      go(2, x1, y1);
    } else if (st.k === 'stir') {
      go(0, st.cx + st.R, st.cy, 0);
      for (let k = 1; k <= 16 * st.n + 4 && s.i === i; k++) {
        const ang = (k / 16) * 2 * Math.PI;
        const r = st.R + gauss() * sd * 0.5;
        go(1, st.cx + Math.cos(ang) * r, st.cy + Math.sin(ang) * r, 3);
      }
      go(2, st.cx + st.R, st.cy);
    }
    // Still not done (a tap far off, say): wait for it to run out.
    if (s.i === i && !s.done) advance(s, st.k !== 'hold' ? s.s0 + st.T : s.a.p !== null ? s.a.p + st.F : s.s0 + 600);
  }
  return { s, inputs, end: s.tick };
}
