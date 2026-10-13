// The Compass on the client: keeps what the server says about quests,
// orders, the journal and exploring, turns it into the state shared/goals.js
// ranks, and works out where each goal points (the nearest tree, the right
// station, a waystone…) and how to get there (walk, or a waystone first).
// It only points; every reward is the server's to give.
import '../../../shared/almanac.js'; // (teaches questDef the Almanac's ids)
import { suggest } from '../../../shared/goals.js';
import { NODE_TYPES, SPAWNS, PROPS, LANDMARKS, LAKES, STONES, ENTRANCES, PASSAGES, REGIONS, entranceFront, stoneFront, doorPoint, travelFee, STONE_RANGE } from '../../../shared/world.js';
import { stationPos, spotsOf } from '../../../shared/stations.js';
import { MONSTERS } from '../../../shared/monsters.js';
import { STATIONS } from '../../../shared/crafting.js';
import { townBuilding, townAt, regionAt } from '../../../shared/places.js';
import { grid, hasBit, setBit, regionCells, cellCentre } from '../../../shared/journal.js';
import { nowarpItem } from '../../../shared/travel.js';

const WALK_LIMIT = 250; // farther than this, a waystone may be quicker
const near = (p, list) => {
  let best = null;
  let bd = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) [best, bd] = [e, d];
  }
  return best;
};

export class Compass {
  constructor(game) {
    this.g = game;
    this.quests = new Map(); // id|period → { id, period, step, n }
    this.done = new Set();
    this.orders = []; // open orders (this town's board), with goods counts
    this.big = null;
    this.found = new Set();
    this.seen = new Set();
    this.pages = [];
    this.records = {};
    this.unlocks = [];
    this.bits = null;
    this.G = null;
    this.list = [];
    this.bind(game.sock);
  }

  bind(s) {
    s.on('welcome', (m) => m.you?.quests && this.setQuests(m.you.quests));
    s.on('quest', (m) => this.onQuest(m));
    s.on('discover', (m) => {
      this.found.add(m.id);
      const p = this.pages.find((x) => x.id === m.region);
      if (p && m.pct != null) Object.assign(p, { pct: m.pct, found: p.found + 1 });
    });
    s.on('cells', (m) => this.bits && m.k.forEach((k) => setBit(this.bits, k)));
    s.on('unlock', (m) => this.unlocks.push({ ...m, at: Date.now() }));
    s.on('record', (m) => (this.records[m.item] = m.kg));
    s.on('order', () => this.loadOrders());
  }

  // Everything that isn't pushed: asked for once on arrival, then as needed.
  async load() {
    const s = this.g.sock;
    try {
      const [j, e] = await Promise.all([s.rpc('journal.get', {}, { auto: true }), s.rpc('explore.bits', {}, { auto: true })]);
      this.setJournal(j);
      this.G = { x0: e.x0, z0: e.z0, w: e.w, h: e.h };
      this.bits = Uint8Array.from(atob(e.bits), (c) => c.charCodeAt(0));
    } catch {}
    this.loadOrders();
    this.loadLandmarks();
  }
  // Which landmarks are resting for you (a cache opened this week…), and
  // this week's glimmer regions.
  async loadLandmarks() {
    try {
      const r = await this.g.sock.rpc('landmark.states', {}, { auto: true });
      this.landmarkWait = Object.fromEntries(Object.entries(r.states).filter(([, w]) => w));
      this.glimmerRegions = r.glimmers;
    } catch {}
  }
  markUsed(id, r) {
    this.landmarkWait ??= {};
    const why = { cache: 'Empty. It fills again next week.', shrine: 'The shrine is quiet. Come back in 30 min.', ruin: 'You have already read this.', secret: 'You have already been here.', curio: 'You have already been here.' }[r.kind];
    if (why) this.landmarkWait[id] = why;
    if (r.kind === 'shrine') setTimeout(() => delete this.landmarkWait[id], 30 * 60_000);
    this.used = (this.used ?? new Set()).add(id);
  }
  async loadOrders() {
    try {
      const o = await this.g.sock.rpc('orders.list', {}, { auto: true });
      this.orders = o.slots.filter((x) => x.state === 'open').map((x) => ({ ...x, town: o.town }));
      this.big = o.big ? { ...o.big, town: o.town } : null;
    } catch {}
  }
  setJournal(j) {
    this.pages = j.pages.map((p) => ({ id: p.id, name: p.name, pct: p.pct, places: p.places, found: p.found }));
    for (const p of j.pages) for (const x of p.tabs.places) (x.found ? this.found : x.pinned ? this.seen : new Set()).add(x.id);
    for (const p of j.pages) for (const f of p.tabs.fish) if (f.best) this.records[f.id] = f.best;
    this.titles = j.titles;
  }
  setQuests(q) {
    this.quests = new Map(q.active.map((r) => [`${r.id}|${r.period}`, r]));
    this.done = new Set(q.done);
  }
  onQuest(m) {
    const k = `${m.id}|${m.period}`;
    if (m.dropped || m.done) {
      this.quests.delete(k);
      if (m.done && !m.period) this.done.add(m.id);
    } else this.quests.set(k, { id: m.id, period: m.period, step: m.step, n: m.n });
    if (m.id === 'hv_intro' || m.done) this.loadOrders();
  }

