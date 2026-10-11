import { newCraft, stepCraft, CRAFT_MAX_TICKS } from '../../shared/crafting.js';

// A scripted player: aims at each window with Gaussian timing error (sdMs).
export function bot(spec, sdMs, seed = 1, lat = 2) {
  let gs = seed;
  const gr = () => ((gs = (gs * 1103515245 + 12345) % 2147483648) / 2147483648);
  const gauss = () => {
    let u = 0;
    while (!u) u = gr();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * gr());
  };
  const s = newCraft(spec, [lat, lat]);
  const tog = [];
  let held = false;
  let plan = null;
  let planned = -1;
  while (!s.done && s.tick < CRAFT_MAX_TICKS) {
    if (s.phase === 'wait' && planned !== s.i) {
      planned = s.i;
      const st = spec.steps[s.i];
      const err = () => Math.round((gauss() * sdMs) / 16.667) + lat;
      if (st.k === 'strike') {
        const t = s.T + err();
        plan = (x) => x >= t && x < t + 6;
      } else if (st.k === 'sweep') {
        const tgt = s.X.find((x) => x >= s.s0 + 30) ?? s.X[0];
        const t = tgt + err();
        plan = (x) => x >= t && x < t + 6;
      } else {
        const ps = s.s0 + 15 + Math.floor(gr() * 15);
        const rel = ps + st.at + err();
        plan = (x) => x >= ps && x < rel;
      }
    }
    if (s.phase !== 'wait') plan = null;
    const h = plan ? plan(s.tick) : held;
    if (h !== held) {
      tog.push(s.tick);
      held = h;
    }
    stepCraft(s, held);
  }
  return { s, tog };
}
