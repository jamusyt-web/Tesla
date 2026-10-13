// Town storage (SPEC §6.1): what a hero keeps in each town's warehouse, so
// goods can wait where they'll sell. One row per (hero, town, item) in
// town_storage (migration 008). Goods never teleport: a resting market order
// that fills, a sell order cancelled from afar or a job delivery lands here,
// in that town, for the hero to collect when they're there. Storage is free.
import { isItem } from '../shared/items.js';
import { tx, fail } from './db.js';

const qs = new WeakMap();
function q(db) {
  if (!qs.has(db))
    qs.set(db, {
      add: db.prepare('INSERT INTO town_storage (account_id, town, item, qty) VALUES (?,?,?,?) ON CONFLICT(account_id, town, item) DO UPDATE SET qty = qty + excluded.qty'),
      get: db.prepare('SELECT qty FROM town_storage WHERE account_id = ? AND town = ? AND item = ?'),
      set: db.prepare('UPDATE town_storage SET qty = ? WHERE account_id = ? AND town = ? AND item = ?'),
      drop: db.prepare('DELETE FROM town_storage WHERE account_id = ? AND town = ? AND qty = 0'),
      list: db.prepare('SELECT item, qty FROM town_storage WHERE account_id = ? AND town = ? AND qty > 0 ORDER BY item'),
      count: db.prepare('SELECT town, SUM(qty) AS n FROM town_storage WHERE account_id = ? AND qty > 0 GROUP BY town'),
    });
  return qs.get(db);
}

const amount = (qty) => {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty < 1) fail('Bad amount.');
  return qty;
};

// Goods arriving for a hero in `town` (from a fill, a cancel or a delivery).
// Call inside the caller's transaction.
export function stash(db, heroId, town, item, qty) {
  if (!isItem(item) || !Number.isInteger(qty) || qty <= 0) fail('Bad item');
  q(db).add.run(heroId, town, item, qty);
}

// Move qty of item from the hero's bag into storage in `town`.
export function put(db, heroes, heroId, town, item, qty) {
  if (!isItem(item)) fail('Unknown item.');
  qty = amount(qty);
  return tx(db, () => {
    heroes.takeItem(heroId, item, qty, { keepEquipped: true });
    stash(db, heroId, town, item, qty);
    return { item, qty };
  });
}

// Move qty of item from storage in `town` back into the hero's bag.
export function take(db, heroes, heroId, town, item, qty) {
  if (!isItem(item)) fail('Unknown item.');
  qty = amount(qty);
  return tx(db, () => {
    const have = q(db).get.get(heroId, town, item)?.qty ?? 0;
    if (have < qty) fail("You don't have that many stored here.");
    q(db).set.run(have - qty, heroId, town, item);
    q(db).drop.run(heroId, town);
    heroes.addItem(heroId, item, qty);
    return { item, qty };
  });
}

// Everything stored in `town` into the bag: { item: qty } moved.
export function collect(db, heroes, heroId, town) {
  return tx(db, () => {
    const moved = list(db, heroId, town);
    for (const [item, n] of Object.entries(moved)) {
      q(db).set.run(0, heroId, town, item);
      heroes.addItem(heroId, item, n);
    }
    q(db).drop.run(heroId, town);
    return moved;
  });
}

// Everything the hero has stored in `town`: { item: qty }.
export function list(db, heroId, town) {
  return Object.fromEntries(q(db).list.all(heroId, town).map((r) => [r.item, r.qty]));
}

// How many items the hero has waiting in each town: { town: n }.
export function waiting(db, heroId) {
  return Object.fromEntries(q(db).count.all(heroId).map((r) => [r.town, r.n]));
}
