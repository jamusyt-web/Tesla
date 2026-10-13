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
  return bits.join(' · ');
}