  // ── Where things are ──
  // The nearest place a goal's target can be done: { x, z, label, go } or null.
  locate(t) {
    const g = this.g;
    if (!t || !g.me) return null;
    const p = g.myPos();
    switch (t.kind) {
      case 'node': {
        const n = g.nearestNode(t.type);
        return n ? { x: n.x, z: n.z, y: NODE_TYPES[n.type]?.kind === 'tree' ? 5.4 : 2.2, label: NODE_TYPES[n.type]?.name ?? t.type, node: n.id, go: () => g.goNode(n.id) } : null;
      }
      case 'nodeId': {
        const n = g.nodePos(t.id);
        return n ? { x: n.x, z: n.z, y: 4, label: NODE_TYPES[n.type]?.name ?? '', node: n.id, go: () => g.goNode(n.id) } : null;
      }
      case 'monster': {
        let mv = null;
        for (const m of g.mobs.values()) if (m.type === t.type && m.state !== 'dead' && (!mv || Math.hypot(m.x - p.x, m.z - p.z) < Math.hypot(mv.x - p.x, mv.z - p.z))) mv = m;
        if (mv) return { x: mv.x, z: mv.z, y: 2.6, label: MONSTERS[t.type]?.name ?? t.type, mob: mv.id, go: () => g.goMob(mv.id) };
        const camp = near(p, SPAWNS.filter((s) => s.monster === t.type));
        return camp ? { x: camp.x, z: camp.z, y: 2.6, label: 'Camp', go: () => g.walkTo(camp.x, camp.z, true) } : null;
      }
      case 'station': {
        const sp = spotsOf(t.station, p.x, p.z)[0];
        const st = stationPos(t.station, p.x, p.z);
        return sp ? { x: st?.x ?? sp.x, z: st?.z ?? sp.z, y: 2.4, label: STATIONS[t.station]?.label ?? t.station, go: () => g.walkTo(sp.x, sp.z, true, () => g.hud.panels.open('craft', { station: t.station })) } : null;
      }
      case 'building': {
        const b = townBuilding(t.action, p.x, p.z);
        if (!b) return null;
        const [dx, dz] = doorPoint(b);
        return { x: dx, z: dz, y: 3.2, label: b.label ?? t.action, go: () => (t.action === 'shop' ? g.enterShop(g.myId) : g.goBuilding(b.id)) };
      }
      case 'board': {
        const pr = near(p, PROPS.filter((x) => x.slot === 'proc_job_board'));
        return pr ? { x: pr.x, z: pr.z, y: 3, label: 'Order Board', go: () => g.goBoard(pr.id) } : null;
      }
      case 'stone': {
        const st = STONES.find((s) => s.id === t.id);
        return st ? { x: st.x, z: st.z, y: 3.5, label: st.name, go: () => g.goStone(st.id) } : null;
      }
      case 'entrance': {
        const e = ENTRANCES.find((x) => x.kind === t.dungeon) ?? ENTRANCES[0];
        if (!e) return null;
        const [fx, fz] = entranceFront(e);
        return { x: fx, z: fz, y: 4, label: 'Dungeon', go: () => g.walkTo(fx, fz, true, () => g.goCrypt(e.id)) };
      }
      case 'landmark': {
        const list = LANDMARKS.filter((l) => (t.id ? l.id === t.id : l.kind === t.lk));
        const l = near(p, list.filter((x) => !this.used?.has(x.id)).length ? list.filter((x) => !this.used?.has(x.id)) : list);
        return l ? { x: l.x, z: l.z, y: 2.5, label: this.found.has(l.id) || this.seen.has(l.id) ? l.name : '?', go: () => g.walkTo(l.x, l.z, true) } : null;
      }
      case 'lake': {
        const n = g.nearestNode('fish_spot');
        if (n) return { x: n.x, z: n.z, y: 1.5, label: 'Fishing spot', node: n.id, go: () => g.goNode(n.id) };
        const l = near(p, LAKES);
        return l ? { x: l.x, z: l.z, y: 1, label: 'Lake', go: () => g.walkTo(l.x, l.z, true) } : null;
      }
      case 'passage': {
        const ps = PASSAGES.find((x) => x.id === t.id);
        return ps ? { x: ps.x, z: ps.z, y: 2.5, label: ps.name ?? 'Passage', go: () => g.walkTo(ps.x, ps.z, true) } : null;
      }
      case 'town': {
        const r = REGIONS.find((x) => x.id === t.id);
        return r ? { x: r.x, z: r.z, y: 4, label: r.name, go: () => g.walkTo(r.x, r.z, true) } : null;
      }
      case 'point':
        return { x: t.x, z: t.z, y: 2.5, label: '', go: () => g.walkTo(t.x, t.z, true) };
      case 'explore': {
        const u = this.unexplored();
        return u ? { x: u.x, z: u.z, y: 2, label: 'Unexplored', go: () => g.walkTo(u.x, u.z, true) } : null;
      }
      case 'bag':
        return { x: p.x, z: p.z, y: 0, here: true, label: 'Your bag', go: () => g.hud.panels.open('bag') };
      default:
        return null;
    }
  }

