// Phones report how the game runs on them (client/src/util/perfbeacon.js),
// at most once a minute each; the server owner sees the summary.
import { register } from './rpc.js';
import { fail } from './db.js';
import { perfSample, perfReport } from './telemetry.js';

const EVERY_MS = 60_000;
const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
const label = (v) => String(v ?? '').replace(/[^\w:.-]/g, '').slice(0, 40) || 'unknown';

register(
  'perf.sample',
  (g, c, a) => {
    const now = Date.now();
    if (now - (c.lastPerf ?? 0) < EVERY_MS - 2000) fail('Too soon.');
    c.lastPerf = now;
    perfSample(g.db, { device: label(a.device), region: label(a.region), fps50: num(a.fps50, 0, 240), fps5: num(a.fps5, 0, 240), draws95: num(a.draws95, 0, 1e5), tris95: num(a.tris95, 0, 1e8), loadMs: num(a.loadMs, 0, 6e5) }, now);
    return {};
  },
  { inRun: true },
);

register('owner.perf', (g, c, a) => {
  if (!g.auth.isAdmin(c.hero.id)) fail('Only server owners can do that.');
  return { rows: perfReport(g.db, num(a.days, 1, 60) ?? 7) };
});
