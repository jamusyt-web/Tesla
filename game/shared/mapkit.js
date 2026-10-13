// Tools for building the world map, shared by the world editor, the server's
// patch loader and the world-building scripts (scripts/world/lib.mjs):
//   stamps:  the standard town kit (SPEC §3.1) and an outpost (§1.4)
//   patches: id-keyed additions to a map, applied once each (§11.2)
//   checks:  reachability over passages and docks, and the editor's lints (§8.2)
// Plain data in, plain data out: nothing here touches the live world.
import { NODE_TYPES } from './nodes.js';

// Every list of map entries (the order the editor shows them in).
export const MAP_LISTS = ['lands', 'regions', 'buildings', 'gates', 'plazas', 'fountains', 'lakes', 'docks', 'zones', 'paths', 'nodes', 'spawns', 'stones', 'entrances', 'props', 'landmarks', 'passages', 'skyline'];

// ── Stamps ───────────────────────────────────────────────────────────
// The standard town kit, as offsets from the town centre. Every town has
// the same layout, so heroes always know where things are.
export const STATION_SET = [
  ['forge', 'proc_forge', -22.3, -11.8, 0.8],
  ['anvil', 'workshop_anvil', -19.5, -11.6, 0.7],
  ['workbench', 'workshop_workbench', -16.2, -11.9, 0.8],
  ['grindstone', 'workshop_grindstone', -13.4, -11.5, 0.6],
  ['cookpot', 'proc_cookpot', -10.7, -12.3, 0.7],
];
// opts: { name, tier, biome, kit, sig (signature station kind), r }
export function stampTownKit(t, x, z, opts = {}) {
  const at = (dx, dz) => ({ x: +(x + dx).toFixed(2), z: +(z + dz).toFixed(2) });
  const name = opts.name ?? t[0].toUpperCase() + t.slice(1);
  const kit = opts.kit && opts.kit !== 'ftk' ? { kit: opts.kit } : {};
  const out = {
    regions: [{ id: t, name, tier: opts.tier ?? 1, kind: 'town', ...at(0, 0), r: opts.r ?? 70, stone: `stone_${t}`, ...(opts.biome ? { biome: opts.biome } : {}) }],
    plazas: [{ id: `${t}_plaza`, ...at(0, 0), r: 11.2 }],
    stones: [{ id: `stone_${t}`, name: `${name} Square`, ...at(6.2, 5.2), rot: -1.76 }],
    buildings: [
      { id: `${t}_market`, label: 'Market', icon: '⚖️', glyph: 'scales', action: 'market', ...at(18, -6), w: 11, d: 8, face: 'w', style: 'market', ...kit },
      { id: `${t}_workshop`, label: 'Workshop', icon: '🔨', glyph: 'anvil', action: 'craft', ...at(-17, -6), w: 9, d: 7, face: 'e', style: 'workshop', ...kit },
      { id: `${t}_shop`, label: 'Shops', icon: '🏪', glyph: 'shop', action: 'shop', ...at(-15, 16), w: 9, d: 7, face: 'n', style: 'shop', ...kit },
      { id: `${t}_townhall`, label: 'Town Hall', icon: '🏛️', glyph: 'castle', action: 'townhall', ...at(16, 17.5), w: 11, d: 10, face: 'n', style: 'townhall', ...kit },
    ],
    props: [
      ...STATION_SET.map(([kind, slot, dx, dz, r]) => ({ id: `${t}_${kind}`, slot, ...at(dx, dz), rot: 0, r, station: kind })),
      ...(opts.sig ? [{ id: `${t}_sig`, slot: 'proc_forge', ...at(-30, -14), rot: 0, r: 0.8, station: opts.sig }] : []),
      { id: `${t}_board`, slot: 'proc_job_board', ...at(-6.2, 5.2), rot: 0, r: 0.6, orders: t },
      { id: `${t}_supplier`, slot: 'market_stall_canopy', ...at(30, -10), rot: 0, r: 1.2, supplier: t },
    ],
    zones: [{ id: `${t}_yard`, kind: 'town', label: `${name} Yard`, ...at(-17, -12), r: 14, ground: '#b9a27a' }],
  };
  return out;
}
// An outpost around its waystone: a campfire, a cookpot and a notice post.
export function stampOutpost(id, x, z, opts = {}) {
  const at = (dx, dz) => ({ x: +(x + dx).toFixed(2), z: +(z + dz).toFixed(2) });
  const name = opts.name ?? id[0].toUpperCase() + id.slice(1);
  return {
    regions: [{ id, name, tier: opts.tier ?? 1, kind: 'outpost', ...at(0, 5), r: opts.r ?? 34, stone: `stone_${id}`, ...(opts.biome ? { biome: opts.biome } : {}) }],
    stones: [{ id: `stone_${id}`, name, ...at(0, 0), rot: 0 }],
    props: [
      { id: `${id}_fire`, slot: 'campfire', ...at(4, 3), rot: 0, r: 0.7 },
      { id: `${id}_cookpot`, slot: 'proc_cookpot', ...at(-4, 3), rot: 0, r: 0.7, station: 'cookpot' },
      { id: `${id}_notice`, slot: 'proc_signboard', ...at(0, 6), rot: 0, r: 0.4 },
    ],
  };
}

