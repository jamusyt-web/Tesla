// Writes maps/patches/015_hearthvale_gates.json: Hearthvale's West Gate on
// the island's west shore and the road to it from the square, skirting the
// north edge of Whisperwood (SPEC §1.4, Phase 3 W1c). The Westmarch road
// beyond the gate comes with Amberfold (020_amberfold).
//   node scripts/world/hearthvale-gates.mjs
import { check, writePatch } from './lib.mjs';

const add = {
  gates: [{ id: 'gate_west', label: 'West Gate', icon: '🍂', glyph: 'gate', x: -92, z: -4, rot: Math.PI / 2, width: 7, scale: 4.5 }],
  paths: [{ id: 'hv_west_road', pts: [[-36, 0], [-48, -12], [-66, -12.5], [-82, -9], [-92, -4]], w: 2.2 }],
};
check(add, { id: '015_hearthvale_gates' });
console.log(writePatch('015_hearthvale_gates', add));
