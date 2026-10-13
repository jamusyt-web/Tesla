// Town reputation (SPEC §5.7): points per hero per town (table town_rep).
// Ranks come from shared/rep.js. Crafting asks rankOf() for recipes that
// need a rank; orders, the Big Order and quests add points.
import { rankFor, repView } from '../shared/rep.js';

let DB = null;
let Q = null;
export function useDb(db) {
  DB = db;
  Q = {
    get: db.prepare('SELECT points FROM town_rep WHERE account_id = ? AND town = ?'),
    all: db.prepare('SELECT town, points FROM town_rep WHERE account_id = ?'),
    add: db.prepare('INSERT INTO town_rep (account_id, town, points) VALUES (?,?,?) ON CONFLICT(account_id, town) DO UPDATE SET points = points + excluded.points'),
  };
}

export const pointsOf = (heroId, town) => (Q ? (Q.get.get(heroId, town)?.points ?? 0) : 0);

// The hero's reputation rank in a town (1 = Stranger).
export function rankOf(heroId, town) {
  return rankFor(pointsOf(heroId, town)).rank;
}

// Add reputation points in a town: { points, rank, up (a new rank) }.
export function add(heroId, town, points) {
  if (!Q || !town || !(points > 0)) return null;
  const before = rankOf(heroId, town);
  Q.add.run(heroId, town, Math.round(points));
  const now = repView(pointsOf(heroId, town));
  return { ...now, up: now.rank > before };
}

// Every town's standing for a hero: { town: { rank, name, points, next } }.
export function standing(heroId) {
  if (!Q) return {};
  return Object.fromEntries(Q.all.all(heroId).map((r) => [r.town, repView(r.points)]));
}
