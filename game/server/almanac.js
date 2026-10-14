// The Almanac on the server (SPEC §5.4): makes each hero's three dailies
// (make, venture, wander) from what they can already do, and the weekly
// Grand Errand. They run as quests (server/quests.js), so the usual events
// move them on and the usual rewards pay. Everything banks: up to 6 dailies
// open, the weekly for two weeks; a new day only fills free places.
import { NODE_TYPES } from '../shared/nodes.js';
import { RECIPES } from '../shared/recipes.js';
import { MONSTERS } from '../shared/monsters.js';
import { NODES, SPAWNS, ENTRANCES, LAKES, LANDMARKS, REGIONS, stoneById, mulberry32 } from '../shared/world.js';
import { stationsOf } from '../shared/stations.js';
import { isStackable } from '../shared/crafting.js';
import { levelFromXp } from '../shared/skills.js';
import { dayIndex, weekIndex } from '../shared/dungeon.js';
import { townAt } from '../shared/places.js';
import { hash32, ordersOf } from '../shared/orders.js';
import { COLUMNS, MAX_OPEN, MAX_WEEKLY, dailyId, errandId, skillFor, todayStrip } from '../shared/almanac.js';
import { questDef } from '../shared/quests.js';
import { fail } from './db.js';
import { register } from './rpc.js';

const lvl = (hero, s) => levelFromXp(hero.skills?.[s] || 0);
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// What a hero can do today, as daily ideas per column: [{ ev, k, v, n }].
export function ideas(hero) {
  const types = new Set(NODES.map((n) => n.type));
  const make = [];
  for (const t of types) {
    const nt = NODE_TYPES[t];
    if (!nt || nt.kind === 'fish' || !nt.drops?.[0] || lvl(hero, nt.skill) < nt.lvl) continue;
    make.push({ ev: 'gather', k: 'item', v: nt.drops[0].id, n: 10 + Math.round(6 / Math.max(1, nt.lvl / 3)) });
  }
  const craft = lvl(hero, 'crafting');
  for (const r of RECIPES) {
    if (r.lvl > craft || !isStackable(r) || r.town || !stationsOf(r.station).length) continue;
    make.push({ ev: 'craft', k: 'item', v: r.out, n: Math.max(2, Math.min(8, Math.round(60 / (r.xp || 6)))) });
  }
  const combat = lvl(hero, 'combat');
  const venture = [];
  for (const m of new Set(SPAWNS.map((s) => s.monster))) {
    const def = MONSTERS[m];
    if (!def || def.boss || (def.lvl ?? 1) > combat + 2 || (def.lvl ?? 1) < combat - 8) continue;
    venture.push({ ev: 'kill', k: 'monster', v: m, n: 3 + ((def.lvl ?? 1) < combat ? 2 : 0) });
  }
  if (combat >= 5) for (const e of ENTRANCES) venture.push({ ev: 'dungeon', k: 'kind', v: e.kind, n: 1 });
  if (!venture.length) venture.push({ ev: 'kill', k: '-', v: '', n: 3 });
  const wander = [];
  if (LAKES.length) wander.push({ ev: 'fish', k: '-', v: '', n: 4 });
  if (REGIONS.some((r) => ordersOf(r.id).length)) wander.push({ ev: 'order', k: '-', v: '', n: 1 });
  if (LANDMARKS.some((l) => l.kind === 'shrine')) wander.push({ ev: 'landmark', k: 'kind', v: 'shrine', n: 1 });
  wander.push({ ev: 'sell', k: '-', v: '', n: 5 });
  if (!make.length) make.push({ ev: 'gather', k: '-', v: '', n: 5 });
  return { make, venture, wander };
}

// The hero's best town tier (from the waystones they've touched) and its towns.
export function homeTowns(hero) {
  const towns = new Map();
  for (const id of hero.stones ?? []) {
    const st = stoneById(id);
    const t = st && townAt(st.x, st.z);
    if (t) towns.set(t.id, t.tier ?? 1);
  }
  if (!towns.size) towns.set(hero.home ?? 'hearthvale', 1);
  return { tier: Math.max(...towns.values()), towns: [...towns.keys()] };
}

// A material from the hero's best place: one of the raw goods the map grows.
const materials = () => [...new Set(NODES.map((n) => NODE_TYPES[n.type]?.drops?.[0]?.id).filter(Boolean))];

