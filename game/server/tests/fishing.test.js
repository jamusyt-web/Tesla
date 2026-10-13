import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FISH, newFight, stepFight, replayFight, fishingGear, rollFish } from '../../shared/fishing.js';
import { mulberry32 } from '../../shared/world.js';

// A decent human: sees the fish ~200 ms late and steers the bar toward it.
// Returns the recorded toggles exactly like the real client does.
function play(fish, gear, seed = 1) {
  const s = newFight(fish, gear);
  const r = mulberry32(seed);
  const seen = [];
  const toggles = [];
  let held = false;
  while (!s.done) {
    seen.push(s.fishPos);
    const fishSeen = seen[Math.max(0, seen.length - 13)];
    const want = fishSeen - (s.zonePos + gear.zone / 2) + (r() - 0.5) * 0.12 - s.zoneVel * 0.18 > 0;
    if (want !== held) {
      toggles.push(s.tick);
      held = want;
    }
    stepFight(s, held);
  }
  return { s, toggles };
}

const rate = (id, tier, n = 120) => {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const f = FISH[id];
    if (play({ d: f.d, behavior: f.behavior, seed: 1000 + i * 31 }, fishingGear(tier, 3), i).s.done === 'caught') ok++;
  }
  return ok / n;
};

test('server replay reproduces the client fight exactly', () => {
  for (let i = 0; i < 40; i++) {
    const fish = rollFish(mulberry32(i + 1), 'mirror', 1 + (i % 3), 5, i % 2 === 0);
    const gear = fishingGear(1 + (i % 3), 5);
    const { s, toggles } = play(fish, gear, i);
    const r = replayFight(fish, gear, toggles, s.tick);
    assert.equal(r.done, s.done, `fight ${i}`);
    assert.equal(r.tick, s.tick);
    assert.equal(r.progress, s.progress);
  }
});

test('doing nothing loses the fish; stopping early is not a catch', () => {
  const fish = { d: 30, behavior: 'smooth', seed: 7 };
  const gear = fishingGear(1, 1);
  assert.notEqual(replayFight(fish, gear, [], 2400).done, 'caught');
  const { s, toggles } = play(fish, gear, 3);
  assert.equal(s.done, 'caught');
  assert.equal(replayFight(fish, gear, toggles, Math.floor(s.tick / 2)).done, null, 'half a fight proves nothing');
});

test('small fish are easy; big fish need better gear', () => {
  assert.ok(rate('minnow', 1) > 0.9, 'minnows are easy with the starter rod');
  const koi1 = rate('golden_koi', 1);
  const koi3 = rate('golden_koi', 3);
  assert.ok(koi1 < 0.15, `koi with starter rod should be very hard (${koi1})`);
  assert.ok(koi3 > 0.6, `koi with the best rod should be doable (${koi3})`);
  assert.ok(rate('trout', 2) > rate('trout', 1), 'better rod, better odds');
});

test('the lake king only bites in deep water with a decent rod', () => {
  const seen = (tier, deep) => {
    const r = mulberry32(99);
    for (let i = 0; i < 4000; i++) if (rollFish(r, 'mirror', tier, 20, deep).id === 'lake_king') return true;
    return false;
  };
  assert.equal(seen(1, true), false);
  assert.equal(seen(3, false), false);
  assert.equal(seen(3, true), true);
});

// ── Places, tables and legendaries (Phase 1, M4) ──
import { FISH_TABLES, fishWeights, fishLuck, inWindow, townTable, tableOf } from '../../shared/fishing.js';
import { DAY_MS } from '../../shared/clock.js';

// A scripted angler: reacts within about 50 ms and steers the bar onto the fish.
function scripted(fish, gear, seed) {
  const s = newFight(fish, gear);
  const r = mulberry32(seed);
  const seen = [];
  while (!s.done) {
    seen.push(s.fishPos);
    const f = seen[Math.max(0, seen.length - 4)];
    stepFight(s, f - (s.zonePos + gear.zone / 2) + (r() - 0.5) * 0.12 - s.zoneVel * 0.18 > 0);
  }
  return s.done === 'caught';
}

