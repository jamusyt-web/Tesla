// The Compass (SPEC §5.3): one engine behind the goal card, the context
// button's last rule, the result screens and the bots. Pure: it reads a
// snapshot of what the hero has on and returns goals, best first, and never
// an empty list. The card only points; the server decides everything.
//
// suggest(state, now) → [{ id, src, text, why, progress: [n, of] | null, target, score }]
// state: { hero: { skills, level, inv, equip, stones, pos: { x, z }, town, region },
//          quests: [{ id, period, step, n }], pins: [ids],
//          orders: [{ town, slot, kind, item, monster, qty, got, text }],
//          ready: [{ kind, town, text, target }],   (till, storage, orders to hand in)
//          journal: { found: Set, seen: Set, pages: [{ id, name, pct, places, found }] },
//          unexplored: { x, z } | null, unlocks: [{ skill, lvl, list, at }],
//          nodeStates: [{ id, type, st, x, z }], party: [{ name, x, z, place }],
//          records: { fish: kg }, nextTown: { id, name } | null,
//          locate(target) → { x, z } | null }   (the nearest place a target can be done)
import { ITEMS } from './items.js';
import { NODE_TYPES } from './nodes.js';
import { RECIPES } from './recipes.js';
import { MONSTERS } from './monsters.js';
import { STATIONS } from './crafting.js';
import { LANDMARKS } from './world.js';
import { levelFromXp } from './skills.js';
import { questDef, stepNeed } from './quests.js';

export const SCORE = { elite: 95, quest: 90, ready: 88, readyAway: 60, pinned: 85, sideQuest: 78, unlock: 75, ancient: 72, almanac: 70, weekly: 68, upgrade: 65, order: 62, rich: 58, journal: 55, landmark: 50, landmarkNew: 80, fallback: 10 };
// How much more a rich (1) or ancient (2) node asks of you (server/nodestates.js STATE_FX).
export const STATE_GATE = { 1: 8, 2: 16 };
export const SWITCH_BY = 15; // the card only switches for a rival this much better (or when its goal is done)
export const UNLOCK_MS = 30 * 60_000;

