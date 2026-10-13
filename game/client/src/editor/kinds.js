// Everything the world editor can place and edit, one entry per map list.
// Each kind says how to show it in the inspector (fields), where you can click
// it (hit), what a new one looks like (make), and how to label it.
import { NODE_TYPES, CRYPT, LANDMARK_KINDS, PASSAGE_KINDS, REGION_KINDS } from '../../../shared/world.js';
import { DUNGEONS } from '../../../shared/dungeon.js';
import { MONSTERS } from '../../../shared/monsters.js';
import { BIOMES } from '../../../shared/biomes.js';
import { FISH_TABLES } from '../../../shared/fishing.js';
import { TRADE } from '../../../shared/economy.js';
import { STATIONS } from '../../../shared/crafting.js';
import { SKILLS } from '../../../shared/skills.js';
import { ITEMS } from '../../../shared/items.js';
import { STATION_SET, stampTownKit, stampOutpost } from '../../../shared/mapkit.js';
import { MODELS } from '../scene/manifest/index.js';
import { PROC_BUILDERS } from '../scene/procprops.js';
import * as assets from '../scene/assets.js';

const deg = (r) => Math.round((r * 180) / Math.PI);
export const pretty = (slot) =>
  slot
    .replace(/^(deco|prop|proc|workshop|market)_/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

// Slots you can place as props: everything in the manifest except item icons,
// gatherable nodes (placed as nodes), creatures and raw building-kit pieces
// ("kit:piece", used to assemble buildings), plus the code-drawn kinds.
const NOT_PROPS = /^(icon:|tree_|rock_|herb_|npc_|mob_)|:/;
export const PROP_SLOTS = [...Object.keys(MODELS).filter((s) => !NOT_PROPS.test(s)), ...Object.keys(PROC_BUILDERS)].sort();
// Ground cover never blocks movement; trees and big things do.
const SOFT = /^(deco_(flower|grass|lily_pad|mushroom)|lantern_hanging|market_goods_)/;

// A sensible collision radius for a new prop: like the copies already on the
// map if there are any, otherwise from the model's size.
export function defaultRadius(map, slot, s = 1) {
  if (SOFT.test(slot)) return 0;
  const same = map.props.filter((p) => p.slot === slot);
  if (same.length) {
    const rs = same.map((p) => (p.r || 0) / (p.s || 1)).sort((a, b) => a - b);
    return +(rs[rs.length >> 1] * s).toFixed(2);
  }
  const size = assets.sizeOf(slot);
  return size ? +(Math.min(size.x, size.z) * 0.4 * s).toFixed(2) : 0.5;
}

const num = (key, label, step = 0.1, extra = {}) => ({ key, label, type: 'num', step, ...extra });
const XZ = [num('x', 'X'), num('z', 'Z')];
const COLOR = (key, label) => ({ key, label, type: 'color' });
const sel = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
// Select options with a "none" first (stored as no field at all).
const opt = (none, list) => [['', none], ...list];
const BIOME_OPTS = () => Object.keys(BIOMES).map((b) => [b, b]);
const KIT_OPTS = [['ftk', 'Fantasy town (ftk)'], ['cabin', 'Holiday cabin'], ['adobe', 'Adobe'], ['slate', 'Slate castle']];
const STYLE_OPTS = ['cottage', 'hall', 'market', 'workshop', 'shop', 'townhall'].map((k) => [k, k]);
const ACTION_OPTS = [['market', 'Market'], ['craft', 'Workshop (crafting)'], ['shop', 'Player shops'], ['townhall', 'Town Hall']];

export const KINDS = {
  props: {
    label: 'Prop',
    prefix: 'p',
    order: 1,
    name: (e) => pretty(e.slot),
    hit: (e) => ({ r: Math.max(e.r || 0, 0.7 * (e.s ?? 1)) }),
    fields: (e) => [
      { key: 'slot', label: 'Model', type: 'select', options: PROP_SLOTS.map((s) => [s, pretty(s)]) },
      ...XZ,
      { key: 'rot', label: 'Turn (°)', type: 'deg' },
      num('s', 'Size', 0.05, { min: 0.1, def: 1 }),
      num('r', 'Blocks within (m)', 0.05, { min: 0, help: '0 = you can walk through it' }),
      num('y', 'Height', 0.05, { def: 0 }),
      num('v', 'Variant', 1, { min: 0, def: 0, int: true }),
      { key: 'bob', label: 'Bobs on water', type: 'check' },
      ...(e.station ? [sel('station', 'Crafting station', Object.entries(STATIONS).map(([k, st]) => [k, st.label]))] : []),
      ...(e.supplier != null ? [text('supplier', 'Supplier stall of (town id)')] : []),
      ...(e.orders != null ? [text('orders', 'Order board of (town id)')] : []),
    ],
  },
  nodes: {
    label: 'Resource node',
    prefix: 'n',
    order: 1,
    name: (e) => NODE_TYPES[e.type]?.name ?? e.type,
    hit: (e) => ({ r: Math.max((NODE_TYPES[e.type]?.r || 0) * (e.s ?? 1), 0.7) }),
    fields: (e) => [
      { key: 'type', label: 'Type', type: 'select', options: Object.entries(NODE_TYPES).map(([k, t]) => [k, `${t.name} (lv ${t.lvl})`]) },
      ...XZ,
      { key: 'rot', label: 'Turn (°)', type: 'deg' },
      num('s', 'Size', 0.05, { min: 0.5, max: 1.6 }),
      ...(NODE_TYPES[e.type]?.kind === 'fish' ? [sel('table', 'Fish here', opt("(the lake's)", Object.keys(FISH_TABLES).map((k) => [k, k])))] : []),
    ],
  },
  buildings: {
    label: 'Building',
    prefix: 'cottage',
    order: 2,
    name: (e) => e.label || (e.deco ? 'Cottage' : e.id),
    hit: (e) => ({ w: e.w, d: e.d }),
    fields: (e) => [
      ...(e.deco ? [] : [{ key: 'label', label: 'Name', type: 'text' }]),
      ...XZ,
      num('w', 'Width (x)', 0.5, { min: 3 }),
      num('d', 'Depth (z)', 0.5, { min: 3 }),
      { key: 'face', label: 'Door faces', type: 'select', options: [['n', 'North'], ['e', 'East'], ['s', 'South'], ['w', 'West']] },
      ...(e.deco ? [] : [sel('action', 'Opens', ACTION_OPTS)]),
      sel('style', 'Look', opt('(from its id)', STYLE_OPTS)),
      sel('kit', 'Building kit', KIT_OPTS, { def: 'ftk' }),
      text('tex', 'Texture (cottages)'),
    ],
  },
  gates: {
    label: 'Gatehouse',
    prefix: 'gate',
    order: 2,
    name: (e) => e.label || 'Gatehouse',
    hit: (e) => ({ w: 7 * (e.scale ?? 4.5), d: e.scale ?? 4.5 }),
    fields: () => [{ key: 'label', label: 'Name', type: 'text' }, ...XZ, num('scale', 'Size', 0.1, { min: 2, max: 8 })],
  },
  stones: {
    label: 'Waystone',
    prefix: 'stone',
    order: 2,
    name: (e) => e.name || 'Waystone',
    hit: () => ({ r: 1.2 }),
    fields: () => [{ key: 'name', label: 'Name', type: 'text' }, ...XZ, { key: 'rot', label: 'Faces (°)', type: 'deg', help: 'Travellers arrive in front of it' }],
  },
  entrances: {
    label: 'Dungeon entrance',
    prefix: 'crypt',
    order: 2,
    name: (e) => DUNGEONS[e.kind]?.name ?? 'Dungeon',
    hit: () => ({ w: CRYPT.w, d: CRYPT.d }),
    fields: () => [{ key: 'kind', label: 'Dungeon', type: 'select', options: Object.entries(DUNGEONS).map(([k, d]) => [k, d.name]) }, ...XZ, { key: 'rot', label: 'Door faces (°)', type: 'deg', help: 'Heroes go in at the door' }],
  },
  fountains: { label: 'Fountain', prefix: 'fountain', order: 3, name: () => 'Fountain', hit: (e) => ({ r: e.r }), fields: () => [...XZ, num('r', 'Radius', 0.1, { min: 1.5, max: 6 })] },
  docks: { label: 'Dock', prefix: 'dock', order: 3, name: (e) => (e.style === 'bridge' ? 'Bridge' : 'Dock'), hit: (e) => ({ w: e.w, d: e.d }), fields: () => [...XZ, num('w', 'Width', 0.5, { min: 2 }), num('d', 'Length', 0.5, { min: 3 }), sel('style', 'Style', [['pier', 'Pier'], ['bridge', 'Bridge']], { def: 'pier' })] },
  spawns: {
    label: 'Monster camp',
    prefix: 'spawn',
    order: 4,
    name: (e) => (e.elite ? `Elite: ${e.name || MONSTERS[e.monster]?.name} (lv ${e.lvl})` : `${MONSTERS[e.monster]?.name ?? e.monster} ×${e.count}`),
    hit: (e) => ({ r: e.r, ring: true }),
    fields: (e) => [
      { key: 'monster', label: 'Monster', type: 'select', options: Object.entries(MONSTERS).map(([k, m]) => [k, `${m.name} (lv ${m.lvl})`]) },
      ...XZ,
      num('r', 'Roams within (m)', 0.5, { min: 2 }),
      num('count', 'How many', 1, { min: 1, max: 20, int: true }),
      { key: 'elite', label: 'Elite (restatted to its own level)', type: 'check' },
      ...(e.elite ? [num('lvl', 'Elite level', 1, { min: 1, max: 50, int: true, def: MONSTERS[e.monster]?.lvl ?? 1 }), text('name', 'Elite name')] : []),
    ],
  },
  paths: { label: 'Path', prefix: 'path', order: 5, name: () => 'Path', fields: () => [num('w', 'Width', 0.1, { min: 0.6, max: 5 })] },
  plazas: { label: 'Plaza', prefix: 'plaza', order: 6, name: () => 'Plaza', hit: (e) => ({ r: e.r, ring: true }), fields: () => [...XZ, num('r', 'Radius', 0.5, { min: 4 })] },
  lakes: {
    label: 'Lake',
    prefix: 'lake',
    order: 6,
    name: (e) => (e.kind === 'ice' ? 'Frozen lake' : 'Lake'),
    hit: (e) => ({ r: e.r, ring: true }),
    fields: () => [...XZ, num('r', 'Radius', 0.5, { min: 3 }), num('deep', 'Deep water within', 0.5, { min: 0, help: 'Fishing here catches bigger fish' }), sel('kind', 'Kind', [['water', 'Water'], ['ice', 'Frozen']], { def: 'water' }), sel('fish', 'Fish', opt('Mirror Lake', Object.keys(FISH_TABLES).filter((k) => k !== 'mirror').map((k) => [k, k])))],
  },
  zones: {
    label: 'Zone',
    prefix: 'zone',
    order: 7,
    name: (e) => e.label || 'Zone',
    hit: (e) => ({ r: e.r, ring: true }),
    fields: () => [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'select', options: ['meadow', 'forest', 'quarry', 'garden', 'lake', 'wilds', 'town'].map((k) => [k, k]) },
      ...XZ,
      num('r', 'Radius', 0.5, { min: 3 }),
      COLOR('ground', 'Ground colour'),
      sel('biome', 'Biome', opt('(inherit)', BIOME_OPTS())),
      num('cover', 'Ground cover ×', 0.1, { min: 0, max: 3, def: 1, help: '0 = none, 1 = the biome’s usual' }),
    ],
  },
  lands: { label: 'Land', prefix: 'land', order: 9, name: () => 'Land', hit: (e) => ({ r: e.r, ring: true }), fields: () => [...XZ, num('r', 'Radius', 1, { min: 5, help: 'Overlap pieces of land to shape the coast' })] },
  regions: {
    label: 'Region',
    prefix: 'region',
    order: 8,
    name: (e) => `${e.name} (tier ${e.tier})`,
    hit: (e) => ({ r: e.r, ring: true }),
    fields: (e, map) => [
      { key: 'name', label: 'Name', type: 'text' },
      num('tier', 'Difficulty tier', 1, { min: 1, max: 5, int: true }),
      sel('kind', 'Kind', REGION_KINDS.map((k) => [k, k])),
      ...XZ,
      num('r', 'Radius', 1, { min: 10 }),
      sel('biome', 'Biome', opt('(the map’s)', BIOME_OPTS())),
      sel('stone', 'Home waystone', opt('(nearest)', (map?.stones ?? []).map((s) => [s.id, s.name || s.id]))),
      ...(e.kind === 'town' ? [sel('trade', 'Merchant prices', opt('(its own, or Hearthvale’s)', Object.keys(TRADE).map((k) => [k, k])))] : []),
      { key: 'autoCover', label: 'Ground cover from its biome', type: 'check' },
    ],
  },
  landmarks: {
    label: 'Landmark',
    prefix: 'lm',
    order: 3,
    name: (e) => `${e.name || 'Landmark'} (${e.kind})`,
    hit: (e) => ({ r: Math.max(1.5, (e.r ?? 8) * 0.25) }),
    fields: () => [
      text('name', 'Name'),
      sel('kind', 'Kind', LANDMARK_KINDS.map((k) => [k, k])),
      ...XZ,
      num('r', 'Found within (m)', 0.5, { min: 2, def: 8 }),
      { key: 'look', label: 'Looks toward (°)', type: 'deg' },
      sel('reset', 'Refills', opt('never', [['weekly', 'every week'], ['once', 'once only']])),
      text('loot', 'Loot table'),
      text('lore', 'Lore'),
      num('page', 'Atlas page (1–12)', 1, { min: 1, max: 12, int: true }),
    ],
  },
  passages: {
    label: 'Passage',
    prefix: 'pass',
    order: 2,
    name: (e) => e.name || 'Passage',
    hit: () => ({ r: 1.5 }),
    // Its other end is a second handle you can drag.
    ends: (e) => [{ x: e.tx, z: e.tz, keys: ['tx', 'tz'] }],
    fields: (e) => [
      text('name', 'Name'),
      sel('kind', 'Kind', PASSAGE_KINDS.map((k) => [k, k])),
      ...XZ,
      num('tx', 'Other end X'),
      num('tz', 'Other end Z'),
      { key: 'req', label: 'Needs skill', type: 'req', skills: Object.keys(SKILLS) },
      sel('kit', 'Or carrying', opt('(no kit)', Object.entries(ITEMS).filter(([, it]) => it.kit).map(([k, it]) => [k, it.name]))),
    ],
  },
  skyline: {
    label: 'Skyline beacon',
    prefix: 'sky',
    order: 9,
    name: (e) => `Skyline: ${e.card}`,
    hit: () => ({ r: 4 }),
    fields: () => [sel('kind', 'Kind', ['tree', 'tower', 'mill', 'crystal', 'beacon'].map((k) => [k, k])), ...XZ, num('h', 'Height (m)', 1, { min: 4 }), sel('card', 'Looks like', PROP_SLOTS.map((k) => [k, pretty(k)]))],
  },
};
export const SKYLINE_MAX = 6;
export const KIND_KEYS = Object.keys(KINDS);