test('every legendary bites only in deep water, with its rod, in its window, and a scripted angler lands it', () => {
  const legends = Object.entries(FISH).filter(([, f]) => f.legend);
  assert.ok(legends.length >= 1);
  for (const [id, f] of legends) {
    const table = Object.values(FISH_TABLES).find((t) => t.legends?.includes(id));
    assert.ok(table, `${id} lives in some table`);
    const has = (rod, deep, ctx) => fishWeights(table, rod, table.lvl, deep, ctx).some((e) => e.id === id);
    assert.equal(has(f.legend.rod, false, {}), false, `${id}: not in the shallows`);
    if (f.legend.rod > 1) assert.equal(has(f.legend.rod - 1, true, {}), false, `${id}: not with a weaker rod`);
    // Find a moment inside its window (any weather it wants).
    let now = 0;
    while (!inWindow(f.legend, { now, weather: f.legend.window?.weather ?? null })) now += 60_000;
    assert.ok(now < DAY_MS, `${id}: its window opens every day`);
    assert.equal(has(f.legend.rod, true, { now, weather: f.legend.window?.weather ?? null }), true, `${id}: bites in its window`);
    // ≥ 60% landed with its rod at the table's level + 10.
    const gear = fishingGear(f.legend.rod, table.lvl + 10);
    let ok = 0;
    for (let i = 0; i < 200; i++) if (scripted({ d: Math.round(f.d + (((i % 10) / 10) - 0.4) * 14), behavior: f.behavior, seed: 7000 + i * 13 }, gear, i)) ok++;
    assert.ok(ok / 200 >= 0.6, `${id}: landed ${ok / 2}%`);
  }
});

test('windows: weather and time of day', () => {
  const night = (DAY_MS * 80) / 100; // 80 clock minutes in
  const noon = (DAY_MS * 30) / 100;
  assert.equal(inWindow({ rod: 7, window: { time: 'night' } }, { now: night }), true);
  assert.equal(inWindow({ rod: 7, window: { time: 'night' } }, { now: noon }), false);
  assert.equal(inWindow({ rod: 6, window: { time: [25, 35] } }, { now: noon }), true);
  assert.equal(inWindow({ rod: 5, window: { weather: 'snow' } }, { now: noon, weather: 'snow' }), true);
  assert.equal(inWindow({ rod: 5, window: { weather: 'snow' } }, { now: noon, weather: null }), false);
  assert.equal(inWindow({ rod: 2 }, {}), true, 'no window: any time');
});

test('tables: Mirror Lake as it always was, town tables by the rule, and the clamps', () => {
  // Mirror Lake's weights match the old fixed table at levels up to 40.
  const w = Object.fromEntries(fishWeights('mirror', 3, 20, true).map((e) => [e.id, e.w]));
  const luck = 1 + 20 * 0.04 + 2 * 0.6;
  assert.equal(w.trout, 24 * luck);
  assert.equal(w.lake_king, 0.6 * luck);
  assert.equal(w.minnow, 18);
  assert.equal(tableOf('nowhere'), FISH_TABLES.mirror, 'an unknown table fishes like Mirror Lake');
  const T = townTable(12, ['minnow', 'perch', 'trout']);
  const sh = Object.fromEntries(fishWeights(T, 4, 12, false).map((e) => [e.id, e.w]));
  assert.deepEqual([sh.old_boot, sh.minnow, sh.perch, sh.trout], [7, 50, 35, 15 * fishLuck(4, 12)]);
  // Luck counts levels only up to 40; rods up to tier 7 keep getting better.
  assert.equal(fishLuck(1, 50), fishLuck(1, 40));
  const g3 = fishingGear(3, 40);
  const g7 = fishingGear(7, 40);
  assert.ok(g7.gain > g3.gain && g7.drain < g3.drain && g7.zone >= g3.zone);
  assert.ok(fishingGear(7, 50).drain >= 0.06 && fishingGear(9, 50).gain === fishingGear(7, 50).gain);
});
