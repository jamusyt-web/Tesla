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
    const fish = rollFish(mulberry32(i + 1), 1 + (i % 3), 5, i % 2 === 0);
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
    for (let i = 0; i < 4000; i++) if (rollFish(r, tier, 20, deep).id === 'lake_king') return true;
    return false;
  };
  assert.equal(seen(1, true), false);
  assert.equal(seen(3, false), false);
  assert.equal(seen(3, true), true);
});
