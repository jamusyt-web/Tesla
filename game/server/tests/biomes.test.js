import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { current as currentMap } from '../map.js';
import { setWorld } from '../../shared/world.js';
import { BIOMES, registerBiome, biome, LOW_FOG } from '../../shared/biomes.js';
import { biomeAt, groundAt } from '../../shared/places.js';
import { dayMin, isNight, isNoon, nightness, weatherAt, hash32, WEATHER_SLOT_MS } from '../../shared/clock.js';

after(() => setWorld(currentMap.map));

test('the meadow and the Wilds look exactly as Hearthvale does today', () => {
  const m = BIOMES.meadow;
  assert.deepEqual(m.ground, { grass: '#74a04c', grass2: '#628c42', path: '#b89b6e', plaza: '#a89a82', sand: '#d6bd8a', cliff: '#7a5b40' });
  assert.deepEqual(m.tufts.colors, ['#6b9a48', '#5a8a3d', '#7caa55']);
  assert.deepEqual([m.water, m.sea, m.sky], [{ shallow: '#5fb3c4', deep: '#1f5f86' }, { shallow: '#58a8bc', deep: '#1b4f74' }, { top: '#5fb8f0', mid: '#a9dcf7', bot: '#fde7c4' }]);
  assert.deepEqual(m.light, { fog: '#b8c4c8', fogNear: 20, fogFar: 100, hemiSky: '#c8d8ec', hemiGround: '#6b5a48', hemi: 1.3, sun: '#ffe4bc', sunI: 2.7, exposure: 1.05 });
  const w = BIOMES.wilds;
  assert.deepEqual(w.ground, m.ground);
  assert.deepEqual(w.tufts.colors, ['#4e6e38', '#43602f', '#5b7a42']);
  assert.deepEqual(w.light, { ...m.light, fog: '#9faea6', fogNear: 14, fogFar: 70, hemi: 1.05, sun: '#ffd0a0' });
  assert.equal(m.weather, null);
  assert.equal(w.weather, null);
  assert.deepEqual(m.cover, [], 'Hearthvale keeps its hand-placed cover');
  assert.deepEqual(LOW_FOG, { near: 0.9, far: 0.75 });
  assert.equal(biome('nowhere'), m, 'an unknown biome looks like the meadow');
});

test('biomeAt: a zone, else a region, else the map, else meadow', () => {
  setWorld({
    format: 2, name: 'T', rev: 1, spawn: { x: 0, z: 0 }, biome: 'heath',
    lands: [{ id: 'l', x: 0, z: 0, r: 500 }],
    regions: [{ id: 'big', name: 'Big', kind: 'wild', biome: 'autumn', x: 200, z: 0, r: 150 }, { id: 'core', name: 'Core', kind: 'town', biome: 'alpine', x: 200, z: 0, r: 40 }],
    zones: [{ id: 'w', kind: 'wilds', label: 'W', x: -200, z: 0, r: 30 }, { id: 'g', kind: 'garden', label: 'G', biome: 'crystal', x: 300, z: 0, r: 10 }],
  });
  assert.equal(biomeAt(-200, 0), 'wilds', 'a wilds zone is the Wilds');
  assert.equal(biomeAt(300, 0), 'crystal', 'a zone with a biome');
  assert.equal(biomeAt(200, 10), 'alpine', 'the smallest region');
  assert.equal(biomeAt(120, 0), 'autumn');
  assert.equal(biomeAt(0, 300), 'heath', "else the map's");
  setWorld({ format: 2, name: 'T', rev: 1, spawn: { x: 0, z: 0 }, lands: [{ id: 'l', x: 0, z: 0, r: 50 }] });
  assert.equal(biomeAt(0, 0), 'meadow');
});

test('ground colours blend across a biome edge', () => {
  registerBiome({ ...BIOMES.meadow, id: 'test_dusty', ground: { ...BIOMES.meadow.ground, grass: '#ffffff' } });
  setWorld({ format: 2, name: 'T', rev: 1, spawn: { x: 0, z: 0 }, lands: [{ id: 'l', x: 0, z: 0, r: 300 }], regions: [{ id: 'r', name: 'R', kind: 'wild', biome: 'test_dusty', x: 0, z: 0, r: 100 }] });
  const lin = (h) => (h / 255 < 0.04045 ? (h / 255) * 0.0773993808 : Math.pow((h / 255) * 0.9478672986 + 0.0521327014, 2.4));
  assert.deepEqual(groundAt(0, 0).grass, [1, 1, 1]);
  assert.deepEqual(groundAt(0, 200).grass, [0x74, 0xa0, 0x4c].map(lin), 'outside: the meadow, as three.js reads #74a04c');
  const edge = groundAt(0, 100).grass[0];
  assert.ok(edge > lin(0x74) && edge < 1, 'the edge is a blend');
});

test('the clock: a 100-minute day; weather is the same everywhere at a given moment', () => {
  const at = (min) => min * 60_000;
  assert.equal(dayMin(at(130)), 30);
  assert.ok(isNoon(at(30)) && !isNight(at(30)) && isNight(at(75)) && !isNight(at(95)));
  assert.deepEqual([nightness(at(10)), nightness(at(65)), nightness(at(80)), nightness(at(95))], [0, 0.5, 1, 0.5]);
  assert.equal(hash32('meadow:1'), hash32('meadow:1'));
  registerBiome({ ...BIOMES.meadow, id: 'test_rainy', weather: { kind: 'rain', rate: 0.5, chance: 0.4 } });
  registerBiome({ ...BIOMES.meadow, id: 'test_starry', weather: { kind: 'sparkle', rate: 0.3, chance: 1, night: true } });
  let wet = 0;
  for (let s = 0; s < 500; s++) {
    const t = s * WEATHER_SLOT_MS + 1000;
    const w = weatherAt('test_rainy', t);
    assert.deepEqual(w, weatherAt('test_rainy', t + WEATHER_SLOT_MS - 2000), 'one roll per 20-minute slot');
    if (w) (wet++, assert.equal(w.kind, 'rain'));
  }
  assert.ok(wet > 150 && wet < 250, `rain in about 40% of slots (${wet}/500)`);
  assert.equal(weatherAt('meadow', Date.now()), null);
  assert.equal(weatherAt('test_starry', at(30)), null, 'night weather waits for the night');
  assert.equal(weatherAt('test_starry', at(80))?.kind, 'sparkle');
});