const lvl = (hero, s) => levelFromXp(hero.skills?.[s] || 0);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const have = (hero, id) => hero.inv?.[id] ?? 0;
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
// "40 m NW"
export function bearing(from, to) {
  const d = dist(from, to);
  if (!Number.isFinite(d)) return '';
  if (d < 12) return 'right here';
  const a = Math.atan2(to.x - from.x, -(to.z - from.z)); // north is −z
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${Math.round(d / 5) * 5} m ${dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8]}`;
}

// ── Where a raw good comes from, for this hero ──
export function sourceOf(hero, item) {
  for (const [type, n] of Object.entries(NODE_TYPES)) if (n.drops?.[0]?.id === item && n.kind !== 'fish' && lvl(hero, n.skill) >= n.lvl) return { verb: { tree: 'chop', rock: 'mine', herb: 'pick' }[n.kind] ?? 'gather', name: n.name, target: { kind: 'node', type } };
  for (const [type, n] of Object.entries(NODE_TYPES)) if (n.drops?.[0]?.id === item && n.kind !== 'fish') return { verb: 'gather', name: n.name, need: `${cap(n.skill)} ${n.lvl}`, target: { kind: 'node', type } };
  const hunts = Object.entries(MONSTERS).filter(([, def]) => !def.boss && (def.drops ?? []).some((d) => d.id === item)).sort((a, b) => (a[1].lvl ?? 1) - (b[1].lvl ?? 1));
  const ok = hunts.find(([, def]) => (def.lvl ?? 1) <= lvl(hero, 'combat') + 2);
  if (ok) return { verb: 'hunt', name: ok[1].name, target: { kind: 'monster', type: ok[0] } };
  if (hunts.length) return { verb: 'hunt', name: hunts[0][1].name, need: `Combat ${hunts[0][1].lvl ?? 1}, or buy them`, target: { kind: 'monster', type: hunts[0][0] } };
  return { verb: 'buy', name: 'the Market', target: { kind: 'building', action: 'market' } };
}

// ── The next upgrade: per slot, the best recipe you could make soon that
// beats what you wear, and the first thing standing in the way. ──
const SLOTS = ['axe', 'pick', 'rod', 'weapon', 'armor', 'trinket'];
const slotOf = (it) => it?.tool ?? it?.slot ?? null;
const power = (id) => {
  const it = ITEMS[id];
  if (!it) return 0;
  if (it.tool) return (it.power ?? 1) * 10 + (it.tier ?? 1);
  return (it.atk ?? 0) + (it.def ?? 0) * 1.2 + (it.hp ?? 0) / 8 + (it.value ?? 0) / 1000;
};
const reqMet = (hero, it) => !it?.req || Object.entries(it.req).every(([s, n]) => (s === 'hero' ? hero.level >= n : lvl(hero, s) >= n));

export function nextUpgrades(hero) {
  const craft = lvl(hero, 'crafting');
  const out = [];
  for (const slot of SLOTS) {
    const worn = hero.equip?.[slot];
    let best = null;
    for (const r of RECIPES) {
      const it = ITEMS[r.out];
      if (slotOf(it) !== slot || r.lvl > craft + 3 || r.town || !reqMet(hero, it)) continue;
      if (power(r.out) <= power(worn) || have(hero, r.out) > 0) continue;
      if (!best || r.lvl < best.lvl || (r.lvl === best.lvl && power(r.out) < power(best.out))) best = r; // the nearest step up
    }
    if (best) out.push({ slot, recipe: best, plan: planFor(hero, best) });
  }
  return out;
}

// What to do next toward a recipe: { text, target }. Missing goods come
// first (you can gather while you train); then the Crafting level; then make it.
export function planFor(hero, r) {
  const name = ITEMS[r.out]?.name ?? r.out;
  for (const [id, n] of Object.entries(r.in)) {
    const short = n - have(hero, id);
    if (short <= 0) continue;
    const sub = RECIPES.find((x) => x.out === id && !x.town);
    if (sub) {
      // One level down: can we make the input now?
      for (const [raw, m] of Object.entries(sub.in)) {
        const lack = m * Math.ceil(short / (sub.qty || 1)) - have(hero, raw);
        if (lack > 0) {
          const s = sourceOf(hero, raw);
          return { text: `${name}: ${short} ${ITEMS[id].name} → ${s.verb} ${lack} ${ITEMS[raw]?.name ?? raw}${s.need ? ` (${s.need})` : ''}`, target: s.target };
        }
      }
      if (sub.lvl <= lvl(hero, 'crafting')) return { text: `${name}: make ${short} ${ITEMS[id].name} at the ${STATIONS[sub.station]?.label ?? sub.station}`, target: { kind: 'station', station: sub.station }, recipe: sub.id };
      continue;
    }
    const s = sourceOf(hero, id);
    return { text: `${name}: ${s.verb} ${short} ${ITEMS[id]?.name ?? id}${s.need ? ` (${s.need})` : ''}`, target: s.target };
  }
  if (r.lvl > lvl(hero, 'crafting')) return { text: `${name}: train Crafting to ${r.lvl} (you're ${lvl(hero, 'crafting')})`, target: { kind: 'building', action: 'craft' } };
  return { text: `Make a ${name} at the ${STATIONS[r.station]?.label ?? r.station}`, target: { kind: 'station', station: r.station }, recipe: r.id };
}

