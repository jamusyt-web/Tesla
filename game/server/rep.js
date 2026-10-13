// Town reputation (SPEC §5.4): points earned per town from orders and
// projects, giving ranks that unlock recipes and the quartermaster.
//
// Phase 0 stub with the final signatures: everyone is rank 1 everywhere and
// points go nowhere yet. Phase 2 (E5) implements it; crafting already asks
// rankOf() for recipes that need a rank.

let DB = null;
export function useDb(db) {
  DB = db;
}

// The hero's reputation rank in a town (1 = newcomer).
export function rankOf(heroId, town) {
  return 1;
}

// Add reputation points in a town.
export function add(heroId, town, points) {}
