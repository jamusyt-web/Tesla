// The journal and discovery (SPEC §5.5): the rules both sides share.
//
// Exploring: the land is cut into 16 m cells; walking within 32 m of one
// marks it. One bit per cell per hero (server/explore.js keeps them).
// Each region's page reads 60% from cells walked and 40% from places found
// (landmarks, waystones, dungeon doors and lakes).
import { LANDS, REGIONS, LANDMARKS, STONES, ENTRANCES, LAKES, landDistance } from './world.js';
import { regionAt } from './places.js';
import { DUNGEONS } from './dungeon.js';
import { mulberry32 } from './world.js';

export const CELL = 16;
export const SEE = 32; // metres around you that count as explored

// ── The grid ──
let GRID = null;
let GRID_FOR = null;
// The cells over the land's bounding box: { x0, z0, w, h }.
export function grid() {
  if (GRID && GRID_FOR === LANDS) return GRID;
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of LANDS) [x0, z0, x1, z1] = [Math.min(x0, l.x - l.r), Math.min(z0, l.z - l.r), Math.max(x1, l.x + l.r), Math.max(z1, l.z + l.r)];
  if (!LANDS.length) [x0, z0, x1, z1] = [-96, -96, 96, 96];
  x0 = Math.floor(x0 / CELL) * CELL;
  z0 = Math.floor(z0 / CELL) * CELL;
  GRID = { x0, z0, w: Math.ceil((x1 - x0) / CELL), h: Math.ceil((z1 - z0) / CELL) };
  GRID_FOR = LANDS;
  REGION_CELLS = null;
  return GRID;
}
export const bytesFor = (G) => Math.ceil((G.w * G.h) / 8);
export const cellIndex = (G, x, z) => {
  const i = Math.floor((x - G.x0) / CELL);
  const j = Math.floor((z - G.z0) / CELL);
  return i < 0 || j < 0 || i >= G.w || j >= G.h ? -1 : j * G.w + i;
};
export const cellCentre = (G, k) => ({ x: G.x0 + ((k % G.w) + 0.5) * CELL, z: G.z0 + (Math.floor(k / G.w) + 0.5) * CELL });
export const hasBit = (bits, k) => k >= 0 && (bits[k >> 3] & (1 << (k & 7))) !== 0;
export const setBit = (bits, k) => (bits[k >> 3] |= 1 << (k & 7));

// Mark every cell within SEE of (x, z); returns the cells that are new.
export function markAround(bits, G, x, z, r = SEE) {
  const out = [];
  const i0 = Math.floor((x - r - G.x0) / CELL);
  const i1 = Math.floor((x + r - G.x0) / CELL);
  const j0 = Math.floor((z - r - G.z0) / CELL);
  const j1 = Math.floor((z + r - G.z0) / CELL);
  for (let j = Math.max(0, j0); j <= Math.min(G.h - 1, j1); j++)
    for (let i = Math.max(0, i0); i <= Math.min(G.w - 1, i1); i++) {
      const cx = G.x0 + (i + 0.5) * CELL;
      const cz = G.z0 + (j + 0.5) * CELL;
      if (Math.hypot(cx - x, cz - z) > r + CELL * 0.5) continue;
      const k = j * G.w + i;
      if (hasBit(bits, k)) continue;
      setBit(bits, k);
      out.push(k);
    }
  return out;
}

// Bits saved under an older grid (the world grew): move each to its new cell.
export function reproject(bits, from, to = grid()) {
  if (from.x0 === to.x0 && from.z0 === to.z0 && from.w === to.w && from.h === to.h) return bits;
  const out = new Uint8Array(bytesFor(to));
  for (let k = 0; k < from.w * from.h; k++) {
    if (!hasBit(bits, k)) continue;
    const c = cellCentre(from, k);
    const n = cellIndex(to, c.x, c.z);
    if (n >= 0) setBit(out, n);
  }
  return out;
}

// ── Regions: land cells and the places to find ──
let REGION_CELLS = null;
const isLandCell = (G, k) => {
  const c = cellCentre(G, k);
  return landDistance(c.x, c.z) < 0;
};
// The land cells of each region: Map(region id → [cell indexes]).
export function regionCells() {
  const G = grid();
  if (REGION_CELLS) return REGION_CELLS;
  REGION_CELLS = new Map(REGIONS.map((r) => [r.id, []]));
  for (let k = 0; k < G.w * G.h; k++) {
    if (!isLandCell(G, k)) continue;
    const c = cellCentre(G, k);
    const r = regionAt(c.x, c.z);
    if (r) REGION_CELLS.get(r.id)?.push(k);
  }
  return REGION_CELLS;
}
export const resetJournalCache = () => ((GRID = null), (REGION_CELLS = null));

// Every place to discover: { id, kind, name, x, z, r, region }.
export function discoverables() {
  const out = [];
  const add = (id, kind, name, x, z, r) => out.push({ id, kind, name, x, z, r, region: regionAt(x, z)?.id ?? null });
  for (const l of LANDMARKS) add(l.id, l.kind, l.name ?? l.id, l.x, l.z, l.r ?? 8);
  for (const s of STONES) add(s.id, 'stone', s.name ?? 'Waystone', s.x, s.z, 8);
  for (const e of ENTRANCES) add(e.id, 'door', DUNGEONS[e.kind]?.name ?? 'A dungeon door', e.x, e.z, 12);
  for (const l of LAKES) add(l.id, 'lake', l.name ?? 'A lake', l.x, l.z, l.r + 6);
  return out;
}

// A page's discovery: 60 × walked / land + 40 × found / places, out of 100.
export function pagePct(walked, land, found, places) {
  if (!land && !places) return 0;
  if (!places) return Math.floor((100 * walked) / land);
  if (!land) return Math.floor((100 * found) / places);
  return Math.floor((60 * walked) / land + (40 * found) / places);
}