// ── The Compass ──
export function suggest(state, now = Date.now()) {
  const hero = state.hero ?? { skills: {}, inv: {}, equip: {}, level: 1, pos: { x: 0, z: 0 } };
  const pos = hero.pos ?? { x: 0, z: 0 };
  const locate = state.locate ?? (() => null);
  const pins = new Set(state.pins ?? []);
  const out = [];
  const add = (g) => {
    const at = g.target ? locate(g.target) : null;
    const d = dist(pos, at);
    out.push({ progress: null, why: '', ...g, d: Number.isFinite(d) ? Math.round(d) : null });
  };

  // Quests: the intro (or a pinned quest) leads; side chains nearer score higher.
  for (const q of state.quests ?? []) {
    const def = questDef(q.id);
    const step = def?.steps[q.step];
    if (!step) continue;
    const daily = q.id.startsWith('alm:');
    const weekly = q.id.startsWith('err:');
    const need = stepNeed(step);
    const progress = need > 1 ? [q.n, need] : null;
    if (daily || weekly) {
      add({ id: `${q.id}|${q.period}`, src: 'almanac', text: weekly ? `Grand Errand ${q.step + 1}/${def.steps.length}: ${step.text}` : step.text, why: weekly ? 'This week' : 'Today', progress, target: step.target, score: pins.has(q.id) ? SCORE.pinned : weekly ? SCORE.weekly : SCORE.almanac });
      continue;
    }
    const main = q.id === 'hv_intro' || pins.has(q.id);
    const loc = step.target ? locate(step.target) : null;
    const near = loc ? Math.max(0, 10 - dist(pos, loc) / 40) : 0;
    add({ id: q.id, src: 'quest', text: `${def.title} ${q.step + 1}/${def.steps.length}: ${step.text}`, why: step.hint ?? '', progress, target: step.target, score: main ? SCORE.quest : SCORE.sideQuest - 10 + near });
  }

  // Ready to collect or hand in.
  for (const r of state.ready ?? []) add({ id: `ready:${r.kind}:${r.town}:${r.slot ?? ''}`, src: 'ready', text: r.text, why: r.here ? 'Ready here' : 'Ready', target: r.target, score: r.here ? SCORE.ready : SCORE.readyAway });

  // Level-up unlocks, for half an hour.
  for (const u of state.unlocks ?? []) {
    if (now - u.at > UNLOCK_MS) continue;
    for (const x of u.list) if (x.show) add({ id: `unlock:${u.skill}:${u.lvl}:${x.text}`, src: 'unlock', text: `${cap(u.skill)} ${u.lvl}: ${x.text}`, why: 'New', target: x.show, score: SCORE.unlock });
  }

  // Rich and ancient nodes you can work.
  for (const n of state.nodeStates ?? []) {
    const t = NODE_TYPES[n.type];
    if (!t || !n.st || lvl(hero, t.skill) < t.lvl + (STATE_GATE[n.st] ?? 0)) continue;
    const d = dist(pos, n);
    if (d > (n.st === 2 ? 600 : 150)) continue;
    add({ id: `node:${n.id}`, src: n.st === 2 ? 'ancient' : 'rich', text: `${n.st === 2 ? 'Ancient' : 'Rich'} ${t.name}, ${bearing(pos, n)}`, why: n.st === 2 ? 'A rare find' : 'Three times the yield', target: { kind: 'nodeId', id: n.id }, score: n.st === 2 ? SCORE.ancient : SCORE.rich });
  }

  // The next upgrade, per slot (the best two).
  for (const u of nextUpgrades(hero).slice(0, 2)) add({ id: `upgrade:${u.slot}`, src: 'upgrade', text: u.plan.text, why: 'Next upgrade', target: u.plan.target, score: pins.has(u.recipe.id) ? SCORE.pinned : SCORE.upgrade, recipe: u.plan.recipe ?? null });

  // Open orders still being gathered.
  for (const o of state.orders ?? []) {
    if (o.kind === 'hunt') {
      if (o.got < o.qty) add({ id: `order:${o.town}:${o.slot}`, src: 'order', text: `Order: ${o.text}`, why: 'Order Board', progress: [o.got, o.qty], target: { kind: 'monster', type: o.monster }, score: SCORE.order });
      continue;
    }
    const h = have(hero, o.item);
    if (h + o.got >= o.qty) continue; // (ready: listed above)
    const s = sourceOf(hero, o.item);
    add({ id: `order:${o.town}:${o.slot}`, src: 'order', text: `Order: ${o.text}`, why: `${s.verb} at ${s.name}`, progress: [o.got + h, o.qty], target: s.target, score: pins.has(`order:${o.town}:${o.slot}`) ? SCORE.pinned : SCORE.order });
  }

  // Places to find: undiscovered landmarks near you.
  const found = state.journal?.found ?? new Set();
  const seen = state.journal?.seen ?? new Set();
  const page = (state.journal?.pages ?? []).find((p) => p.id === hero.region);
  const near = LANDMARKS.filter((l) => !found.has(l.id) && dist(pos, l) <= 150).sort((a, b) => dist(pos, a) - dist(pos, b)).slice(0, 2); // the nearest two
  for (const l of near) {
    const d = dist(pos, l);
    add({ id: `lm:${l.id}`, src: 'landmark', text: seen.has(l.id) ? `Find ${l.name}, ${bearing(pos, l)}` : `Something to find, ${bearing(pos, l)}`, why: 'Discover', target: { kind: 'point', x: l.x, z: l.z }, score: (page?.pct ?? 0) < 25 ? SCORE.landmarkNew - d / 30 : SCORE.landmark });
  }
  // A page nearly done.
  for (const p of state.journal?.pages ?? []) if (p.pct >= 75 && p.pct < 100) add({ id: `page:${p.id}`, src: 'journal', text: `${p.name} is ${p.pct}% discovered: ${p.places - p.found} places left`, why: 'Journal', target: { kind: 'explore' }, score: SCORE.journal });

  // The fallback chain: something is always there.
  if (state.unexplored) add({ id: 'explore', src: 'fallback', text: `Unexplored land, ${bearing(pos, state.unexplored)}`, why: 'Explore', target: { kind: 'point', x: state.unexplored.x, z: state.unexplored.z }, score: SCORE.fallback + 3 });
  const rec = Object.entries(state.records ?? {}).sort((a, b) => (ITEMS[b[0]]?.value ?? 0) - (ITEMS[a[0]]?.value ?? 0))[0];
  if (rec) add({ id: 'record', src: 'fallback', text: `Beat your ${ITEMS[rec[0]]?.name ?? rec[0]} record (${rec[1]} kg)`, why: 'Records', target: { kind: 'lake' }, score: SCORE.fallback + 2 });
  if (state.nextTown) add({ id: `visit:${state.nextTown.id}`, src: 'fallback', text: `Visit ${state.nextTown.name}`, why: 'Travel', target: { kind: 'town', id: state.nextTown.id }, score: SCORE.fallback + 1 });
  for (const f of state.party ?? []) add({ id: `friend:${f.name}`, src: 'fallback', text: `${f.name} is ${f.place ? `at ${f.place}` : 'nearby'}: join them`, why: 'Friends', target: { kind: 'point', x: f.x, z: f.z }, score: SCORE.fallback });
  if (!out.length) add({ id: 'wander', src: 'fallback', text: 'Wander: chop, mine or fish whatever is near', why: 'Explore', target: { kind: 'explore' }, score: 1 });

  return out.sort((a, b) => b.score - a.score || (a.d ?? 1e9) - (b.d ?? 1e9));
}

// The context button's rules, first match wins (SPEC §5.3).
export const CONTEXT_RULES = ['fight', 'elite', 'collect', 'deliver', 'passage', 'stone', 'door', 'landmark', 'craft', 'node', 'cast', 'monster', 'compass'];
export const pickContext = (cands) => cands.filter(Boolean).sort((a, b) => CONTEXT_RULES.indexOf(a.rule) - CONTEXT_RULES.indexOf(b.rule) || (a.d ?? 0) - (b.d ?? 0))[0] ?? null;

// The card's choice: keep showing `cur` unless it's gone or a rival beats it
// by SWITCH_BY. Returns the goal to show.
export function pickShown(list, curId) {
  const top = list[0];
  const cur = curId && list.find((g) => g.id === curId);
  if (!cur || !top || top.id === cur.id) return top ?? null;
  return top.score >= cur.score + SWITCH_BY ? top : cur;
}
