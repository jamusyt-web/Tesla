// A bot that plays like a new player who does whatever the goal card says
// (SPEC §10, Gate G2): it asks the same Compass (shared/goals.js) for the
// best thing to do, does it (chop, mine, fight, craft, fish, stock the shop,
// hand in orders, open caches…) and moves on. It reports how far it got,
// whether the Compass was ever empty (sampled every 2 s) and how much of its
// time was dead air (nothing it could act on).
//
// Used by scripts/bots.js with BOT_COMPASS=1.
import { suggest } from '../shared/goals.js';
import '../shared/almanac.js';
import { questDef } from '../shared/quests.js';
import { NODES, NODE_TYPES, SPAWNS, STONES, LANDMARKS, PROPS, approachPoint, stoneFront, doorPoint } from '../shared/world.js';
import { spotsOf } from '../shared/stations.js';
import { townBuilding, regionAt } from '../shared/places.js';
import { RECIPES, RECIPE_BY_ID } from '../shared/recipes.js';
import { ITEMS } from '../shared/items.js';
import { newFight, stepFight, FISH_MAX_TICKS } from '../shared/fishing.js';
import { LANDMARK_INFO } from '../shared/journal.js';
import { grid, regionCells, cellCentre, hasBit, setBit } from '../shared/journal.js';
import { heroLevel, levelFromXp } from '../shared/skills.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SKIP_MS = 120_000;

