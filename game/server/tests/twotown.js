// A second town for tests: Testvale, 400 m east of Hearthvale on its own
// island, laid out with the standard town kit (SPEC §3.1), plus an islet
// off its north shore reached only by a passage. (M6 turns this into
// maps/fixtures/twotown.json.)
import fs from 'node:fs';
import { SHIPPED_MAP } from '../map.js';

export const TV = { x: 400, z: 0 };
const at = (dx, dz) => ({ x: TV.x + dx, z: TV.z + dz });

export function twoTownMap() {
  const m = JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8'));
  m.lands.push({ id: 'testvale_land', ...TV, r: 90 }, { id: 'testvale_islet', ...at(0, -125), r: 14 });
  m.regions.push({ id: 'testvale', name: 'Testvale', tier: 2, kind: 'town', ...TV, r: 70, stone: 'stone_testvale' });
  m.plazas.push({ id: 'tv_plaza', ...TV, r: 11.2 });
  m.stones.push({ id: 'stone_testvale', name: 'Testvale Square', ...at(6.2, 5.2), rot: -1.76 });
  m.buildings.push(
    { id: 'tv_workshop', label: 'Workshop', action: 'craft', ...at(-17, -6), w: 9, d: 7, face: 'e', style: 'workshop' },
    { id: 'tv_market', label: 'Market', action: 'market', ...at(18, -6), w: 11, d: 8, face: 'w', style: 'market' },
    { id: 'tv_townhall', label: 'Town Hall', action: 'townhall', ...at(16, 17.5), w: 11, d: 10, face: 'n', style: 'townhall' },
  );
  const st = [['forge', 'proc_forge', -22.3, -11.8], ['anvil', 'workshop_anvil', -19.5, -11.6], ['workbench', 'workshop_workbench', -16.2, -11.9], ['grindstone', 'workshop_grindstone', -13.4, -11.5], ['cookpot', 'proc_cookpot', -10.7, -12.3]];
  for (const [kind, slot, dx, dz] of st) m.props.push({ id: `tv_${kind}`, slot, ...at(dx, dz), rot: 0, r: 0.7, station: kind });
  // From the north shore of Testvale over to the islet.
  m.passages = [{ id: 'pass_tv', name: 'Smugglers’ Squeeze', kind: 'squeeze', ...at(0, -80), tx: TV.x, tz: TV.z - 120, req: { skill: 'mining', lvl: 10 }, kit: 'test_lantern' }];
  return m;
}
