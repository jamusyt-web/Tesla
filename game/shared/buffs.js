// Buffs (SPEC §4.8): three slots, meal, tonic and lure, one buff each.
// Using a new one replaces the old. Most count down only when you do the
// thing they help with (uses per 'swing', 'gather', 'cast', 'battle' or
// 'craft'), so they never run out while you're away; a few travel buffs
// are timed ({ ms }). The state lives on the hero (heroes.buffs):
//   { meal: { item, fx, per, left } | { item, fx, until }, tonic, lure }
import { ITEMS } from './items.js';

export const BUFF_SLOTS = ['meal', 'tonic', 'lure'];

// A buff is still on: uses left, or time left.
export const live = (b, now = Date.now()) => !!b && (b.until != null ? b.until > now : b.left > 0);

// The buffs that are on right now: { slot: buff }.
export function activeBuffs(buffs, now = Date.now()) {
  const out = {};
  for (const s of BUFF_SLOTS) if (live(buffs?.[s], now)) out[s] = buffs[s];
  return out;
}

// Start an item's buff: returns the new buffs (the old one in its slot is replaced).
export function applyBuff(buffs, itemId, now = Date.now()) {
  const b = ITEMS[itemId]?.buff;
  if (!b) return null;
  const on = b.uses?.ms != null ? { item: itemId, fx: b.fx, until: now + b.uses.ms } : { item: itemId, fx: b.fx, per: b.uses?.per, left: b.uses?.n ?? 1 };
  return { ...activeBuffs(buffs, now), [b.slot]: on };
}

// One use of `per` (a swing, a gather, a cast, a battle, a craft): every
// buff counting those ticks down. Returns { buffs, changed, ended: [items] }.
export function useBuffs(buffs, per, now = Date.now()) {
  const out = { ...(buffs ?? {}) };
  let changed = false;
  const ended = [];
  for (const s of BUFF_SLOTS) {
    const b = out[s];
    if (!b) continue;
    if (!live(b, now)) {
      delete out[s];
      changed = true;
      continue;
    }
    if (b.per !== per) continue;
    out[s] = { ...b, left: b.left - 1 };
    changed = true;
    if (out[s].left <= 0) {
      delete out[s];
      ended.push(b.item);
    }
  }
  return { buffs: out, changed, ended };
}
