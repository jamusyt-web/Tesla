import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, RECIPE_BY_ID } from '../../shared/recipes.js';
import { ITEMS } from '../../shared/items.js';
import { bot } from './craft-bot.js';
import { buildSpec, replayCraft, finalizeCraft, scoreOf, gradeOf, isFlawless, outcomeOf, isStackable, batchCap, newCraft, input, advance, packInputs, unpackInputs, STEP_TEXT, READY, STAGE_W, STAGE_H, MAX_INPUTS, CRAFT_MAX_TICKS } from '../../shared/crafting.js';

test('the server replay of recorded inputs matches live play, for every recipe', () => {
  for (const r of RECIPES)
    for (let seed = 1; seed <= 12; seed++) {
      const spec = buildSpec(r, { lvl: r.lvl, batch: batchCap(r, 10), seed });
      const { s, inputs, end } = bot(spec, 45, seed);
      // Sent packed, the way the client sends them.
      const back = replayCraft(JSON.parse(JSON.stringify(spec)), unpackInputs(packInputs(inputs), end), end, [2, 2]);
      assert.deepEqual(back.res, s.res, `${r.id} seed ${seed}`);
      assert.equal(scoreOf(back), scoreOf(s));
      assert.ok(inputs.length <= MAX_INPUTS, `${r.id}: ${inputs.length} inputs`);
    }
});

test('moving time on in one jump or many small ones comes out the same', () => {
  const spec = buildSpec(RECIPE_BY_ID.sword_iron, { lvl: 6, seed: 4 });
  const { inputs, end } = bot(spec, 45, 2);
  const a = replayCraft(spec, inputs, end, [2, 2]);
  const b = newCraft(spec, [2, 2]);
  let k = 0;
  for (let t = 0; t <= end; t++) {
    while (k < inputs.length && inputs[k][0] === t) input(b, inputs[k++]);
    advance(b, t);
  }
  assert.deepEqual(b.res, a.res);
});

test('bad inputs are refused whole', () => {
  assert.deepEqual(unpackInputs([0, 0, 500, 300, 5, 2, 500, 300], 10), [[0, 0, 500, 300], [5, 2, 500, 300]]);
  for (const bad of [[0, 0, 500], [0, 3, 1, 1], [-1, 0, 1, 1], [0, 0, 1.5, 1], [0, 0, 9999, 1], [20, 0, 1, 1], 'x'])
    assert.equal(unpackInputs(bad, 10), null, JSON.stringify(bad));
  assert.equal(unpackInputs(new Array((MAX_INPUTS + 1) * 4).fill(0), 10), null);
});

test('doing nothing finishes as all misses (grade D, plain output); tapping all over scores badly', () => {
  const r = RECIPE_BY_ID.sword_iron;
  const idle = finalizeCraft(replayCraft(buildSpec(r, { lvl: 6, seed: 3 }), [], CRAFT_MAX_TICKS));
  assert.equal(scoreOf(idle), 0);
  assert.equal(gradeOf(0), 'D');
  let x = 11;
  const rnd = (n) => ((x = (x * 16807) % 2147483647) % n);
  for (const per of [4, 8, 15, 30]) {
    let sum = 0;
    for (let n = 0; n < 40; n++) {
      const inp = [];
      for (let t = 0; t < CRAFT_MAX_TICKS - 3; t += per) {
        const [px, py] = [rnd(1000), rnd(600)];
        inp.push([t, 0, px, py], [t + 2, 2, px, py]);
      }
      sum += scoreOf(finalizeCraft(replayCraft(buildSpec(r, { lvl: 6, seed: 500 + n }), inp, CRAFT_MAX_TICKS)));
    }
    assert.ok(sum / 40 < 25, `tapping at random every ${per} ticks scores ${sum / 40}`);
  }
});

test('stopping early never beats finishing', () => {
  const r = RECIPE_BY_ID.sword_iron;
  for (let n = 0; n < 80; n++) {
    const spec = buildSpec(r, { lvl: 6, seed: 9000 + n });
    const { s, inputs, end } = bot(spec, 45, n + 1);
    const full = scoreOf(s);
    for (const f of [0.25, 0.5, 0.75]) assert.ok(scoreOf(finalizeCraft(replayCraft(spec, inputs, Math.floor(end * f), [2, 2]))) <= full);
  }
});

test('skill matters: a steady hand makes Fine gear far more often than a shaky one', () => {
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
  const skilled = rate(22);
  const casual = rate(70);
  assert.ok(skilled.fine > 0.7, `skilled fine ${skilled.fine}`);
  assert.ok(casual.fine < 0.5, `casual fine ${casual.fine}`);
  assert.ok(skilled.mw > 0 && skilled.mw < 0.4, `masterwork stays rare: ${skilled.mw}`);
});

test('every recipe is a short run of real motions', () => {
  for (const r of RECIPES) {
    const spec = buildSpec(r, { lvl: r.lvl, seed: 2 });
    assert.ok(spec.steps.length >= 2 && spec.steps.length <= 11, `${r.id}: ${spec.steps.length} steps`);
    for (const st of spec.steps) assert.ok(STEP_TEXT[st.skin], `${r.id}: words for ${st.skin}`);
  }
  const kinds = (id) => buildSpec(RECIPE_BY_ID[id], { lvl: 10, seed: 1 }).steps.map((st) => st.k);
  assert.ok(kinds('sword_iron').includes('tap') && kinds('sword_iron').includes('carve'), 'swords are hammered then sharpened');
  assert.ok(kinds('oak_plank').includes('saw'), 'planks are sawn');
  assert.ok(kinds('fish_stew').includes('stir'), 'stew is stirred');
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

test('specs only use integers and every step can be done well', () => {
  for (const r of RECIPES) {
    const spec = buildSpec(r, { lvl: 10, batch: batchCap(r, 10), seed: 4 });
    assertSpec(r, spec);
  }
});
const assertSpec = (r, spec) => {
  const { P, G, W, p, g } = spec.win;
  assert.ok(P < G && G < W && p < g && g < 1000);
  let worst = READY;
  for (const st of spec.steps) {
    for (const v of Object.values(st)) if (typeof v === 'number') assert.ok(Number.isInteger(v), `${r.id} ${JSON.stringify(st)}`);
    if (st.k === 'hold') assert.ok(st.at + W + 4 <= st.F);
    if (st.k === 'tap') assert.ok(st.x - st.r >= 0 && st.x + st.r <= STAGE_W && st.y - st.r >= 0 && st.y + st.r <= STAGE_H, `${r.id} tap on the stage`);
    if (st.k === 'carve') for (const [x, y] of st.pts) assert.ok(x >= 0 && x <= STAGE_W && y >= 0 && y <= STAGE_H);
    worst += (st.T ?? 600 + st.F) + 30;
  }
  assert.ok(worst < CRAFT_MAX_TICKS, `${r.id}: even an idle craft ends on its own (${worst})`);
};

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
      assert.ok(spec.win.P >= 2);
      assertSpec(r, spec);
      if (r.pattern === 'forge_blade') assert.ok(spec.steps.length > base.steps.length, 'harder tiers have more steps');
      if (t >= 6) assert.ok(spec.steps.some((st) => st.skin === 'chill'), 'a chill from tier 6');
      // A careful player can still ace it, and the server replays it exactly.
      const { s, inputs, end } = bot(spec, 15, 9);
      const back = replayCraft(JSON.parse(JSON.stringify(spec)), inputs, end, [2, 2]);
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