// What the Place panel offers. make(x, z, map) returns the new entity (no id yet).
const rnd = (a, b) => +(a + Math.random() * (b - a)).toFixed(3);
const natural = (slot) => /^deco_/.test(slot);
export const PALETTE = [
  {
    title: 'Nature',
    items: PROP_SLOTS.filter(natural).map((slot) => ({ kind: 'props', label: pretty(slot), slot, make: (x, z, map, opt) => {
      const s = opt.vary ? rnd(0.85, 1.2) : 1;
      return { slot, x, z, rot: opt.vary ? rnd(0, 6.28) : 0, r: defaultRadius(map, slot, s), s, v: opt.vary ? Math.floor(Math.random() * 6) : 0 };
    } })),
  },
  {
    title: 'Town props',
    items: PROP_SLOTS.filter((s) => !natural(s) && !s.startsWith('proc_')).map((slot) => ({ kind: 'props', label: pretty(slot), slot, make: (x, z, map) => ({ slot, x, z, rot: 0, r: defaultRadius(map, slot) }) })),
  },
  {
    title: 'Built in code',
    items: PROP_SLOTS.filter((s) => s.startsWith('proc_')).map((slot) => ({ kind: 'props', label: pretty(slot), slot, make: (x, z) => ({ slot, x, z, rot: 0, r: slot === 'proc_standing_stone' ? 0.5 : 0, s: 1 }) })),
  },
  {
    title: 'Resource nodes',
    items: Object.entries(NODE_TYPES).map(([type, t]) => ({ kind: 'nodes', label: `${t.name} (lv ${t.lvl})`, make: (x, z, map, opt) => ({ type, x, z, rot: rnd(0, 6.28), s: opt.vary ? rnd(0.9, 1.15) : 1 }) })),
  },
  {
    title: 'Monster camps',
    items: Object.entries(MONSTERS).map(([monster, m]) => ({ kind: 'spawns', label: `${m.name} (lv ${m.lvl})`, make: (x, z) => ({ monster, x, z, r: 8, count: 3 }) })),
  },
  {
    title: 'Stamps',
    items: [
      { kind: 'stamp', label: 'Town kit (a whole town)', stamp: 'town', make: (x, z, map, opt) => stampTownKit(opt.id ?? 'newtown', x, z, opt) },
      { kind: 'stamp', label: 'Outpost (stone, fire, cookpot, notice)', stamp: 'outpost', make: (x, z, map, opt) => stampOutpost(opt.id ?? 'outpost', x, z, opt) },
    ],
  },
  {
    title: 'Town pieces',
    items: [
      ...ACTION_OPTS.map(([action, label]) => ({ kind: 'buildings', label, make: (x, z) => ({ label, action, style: { craft: 'workshop' }[action] ?? action, x, z, w: action === 'townhall' ? 11 : 9, d: action === 'townhall' ? 10 : 7, face: 's' }) })),
      { kind: 'props', label: 'Order board', make: (x, z) => ({ slot: 'proc_job_board', x, z, rot: 0, r: 0.6, orders: '' }) },
      { kind: 'props', label: 'Supplier stall', make: (x, z) => ({ slot: 'market_stall_canopy', x, z, rot: 0, r: 1.2, supplier: '' }) },
      { kind: 'set', label: 'The five crafting stations', make: (x, z) => ({ props: STATION_SET.map(([station, slot, dx, dz, r]) => ({ slot, x: +(x + dx + 16.5).toFixed(2), z: +(z + dz + 12).toFixed(2), rot: 0, r, station })) }) },
      ...['smokehouse', 'quench_trough', 'glassworks', 'starforge'].map((station) => ({ kind: 'props', label: STATIONS[station].label, make: (x, z) => ({ slot: 'proc_forge', x, z, rot: 0, r: 0.8, station }) })),
      { kind: 'gates', label: 'Gatehouse', make: (x, z) => ({ label: 'Gate', x, z, width: 6, scale: 4.5 }) },
      { kind: 'docks', label: 'Bridge', make: (x, z) => ({ x, z, w: 4, d: 16, style: 'bridge' }) },
      { kind: 'props', label: 'Campfire', make: (x, z) => ({ slot: 'campfire', x, z, rot: 0, r: 0.7 }) },
      { kind: 'props', label: 'Notice post', make: (x, z) => ({ slot: 'proc_signboard', x, z, rot: 0, r: 0.4 }) },
    ],
  },
  {
    title: 'Places to find',
    items: [
      ...LANDMARK_KINDS.map((kind) => ({ kind: 'landmarks', label: `Landmark: ${kind}`, make: (x, z) => ({ kind, name: `New ${kind}`, x, z, r: 8 }) })),
      { kind: 'passages', label: 'Passage (two ends)', make: (x, z) => ({ name: 'New passage', kind: 'climb', x, z, tx: x + 12, tz: z, req: null }) },
      { kind: 'skyline', label: 'Skyline beacon (seen from afar)', make: (x, z) => ({ kind: 'tree', x, z, h: 28, card: 'tree_oak' }) },
    ],
  },
  {
    title: 'Buildings & areas',
    items: [
      { kind: 'buildings', label: 'Cottage', make: (x, z) => ({ x, z, w: 6, d: 5, face: 's', color: '#f1e1b6', roof: '#b4553f', deco: true }) },
      { kind: 'stones', label: 'Waystone (fast travel)', make: (x, z) => ({ name: 'New Waystone', x, z, rot: 0 }) },
      { kind: 'entrances', label: 'Dungeon entrance (crypt)', make: (x, z) => ({ kind: 'hollow_crypt', x, z, rot: 0 }) },
      { kind: 'docks', label: 'Dock', make: (x, z) => ({ x, z, w: 3, d: 8 }) },
      { kind: 'fountains', label: 'Fountain', make: (x, z) => ({ x, z, r: 2.6 }) },
      { kind: 'plazas', label: 'Plaza', make: (x, z) => ({ x, z, r: 8 }) },
      { kind: 'lakes', label: 'Lake', make: (x, z) => ({ x, z, r: 8, deep: 3 }) },
      { kind: 'zones', label: 'Zone', make: (x, z) => ({ kind: 'meadow', label: 'New Zone', x, z, r: 12, ground: '#74a04c' }) },
      { kind: 'regions', label: 'Region (town / area)', make: (x, z) => ({ name: 'New Region', tier: 1, kind: 'town', x, z, r: 40 }) },
      { kind: 'lands', label: 'Land', make: (x, z) => ({ x, z, r: 40 }) },
    ],
  },
];

// Inspector helpers for a field's value as shown vs stored.
export const show = (f, v) => (f.type === 'deg' ? deg(v || 0) : v ?? f.def ?? '');
export const store = (f, raw) => {
  if (f.type === 'deg') return +(((Number(raw) || 0) * Math.PI) / 180).toFixed(3);
  if (f.type === 'num') {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = f.def ?? 0;
    if (f.min != null) v = Math.max(f.min, v);
    if (f.max != null) v = Math.min(f.max, v);
    return f.int ? Math.round(v) : +v.toFixed(3);
  }
  if (f.type === 'check') return !!raw || undefined;
  if (f.type === 'select' && raw === '') return undefined;
  return raw;
};
