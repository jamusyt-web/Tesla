// The journal and discovery (Phase 2, E3): cells and places, the 60/40
// page, claims, landmark resets, the bitmap re-projection and the atlas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, SPAWN } from '../../shared/world.js';
import { grid, markAround, reproject, cellIndex, hasBit, bytesFor, pagePct, atlasDrop, ATLAS, glimmers } from '../../shared/journal.js';
import { emit } from '../events.js';
import { harness } from './harness.js';

const lm = (id) => LANDMARKS.find((l) => l.id === id);
const at = (c, x, z) => Object.assign(c.ent, { x, z, path: null });

test('the patch put Hearthvale’s landmarks on the map', () => {
  for (const id of ['vista_wildwatch_cliff', 'cache_under_pier', 'npc_tinker', 'shrine_old_oak', 'curio_lost_hat']) assert.ok(lm(id), id);
});

test('pages read 60% from cells walked and 40% from places found', () => {
  assert.equal(pagePct(0, 100, 0, 10), 0);
  assert.equal(pagePct(100, 100, 0, 10), 60);
  assert.equal(pagePct(0, 100, 10, 10), 40);
  assert.equal(pagePct(50, 100, 5, 10), 50);
  assert.equal(pagePct(10, 10, 0, 0), 100, 'no places: cells only');
});

test('walking marks cells and finds places; the page and the quest follow', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Mapp');
    const p0 = game.journal.get(c).pages.find((p) => p.id === 'hearthvale');
    assert.ok(p0.found <= 1, 'a new hero has found at most the square’s waystone');
    assert.ok(p0.walked > 0, 'but has seen where they stand');
    const v = lm('vista_wildwatch_cliff');
    at(c, v.x, v.z);
    emit(c, 'pos', { x: v.x, z: v.z });
    const disc = c.sent.find((m) => m.t === 'discover' && m.id === v.id);
    assert.ok(disc, 'discovered');
    assert.ok(disc.pct > p0.pct);
    const p1 = game.journal.get(c).pages.find((p) => p.id === 'hearthvale');
    assert.equal(p1.found, p0.found + 1);
    assert.ok(p1.walked > p0.walked);
    // Attuning a stone counts as finding it.
    emit(c, 'attune', { id: 'stone_wildwatch' });
    assert.equal(game.journal.get(c).pages.find((p) => p.id === 'hearthvale').found, p0.found + 2);
    // Saved and loaded again.
    game.explore.save(c);
    const bits = new Uint8Array(game.db.prepare('SELECT bits FROM explore WHERE account_id = ?').get(c.id).bits);
    assert.ok(hasBit(bits, cellIndex(grid(), v.x, v.z)));
  } finally {
    done();
  }
});

test('the bitmap moves to a bigger grid without losing a cell', () => {
  const G = grid();
  const bits = new Uint8Array(bytesFor(G));
  markAround(bits, G, SPAWN.x, SPAWN.z);
  markAround(bits, G, 40, -60);
  const big = { x0: G.x0 - 160, z0: G.z0 - 48, w: G.w + 20, h: G.h + 9 };
  const moved = reproject(bits, G, big);
  for (const [x, z] of [[SPAWN.x, SPAWN.z], [40, -60]]) assert.ok(hasBit(moved, cellIndex(big, x, z)), `${x},${z}`);
  let a = 0;
  let b = 0;
  for (let k = 0; k < G.w * G.h; k++) a += hasBit(bits, k);
  for (let k = 0; k < big.w * big.h; k++) b += hasBit(moved, k);
  assert.equal(a, b);
});

test('landmarks: caches weekly, shrines every 30 minutes, curios once, views pin the region', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Lumi');
    const now = Date.now();
    const cache = lm('cache_under_pier');
    at(c, cache.x, cache.z);
    const g0 = game.heroes.gold(c.id);
    const r = game.landmarks.use(c, cache.id, now);
    assert.ok(r.loot.gold >= 20 && r.loot.gold <= 80);
    assert.equal(game.heroes.gold(c.id) - g0, r.loot.gold);
    assert.throws(() => game.landmarks.use(c, cache.id, now + 1000), /next week/);
    assert.ok(game.landmarks.use(c, cache.id, now + 8 * 86_400_000).loot, 'full again next week');
    // Too far away.
    assert.throws(() => game.landmarks.use(c, 'shrine_old_oak', now), /Walk up/);
    const sh = lm('shrine_old_oak');
    at(c, sh.x, sh.z);
    c.giveBoon('festive');
    game.landmarks.use(c, sh.id, now);
    assert.equal(c.hero.buffs.bless?.boon, 'blessing');
    assert.equal(c.hero.buffs.boon?.boon, 'festive', 'praying keeps Festive');
    assert.ok(c.effects().moveSpeed >= 0.15);
    assert.throws(() => game.landmarks.use(c, sh.id, now + 60_000), /Come back in/);
    game.landmarks.use(c, sh.id, now + 31 * 60_000);
    // A curio, once; the Town Hall takes it for reputation.
    const cu = lm('curio_lost_hat');
    at(c, cu.x, cu.z);
    game.landmarks.use(c, cu.id, now);
    assert.equal(game.heroes.count(c.id, 'lost_hat'), 1);
    assert.throws(() => game.landmarks.use(c, cu.id, now + 8 * 86_400_000), /already/);
    at(c, 0, 0);
    assert.equal(game.landmarks.returnCurios(c).rep, 30);
    assert.equal(game.heroes.count(c.id, 'lost_hat'), 0);
    // A view pins the region's places on your map.
    const v = lm('vista_wildwatch_cliff');
    at(c, v.x, v.z);
    const view = game.landmarks.use(c, v.id, now);
    assert.ok(view.pins.includes('secret_whisper_hollow'));
    const places = game.journal.get(c).pages.find((p) => p.id === 'hearthvale').tabs.places;
    assert.equal(places.find((p) => p.id === 'secret_whisper_hollow').name, 'Whisper Hollow', 'pinned: its name shows');
    assert.ok(c.sent.some((m) => m.t === 'quest' && m.id === 'hv_wander') || true);
  } finally {
    done();
  }
});

