// Small pieces of item UI shared by the panels: an item's icon, a bag slot,
// a quantity box and a one-line description of what it does.
import { h, fmt } from '../util/dom.js';
import { itemIcon } from './portrait.js';
import { ITEMS, baseOf, qOf } from '../../../shared/items.js';


// 3D-rendered icon when the item has a model, emoji otherwise.
// Fine / Masterwork versions use their base item's picture plus a star.
export const iconEl = (id, size = null) => {
  const q = qOf(id);
  const src = itemIcon(baseOf(id));
  const pic = src ? h('img.icon3d', { src, alt: ITEMS[id]?.name || id, style: size ? { width: size, height: size } : null }) : ITEMS[id]?.icon || '❔';
  return q ? h('span.qicon', pic, h('i.qbadge.q' + q, q === 2 ? '✦' : '★')) : pic;
};

export const itemSlot = (id, qty, { sel = false, eq = false, on } = {}) =>
  h('div.slot' + (sel ? '.sel' : ''), { 'data-r': ITEMS[id]?.rarity, 'data-q': qOf(id) || null, title: ITEMS[id]?.name, on: on ? { click: on } : null }, iconEl(id), qty != null ? h('span.q', fmt(qty)) : null, eq ? h('span.eq', 'E') : null);

export const qtyInput = (value, max) => {
  const inp = h('input', { type: 'number', min: 1, max, value, inputMode: 'numeric' });
  return inp;
};

export function itemDesc(it) {
  const bits = [];
  if (it.tool) bits.push(`Tier ${it.tier} ${it.tool === 'axe' ? 'axe' : it.tool === 'pick' ? 'pickaxe' : 'rod'} · Power ${it.power}${it.speed ? ` · ${(1000 / it.speed).toFixed(1)} swings/s` : ''}`);
  if (it.atk) bits.push(`+${it.atk} ATK`);
  if (it.def) bits.push(`+${it.def} DEF`);
  if (it.hp) bits.push(`+${it.hp} HP`);
  if (it.heal) bits.push(`Heals ${it.heal} HP in battle`);
  if (it.buff) bits.push(`${it.buff.slot[0].toUpperCase() + it.buff.slot.slice(1)}: ${fxText(it.buff.fx)} for ${it.buff.uses?.ms ? `${Math.round(it.buff.uses.ms / 60000)} min` : `${it.buff.uses?.n} ${USES[it.buff.uses?.per] ?? 'uses'}`}`);
  if (it.fx) bits.push(fxText(it.fx));
  if (it.req?.combat) bits.push(`Needs Combat ${it.req.combat}`);
  if (it.set) bits.push(`Part of the ${it.set[0].toUpperCase() + it.set.slice(1)} set`);
  if (it.kit) bits.push('Opens passages; never used up');
  if (it.bound) bits.push("Can't be traded");
  if (it.nowarp) bits.push("Waystones won't carry it");
  return bits.join(' · ');
}

const USES = { swing: 'swings', gather: 'gathers', cast: 'casts', battle: 'battles', craft: 'crafts' };
// Effects in words (shared/perks.js names).
const FX = {
  toolPower: (v) => `tool power +${v}`,
  gatherXp: (v) => `+${Math.round(v * 100)}% gathering xp`,
  fishXp: (v) => `+${Math.round(v * 100)}% fishing xp`,
  craftXp: (v) => `+${Math.round(v * 100)}% crafting xp`,
  moveSpeed: (v) => `+${Math.round(v * 100)}% walk speed out of battle`,
  luck: (v) => `fishing luck +${v}`,
  rodZone: (v) => `bigger catch bar`,
  doubleLog: (v) => `+${Math.round(v * 100)}% double logs`,
  doubleOre: (v) => `+${Math.round(v * 100)}% double ore`,
  doubleHerb: (v) => `+${Math.round(v * 100)}% double herbs`,
  treePower: (v) => `axe power +${v}`,
  rockPower: (v) => `pickaxe power +${v}`,
  perfectTick: (v) => `perfect crafting windows +${v}`,
  tonicAtk: (v) => `+${Math.round(v * 100)}% attack`,
  tonicDef: (v) => `+${Math.round(v * 100)}% defence`,
};
export const fxText = (fx = {}) => Object.entries(fx).map(([k, v]) => FX[k]?.(v) ?? k).join(', ');