// ── Patches ──────────────────────────────────────────────────────────
// Footprints that mustn't overlap: buildings (rectangles) and blocking
// props (circles with r > 0).
const rectOf = (b) => {
  const swap = b.face === 'e' || b.face === 'w';
  return { x: b.x, z: b.z, w: (swap ? b.d : b.w) ?? 0, d: (swap ? b.w : b.d) ?? 0 };
};
function overlaps(a, b) {
  if (a.w != null && b.w != null) return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;
  if (a.r != null && b.r != null) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r;
  const [c, q] = a.r != null ? [a, b] : [b, a];
  const dx = Math.max(Math.abs(c.x - q.x) - q.w / 2, 0);
  const dz = Math.max(Math.abs(c.z - q.z) - q.d / 2, 0);
  return Math.hypot(dx, dz) < c.r;
}
const footprint = (list, e) => (list === 'buildings' ? rectOf(e) : list === 'props' && e.r > 0 ? { x: e.x, z: e.z, r: e.r } : null);
const solids = (map) => [
  ...(map.buildings ?? []).map((b) => ({ id: b.id, f: rectOf(b) })),
  ...(map.props ?? []).filter((p) => p.r > 0).map((p) => ({ id: p.id, f: { x: p.x, z: p.z, r: p.r } })),
];

// Apply patches ({ id, add: { list: [entries] }, remove? }) in id order.
// Each runs once (recorded in map.patches): it adds every entry whose id is
// new, skipping any whose footprint collides with a building or blocking
// prop. Returns { map, changed, report: [{ patch, status, added, skipped:
// [{ list, id, why }] }] }. The input map isn't modified.
export function applyPatches(map, patches, { projects = false } = {}) {
  const m = JSON.parse(JSON.stringify(map));
  m.patches ??= [];
  const report = [];
  let changed = false;
  for (const p of [...patches].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!p?.id) continue;
    if (m.patches.includes(p.id)) {
      report.push({ patch: p.id, status: 'already applied', added: 0, skipped: [] });
      continue;
    }
    if (p.remove?.length && !projects) {
      report.push({ patch: p.id, status: 'refused: only project patches may remove things', added: 0, skipped: [] });
      continue;
    }
    const used = new Set(MAP_LISTS.flatMap((k) => (m[k] ?? []).map((e) => e.id)));
    const solid = solids(m);
    const skipped = [];
    let added = 0;
    for (const [list, entries] of Object.entries(p.add ?? {})) {
      if (!MAP_LISTS.includes(list)) {
        skipped.push({ list, id: '*', why: `unknown list "${list}"` });
        continue;
      }
      for (const e of entries) {
        if (!e?.id) {
          skipped.push({ list, id: '?', why: 'no id' });
          continue;
        }
        if (used.has(e.id)) {
          skipped.push({ list, id: e.id, why: 'that id is already on the map' });
          continue;
        }
        const f = footprint(list, e);
        const hit = f && solid.find((s) => overlaps(f, s.f));
        if (hit) {
          skipped.push({ list, id: e.id, why: `it would overlap ${hit.id}` });
          continue;
        }
        (m[list] ??= []).push(e);
        used.add(e.id);
        if (f) solid.push({ id: e.id, f });
        added++;
      }
    }
    for (const id of p.remove ?? []) for (const k of MAP_LISTS) if (m[k]) m[k] = m[k].filter((e) => e.id !== id);
    m.patches.push(p.id);
    changed = true;
    report.push({ patch: p.id, status: 'applied', added, skipped });
  }
  return { map: m, changed, report };
}