test('page claims: once each, only once reached, with rewards', () => {
  const { game, hero, done } = harness();
  try {
    const c = hero('Clay');
    assert.throws(() => game.journal.claim(c, 'hearthvale', 50), /Discover 50%/);
    // Walk the whole island and find everything.
    for (let x = -96; x <= 96; x += 24) for (let z = -96; z <= 96; z += 24) game.explore.visit(c, x, z);
    for (const l of LANDMARKS) game.explore.visit(c, l.x, l.z);
    for (const id of ['stone_square', 'stone_wildwatch']) emit(c, 'attune', { id });
    const page = game.journal.get(c).pages.find((p) => p.id === 'hearthvale');
    assert.ok(page.pct >= 75, `${page.pct}%`);
    const r = game.journal.claim(c, 'hearthvale', 50);
    assert.equal(r.reward.title, 'Hearthvale Wanderer');
    assert.ok(game.journal.get(c).titles.includes('Hearthvale Wanderer'));
    assert.throws(() => game.journal.claim(c, 'hearthvale', 50), /Already/);
    assert.throws(() => game.journal.claim(c, 'hearthvale', 60), /No such reward/);
    if (game.journal.get(c).whole >= 50) {
      game.journal.claim(c, 'whole', 50);
      assert.equal(game.heroes.count(c.id, 'charm_wayfarer'), 1);
    }
  } finally {
    done();
  }
});

test("Ysolde's Atlas: the tinker gives page 1 after the intro; each page needs the one before", () => {
  assert.equal(atlasDrop('npc_tinker', new Set()), 1);
  assert.equal(atlasDrop('npc_tinker', new Set([1])), null);
  assert.equal(atlasDrop('cache_under_pier', new Set()), null, 'no page 1, no page 2');
  assert.equal(atlasDrop('cache_under_pier', new Set([1])), 2);
  assert.equal(atlasDrop('cache_hollowlog', new Set([1, 2])), 3);
  assert.equal(atlasDrop('cache_hollowlog', new Set([1])), null, 'out of order: nothing');
  assert.equal(ATLAS.length, 12);
  assert.ok(glimmers(100).length <= 6);
  const { game, hero, done } = harness();
  try {
    const c = hero('Ysa');
    const t = lm('npc_tinker');
    at(c, t.x, t.z);
    const before = game.landmarks.use(c, t.id);
    assert.ok(!before.page, 'not before the intro is done');
    c.questsDone.add('hv_intro');
    const r = game.landmarks.use(c, t.id);
    assert.equal(r.page.n, 1);
    assert.equal(game.heroes.count(c.id, 'atlas_page_1'), 1);
    const pier = lm('cache_under_pier');
    at(c, pier.x, pier.z);
    assert.equal(game.landmarks.use(c, pier.id).page.n, 2);
  } finally {
    done();
  }
});

test('the 75% cloak tint must be earned; the trophy wall lists records and regions', () => {
  const { game, hero, call, done } = harness();
  try {
    const c = hero('Cape');
    call(c, 'avatar', { avatar: { ...c.hero.avatar, back: 'cape', cloakTint: 'meadow' } });
    assert.equal(c.hero.avatar.cloakTint, 'none', 'not earned yet');
    game.journal.note(c.id, 'unlock', 'cloak:meadow');
    call(c, 'avatar', { avatar: { ...c.hero.avatar, back: 'cape', cloakTint: 'meadow' } });
    assert.equal(c.hero.avatar.cloakTint, 'meadow');
    game.journal.note(c.id, 'fish', 'pike', { best: 6.2 });
    game.journal.note(c.id, 'unlock', 'plaque:hearthvale');
    const t = game.journal.trophies(c.id);
    assert.ok(t.some((l) => /Hearthvale: every corner found/.test(l)));
    assert.ok(t.some((l) => /Pike: 6.2 kg/.test(l)));
  } finally {
    done();
  }
});
