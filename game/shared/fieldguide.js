// The field guide (Living wilds): every tree, rock, herb, fish and creature
// on the map, and each one's kinds to find (a sturdy oak, a golden one, a
// trophy-sized pike, twenty wolves beaten). It's built from the content and
// the map, so new towns fill it by themselves. The server ticks entries off
// from journal rows and pays each page at 25, 50 and 100%.
import { NODE_TYPES } from './nodes.js';
import { MONSTERS } from './monsters.js';
import { FISH, tableOf } from './fishing.js';
import { ITEMS } from './items.js';
import { NODES, LAKES, SPAWNS, ENTRANCES } from './world.js';
import { DUNGEONS } from './dungeon.js';
import { regionAt } from './places.js';
import { ST, stateWord } from './wilds.js';

export const GUIDE_PAGES = [
  { id: 'trees', name: 'Trees', icon: '🌳', kind: 'tree', skill: 'foraging', title: 'Friend of the Forest', cloak: 'grove' },
  { id: 'rocks', name: 'Rocks', icon: '🪨', kind: 'rock', skill: 'mining', title: 'Rockhound', cloak: 'slate' },
  { id: 'herbs', name: 'Herbs', icon: '🌿', kind: 'herb', skill: 'herbalism', title: 'Green Thumb', cloak: 'bloom' },
  { id: 'fish', name: 'Fish', icon: '🐟', kind: 'fish', skill: 'fishing', title: 'Master Angler', cloak: 'tide' },
  { id: 'creatures', name: 'Creatures', icon: '🐾', kind: 'creature', skill: 'combat', title: 'Beastmaster', cloak: 'hunter' },
];
export const GUIDE_STEPS = [25, 50, 100];

// What each page pays. Claims are kept with the journal's (page 'guide:<id>').
export function guideReward(pageId, pct) {
  const p = GUIDE_PAGES.find((x) => x.id === pageId);
  if (!p) return null;
  if (pct === 25) return { gold: 200, xp: { [p.skill]: 400 }, text: `200 gold and 400 ${p.skill} xp` };
  if (pct === 50) return { gold: 500, cloak: p.cloak, text: `500 gold and a ${p.cloak} tint for your cloak` };
  if (pct === 100) return { gold: 2000, title: p.title, text: `2,000 gold and the title ${p.title}` };
  return null;
}

// A fish is a trophy at three quarters of its biggest size or more.
export const trophyKg = (id) => Math.round((FISH[id]?.kg?.[1] ?? 1) * 0.75 * 10) / 10;
// Beat this many of a creature to know it well.
export const HUNT = { mob: 20, boss: 5 };

const NODE_STATES = [ST.plain, ST.rich, ST.ancient, ST.big, ST.elder, ST.golden];

