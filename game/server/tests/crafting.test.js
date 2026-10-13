import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, RECIPE_BY_ID } from '../../shared/recipes.js';
import { ITEMS } from '../../shared/items.js';
import { bot } from './craft-bot.js';
import { buildSpec, replayCraft, finalizeCraft, scoreOf, gradeOf, isFlawless, outcomeOf, isStackable, batchCap, CRAFT_MAX_TICKS } from '../../shared/crafting.js';

test('the server replay of recorded inputs matches live play, for every recipe', () => {
  for (const r of RECIPES)
    for (let seed = 1; seed <= 12; seed++) {
      const spec = buildSpec(r, { lvl: r.lvl, batch: batchCap(r, 10), seed });
      const { s, tog } = bot(spec, 70, seed);
      const back = replayCraft(JSON.parse(JSON.stringify(spec)), tog, s.tick, [2, 2]);
      assert.deepEqual(back.res, s.res, `${r.id} seed ${seed}`);
      assert.equal(scoreOf(back), scoreOf(s));
    }
});

test('doing nothing finishes as all misses (grade D, plain output); mashing scores badly', () => {
  const r = RECIPE_BY_ID.sword_iron;
  const idle = finalizeCraft(replayCraft(buildSpec(r, { lvl: 6, seed: 3 }), [], CRAFT_MAX_TICKS));
  assert.equal(scoreOf(idle), 0);
  assert.equal(gradeOf(0), 'D');
  for (const per of [4, 6, 10, 15, 20]) {
    let sum = 0;
    for (let n = 0; n < 60; n++) {
      const tog = [];
      for (let t = 0; t < CRAFT_MAX_TICKS; t += per) tog.push(t, t + 2);
      sum += scoreOf(finalizeCraft(replayCraft(buildSpec(r, { lvl: 6, seed: 500 + n }), tog, CRAFT_MAX_TICKS)));
    }
    assert.ok(sum / 60 < 20, `mashing every ${per} ticks scores ${sum / 60}`);
  }
});

test('stopping early never beats finishing', () => {
  const r = RECIPE_BY_ID.sword_iron;
  for (let n = 0; n < 80; n++) {
    const spec = buildSpec(r, { lvl: 6, seed: 9000 + n });
    const { s, tog } = bot(spec, 70, n + 1);
    const full = scoreOf(s);
    for (const f of [0.25, 0.5, 0.75]) assert.ok(scoreOf(finalizeCraft(replayCraft(spec, tog, Math.floor(s.tick * f), [2, 2]))) <= full);
  }
});

test('skill matters: careful play makes Fine gear far more often than sloppy play', () => {
  const r = RECIPE_BY_ID.sword_iron;
  let rs = 7;
  const rng = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const rate = (sd) => {
    let fine = 0;
    let mw = 0;
    for (let n = 0; n < 200; n++) {
      const spec = buildSpec(r, { lvl: r.lvl, seed: 1000 + n });
      const { s } = bot(spec, sd, n + 3);
      const o = outcomeOf({ r, batch: 1, score: scoreOf(s), flawless: isFlawless(s), over: 0 }, rng);
      if (o.q >= 1) fine++;
      if (o.q === 2) mw++;
    }
    return { fine: fine / 200, mw: mw / 200 };
  };
  const skilled = rate(45);
  const casual = rate(110);
  assert.ok(skilled.fine > 0.7, `skilled fine ${skilled.fine}`);
  assert.ok(casual.fine < 0.5, `casual fine ${casual.fine}`);
  assert.ok(skilled.mw > 0 && skilled.mw < 0.4, `masterwork stays rare: ${skilled.mw}`);
});

test('outcomes: never less than the plain recipe; bonus yield only for materials/food', () => {
  for (const r of RECIPES)
    for (const score of [0, 55, 75, 88, 95, 100]) {
      const o = outcomeOf({ r, batch: 4, score, flawless: score === 100, over: 0 }, () => 0.01);
      assert.ok(ITEMS[o.item], `${r.id} → ${o.item}`);
      if (isStackable(r)) {
        assert.ok(o.qty >= r.qty * 4 && o.qty <= Math.ceil(r.qty * 4 * 1.2));
        assert.equal(o.q, 0);
      } else assert.equal(o.qty, r.qty);
    }
});

