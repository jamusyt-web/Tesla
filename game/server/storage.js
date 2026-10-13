// Town storage (SPEC §6.1): what a hero keeps in each town's warehouse, so
// goods can wait where they'll sell. One row per (hero, town, item) in
// town_storage (migration 008).
//
// Phase 0 stub with the final signatures; Phase 1 (M3) fills it in.
import { fail } from './db.js';

// Move qty of item from the hero's bag into storage in `town`.
export function put(db, heroId, town, item, qty) {
  fail('Town storage opens with the new towns.');
}

// Move qty of item from storage in `town` back into the hero's bag.
export function take(db, heroId, town, item, qty) {
  fail('Town storage opens with the new towns.');
}

// Everything the hero has stored in `town`: { item: qty }.
export function list(db, heroId, town) {
  return {};
}