// ── Rewards ──
export const PAGE_STEPS = [25, 50, 75, 100];
export const JOURNAL_REP = 50; // each page milestone is worth this much reputation in its town
// What a page milestone gives (region: the regions entry).
export function pageReward(region, pct) {
  if (pct === 25) return { pins: true, text: 'Its caches and fishing spots are marked on your map' };
  if (pct === 50) return { title: `${region.name} Wanderer`, text: `Title: ${region.name} Wanderer` };
  if (pct === 75) return { cloak: region.biome ?? 'meadow', text: `A ${region.biome ?? 'meadow'} tint for your cloak` };
  if (pct === 100) return { stoneDiscount: 0.5, plaque: true, text: 'Waystone fees to this region −50%, and a plaque for your shop' };
  return null;
}
// The whole journal: the average of every page.
export const WHOLE_STEPS = [50, 100];
export function wholeReward(pct) {
  if (pct === 50) return { items: { charm_wayfarer: 1 }, text: "Wayfarer's Charm (+8% walk speed)" };
  if (pct === 100) return { title: 'Keeper of the Hearthlands', text: 'Title: Keeper of the Hearthlands' };
  return null;
}

// ── Landmarks ──
// What each kind does at the context button (server/landmarks.js runs it).
export const LANDMARK_INFO = {
  vista: { verb: 'Take in the view', glyph: 'eye', reset: 'once' },
  ruin: { verb: 'Read the ruin', glyph: 'scroll', reset: 'once' },
  shrine: { verb: 'Pray', glyph: 'spark', reset: 'cooldown', ms: 30 * 60_000 },
  cache: { verb: 'Open the cache', glyph: 'chest', reset: 'weekly' },
  secret: { verb: 'Search', glyph: 'search', reset: 'once' },
  curio: { verb: 'Pick it up', glyph: 'hand', reset: 'once' },
  npc: { verb: 'Talk', glyph: 'talk', reset: 'none' },
  landmark: { verb: null, glyph: 'flag', reset: 'none' },
};
export const LANDMARK_RANGE = 4; // how close to stand to use one
export const SPARKLE_RANGE = 15; // caches sparkle when you're this near

// A cache's loot: gold [20, 40] × tier and 1–2 of the region's materials.
export function cacheLoot(tier, materials, rng = Math.random, glimmer = false) {
  const T = Math.max(1, tier);
  const roll = () => {
    const out = { gold: Math.round((20 + rng() * 20) * T), items: {} };
    const n = 1 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n && materials.length; i++) {
      const m = materials[Math.floor(rng() * materials.length)];
      out.items[m] = (out.items[m] ?? 0) + 1 + Math.floor(rng() * 2 * T);
    }
    return out;
  };
  const a = roll();
  if (!glimmer) return a;
  const b = roll(); // a glimmer: a second roll
  for (const [k, v] of Object.entries(b.items)) a.items[k] = (a.items[k] ?? 0) + v;
  a.gold += b.gold;
  return a;
}

// This week's glimmers: 6 caches picked from every cache, the same for everyone.
export function glimmers(week) {
  const caches = LANDMARKS.filter((l) => l.kind === 'cache').map((l) => l.id);
  const rng = mulberry32(week * 2654435761);
  const out = [];
  while (out.length < Math.min(6, caches.length)) out.push(caches.splice(Math.floor(rng() * caches.length), 1)[0]);
  return out;
}

// ── Ysolde's Atlas: the Cartographer's hunt ──
// The tinker in Hearthvale gives page 1; each page's riddle points to the
// cache holding the next. The last place holds no page: the hunt's end.
export const ATLAS = [
  { at: 'npc_tinker', riddle: 'Where boards keep the lake from your boots, look beneath. Mirror Lake, Hearthvale.' },
  { at: 'cache_under_pier', riddle: 'West past the gate, a log lies hollow where the causeway ends. The Westmarch.' },
  { at: 'cache_hollowlog', riddle: 'North on the causeway a cart drowned in the reeds. Hollowmere.' },
  { at: 'cache_drowned_cart', riddle: 'Under the miller’s eaves a box keeps his secrets. Amberfold.' },
  { at: 'cache_millers_box', riddle: 'Where the bear sleeps on the Thornback road, mind your step.' },
  { at: 'cache_bearden', riddle: 'The trappers of Rimeholt Fells hide more than furs.' },
  { at: 'cache_trappers', riddle: 'Squeeze past the Ninefold Barrow’s stones; the dead keep a box.' },
  { at: 'cache_ninefold', riddle: 'On the Midmarch moor a cairn marks an old grave, and a gift.' },
  { at: 'cache_cairn', riddle: 'A caravan box lies half-buried in the Dunesea sands.' },
  { at: 'cache_caravan_box', riddle: 'Climb to the Eyrie above the Skystair; the eagles guard it.' },
  { at: 'cache_eyrie', riddle: 'Where a star fell, a fragment waits by the crater rim.' },
  { at: 'cache_fallen_star', riddle: 'Swim to the islet where the Starfallen stands. The last page tells you nothing more: it is the end.' },
];
export const ATLAS_END = 'secret_starfallen';
export const atlasPage = (n) => `atlas_page_${n}`;
// The page a place gives a hero holding `pages` (Set of page numbers), or null.
export function atlasDrop(landmarkId, pages) {
  const i = ATLAS.findIndex((p) => p.at === landmarkId);
  if (i < 0) return null;
  const n = i + 1; // this place holds page n
  if (n === 1) return pages.has(1) ? null : 1; // the tinker
  return pages.has(n - 1) && !pages.has(n) ? n : null;
}