// Every entry on every page, built once: { page, id, name, icon (an item to
// draw), where (region or dungeon names), boss?, legend?, go (a compass target) }.
let cache = null;
let cacheKey = '';
export function guideEntries() {
  const key = `${NODES.length}:${LAKES.length}:${SPAWNS.length}:${ENTRANCES.length}`; // the owner's editor can grow the map
  if (cache && key === cacheKey) return cache;
  cacheKey = key;
  const where = new Map(); // 'page:id' → Set of place names (in first-met order)
  const add = (page, id, x, z, name = null) => {
    const k = `${page}:${id}`;
    if (!where.has(k)) where.set(k, new Set());
    const n = name ?? regionAt(x, z)?.name;
    if (n) where.get(k).add(n);
  };
  const out = [];
  // Gatherables: every tree, rock and herb kind that grows somewhere.
  for (const n of NODES) {
    const kind = NODE_TYPES[n.type]?.kind;
    if (['tree', 'rock', 'herb'].includes(kind)) add(`${kind}s`, n.type, n.x, n.z);
  }
  for (const [type, t] of Object.entries(NODE_TYPES))
    if (where.has(`${t.kind}s:${type}`)) out.push({ page: `${t.kind}s`, id: type, name: t.name, icon: t.drops?.[0]?.id ?? null, tier: t.tier, lvl: t.lvl, go: { kind: 'node', type } });
  // Fish: every catch in every lake's table (not the old boot), legends too.
  const lakeOf = new Map();
  for (const l of LAKES) {
    const tb = tableOf(l.fish);
    for (const id of [...tb.fish.map((f) => f.id), ...(tb.legends ?? [])]) {
      if (id === 'old_boot' || !ITEMS[id]) continue;
      add('fish', id, l.x, l.z);
      if (!lakeOf.has(id)) lakeOf.set(id, { x: l.x, z: l.z, name: l.name });
    }
  }
  for (const [id, at] of lakeOf) out.push({ page: 'fish', id, name: ITEMS[id].name, icon: id, legend: !!FISH[id]?.legend, lvl: FISH[id]?.d ?? 0, go: { kind: 'point', x: at.x, z: at.z } });
  // Creatures: every camp's monster, and every dungeon's.
  // A camp's monster is found at its camp; a dungeon's, at the dungeon door.
  const goes = new Map();
  const bosses = new Set();
  for (const s of SPAWNS) if (MONSTERS[s.monster]) (add('creatures', s.monster, s.x, s.z), goes.set(s.monster, { kind: 'monster', type: s.monster }));
  for (const e of ENTRANCES) {
    const d = DUNGEONS[e.kind];
    if (d?.boss?.monster) bosses.add(d.boss.monster);
    for (const m of [...(d?.pool ?? []), d?.boss?.monster]) if (m && MONSTERS[m]) (add('creatures', m, 0, 0, d.name), goes.has(m) || goes.set(m, { kind: 'entrance', dungeon: e.kind }));
  }
  for (const [id, go] of goes) {
    const m = MONSTERS[id];
    out.push({ page: 'creatures', id, name: m.name, icon: m.drops?.[0]?.id ?? null, boss: !!m.boss || bosses.has(id), lvl: m.lvl ?? 0, go });
  }
  for (const e of out) e.where = [...(where.get(`${e.page}:${e.id}`) ?? [])];
  const order = (e) => [GUIDE_PAGES.findIndex((p) => p.id === e.page), e.tier ?? 0, e.lvl ?? 0];
  out.sort((a, b) => {
    const x = order(a);
    const y = order(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return (cache = out);
}

// One entry's marks for a hero, from their journal rows:
// rows = { variant: Map('type:st' → row), node: Set('rich:type'), fish: Map, creature: Map }.
// → [{ k, label, got }] and the entry's count and best.
export function entryMarks(e, rows) {
  if (e.page === 'fish') {
    const r = rows.fish?.get(e.id);
    const kg = trophyKg(e.id);
    return { marks: [{ k: 'caught', label: 'Caught', got: !!r }, { k: 'trophy', label: `Trophy, ${kg} kg+`, got: (r?.best ?? 0) >= kg }], n: r?.n ?? 0, best: r?.best ?? null };
  }
  if (e.page === 'creatures') {
    const n = rows.creature?.get(e.id)?.n ?? 0;
    const need = e.boss ? HUNT.boss : HUNT.mob;
    return { marks: [{ k: 'met', label: 'Beaten', got: n > 0 }, { k: 'hunted', label: `${need} beaten`, got: n >= need }], n, best: null };
  }
  let n = 0;
  let best = null;
  const marks = NODE_STATES.map((st) => {
    const r = rows.variant?.get(`${e.id}:${st}`);
    n += r?.n ?? 0;
    if (r?.best != null) best = Math.max(best ?? 0, r.best);
    const legacy = (st === ST.rich && rows.node?.has(`rich:${e.id}`)) || (st === ST.ancient && rows.node?.has(`ancient:${e.id}`));
    return { k: st, label: st ? stateWord(e.id, st) : 'Common', got: !!r || !!legacy };
  });
  // Any kind of it gathered means you've met the common one too.
  if (marks.some((m) => m.got)) marks[0].got = true;
  return { marks, n, best };
}

// The whole guide for a hero: pages with their entries and how full they are.
export function buildGuide(rows) {
  const entries = guideEntries();
  return GUIDE_PAGES.map((p) => {
    let got = 0;
    let all = 0;
    const list = entries
      .filter((e) => e.page === p.id)
      .map((e) => {
        const m = entryMarks(e, rows);
        got += m.marks.filter((x) => x.got).length;
        all += m.marks.length;
        const found = m.marks[0].got;
        return { id: e.id, name: e.name, icon: e.icon, where: e.where, boss: e.boss, legend: e.legend, go: e.go, found, done: m.marks.every((x) => x.got), ...m };
      });
    return { id: p.id, name: p.name, icon: p.icon, pct: all ? Math.floor((100 * got) / all) : 0, got, all, entries: list };
  });
}