// ── Reachability ─────────────────────────────────────────────────────
// Which lands you can get to from the spawn: walking across overlapping
// land, along docks and bridges, and through passages. { reached, cut }.
export function landReach(map) {
  const lands = map.lands ?? [];
  const landAt = (x, z) => lands.filter((l) => Math.hypot(x - l.x, z - l.z) <= l.r);
  const edges = new Map(lands.map((l) => [l.id, new Set()]));
  const link = (a, b) => a !== b && (edges.get(a)?.add(b), edges.get(b)?.add(a));
  for (let i = 0; i < lands.length; i++)
    for (let j = i + 1; j < lands.length; j++) if (Math.hypot(lands[i].x - lands[j].x, lands[i].z - lands[j].z) <= lands[i].r + lands[j].r) link(lands[i].id, lands[j].id);
  // A dock touches the land at both its ends.
  for (const d of map.docks ?? []) {
    const ends = [[d.x, d.z - d.d / 2], [d.x, d.z + d.d / 2], [d.x - d.w / 2, d.z], [d.x + d.w / 2, d.z]].flatMap(([x, z]) => landAt(x, z).map((l) => l.id));
    for (const a of ends) for (const b of ends) link(a, b);
  }
  for (const p of map.passages ?? []) for (const a of landAt(p.x, p.z)) for (const b of landAt(p.tx, p.tz)) link(a.id, b.id);
  const start = landAt(map.spawn?.x ?? 0, map.spawn?.z ?? 0).map((l) => l.id);
  const reached = new Set(start);
  const todo = [...start];
  while (todo.length) for (const n of edges.get(todo.pop()) ?? []) if (!reached.has(n)) (reached.add(n), todo.push(n));
  return { reached, cut: lands.filter((l) => !reached.has(l.id)).map((l) => l.id) };
}

// ── Lints (the editor's panel; each has a point to jump to) ──────────
// The highest skill gate a node may have in a region of each tier.
export const NODE_BAND_MAX = { 1: 8, 2: 12, 3: 22, 4: 25, 5: 36 };
const smallest = (list, x, z, ok = () => true) => list.filter((e) => Math.hypot(x - e.x, z - e.z) < e.r && ok(e)).sort((a, b) => a.r - b.r)[0] ?? null;