export async function runCompassBot({ ws, name, col, nav, until, log = () => {} }) {
  let me = null;
  let rid = 0;
  const pending = new Map();
  const quests = new Map();
  const found = new Set();
  const deadNodes = new Map(); // node id → when it fell
  const mobs = new Map();
  let bits = null;
  let battle = null;
  let bite = null;
  const stats = { samples: 0, empty: 0, acted: {}, failed: {}, dead: 0, started: Date.now(), questsDone: 0, level0: 1 };
  const waiters = [];
  const wait = (pred, ms) => new Promise((r) => {
    const w = { pred, r };
    waiters.push(w);
    setTimeout(() => (waiters.splice(waiters.indexOf(w), 1), r(null)), ms);
  });

  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') {
      me = { ...m.you };
      for (const q of m.you.quests?.active ?? []) quests.set(`${q.id}|${q.period}`, q);
      for (const x of m.mobs ?? []) mobs.set(x.id, x);
      stats.level0 = me.level;
    }
    if (m.t === 'me' && me) Object.assign(me, { inv: m.inv, skills: m.skills, level: m.level, equip: m.equip, gold: m.gold, hp: m.hp, maxHp: m.maxHp });
    if (m.t === 's') {
      for (const r of m.p ?? []) if (me && r[0] === me.id) Object.assign(me, { x: r[1], z: r[2], act: r[4] });
      for (const x of m.add ?? []) mobs.set(x.id, x);
      for (const r of m.m ?? []) mobs.set(r[0], { ...(mobs.get(r[0]) ?? {}), id: r[0], x: r[1], z: r[2], state: r[4] });
      for (const id of m.rm ?? []) mobs.delete(id);
    }
    if (m.t === 'node') m.alive ? deadNodes.delete(m.id) : deadNodes.set(m.id, Date.now());
    if (m.t === 'quest') {
      const k = `${m.id}|${m.period}`;
      if (m.done || m.dropped) {
        quests.delete(k);
        if (m.done) stats.questsDone++;
      } else quests.set(k, { id: m.id, period: m.period, step: m.step, n: m.n });
    }
    if (m.t === 'discover') found.add(m.id);
    if (m.t === 'cells' && bits) for (const k of m.k) setBit(bits, k);
    if (m.t === 'battle') battle = m.b;
    if (m.t === 'battleEnd') battle = null;
    if (m.t === 'bite') bite = m;
    if (m.t === 'res') pending.get(m.rid)?.(m), pending.delete(m.rid);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.r(m));
  });
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const req = (t, a) => new Promise((r) => {
    const id = ++rid;
    pending.set(id, r);
    send({ ...a, t, rid: id });
    setTimeout(() => r({ ok: false, err: 'timeout' }), 6000);
  });
  const rpc = (m, a = {}) => req('rpc', { m, a });
  const walk = async (x, z) => {
    send({ t: 'move', x, z });
    await sleep(500);
    for (let k = 0; k < 60 && me?.act === 'walk'; k++) await sleep(300);
    return Math.hypot(me.x - x, me.z - z) < 4;
  };
  while (!me) await sleep(100);
  const ex = await rpc('explore.bits');
  if (ex.ok) bits = Buffer.from(ex.data.bits, 'base64');
  const jr = await rpc('journal.get');
  for (const p of jr.data?.pages ?? []) for (const x of p.tabs.places) if (x.found) found.add(x.id);
  let orders = [];
  const loadOrders = async () => {
    const o = await rpc('orders.list');
    orders = (o.data?.slots ?? []).filter((x) => x.state === 'open').map((x) => ({ ...x, town: o.data.town }));
  };
  await loadOrders();

  // ── The Compass, as the goal card sees it ──
  const nearestNode = (type) => {
    let best = null;
    for (const n of NODES) {
      if (n.type !== type || deadNodes.has(n.id)) continue;
      const d = Math.hypot(n.x - me.x, n.z - me.z);
      if (!best || d < best.d) best = { n, d };
    }
    return best?.n ?? null;
  };
  const unexplored = () => {
    if (!bits) return null;
    const G = grid();
    let best = null;
    for (const list of regionCells().values())
      for (const k of list) {
        if (hasBit(bits, k)) continue;
        const c = cellCentre(G, k);
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (!best || d < best.d) best = { ...c, d };
      }
    return best;
  };
  const locate = (t) => {
    if (!t) return null;
    if (t.kind === 'node') return nearestNode(t.type);
    if (t.kind === 'monster') return [...mobs.values()].find((m) => m.type === t.type && m.state !== 'dead') ?? SPAWNS.find((s) => s.monster === t.type) ?? null;
    if (t.kind === 'station') return spotsOf(t.station, me.x, me.z)[0] ?? null;
    if (t.kind === 'building') {
      const b = townBuilding(t.action, me.x, me.z);
      return b ? { x: doorPoint(b)[0], z: doorPoint(b)[1] } : null;
    }
    if (t.kind === 'board') return PROPS.find((p) => p.slot === 'proc_job_board') ?? null;
    if (t.kind === 'stone') return STONES.find((s) => s.id === t.id) ?? null;
    if (t.kind === 'point') return t;
    if (t.kind === 'landmark') return LANDMARKS.find((l) => (t.id ? l.id === t.id : l.kind === t.lk)) ?? null;
    if (t.kind === 'lake') return nearestNode('fish_spot');
    if (t.kind === 'explore') return unexplored();
    if (t.kind === 'bag') return { x: me.x, z: me.z };
    return null;
  };
  const skip = new Map();
  const state = () => ({
    hero: { skills: me.skills ?? {}, level: me.level, inv: me.inv ?? {}, equip: me.equip ?? {}, stones: me.stones ?? [], pos: { x: me.x, z: me.z }, region: regionAt(me.x, me.z)?.id },
    quests: [...quests.values()],
    orders,
    ready: orders.filter((o) => (o.kind === 'hunt' ? o.got >= o.qty : (me.inv?.[o.item] ?? 0) >= o.qty - o.got)).map((o) => ({ kind: 'order', town: o.town, slot: o.slot, here: true, text: o.text, target: { kind: 'board' } })),
    journal: { found, seen: new Set(), pages: [] },
    unexplored: unexplored(),
    locate,
  });
  const goals = () => suggest(state()).filter((g) => !(skip.get(g.id) > Date.now()));
  const sampler = setInterval(() => {
    stats.samples++;
    if (!suggest(state()).length) stats.empty++;
  }, 2000);

  // ── Doing things ──
  const gather = async (n) => {
    if (!n) return false;
    const ap = approachPoint(n, me.x, me.z, col, nav);
    if (!ap || !(await walk(ap[0], ap[1]))) return false;
    const nt = NODE_TYPES[n.type];
    if (nt.kind === 'fish') return fish(n);
    for (let k = 0; k < 30; k++) {
      const r = await req('hit', { node: n.id });
      if (!r.ok) {
        if (/regrowing/.test(r.err)) deadNodes.set(n.id, Date.now());
        return false;
      }
      if (r.data?.broke || nt.kind === 'herb') return true;
      if (r.data?.tooFast) await sleep(r.data.wait ?? 200);
      else await sleep((ITEMS[me.equip?.[nt.tool]]?.speed ?? 700) + 30);
    }
    return true;
  };
  const fish = async (n) => {
    bite = null;
    const c = await req('cast', { node: n.id });
    if (!c.ok) return false;
    const b = await wait((m) => m.t === 'bite' || m.t === 'fishResult', 9000);
    if (!b || b.t !== 'bite') return false;
    const r = await req('reel', {});
    if (!r.ok || !r.data?.fight) return false;
    const { fish: f, gear } = r.data.bite;
    // Play the reel fight: hold while the fish is above the middle of the bar.
    const s = newFight(f, gear);
    let held = false;
    const toggles = [];
    while (!s.done && s.tick < FISH_MAX_TICKS) {
      const want = s.fishPos > s.zonePos + gear.zone * 0.5;
      if (want !== held) (toggles.push(s.tick), (held = want));
      stepFight(s, held);
    }
    await sleep((s.tick / 60) * 1000 + 200);
    send({ t: 'land', toggles, end: s.tick });
    const res = await wait((m) => m.t === 'fishResult', 4000);
    return !!res?.ok;
  };
  const fight = async (type) => {
    let m = [...mobs.values()].filter((x) => (!type || x.type === type) && x.state !== 'dead').sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    if (!m) {
      const camp = SPAWNS.find((s) => s.monster === type);
      if (!camp || !(await walk(camp.x, camp.z))) return false;
      await sleep(800);
      m = [...mobs.values()].filter((x) => x.type === type && x.state !== 'dead').sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
      if (!m) return false;
    }
    // Close in (it wanders while you walk): up to four tries.
    for (let k = 0; k < 4; k++) {
      const cur = mobs.get(m.id) ?? m;
      if (cur.state === 'dead') return false;
      const dx = me.x - cur.x;
      const dz = me.z - cur.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 4.5) break;
      await walk(cur.x + (dx / d) * 2.5, cur.z + (dz / d) * 2.5);
    }
    const e = await req('engage', { mob: m.id });
    if (!e.ok) {
      if (process.env.BOT_DEBUG) log(`${name}: engage failed: ${e.err}`);
      return false;
    }
    for (let round = 0; round < 40; round++) {
      await sleep(300);
      if (!battle) break;
      const low = me.hp < me.maxHp * 0.35 && (me.inv?.health_potion ?? 0) > 0;
      send(low ? { t: 'bact', a: 'potion', item: 'health_potion' } : { t: 'bact', a: 'attack' });
      await wait((x) => x.t === 'bres' || x.t === 'battleEnd', 15000);
    }
    await sleep(400);
    return true;
  };
  const craft = async (recipeId) => {
    const r = RECIPE_BY_ID[recipeId];
    if (!r) return false;
    for (const [id, n] of Object.entries(r.in)) if ((me.inv?.[id] ?? 0) < n) return false;
    const sp = spotsOf(r.station, me.x, me.z)[0];
    if (!sp || !(await walk(sp.x, sp.z))) return false;
    const st = await rpc('craft.start', { recipe: recipeId, batch: 1 });
    if (!st.ok) return false;
    await sleep(1500);
    const fin = await rpc('craft.finish', { sid: st.data.sid, toggles: [], end: 1, off: [0, 0] });
    return fin.ok;
  };
  // Something it can make from its bag (to train Crafting), cheapest first.
  const anyCraft = () => RECIPES.filter((r) => !r.town && r.lvl <= Math.max(1, levelOf('crafting')) && Object.entries(r.in).every(([id, n]) => (me.inv?.[id] ?? 0) >= n)).sort((a, b) => a.lvl - b.lvl)[0];
  const levelOf = (s) => levelFromXp(me.skills?.[s] || 0);

  const act = async (g) => {
    const t = g.target ?? {};
    const q = g.src === 'quest' || g.src === 'almanac' ? questDef(g.id.split('|')[0]) : null;
    const step = q ? q.steps[[...quests.values()].find((r) => `${r.id}|${r.period}` === g.id || r.id === g.id)?.step ?? 0] : null;
    const recipe = g.recipe ?? (step?.ev === 'craft' && step.match?.item ? RECIPES.find((r) => r.out === step.match.item && !r.town)?.id : null);
    switch (t.kind) {
      case 'node':
        return gather(nearestNode(t.type));
      case 'nodeId':
        return gather(NODES.find((n) => n.id === t.id));
      case 'lake':
        return gather(nearestNode('fish_spot'));
      case 'monster':
        return fight(t.type);
      case 'station':
        if (recipe) return craft(recipe);
        return anyCraft() ? craft(anyCraft().id) : false;
      case 'building':
        if (t.action === 'shop') {
          const item = Object.entries(me.inv ?? {}).find(([id, n]) => n > 1 && ITEMS[id] && !ITEMS[id].bound && ITEMS[id].cat !== 'tool' && ITEMS[id].cat !== 'gear')?.[0];
          if (!item) return false;
          const r = await rpc('shop.stock', { slot: Math.floor(Math.random() * 6), item, qty: 1, price: ITEMS[item].value });
          return r.ok;
        }
        if (t.action === 'market') {
          const loc = locate(t);
          if (loc) await walk(loc.x, loc.z);
          const goods = Object.entries(me.inv ?? {}).filter(([id, n]) => n > 0 && ITEMS[id] && ['resource', 'material', 'fish'].includes(ITEMS[id].cat));
          let ok = false;
          for (const [id, n] of goods.slice(0, 3)) ok = (await rpc('npcSell', { item: id, qty: Math.min(n, 5) })).ok || ok;
          return ok;
        }
        if (t.action === 'craft') return anyCraft() ? craft(anyCraft().id) : gather(nearestNode('tree_oak'));
        return false;
      case 'board': {
        const loc = locate(t);
        if (loc) await walk(loc.x + 1.8, loc.z + 1.8);
        await loadOrders();
        let ok = false;
        for (const o of orders) if (o.kind === 'hunt' ? o.got >= o.qty : (me.inv?.[o.item] ?? 0) > 0) ok = (await rpc('orders.deliver', { slot: o.slot, qty: o.qty })).ok || ok;
        await loadOrders();
        return ok;
      }
      case 'stone': {
        const st = STONES.find((s) => s.id === t.id);
        if (!st) return false;
        const [fx, fz] = stoneFront(st, 2);
        return walk(fx, fz);
      }
      case 'landmark':
      case 'point':
      case 'explore': {
        const loc = locate(t);
        if (!loc) return false;
        await walk(loc.x, loc.z);
        const lm = LANDMARKS.find((l) => Math.hypot(l.x - me.x, l.z - me.z) < 6 && LANDMARK_INFO[l.kind]?.verb);
        if (lm) await rpc('landmark.use', { id: lm.id });
        return true;
      }
      case 'bag': {
        const item = step?.match?.item;
        return item ? (await rpc('use', { item })).ok : false;
      }
      default:
        return false;
    }
  };

  log(`🧭 ${name} follows the Compass`);
  while (Date.now() < until) {
    const list = goals();
    const g = list[0];
    if (!g) {
      stats.dead += 2;
      await sleep(2000);
      continue;
    }
    const t0 = Date.now();
    let ok = false;
    try {
      ok = await act(g);
    } catch (e) {
      ok = false;
    }
    (ok ? stats.acted : stats.failed)[g.src] = ((ok ? stats.acted : stats.failed)[g.src] ?? 0) + 1;
    if (process.env.BOT_DEBUG) log(`${name}: ${ok ? '✓' : '✗'} [${g.src}] ${g.text} (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (!ok) {
      skip.set(g.id, Date.now() + SKIP_MS);
      if (Date.now() - t0 < 1000) await sleep(300);
    }
    if (g.src === 'order' || g.src === 'ready') await loadOrders();
  }
  clearInterval(sampler);
  const minutes = (Date.now() - stats.started) / 60_000;
  return { name, level: heroLevel(me.skills ?? {}), from: stats.level0, quests: stats.questsDone, compassEmpty: stats.empty, samples: stats.samples, deadPct: Math.round((1000 * stats.dead) / (minutes * 60)) / 10, acted: stats.acted, failed: stats.failed, intro: [...quests.values()].find((q) => q.id === 'hv_intro')?.step ?? 'done' };
}
