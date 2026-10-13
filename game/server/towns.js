// Which town a hero is trading in (SPEC §6.1). Markets, the merchant, the
// supplier stall, storage and the board work only inside a town; out in the
// wilds (or down a dungeon) you can look but not trade.
import { townAt } from '../shared/places.js';
import { REGIONS } from '../shared/world.js';
import { fail } from './db.js';

export const towns = () => REGIONS.filter((r) => r.kind === 'town');
export const townName = (id) => REGIONS.find((r) => r.id === id)?.name ?? id;

// A map with no towns at all trades as Hearthvale everywhere.
const anyTown = () => (towns().length ? null : 'hearthvale');

// The town the hero is standing in, or null (wilds, outposts, dungeons).
export function hereTown(g, c) {
  if (c.ch?.isRun) return null;
  return townAt(c.ent.x, c.ent.z)?.id ?? anyTown();
}

// The town whose books the hero looks at: where they are, else (in the
// wilds, or from inside a dungeon) the nearest town to where they stand
// outside.
export function browseTown(g, c) {
  const p = g.townPos(c);
  const t = townAt(p.x, p.z)?.id ?? anyTown();
  if (t) return t;
  let best = null;
  for (const r of towns()) if (!best || Math.hypot(r.x - p.x, r.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z)) best = r;
  return best?.id ?? 'hearthvale';
}

// The town the hero is in, or a refusal. With `town`, it must be that one.
export function needTown(g, c, town = null) {
  const t = hereTown(g, c);
  if (!t) fail(c.ch?.isRun ? 'Leave the dungeon first.' : 'Head to a town to trade.');
  if (town && t !== town) fail(`That's in ${townName(town)}. Go there to do that.`);
  return t;
}
