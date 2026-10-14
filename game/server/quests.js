// Quests on the server (SPEC §5.2): starts them, moves their steps on from
// game events (server/events.js) and pays the rewards. The client only ever
// shows what this sends ({ t: 'quest' }); it never decides a reward.
//
// Progress lives in quest_progress (account, quest, period): period is 0 for
// one-off quests, the day for dailies and the week for weeklies.
import { ITEMS } from '../shared/items.js';
import { QUESTS, questDef, stepGain, stepNeed, canStart, rewardText } from '../shared/quests.js';
import { townAt, regionAt, townName } from '../shared/places.js';
import { LANDMARKS } from '../shared/world.js';
import { tx, fail } from './db.js';
import { on, emit } from './events.js';
import { register } from './rpc.js';
import * as rep from './rep.js';

// The events a quest step can wait for.
// Quests some other quest opens after (`after: [id, step]`): moving one of
// them on a step can start another, so it checks straight away.
const opensChains = (id) => id === 'hv_intro' || Object.values(QUESTS).some((q) => q.after?.[0] === id);

export const QUEST_EVENTS = ['gather', 'fish', 'kill', 'craft', 'stock', 'sell', 'supply', 'trade', 'deliver', 'travel', 'attune', 'discover', 'landmark', 'dungeon', 'order', 'big', 'passage', 'use'];
const key = (id, period) => `${id}|${period}`;

export class Quests {
  constructor(game) {
    this.game = game;
    this.db = game.db;
    const p = (s) => this.db.prepare(s);
    this.q = {
      all: p('SELECT quest, period, step, n, state, started_at, done_at FROM quest_progress WHERE account_id = ?'),
      one: p('SELECT quest, period, step, n, state FROM quest_progress WHERE account_id = ? AND quest = ? AND period = ?'),
      insert: p("INSERT OR IGNORE INTO quest_progress (account_id, quest, period, step, n, state, started_at) VALUES (?,?,?,0,0,'active',?)"),
      save: p('UPDATE quest_progress SET step = ?, n = ? WHERE account_id = ? AND quest = ? AND period = ?'),
      done: p("UPDATE quest_progress SET state = 'done', step = ?, n = 0, done_at = ? WHERE account_id = ? AND quest = ? AND period = ?"),
      drop: p("UPDATE quest_progress SET state = ? WHERE account_id = ? AND quest = ? AND period = ? AND state = 'active'"),
      pins: p('SELECT pins FROM almanac_meta WHERE account_id = ?'),
      setPins: p("INSERT INTO almanac_meta (account_id, pins) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET pins = excluded.pins"),
    };
  }

  // Read a hero's quests into the client: active ones by id|period, and the
  // finished one-off quests.
  load(c) {
    c.quests = new Map();
    c.questsDone = new Set();
    for (const r of this.q.all.all(c.hero.id)) {
      if (r.state === 'active') c.quests.set(key(r.quest, r.period), r);
      else if (r.state === 'done' && r.period === 0) c.questsDone.add(r.quest);
    }
  }