export class Almanac {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      meta: p('SELECT rerolled_day FROM almanac_meta WHERE account_id = ?'),
      rerolled: p('INSERT INTO almanac_meta (account_id, rerolled_day) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET rerolled_day = excluded.rerolled_day'),
      made: p("SELECT COUNT(*) AS n FROM quest_progress WHERE account_id = ? AND period = ? AND quest LIKE ?"),
      today: p("SELECT quest, period, step, n, state FROM quest_progress WHERE account_id = ? AND ((quest LIKE 'alm:%' AND period = ?) OR (quest LIKE 'err:%' AND period = ?))"),
    };
  }

  // Make today's dailies (into free places only) and this week's errand.
  ensure(c, now = Date.now()) {
    const Q = this.game.quests;
    if (!c.quests) Q.load(c);
    const day = dayIndex(now);
    const open = (prefix) => [...c.quests.values()].filter((r) => r.quest.startsWith(prefix));
    if (this.q.made.get(c.hero.id, day, 'alm:%').n === 0) {
      const room = Math.max(0, MAX_OPEN - open('alm:').length);
      const { tier } = homeTowns(c.hero);
      const I = ideas(c.hero);
      const mats = materials();
      for (const col of COLUMNS.slice(0, room)) Q.start(c, this.#make(c.hero, day, col, I, tier, mats, 0), day, now);
    }
    const week = weekIndex(now);
    if (this.q.made.get(c.hero.id, week, 'err:%').n === 0 && open('err:').length < MAX_WEEKLY) Q.start(c, this.#errand(c.hero, week), week, now);
  }

  #make(hero, day, col, I, tier, mats, salt) {
    const rng = mulberry32(hash32(`${hero.id}:${day}:${col}:${salt}`));
    const idea = pick(rng, I[col]);
    const skill = skillFor(idea.ev, idea.v) ?? lowestSkill(hero);
    const mat = mats.length ? pick(rng, mats) : '-';
    return dailyId(col, idea.ev, idea.k, idea.v, idea.n, tier, skill, mat, salt);
  }
  #errand(hero, week) {
    const rng = mulberry32(hash32(`${hero.id}:week:${week}`));
    const I = ideas(hero);
    const { tier, towns } = homeTowns(hero);
    const big = (x) => ({ ...x, n: x.ev === 'dungeon' || x.ev === 'landmark' ? x.n : x.ev === 'order' ? 3 : x.n * 3 });
    const steps = [pick(rng, I.make), pick(rng, I.venture), pick(rng, I.make), pick(rng, I.venture), pick(rng, I.wander)].map(big);
    return errandId(tier, towns, steps);
  }

  // The Almanac page: open dailies (and today's finished ones), the weekly, Today.
  get(c, now = Date.now()) {
    this.ensure(c, now);
    const day = dayIndex(now);
    const week = weekIndex(now);
    const seen = new Set();
    const rows = [];
    for (const r of [...c.quests.values(), ...this.q.today.all(c.hero.id, day, week)]) {
      const k = `${r.quest}|${r.period}`;
      if (seen.has(k) || !(r.quest.startsWith('alm:') || r.quest.startsWith('err:')) || r.state === 'rerolled' || r.state === 'dropped') continue;
      seen.add(k);
      rows.push({ id: r.quest, period: r.period, step: r.step, n: r.n, done: r.state === 'done' });
    }
    return {
      dailies: rows.filter((r) => r.id.startsWith('alm:')),
      weekly: rows.filter((r) => r.id.startsWith('err:')),
      rerollLeft: (this.q.meta.get(c.hero.id)?.rerolled_day ?? -1) !== day,
      today: todayStrip(now),
      day,
    };
  }

  // Swap one open daily for another of the same column, once a day.
  reroll(c, id, period, now = Date.now()) {
    const day = dayIndex(now);
    if ((this.q.meta.get(c.hero.id)?.rerolled_day ?? -1) === day) fail('You have used today’s reroll.');
    const row = c.quests?.get(`${id}|${Number(period)}`);
    const def = row && id.startsWith('alm:') ? questDef(id) : null;
    if (!def) fail('That daily is not open.');
    const { tier } = homeTowns(c.hero);
    const I = ideas(c.hero);
    let fresh = null;
    for (let salt = 1; salt < 12 && !fresh; salt++) {
      const nid = this.#make(c.hero, day, def.col, I, tier, materials(), salt + Number(id.split(':').pop()));
      if (nid.split(':').slice(0, 5).join(':') !== id.split(':').slice(0, 5).join(':') || I[def.col].length < 2) fresh = nid;
    }
    if (!fresh) fail('There is no other daily like it today.');
    this.game.quests.drop(c, id, Number(period), 'rerolled');
    this.q.rerolled.run(c.hero.id, day);
    this.game.quests.start(c, fresh, day, now);
    return this.get(c, now);
  }
}

// The skill the hero has least of (a wander daily's xp goes there).
function lowestSkill(hero) {
  let best = 'foraging';
  for (const s of ['foraging', 'mining', 'herbalism', 'fishing', 'combat', 'crafting']) if ((hero.skills?.[s] || 0) < (hero.skills?.[best] || 0)) best = s;
  return best;
}

register('almanac.get', (g, c) => g.almanac.get(c), { inRun: true });
register('almanac.reroll', (g, c, a) => g.almanac.reroll(c, String(a.id ?? ''), a.period), { inRun: true });
