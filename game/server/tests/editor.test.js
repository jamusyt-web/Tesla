// The world editor's checks (shared/mapkit.js lints) and stamps, which the
// editor, the patch scripts and the fixture all use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapLints, stampTownKit, stampOutpost, STATION_SET } from '../../shared/mapkit.js';
import { upgradeMap, mapProblems } from '../../shared/world.js';
import { estimateChunk } from '../../shared/budget.js';
import { SHIPPED_MAP } from '../map.js';
import { twoTownMap } from './twotown.js';

const kinds = (lints) => lints.map((l) => l.kind);

test('the town kit stamp: the §3.1 layout with <t>_* ids, and a complete kit', () => {
  const s = stampTownKit('amberfold', -540, -60, { tier: 2, biome: 'autumn', sig: 'smokehouse', kit: 'ftk' });
  assert.deepEqual(s.regions[0], { id: 'amberfold', name: 'Amberfold', tier: 2, kind: 'town', x: -540, z: -60, r: 70, stone: 'stone_amberfold', biome: 'autumn' });
  assert.deepEqual(s.stones[0], { id: 'stone_amberfold', name: 'Amberfold Square', x: -533.8, z: -54.8, rot: -1.76 });
  assert.deepEqual(s.buildings.map((b) => [b.id, b.action, b.x - -540, b.z - -60]), [['amberfold_market', 'market', 18, -6], ['amberfold_workshop', 'craft', -17, -6], ['amberfold_shop', 'shop', -15, 16], ['amberfold_townhall', 'townhall', 16, 17.5]]);
  assert.equal(s.props.filter((p) => p.station).length, STATION_SET.length + 1, 'five stations and the signature one');
  assert.ok(s.props.some((p) => p.id === 'amberfold_sig' && p.station === 'smokehouse'));
  const m = twoTownMap();
  assert.ok(!mapLints(m).some((l) => l.kind === 'town kit' && /Testvale/.test(l.text)), 'the fixture town has the whole kit');
  const half = { ...m, props: m.props.filter((p) => p.id !== 'testvale_anvil') };
  assert.match(mapLints(half).find((l) => l.kind === 'town kit' && /Testvale/.test(l.text)).text, /missing an anvil/);
});

test('lints: road gaps, far from a stone, region minimums, node bands, islands and size', () => {
  const base = upgradeMap(JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8')));
  const m = {
    ...base,
    lands: [...base.lands, { id: 'away', x: 600, z: 0, r: 40 }],
    regions: [...base.regions, { id: 'wildlands', name: 'Wildlands', tier: 1, kind: 'wild', x: 600, z: 0, r: 40 }, ...stampOutpost('lonely', 0, 60).regions],
    paths: [...base.paths, { id: 'long_road', pts: [[0, 0], [0, 400]], w: 3 }],
    nodes: [...base.nodes, { id: 'n_hi', type: 'tree_pine', x: 600, z: 0, rot: 0, s: 1 }],
  };
  const L = mapLints(m, { gzBytes: 300 * 1024 });
  const ks = kinds(L);
  for (const k of ['road gap', 'stones', 'region', 'reachability', 'size']) assert.ok(ks.includes(k), `${k}: ${JSON.stringify(L.filter((l) => l.kind === k))}`);
  assert.ok(L.find((l) => l.kind === 'region' && /Wildlands/.test(l.text)), 'a wild region with no camp');
  assert.ok(L.find((l) => l.kind === 'region' && /Lonely/.test(l.text)), 'an outpost with no waystone or fire');
  for (const l of L) assert.ok(Number.isFinite(l.x) && Number.isFinite(l.z), 'every lint has a place to jump to');
  // A node above its region's band.
  const banded = { ...base, nodes: [...base.nodes, { id: 'n_x', type: 'rock_gold', x: 10, z: 10, rot: 0, s: 1 }] };
  assert.ok(!kinds(mapLints(banded)).includes('node band'), 'gold (8) is fine in a tier-1 region');
  // Today's map: only the supplier stall is missing from Hearthvale.
  const today = mapLints(base);
  assert.deepEqual(today.map((l) => l.text), ['Hearthvale is missing a supplier stall']);
  assert.deepEqual(mapProblems(m), []);
});

test("the budget meter's estimate: a town chunk costs more than open ground", () => {
  const town = estimateChunk(0, 0);
  const empty = estimateChunk(9, 9);
  assert.ok(town.statics.draws > empty.statics.draws);
});