export function mapLints(map, { gzBytes = null } = {}) {
  const out = [];
  const push = (kind, text, at) => out.push({ kind, text, x: at?.x ?? 0, z: at?.z ?? 0 });
  const regions = map.regions ?? [];
  const stones = map.stones ?? [];
  const props = map.props ?? [];
  const inR = (r, e) => Math.hypot(e.x - r.x, e.z - r.z) < r.r;
  // Towns need the whole kit; outposts their stone, fire, cookpot and notice.
  for (const r of regions) {
    if (r.kind === 'town') {
      const has = (ok) => [...(map.buildings ?? []), ...props].some((e) => inR(r, e) && ok(e));
      const missing = [];
      if (!stones.some((s) => s.id === r.stone || inR(r, s))) missing.push('a waystone');
      const an = (w) => `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`;
      for (const a of ['market', 'craft', 'shop', 'townhall']) if (!has((e) => e.action === a)) missing.push(an(a === 'craft' ? 'workshop' : a === 'townhall' ? 'town hall' : a));
      for (const [kind] of STATION_SET) if (!has((e) => e.station === kind)) missing.push(an(kind));
      if (!has((e) => e.slot === 'proc_job_board')) missing.push('an order board');
      if (!has((e) => e.supplier)) missing.push('a supplier stall');
      if (missing.length) push('town kit', `${r.name} is missing ${missing.join(', ')}`, r);
    } else if (r.kind === 'outpost') {
      const near = (ok) => props.some((p) => inR(r, p) && ok(p));
      if (!stones.some((s) => s.id === r.stone || inR(r, s)) || !near((p) => p.slot === 'campfire') || !near((p) => p.station === 'cookpot')) push('region', `${r.name}: an outpost needs a waystone, a campfire and a cookpot`, r);
    } else if (r.kind === 'wild') {
      const camps = (map.spawns ?? []).filter((s) => inR(r, s)).length;
      const nodes = (map.nodes ?? []).filter((n) => inR(r, n)).length;
      if (camps < 1 || nodes < 6) push('region', `${r.name}: wild regions want a camp and 6+ nodes (has ${camps} and ${nodes})`, r);
    }
  }
  // Nodes above their region's band.
  for (const n of map.nodes ?? []) {
    const r = smallest(regions, n.x, n.z);
    const t = NODE_TYPES[n.type];
    if (r && t && t.lvl > (NODE_BAND_MAX[r.tier] ?? 50)) push('node band', `${t.name} (${t.skill} ${t.lvl}) is above ${r.name}'s band (tier ${r.tier})`, n);
  }
  // Everywhere worth going is within 300 m of a waystone.
  const points = [...regions.map((r) => ({ ...r, what: r.name })), ...(map.landmarks ?? []).map((l) => ({ ...l, what: l.name })), ...(map.entrances ?? []).map((e) => ({ ...e, what: `the ${e.kind} door` }))];
  for (const p of points) if (stones.length && Math.min(...stones.map((s) => Math.hypot(s.x - p.x, s.z - p.z))) > 300) push('stones', `${p.what} is more than 300 m from a waystone`, p);
  // Long empty stretches of road.
  const pois = [...stones, ...(map.landmarks ?? []), ...(map.spawns ?? []), ...(map.entrances ?? []), ...(map.lakes ?? []), ...(map.gates ?? []), ...(map.nodes ?? []), ...(map.passages ?? [])];
  for (const path of map.paths ?? []) {
    if ((path.w ?? 0) < 2.5) continue; // town paths, not roads
    let run = 0;
    let worst = 0;
    let at = null;
    for (let i = 1; i < path.pts.length; i++) {
      const [ax, az] = path.pts[i - 1];
      const [bx, bz] = path.pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < len; s += 5) {
        const x = ax + ((bx - ax) * s) / len;
        const z = az + ((bz - az) * s) / len;
        if (pois.some((q) => Math.hypot(q.x - x, q.z - z) < 30 + (q.r ?? 0))) run = 0;
        else if ((run += 5) > worst) (worst = run), (at = { x, z });
      }
    }
    if (worst > 100) push('road gap', `${path.id}: ${Math.round(worst)} m of road with nothing along it`, at);
  }
  // Islands nobody can reach.
  const reach = landReach(map);
  for (const id of reach.cut) {
    const l = map.lands.find((x) => x.id === id);
    push('reachability', `Land ${id} can't be reached (no overlap, dock or passage leads there)`, l);
  }
  if (gzBytes != null && gzBytes > 200 * 1024) push('size', `The map is ${Math.round(gzBytes / 1024)} KB gzipped (keep it under 200 KB)`, map.spawn);
  return out;
}
