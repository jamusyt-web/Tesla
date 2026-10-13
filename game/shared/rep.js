// Town reputation ranks (SPEC §5.7): points earned per town from orders,
// the Big Order, quests, journal milestones and (later) projects. Ranks are
// shown now; what each one unlocks arrives in Phase 5.
export const REP_RANKS = [
  { rank: 1, name: 'Stranger', at: 0 },
  { rank: 2, name: 'Neighbour', at: 300 },
  { rank: 3, name: 'Friend', at: 1000 },
  { rank: 4, name: 'Champion', at: 2500 },
  { rank: 5, name: 'Hero', at: 5000 },
];
export const rankFor = (points) => REP_RANKS.reduce((r, x) => (points >= x.at ? x : r), REP_RANKS[0]);
// { rank, name, points, next (points for the next rank, or null) }
export function repView(points = 0) {
  const r = rankFor(points);
  const next = REP_RANKS.find((x) => x.at > points);
  return { rank: r.rank, name: r.name, points, next: next?.at ?? null };
}
