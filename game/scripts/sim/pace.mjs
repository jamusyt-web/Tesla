// Skill pacing (SPEC §4.8): hours of focused play from skill 12 to 18 on
// Amberfold's nodes, at 240 gathering actions (nodes worked) an hour, as
// the spec counts them.
//   node scripts/sim/pace.mjs
import { fileURLToPath } from 'node:url';
import { xpForLevel } from '../../shared/skills.js';
import { NODE_TYPES } from '../../shared/nodes.js';

export function hoursToLevel(type, from = 12, to = 18) {
  return (xpForLevel(to) - xpForLevel(from)) / (NODE_TYPES[type].xp * 240);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const n of ['tree_maple', 'rock_coal', 'herb_hearthcap']) console.log(`${n.padEnd(16)} ${hoursToLevel(n).toFixed(1)} h from 12 to 18`);
}