  // On connect (and after a quest ends or a level goes up): start every
  // one-off quest the hero can start now. hv_intro has no requirements, so
  // every new hero gets it.
  ensure(c, now = Date.now()) {
    if (!c.quests) this.load(c);
    for (const row of [...c.quests.values()]) {
      const def = questDef(row.quest);
      if (def && c.quests.has(key(row.quest, row.period))) this.#catchUp(c, row, def, now);
    }
    const at = this.#stepsAt(c);
    for (const def of Object.values(QUESTS)) {
      if (def.repeat || c.questsDone.has(def.id) || c.quests.has(key(def.id, 0))) continue;
      if (canStart(def, c.hero, c.questsDone, at)) this.start(c, def.id, 0, now);
    }
  }
  #stepsAt(c) {
    const at = {};
    for (const r of c.quests.values()) if (r.period === 0) at[r.quest] = r.step;
    return at;
  }

  // Start a quest (or a generated one: an Almanac daily) for period.
  start(c, id, period = 0, now = Date.now()) {
    const def = questDef(id);
    if (!def) fail('No such quest.');
    if (!c.quests) this.load(c);
    if (c.quests.has(key(id, period))) return c.quests.get(key(id, period));
    if (this.q.one.get(c.hero.id, id, period)) return null; // done (or rerolled) already
    tx(this.db, () => {
      this.q.insert.run(c.hero.id, id, period, now);
      for (const [item, n] of Object.entries(def.give ?? {})) this.game.heroes.addItem(c.hero.id, item, n);
    });
    const row = { quest: id, period, step: 0, n: 0, state: 'active', started_at: now };
    c.quests.set(key(id, period), row);
    c.send({ t: 'quest', id, period, step: 0, n: 0, started: true });
    if (def.give) c.pushInventory();
    this.#catchUp(c, row, def, now);
    return row;
  }
  // (The Almanac's name for it.)
  startGenerated(c, id, period, now = Date.now()) {
    return this.start(c, id, period, now);
  }

  // Jump an active one-off quest ahead to `step` (no rewards for the steps skipped).
  skipTo(c, id, step) {
    if (!c.quests) this.load(c);
    const row = c.quests.get(key(id, 0));
    if (!row || row.step >= step) return;
    Object.assign(row, { step, n: 0 });
    this.q.save.run(step, 0, c.hero.id, id, 0);
    c.send({ t: 'quest', id, period: 0, step, n: 0 });
  }

  // Take a quest off the list without finishing it (a rerolled daily).
  drop(c, id, period, state = 'dropped') {
    this.q.drop.run(state, c.hero.id, id, period);
    c.quests?.delete(key(id, period));
    c.send({ t: 'quest', id, period, dropped: true });
  }

  // A game event: move on every active step it fits.
  onEvent(c, ev, d) {
    if (!c?.hero || !c.quests?.size) return;
    let ctx = null;
    for (const row of [...c.quests.values()]) {
      const def = questDef(row.quest);
      const step = def?.steps[row.step];
      if (!step || step.ev !== ev) continue;
      ctx ??= this.#where(c);
      const gain = stepGain(step, ev, d, ctx);
      if (gain > 0) this.#advance(c, row, def, gain);
    }
  }
  #where(c) {
    const p = c.ch?.isRun && c.townPos ? c.townPos : c.ent;
    return { town: townAt(p.x, p.z)?.id ?? null, region: regionAt(p.x, p.z)?.id ?? null };
  }

  #advance(c, row, def, gain, now = Date.now()) {
    const step = def.steps[row.step];
    row.n = Math.min(stepNeed(step), row.n + gain);
    if (row.n < stepNeed(step)) {
      this.q.save.run(row.step, row.n, c.hero.id, row.quest, row.period);
      c.send({ t: 'quest', id: row.quest, period: row.period, step: row.step, n: row.n });
      return;
    }
    // The step is done: its own reward, then the next step (or the end).
    const last = row.step >= def.steps.length - 1;
    const rewards = [step.reward, last ? def.reward : null].filter(Boolean);
    // A step can hand something over as it begins (the letter to carry).
    const give = last ? null : def.steps[row.step + 1].give;
    tx(this.db, () => {
      if (last) this.q.done.run(def.steps.length, now, c.hero.id, row.quest, row.period);
      else this.q.save.run(row.step + 1, 0, c.hero.id, row.quest, row.period);
      for (const r of rewards) this.grant(c, r, def);
      for (const [item, n] of Object.entries(give ?? {})) this.game.heroes.addItem(c.hero.id, item, n);
    });
    const doneStep = row.step;
    if (last) {
      c.quests.delete(key(row.quest, row.period));
      if (row.period === 0) c.questsDone.add(row.quest);
    } else Object.assign(row, { step: row.step + 1, n: 0 });
    const reward = rewards.length ? mergeRewards(rewards) : null;
    c.send({ t: 'quest', id: row.quest, period: row.period, step: last ? def.steps.length : row.step, n: 0, stepDone: doneStep, done: last, reward, text: reward ? rewardText(reward) : '' });
    c.pushInventory();
    emit(c, last ? 'questDone' : 'questStep', { id: row.quest, period: row.period, step: doneStep, repeat: def.repeat ?? null });
    if (!last) this.#catchUp(c, row, def, now);
    if (last || opensChains(def.id)) this.ensure(c, now); // the next chains open up
  }

  // A step about something that only happens once (attuning a stone,
  // finding places, a once-only landmark) the hero had already done before
  // the quest got there: it counts.
  #catchUp(c, row, def, now = Date.now()) {
    const step = def.steps[row.step];
    const have = Math.min(stepNeed(step), this.#already(c, step));
    if (have > row.n) this.#advance(c, row, def, have - row.n, now);
  }
  #already(c, step) {
    const m = step?.match ?? {};
    const keys = Object.keys(m);
    if (step?.ev === 'attune' && m.id) return c.hero.stones?.includes(m.id) ? stepNeed(step) : 0;
    if (step?.ev === 'discover' && !keys.length) return this.game.journal?.ids(c.hero.id, 'place').size ?? 0;
    if (step?.ev === 'discover' && m.id && keys.length === 1) return this.game.journal?.ids(c.hero.id, 'place').has(m.id) ? stepNeed(step) : 0;
    // A landmark already used that fits (by id, kind and region).
    if (step?.ev === 'landmark' && keys.length && keys.every((k) => ['id', 'kind', 'region'].includes(k))) {
      const used = this.db.prepare('SELECT landmark FROM landmark_uses WHERE account_id = ?').all(c.hero.id).map((r) => LANDMARKS.find((l) => l.id === r.landmark)).filter(Boolean);
      const fits = (l) => (!m.id || l.id === m.id) && (!m.kind || l.kind === m.kind) && (!m.region || regionAt(l.x, l.z)?.id === m.region);
      return used.some(fits) ? stepNeed(step) : 0;
    }
    return 0;
  }

  // Pay a reward (inside the caller's transaction). The server is the only
  // place a reward is ever decided.
  grant(c, r, def) {
    const H = this.game.heroes;
    const id = c.hero.id;
    if (r.gold && def.repeat) H.addGold(id, r.gold, 'daily');
    else if (r.gold) H.addGold(id, r.gold, 'quest');
    for (const [item, n] of Object.entries(r.items ?? {})) if (ITEMS[item]) H.addItem(id, item, n, 'quest');
    for (const [skill, n] of Object.entries(r.xp ?? {})) {
      c.send({ t: 'xp', xp: H.addXp(c.hero, skill, n) });
    }
    for (const [town, n] of Object.entries(r.rep ?? {})) {
      const up = rep.add(id, town, n);
      if (up?.up) c.send({ t: 'notice', kind: 'rep', text: `You are now a ${up.name} of ${townName(town)}!` });
    }
    if (r.title) this.game.journal?.unlockTitle?.(c, r.title);
  }

  // What the hero has on: { active: [{ id, period, step, n }], done: [ids], pins }.
  list(c) {
    if (!c.quests) this.load(c);
    return {
      active: [...c.quests.values()].map((r) => ({ id: r.quest, period: r.period, step: r.step, n: r.n })),
      done: [...c.questsDone],
      pins: this.pins(c.hero.id),
    };
  }
  pins(heroId) {
    try {
      return JSON.parse(this.q.pins.get(heroId)?.pins ?? '[]');
    } catch {
      return [];
    }
  }
  // Pin (or unpin) a quest, recipe or order for the Compass: at most 3.
  pin(c, id) {
    id = String(id ?? '').slice(0, 64);
    if (!id) fail('Pin what?');
    let pins = this.pins(c.hero.id);
    pins = pins.includes(id) ? pins.filter((p) => p !== id) : [id, ...pins].slice(0, 3);
    this.q.setPins.run(c.hero.id, JSON.stringify(pins));
    return { pins };
  }
}

const mergeRewards = (list) => {
  const out = {};
  for (const r of list)
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
      else if (v && typeof v === 'object') {
        out[k] ??= {};
        for (const [a, n] of Object.entries(v)) out[k][a] = (out[k][a] ?? 0) + n;
      } else out[k] = v;
    }
  return out;
};

// Every quest event moves the hero's quests on.
for (const ev of QUEST_EVENTS) on(ev, (c, d) => c?.game?.quests?.onEvent(c, ev, d));
// A new level can open a quest (one that needs Combat 12, say).
on('xp', (c, xp) => (xp.leveled || xp.heroLeveled) && c?.game?.quests?.ensure(c));

register('quest.list', (g, c) => g.quests.list(c), { inRun: true });
register('quest.pin', (g, c, a) => g.quests.pin(c, a.id), { inRun: true });
