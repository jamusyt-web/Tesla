// Map patches (SPEC §11.2): new content arrives as id-keyed additions that
// apply once, never overwrite the owner's work, and report what they skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPatches, landReach, stampTownKit, stampOutpost } from '../../shared/mapkit.js';
import { upgradeMap, mapProblems } from '../../shared/world.js';
import { SHIPPED_MAP, loadPatches } from '../map.js';

const shipped = () => upgradeMap(JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8')));
const town = { id: '020_testvale', add: { lands: [{ id: 'tv_land', x: 400, z: 0, r: 90 }], ...stampTownKit('testvale', 400, 0, { tier: 2 }) } };

test('a patch applies once', () => {
  const r1 = applyPatches(shipped(), [town]);
  assert.equal(r1.changed, true);
  assert.equal(r1.report[0].status, 'applied');
  assert.ok(r1.report[0].added > 10);
  assert.deepEqual(r1.map.patches, ['020_testvale']);
  assert.ok(r1.map.buildings.some((b) => b.id === 'testvale_market'));
  assert.deepEqual(mapProblems(r1.map), []);
  const r2 = applyPatches(r1.map, [town]);
  assert.equal(r2.changed, false);
  assert.equal(r2.report[0].status, 'already applied');
  assert.equal(JSON.stringify(r2.map), JSON.stringify(r1.map), 'nothing changes the second time');
});

test("it skips ids that already exist (the owner's version wins)", () => {
  const m = shipped();
  m.stones.push({ id: 'stone_testvale', name: "The Owner's Stone", x: 410, z: 3, rot: 0 });
  const r = applyPatches(m, [town]);
  assert.equal(r.map.stones.find((s) => s.id === 'stone_testvale').name, "The Owner's Stone");
  assert.deepEqual(r.report[0].skipped.find((s) => s.id === 'stone_testvale'), { list: 'stones', id: 'stone_testvale', why: 'that id is already on the map' });
});

test('it never re-adds an entry the owner deleted', () => {
  const once = applyPatches(shipped(), [town]).map;
  once.buildings = once.buildings.filter((b) => b.id !== 'testvale_shop'); // the owner didn't want it
  const again = applyPatches(once, [town]);
  assert.ok(!again.map.buildings.some((b) => b.id === 'testvale_shop'));
});

test('it skips footprint collisions with a report', () => {
  const m = shipped();
  m.buildings.push({ id: 'owners_barn', x: 418, z: -6, w: 8, d: 8, face: 's', deco: true }); // right where the market goes
  const r = applyPatches(m, [town]);
  assert.ok(!r.map.buildings.some((b) => b.id === 'testvale_market'));
  assert.deepEqual(r.report[0].skipped.find((s) => s.id === 'testvale_market'), { list: 'buildings', id: 'testvale_market', why: 'it would overlap owners_barn' });
  assert.ok(r.map.buildings.some((b) => b.id === 'testvale_workshop'), 'the rest still went in');
  // Only project patches may take things away.
  const rem = applyPatches(shipped(), [{ id: '030_x', add: {}, remove: ['p10'] }]);
  assert.match(rem.report[0].status, /only project patches/);
  assert.ok(applyPatches(shipped(), [{ id: 'proj', add: {}, remove: ['p10'] }], { projects: true }).map.props.every((p) => p.id !== 'p10'));
});

test('reachability follows overlapping land, docks and passages', () => {
  const m = { spawn: { x: 0, z: 0 }, lands: [{ id: 'home', x: 0, z: 0, r: 50 }, { id: 'next', x: 90, z: 0, r: 45 }, { id: 'isle', x: 0, z: 150, r: 20 }, { id: 'far', x: 300, z: 0, r: 20 }, { id: 'pier_isle', x: -120, z: 0, r: 20 }], docks: [{ id: 'd', x: -75, z: 0, w: 70, d: 4 }], passages: [{ id: 'p', x: 0, z: 45, tx: 0, tz: 140 }] };
  const r = landReach(m);
  assert.deepEqual([...r.reached].sort(), ['home', 'isle', 'next', 'pier_isle']);
  assert.deepEqual(r.cut, ['far']);
});

test('the server reads maps/patches in number order; an outpost stamp is a valid map', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-patches-'));
  fs.writeFileSync(path.join(dir, '010_b.json'), JSON.stringify({ add: { lands: [{ id: 'b', x: 500, z: 500, r: 10 }] } }));
  fs.writeFileSync(path.join(dir, '005_a.json'), JSON.stringify({ add: {} }));
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a patch');
  assert.deepEqual(loadPatches(dir).map((p) => p.id), ['005_a', '010_b']);
  assert.deepEqual(loadPatches(path.join(dir, 'missing')), []);
  const o = applyPatches(shipped(), [{ id: '040_post', add: { lands: [{ id: 'post_land', x: 0, z: -300, r: 40 }], ...stampOutpost('crossing', 0, -300, { tier: 2 }) } }]);
  assert.deepEqual(mapProblems(o.map), []);
  assert.equal(o.map.regions.find((r) => r.id === 'crossing').kind, 'outpost');
});
