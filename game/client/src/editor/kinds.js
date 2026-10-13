// Everything the world editor can place and edit, one entry per map list.
// Each kind says how to show it in the inspector (fields), where you can click
// it (hit), what a new one looks like (make), and how to label it.
import { NODE_TYPES, CRYPT } from '../../../shared/world.js';
import { DUNGEONS } from '../../../shared/dungeon.js';
import { MONSTERS } from '../../../shared/monsters.js';
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
      ...(e.station ? [{ key: 'station', label: 'Crafting station', type: 'readonly' }] : []),
    ],
  },
  nodes: {
    label: 'Resource node',
    prefix: 'n',
    order: 1,
    name: (e) => NODE_TYPES[e.type]?.name ?? e.type,
    hit: (e) => ({ r: Math.max((NODE_TYPES[e.type]?.r || 0) * (e.s ?? 1), 0.7) }),
    fields: () => [{ key: 'type', label: 'Type', type: 'select', options: Object.entries(NODE_TYPES).map(([k, t]) => [k, `${t.name} (lv ${t.lvl})`]) }, ...XZ, { key: 'rot', label: 'Turn (°)', type: 'deg' }, num('s', 'Size', 0.05, { min: 0.5, max: 1.6 })],
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
      ...(e.deco ? [] : [{ key: 'action', label: 'Opens', type: 'readonly' }]),
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
  docks: { label: 'Dock', prefix: 'dock', order: 3, name: () => 'Dock', hit: (e) => ({ w: e.w, d: e.d }), fields: () => [...XZ, num('w', 'Width', 0.5, { min: 2 }), num('d', 'Length', 0.5, { min: 3 })] },
  spawns: {
    label: 'Monster camp',
    prefix: 'spawn',
    order: 4,
    name: (e) => `${MONSTERS[e.monster]?.name ?? e.monster} ×${e.count}`,
    hit: (e) => ({ r: e.r, ring: true }),
    fields: () => [{ key: 'monster', label: 'Monster', type: 'select', options: Object.entries(MONSTERS).map(([k, m]) => [k, `${m.name} (lv ${m.lvl})`]) }, ...XZ, num('r', 'Roams within (m)', 0.5, { min: 2 }), num('count', 'How many', 1, { min: 1, max: 20, int: true })],
  },
  paths: { label: 'Path', prefix: 'path', order: 5, name: () => 'Path', fields: () => [num('w', 'Width', 0.1, { min: 0.6, max: 5 })] },
  plazas: { label: 'Plaza', prefix: 'plaza', order: 6, name: () => 'Plaza', hit: (e) => ({ r: e.r, ring: true }), fields: () => [...XZ, num('r', 'Radius', 0.5, { min: 4 })] },
  lakes: { label: 'Lake', prefix: 'lake', order: 6, name: () => 'Lake', hit: (e) => ({ r: e.r, ring: true }), fields: () => [...XZ, num('r', 'Radius', 0.5, { min: 3 }), num('deep', 'Deep water within', 0.5, { min: 0, help: 'Fishing here catches bigger fish' })] },
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
    ],
  },
  lands: { label: 'Land', prefix: 'land', order: 9, name: () => 'Land', hit: (e) => ({ r: e.r, ring: true }), fields: () => [...XZ, num('r', 'Radius', 1, { min: 5, help: 'Overlap pieces of land to shape the coast' })] },
  regions: {
    label: 'Region',
    prefix: 'region',
    order: 8,
    name: (e) => `${e.name} (tier ${e.tier})`,
    hit: (e) => ({ r: e.r, ring: true }),
    fields: () => [{ key: 'name', label: 'Name', type: 'text' }, num('tier', 'Difficulty tier', 1, { min: 1, max: 5, int: true }), { key: 'kind', label: 'Kind', type: 'select', options: ['town', 'wild', 'outlaw'].map((k) => [k, k]) }, ...XZ, num('r', 'Radius', 1, { min: 10 })],
  },
};
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
  return raw;
};