  // The nearest land you haven't walked yet (by cell), or null.
  unexplored() {
    if (!this.bits || !this.G) return null;
    const p = this.g.myPos();
    const G = grid();
    let best = null;
    let bd = Infinity;
    for (const list of regionCells().values())
      for (const k of list) {
        if (hasBit(this.bits, k)) continue;
        const c = cellCentre(G, k);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) [best, bd] = [c, d];
      }
    return best;
  }

  // The snapshot shared/goals.js ranks.
  state() {
    const g = this.g;
    const me = g.hud.me;
    const p = g.myPos();
    const town = townAt(p.x, p.z)?.id ?? null;
    const ready = [];
    const till = me.shop?.till ?? g.hud.till ?? 0;
    if (till >= 200) ready.push({ kind: 'till', town, here: true, text: `Collect ${till} 🪙 from your shop till`, target: { kind: 'building', action: 'shop' } });
    for (const [t, n] of Object.entries(me.storage ?? {})) if (n > 0) ready.push({ kind: 'storage', town: t, here: t === town, text: `Collect ${n} item${n === 1 ? '' : 's'} waiting in storage`, target: { kind: 'building', action: 'market' } });
    for (const o of this.orders) {
      const can = o.kind === 'hunt' ? o.got >= o.qty : (me.inv?.[o.item] ?? 0) > 0 && (me.inv[o.item] + o.got >= o.qty || me.inv[o.item] >= 10);
      if (can) ready.push({ kind: 'order', town: o.town, slot: o.slot, here: o.town === town, text: `Hand in at the Order Board: ${o.text}`, target: { kind: 'board' } });
    }
    const pins = this.pins();
    return {
      hero: { skills: me.skills ?? {}, level: me.level ?? 1, inv: me.inv ?? {}, equip: me.equip ?? {}, stones: me.stones ?? [], pos: p, town, region: regionAt(p.x, p.z)?.id ?? null },
      quests: [...this.quests.values()],
      pins,
      orders: this.orders,
      ready,
      journal: { found: this.found, seen: this.seen, pages: this.pages },
      unexplored: this.unexplored(),
      unlocks: this.unlocks,
      nodeStates: [...g.town.nodes.entries()].filter(([, v]) => v.st && v.alive).map(([id, v]) => ({ id, type: v.node.type, st: v.st, x: v.node.x, z: v.node.z })),
      records: this.records,
      party: (g.hud.party?.members ?? []).filter((m) => m.id !== g.myId && m.x != null).map((m) => ({ name: m.name, x: m.x, z: m.z, place: m.region })),
      locate: (t) => this.locate(t),
    };
  }
  suggest(now = Date.now()) {
    const snoozed = this.snoozed(now);
    this.list = suggest(this.state(), now).filter((x) => !snoozed.has(x.id));
    return this.list;
  }

  // Pins and snoozes are this device's own (localStorage).
  pins() {
    try {
      return JSON.parse(localStorage.getItem('hv_pins') || '[]');
    } catch {
      return [];
    }
  }
  pin(id) {
    const p = this.pins();
    const next = p.includes(id) ? p.filter((x) => x !== id) : [id, ...p].slice(0, 3);
    try {
      localStorage.setItem('hv_pins', JSON.stringify(next));
    } catch {}
    return next.includes(id);
  }
  snoozed(now = Date.now()) {
    try {
      const s = JSON.parse(localStorage.getItem('hv_snooze') || '{}');
      return new Set(Object.keys(s).filter((k) => s[k] > now));
    } catch {
      return new Set();
    }
  }
  snooze(id, ms = 30 * 60_000) {
    try {
      const s = JSON.parse(localStorage.getItem('hv_snooze') || '{}');
      for (const k of Object.keys(s)) if (s[k] < Date.now()) delete s[k];
      s[id] = Date.now() + ms;
      localStorage.setItem('hv_snooze', JSON.stringify(s));
    } catch {}
  }

  // How to get to a goal: walk, or (far away, with an attuned stone near
  // the target and one near you) a waystone first. { mode, label, fee?, run }.
  route(goal) {
    const g = this.g;
    const at = this.locate(goal.target);
    if (!at) return null;
    const p = g.myPos();
    const d = Math.hypot(at.x - p.x, at.z - p.z);
    const me = g.hud.me;
    if (d > WALK_LIMIT && !nowarpItem(me.inv)) {
      const mine = new Set(me.stones ?? []);
      const dest = near(at, STONES.filter((s) => mine.has(s.id)));
      const here = near(p, STONES);
      if (dest && here && dest.id !== here.id && Math.hypot(dest.x - at.x, dest.z - at.z) <= 150 && Math.hypot(here.x - p.x, here.z - p.z) < d / 2) {
        const fee = travelFee(here, dest);
        return {
          mode: 'travel',
          label: `Travel to ${dest.name} (${fee} 🪙)`,
          fee,
          run: () => {
            const go = async () => (await g.travelTo(dest.id)) && setTimeout(() => this.locate(goal.target)?.go(), 400);
            if (Math.hypot(here.x - p.x, here.z - p.z) < STONE_RANGE - 1) return go();
            const [fx, fz] = stoneFront(here, 2);
            g.walkTo(fx, fz, true, go);
          },
        };
      }
    }
    return { mode: 'walk', label: at.here ? 'Open' : 'Take me there', run: at.go, at };
  }
}
