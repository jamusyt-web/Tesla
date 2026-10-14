// Helpers for the scripts that build new parts of the world as map patches
// (maps/patches/NNN_name.json, SPEC §11.2). A script stamps towns and
// outposts, adds roads, nodes and camps, checks the result against the
// shipped map, and writes the patch:
//
//   import { stampTownKit, merge, writePatch, check } from './lib.mjs';
//   const add = merge(stampTownKit('amberfold', -540, -60, { tier: 2, biome: 'autumn' }), { lands: [...] });
//   check(add);                       // throws on map problems, prints the lints
//   writePatch('020_amberfold', add);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampTownKit, stampOutpost, applyPatches, mapLints, landReach, MAP_LISTS } from '../../shared/mapkit.js';
import { mapProblems, upgradeMap } from '../../shared/world.js';

export { stampTownKit, stampOutpost, applyPatches, mapLints, landReach };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PATCH_DIR = path.join(ROOT, 'maps', 'patches');
export const SHIPPED = path.join(ROOT, 'maps', 'world.json');

// Join several { list: [entries] } bundles into one.
export function merge(...parts) {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) (out[k] ??= []).push(...v);
  return out;
}

// The shipped map with this patch (and every earlier one) applied: throws if
// it has problems; returns { map, report, lints }.
export function check(add, { id = 'check', base = JSON.parse(fs.readFileSync(SHIPPED, 'utf8')) } = {}) {
  const earlier = fs.existsSync(PATCH_DIR)
    ? fs.readdirSync(PATCH_DIR).filter((f) => /^\d{3}_[\w-]+\.json$/.test(f) && f.replace(/\.json$/, '') < id).sort().map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(PATCH_DIR, f), 'utf8')) }))
    : [];
  const { map, report } = applyPatches(upgradeMap(base), [...earlier, { id, add }]);
  const bad = mapProblems(map);
  if (bad.length) throw new Error(`Map problems:\n- ${bad.join('\n- ')}`);
  const lints = mapLints(map);
  for (const l of lints) console.log(`lint (${l.kind}): ${l.text}`);
  return { map, report, lints };
}

// The shipped map with every patch before `id` applied (what a new patch adds to).
export function mapBefore(id) {
  const base = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
  const earlier = fs.readdirSync(PATCH_DIR).filter((f) => /^\d{3}_[\w-]+\.json$/.test(f) && f.replace(/\.json$/, '') < id).sort().map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(fs.readFileSync(path.join(PATCH_DIR, f), 'utf8')) }));
  return applyPatches(upgradeMap(base), earlier).map;
}

// Where new things can go on a map: free(x, z, opts) is true on land (4 m
// in), off roads, lakes, buildings, solid props, landmarks, doors, stones,
// plazas and camps, and `clear` m from every node; take(entry) adds what you
// placed so later ones keep clear of it. `add` is this patch's own lists so far.
// opts: { clear = 4.5, inland = 4, away: [{ x, z, r }] (more places to keep off) }
export function placer(map, add = {}) {
  const all = (k) => [...(map[k] ?? []), ...(add[k] ?? [])];
  const lands = all('lands');
  const lakes = all('lakes');
  const segs = all('paths').flatMap((p) => p.pts.slice(1).map((b, i) => [...p.pts[i], ...b, p.w]));
  const rect = (b) => (b.face === 'e' || b.face === 'w' ? { x: b.x, z: b.z, w: b.d, d: b.w } : b);
  const buildings = all('buildings').map(rect);
  const solids = all('props').filter((p) => p.r > 0);
  const points = [...all('landmarks'), ...all('entrances').map((e) => ({ ...e, r: 8 })), ...all('stones'), ...all('plazas'), ...all('gates').map((g) => ({ ...g, r: 18 }))];
  const camps = all('spawns');
  const nodes = all('nodes');
  const segDist = (x, z, [ax, az, bx, bz]) => {
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
  };
  const free = (x, z, { clear = 4.5, inland = 4, away = [] } = {}) => {
    if (Math.max(...lands.map((l) => l.r - Math.hypot(x - l.x, z - l.z))) < inland) return false;
    if (lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 4)) return false;
    if (segs.some((s) => segDist(x, z, s) < s[4] + 2.5)) return false;
    if (buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 3 && Math.abs(z - b.z) < b.d / 2 + 3)) return false;
    if (solids.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2.5)) return false;
    if (points.some((p) => Math.hypot(x - p.x, z - p.z) < (p.r ?? 3) + 3)) return false;
    if (camps.some((s) => Math.hypot(x - s.x, z - s.z) < s.r)) return false;
    if (away.some((a) => Math.hypot(x - a.x, z - a.z) < a.r)) return false;
    return !nodes.some((n) => Math.hypot(x - n.x, z - n.z) < clear);
  };
  return { free, take: (n) => nodes.push(n) };
}

// A shifting grove (server/groves.js): slots for `types` (weighted [[type, w]])
// spread over the circle (cx, cz, r) at least `spacing` m apart, placed with
// `P` (a placer). Returns the nodes; each carries grove: id. rng: seeded.
export function growForest(P, id, { cx, cz, r, types, spacing = 5, slots = 40, rng, s = [0.9, 1.15] }) {
  const out = [];
  const total = types.reduce((a, [, w]) => a + w, 0);
  const pick = () => {
    let x = rng() * total;
    for (const [t, w] of types) if ((x -= w) < 0) return t;
    return types[0][0];
  };
  for (let tries = 0; out.length < slots && tries < slots * 60; tries++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * r;
    const x = Math.round((cx + Math.cos(a) * d) * 100) / 100;
    const z = Math.round((cz + Math.sin(a) * d) * 100) / 100;
    if (!P.free(x, z, { clear: spacing })) continue;
    const n = { id: `${id}_${out.length}`, type: pick(), x, z, rot: Math.round(rng() * 628) / 100, s: Math.round((s[0] + rng() * (s[1] - s[0])) * 100) / 100, grove: id };
    P.take(n);
    out.push(n);
  }
  return out;
}

// Write maps/patches/<id>.json, its lists in the map's order.
export function writePatch(id, add) {
  const ordered = Object.fromEntries(MAP_LISTS.filter((k) => add[k]?.length).map((k) => [k, add[k]]));
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  const lines = ['{', '  "add": {'];
  const keys = Object.keys(ordered);
  keys.forEach((k, i) => {
    lines.push(`    ${JSON.stringify(k)}: [`);
    ordered[k].forEach((e, j) => lines.push(`      ${JSON.stringify(e)}${j < ordered[k].length - 1 ? ',' : ''}`));
    lines.push(`    ]${i < keys.length - 1 ? ',' : ''}`);
  });
  lines.push('  }', '}');
  const file = path.join(PATCH_DIR, `${id}.json`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