test('specs only use integers and keep every window reachable', () => {
  for (const r of RECIPES) {
    const spec = buildSpec(r, { lvl: 10, batch: batchCap(r, 10), seed: 4 });
    const { P, G, W } = spec.win;
    assert.ok(P < G && G < W);
    for (const st of spec.steps) {
      for (const v of Object.values(st)) if (typeof v === 'number') assert.ok(Number.isInteger(v), `${r.id} ${JSON.stringify(st)}`);
      if (st.k === 'sweep') assert.ok(st.c >= W + 6 && st.c <= st.H - W - 6);
      if (st.k === 'press') assert.ok(st.at + W + 4 <= st.F);
    }
  }
});

// ── Tiers 5–7 (Phase 1, M4) ──
import { recipeTier, windows } from '../../shared/crafting.js';
// Every pattern at each new tier (no real recipes up there yet).
const PATTERN_OF = { smelt: 'iron_bar', saw: 'oak_plank', scrape: 'leather', forge_tool: 'axe_iron', forge_blade: 'sword_iron', forge_plate: 'armor_iron', stew: 'fish_stew', brew: 'health_potion' };
const atTier = (lvl) => Object.values(PATTERN_OF).map((id) => RECIPE_BY_ID[id]).filter(Boolean).map((r) => ({ ...r, id: `${r.id}_t${lvl}`, lvl }));

test('tiers 5–7: more steps, the same reachable windows, and replays still agree', () => {
  assert.deepEqual([13, 20, 21, 28, 29, 40].map((lvl) => recipeTier({ lvl })), [5, 5, 6, 6, 7, 7]);
  const base = buildSpec(RECIPE_BY_ID.sword_iron, { lvl: 12, seed: 3 });
  for (const [lvl, t] of [[13, 5], [21, 6], [29, 7]])
    for (const r of atTier(lvl)) {
      const spec = buildSpec(r, { lvl, batch: 1, seed: 5 });
      assert.equal(spec.tier, t);
      const { P, G, W } = spec.win;
      assert.ok(P >= 2 && P < G && G < W, `${r.id}: ${P}/${G}/${W}`);
      for (const st of spec.steps) {
        for (const v of Object.values(st)) if (typeof v === 'number') assert.ok(Number.isInteger(v), `${r.id} ${JSON.stringify(st)}`);
        if (st.k === 'sweep') assert.ok(st.c >= W + 6 && st.c <= st.H - W - 6, `${r.id} sweep reachable`);
        if (st.k === 'press') assert.ok(st.at + W + 4 <= st.F, `${r.id} press reachable`);
      }
      if (r.pattern === 'forge_blade') assert.ok(spec.steps.length > base.steps.length, 'harder tiers have more steps');
      if (t >= 6) assert.ok(spec.steps.some((st) => st.skin === 'chill'), 'a chill from tier 6');
      // A careful player can still ace it, and the server replays it exactly.
      const { s, tog } = bot(spec, 20, 9);
      const back = replayCraft(JSON.parse(JSON.stringify(spec)), tog, s.tick, [2, 2]);
      assert.deepEqual(back.res, s.res);
      assert.ok(scoreOf(s) >= 70, `${r.id}: careful play scores ${scoreOf(s)}`);
    }
});

test('Smith and Steady Hands widen the windows, but never past the next one out', () => {
  for (let t = 1; t <= 7; t++) {
    const plain = windows(t, 0);
    const smith = windows(t, 0, { P: 1, G: 1 });
    assert.ok(smith.P >= plain.P && smith.G >= plain.G);
    assert.ok(smith.P < smith.G && smith.G < smith.W);
  }
  const spec = buildSpec(RECIPE_BY_ID.oak_plank, { lvl: 1, seed: 1, bonus: { P: 1 } });
  assert.equal(spec.win.P, windows(1, 0).P + 1, 'the bonus is baked into the stored spec');
  // Woodwright: extra planks; Artisan: more Masterwork.
  const r = RECIPE_BY_ID.oak_plank;
  const o = outcomeOf({ r, batch: 20, score: 60, flawless: false, over: 0, E: { bonusPlank: 1 } }, () => 0);
  assert.equal(o.qty, 40, 'every plank came with a spare');
  const mw = (E) => {
    let n = 0;
    let x = 1;
    const rng = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 4000; i++) if (outcomeOf({ r: RECIPE_BY_ID.sword_iron, batch: 1, score: 95, flawless: false, over: 0, E }, rng).mw) n++;
    return n / 4000;
  };
  assert.ok(mw({ masterworkPct: 0.04 }) > mw({}) + 0.02);
});
