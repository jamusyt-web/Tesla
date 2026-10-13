// Engagement telemetry (SPEC §5.8): per hero per day, minutes played,
// sessions, dead air (time in the world with no move, no open panel and no
// context action; measured by the client) and Compass goals shown, taken
// and done; and per Compass source per day. The target: dead air under 5%.
import { today } from './telemetry.js';
import { register } from './rpc.js';

const SRC = /^[a-z]{2,16}$/;
const clampN = (v, hi) => (Number.isFinite(+v) ? Math.max(0, Math.min(hi, Math.round(+v))) : 0);

export class Engage {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      day: p(`INSERT INTO engage_day (day, account_id, minutes, sessions, dead_air_s, goals_shown, goals_taken, goals_done) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(day, account_id) DO UPDATE SET minutes = minutes + excluded.minutes, sessions = sessions + excluded.sessions, dead_air_s = dead_air_s + excluded.dead_air_s,
        goals_shown = goals_shown + excluded.goals_shown, goals_taken = goals_taken + excluded.goals_taken, goals_done = goals_done + excluded.goals_done`),
      src: p(`INSERT INTO goal_log (day, src, shown, taken, done) VALUES (?,?,?,?,?)
        ON CONFLICT(day, src) DO UPDATE SET shown = shown + excluded.shown, taken = taken + excluded.taken, done = done + excluded.done`),
    };
  }

  onConnect(c, now = Date.now()) {
    c.engage = { at: now, secs: 0 };
    this.q.day.run(today(now), c.hero.id, 0, 1, 0, 0, 0, 0);
  }
  // Time played since the last count, in whole minutes (the rest carries over).
  #minutes(c, now) {
    const e = (c.engage ??= { at: now, secs: 0 });
    e.secs += Math.max(0, Math.min(120, (now - e.at) / 1000));
    e.at = now;
    const m = Math.floor(e.secs / 60);
    e.secs -= m * 60;
    return m;
  }
  onDisconnect(c, now = Date.now()) {
    const m = this.#minutes(c, now);
    if (m) this.q.day.run(today(now), c.hero.id, m, 0, 0, 0, 0, 0);
  }

  // The client's minute: { shown: { src: n }, taken, done, dead: seconds }.
  log(c, a, now = Date.now()) {
    const day = today(now);
    const sum = { shown: 0, taken: 0, done: 0 };
    const bySrc = new Map();
    for (const k of ['shown', 'taken', 'done'])
      for (const [src, n] of Object.entries(a?.[k] ?? {}).slice(0, 20)) {
        if (!SRC.test(src)) continue;
        const v = clampN(n, 200);
        sum[k] += v;
        if (!bySrc.has(src)) bySrc.set(src, { shown: 0, taken: 0, done: 0 });
        bySrc.get(src)[k] += v;
      }
    const m = this.#minutes(c, now);
    const dead = clampN(a?.dead, 90);
    this.q.day.run(day, c.hero.id, m, 0, dead, sum.shown, sum.taken, sum.done);
    for (const [src, v] of bySrc) this.q.src.run(day, src, v.shown, v.taken, v.done);
    return {};
  }
}

// The owner's Engagement tab: per day, and the Compass take-rate by source.
export function engageReport(db, days = 7, now = Date.now()) {
  const from = today(now) - days + 1;
  const daysRows = db
    .prepare(`SELECT day, COUNT(*) AS players, SUM(minutes) AS minutes, SUM(sessions) AS sessions, SUM(dead_air_s) AS dead, SUM(goals_shown) AS shown, SUM(goals_taken) AS taken, SUM(goals_done) AS done FROM engage_day WHERE day >= ? GROUP BY day ORDER BY day DESC`)
    .all(from)
    .map((r) => ({ ...r, deadPct: r.minutes ? Math.round((1000 * r.dead) / (r.minutes * 60)) / 10 : 0 }));
  const sources = db
    .prepare('SELECT src, SUM(shown) AS shown, SUM(taken) AS taken, SUM(done) AS done FROM goal_log WHERE day >= ? GROUP BY src ORDER BY shown DESC')
    .all(from)
    .map((r) => ({ ...r, takeRate: r.shown ? Math.round((1000 * r.taken) / r.shown) / 10 : 0 }));
  const minutes = daysRows.reduce((a, r) => a + r.minutes, 0);
  const dead = daysRows.reduce((a, r) => a + r.dead, 0);
  return { days: daysRows, sources, deadPct: minutes ? Math.round((1000 * dead) / (minutes * 60)) / 10 : 0, target: 5 };
}

register('goals.log', (g, c, a) => g.engage.log(c, a), { inRun: true });
