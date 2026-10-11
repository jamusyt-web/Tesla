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
