// More than one town (Phase 1, M2): each town's own stations and work spots,
// recipes only one town can make, the dock acting for the town you're in,
// passages, items waystones won't carry, the toll, and trips home and to a
// party member.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openDb } from '../db.js';
import { Game } from '../game.js';
import { dispatch } from '../rpc.js';
import { useMap, SHIPPED_MAP } from '../map.js';
import { rebuildWorld } from '../static.js';
import * as W from '../../shared/world.js';
import { ITEMS } from '../../shared/items.js';
import { xpForLevel } from '../../shared/skills.js';
import { spotsOf, stationPos } from '../../shared/stations.js';
import { townBuilding, townAt } from '../../shared/places.js';
import { travelToll, homeStone, passageAt, passageNeeds } from '../../shared/travel.js';
import { twoTownMap, installTestvale, uninstallTestvale, TV } from './twotown.js';

let db;
let game;
let n = 0;
before(() => {
  useMap(twoTownMap());
  rebuildWorld();
  db = openDb(':memory:');
  game = new Game(db, { shopSim: false });
  // Testvale's content: its passage kit, a letter waystones won't carry, its own recipe.
  installTestvale();
});
after(() => {
  uninstallTestvale();
  useMap(JSON.parse(fs.readFileSync(SHIPPED_MAP, 'utf8')));
  rebuildWorld();
});

// A connected hero, without a socket.
function hero(name) {
  const id = Number(db.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?,?,?,?)').run(`${name.toLowerCase()}${++n}`, 'x', 'y', Date.now()).lastInsertRowid);
  game.heroes.create(id, name, {});
  const sent = [];
  const c = game.connect({ readyState: 1, send: (d) => sent.push(JSON.parse(d)), on() {}, close() {} }, id);
  return Object.assign(c, { sent });
}
const put = (c, x, z) => Object.assign(c.ent, { x, z, path: null });
const err = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return '';
};

test('each town has its own stations: crafting claims the nearest one', () => {
  assert.equal(townAt(TV.x, TV.z)?.id, 'testvale');
  assert.equal(stationPos('anvil', TV.x, TV.z).id, 'testvale_anvil');
  assert.equal(stationPos('anvil', 0, 0).id, 'p11', "Hearthvale's anvil from Hearthvale");
  const a = hero('Anvi');
  const b = hero('Bel');
  game.heroes.addItem(a.hero.id, 'oak_log', 4);
  game.heroes.addItem(b.hero.id, 'oak_log', 4);
  // Ada at Testvale's workbench, Bel at Hearthvale's: both get the first spot.
  const ta = spotsOf('workbench', TV.x, TV.z)[0];
  const hb = spotsOf('workbench', 0, 0)[0];
  put(a, ta.x, ta.z);
  put(b, hb.x, hb.z);
  const sa = dispatch(game, a, 'craft.start', { recipe: 'oak_plank', batch: 1 });
  const sb = dispatch(game, b, 'craft.start', { recipe: 'oak_plank', batch: 1 });
  assert.equal(sa.spot.prop, 'testvale_workbench');
  assert.equal(sb.spot.prop, 'p12');
  assert.ok(Math.hypot(sa.spot.x - ta.x, sa.spot.z - ta.z) < 0.01 && Math.hypot(sb.spot.x - hb.x, sb.spot.z - hb.z) < 0.01, 'each got the near spot at their own bench');
  assert.deepEqual(a.ch.spots.get('testvale_workbench').slice(0, 1), [a.hero.id]);
  // Finishing frees the spot at the bench it was claimed at.
  dispatch(game, a, 'craft.finish', { sid: sa.sid, toggles: [], end: 1, off: [0, 0] });
  dispatch(game, b, 'craft.finish', { sid: sb.sid, toggles: [], end: 1, off: [0, 0] });
  assert.ok(!a.ch.spots.get('testvale_workbench').includes(a.hero.id));
  assert.ok(game.heroes.count(a.hero.id, 'oak_plank') >= 1, 'made a plank in Testvale');
  game.disconnect(a);
  game.disconnect(b);
});

test("a town's own recipe is refused anywhere else", () => {
  const c = hero('Loka');
  try {
    game.heroes.addItem(c.hero.id, 'oak_log', 4);
    const hv = spotsOf('workbench', 0, 0)[0];
    put(c, hv.x, hv.z);
    assert.match(err(() => dispatch(game, c, 'craft.start', { recipe: 'tv_plank', batch: 1 })), /can only be made in Testvale/);
    assert.equal(game.heroes.count(c.hero.id, 'oak_log'), 4, 'nothing taken');
    const tv = spotsOf('workbench', TV.x, TV.z)[0];
    put(c, tv.x, tv.z);
    const st = dispatch(game, c, 'craft.start', { recipe: 'tv_plank', batch: 1 });
    assert.equal(st.spot.prop, 'testvale_workbench');
    dispatch(game, c, 'craft.finish', { sid: st.sid, toggles: [], end: 1, off: [0, 0] });
  } finally {
    game.disconnect(c);
  }
});

test('the dock opens the services of the town you are in; looks come from style and kit', () => {
  assert.equal(townBuilding('craft', TV.x + 5, TV.z).id, 'testvale_workshop');
  assert.equal(townBuilding('market', TV.x - 30, TV.z).id, 'testvale_market', 'in Testvale even when nearer the edge');
  assert.equal(townBuilding('craft', 0, 0).id, 'workshop');
  assert.equal(townBuilding('townhall', 200, 0)?.action, 'townhall', 'between towns: the nearest');
  assert.equal(W.styleOf({ id: 'tv_market' }), 'tv_market');
  assert.equal(W.styleOf({ id: 'tv_market', style: 'market' }), 'market');
  assert.equal(W.styleOf({ id: 'h1', deco: true }), 'cottage');
  assert.equal(W.kitOf({ id: 'x' }), 'ftk');
  assert.equal(W.kitOf({ id: 'x', kit: 'cabin' }), 'cabin');
});

test('a passage needs its skill level or its kit, and hops you to the other end', () => {
  const p = W.PASSAGES[0];
  assert.equal(passageNeeds(p), 'Mining 10 or Testvale Lantern');
  const c = hero('Pip');
  try {
    put(c, p.x + 10, p.z);
    assert.match(err(() => dispatch(game, c, 'passage.use', { id: p.id })), /Walk up to/);
    put(c, p.x + 1, p.z);
    assert.equal(passageAt(c.ent.x, c.ent.z)?.p.id, p.id);
    assert.match(err(() => dispatch(game, c, 'passage.use', { id: p.id })), /You need Mining 10 or Testvale Lantern/);
    // The kit opens it, and isn't used up.
    game.heroes.addItem(c.hero.id, 'tv_lantern', 1);
    const r = dispatch(game, c, 'passage.use', { id: p.id });
    assert.ok(Math.hypot(r.x - p.tx, r.z - p.tz) <= 3, 'on the islet');
    assert.equal(game.heroes.count(c.hero.id, 'tv_lantern'), 1);
    // And back again with the skill instead of the kit.
    game.heroes.takeItem(c.hero.id, 'tv_lantern', 1);
    c.hero.skills.mining = xpForLevel(10);
    const back = dispatch(game, c, 'passage.use', { id: p.id });
    assert.ok(Math.hypot(back.x - p.x, back.z - p.z) <= 3, 'back on Testvale');
    c.battle = { leave() {} };
    assert.match(err(() => dispatch(game, c, 'passage.use', { id: p.id })), /battle/);
    c.battle = null;
  } finally {
    game.disconnect(c);
  }
});

test('the toll formula', () => {
  const items = { ore: { tag: 'ore', value: 100 }, axe: { tag: 'tool', value: 1000 }, log: { tag: 'wood', value: 4 } };
  assert.equal(travelToll({}, items), 0);
  assert.equal(travelToll({ ore: 8 }, items), 0, 'floor value 480: under 500, free');
  assert.equal(travelToll({ ore: 10 }, items), 4, 'floor value 600: 0.04 × 100');
  assert.equal(travelToll({ log: 250 }, items), 4, 'exact, with no rounding drift');
  assert.equal(travelToll({ ore: 30 }, items), 52, 'floor value 1800: 0.04 × 1300');
  assert.equal(travelToll({ ore: 100 }, items), 120, 'capped at 120');
  assert.equal(travelToll({ axe: 50 }, items), 0, 'gear is not charged');
  assert.equal(travelToll({ ore: 10, nothing: 5 }, items), 4, 'unknown items are skipped');
});

test('waystones charge the toll on raw goods, refuse a nowarp item, and go to a party member', () => {
  const sq = W.STONES.find((s) => s.id === 'stone_square');
  const a = hero('Tolly');
  const b = hero('Mate');
  try {
    for (const s of ['stone_square', 'stone_wildwatch', 'stone_testvale']) game.heroes.attune(a.hero, s);
    const [sx, sz] = W.stoneFront(sq);
    put(a, sx, sz);
    game.heroes.addItem(a.hero.id, 'iron_ore', 100); // floor value 960: toll 18
    game.heroes.addGold(a.hero.id, 500);
    const gold = game.heroes.gold(a.hero.id);
    const r = dispatch(game, a, 'travel', { to: 'stone_wildwatch' });
    assert.equal(r.toll, 18);
    assert.equal(game.heroes.gold(a.hero.id), gold - r.fee - 18);
    assert.equal(db.prepare("SELECT amount FROM gold_flow WHERE reason = 'toll'").get()?.amount, -18, 'the toll is booked as a sink');

    // A letter in the bag: the stone won't take you.
    a.lastTravel = 0;
    game.heroes.addItem(a.hero.id, 'tv_letter', 1);
    assert.match(err(() => dispatch(game, a, 'travel', { to: 'stone_square' })), /won't carry your Letter to Testvale/);
    game.heroes.takeItem(a.hero.id, 'tv_letter', 1);

    // To a party member in Testvale: the attuned stone nearest them.
    put(b, TV.x, TV.z + 25);
    assert.match(err(() => dispatch(game, a, 'travel.party', { member: b.hero.id })), /not in your party/);
    game.parties.invite(a, b.hero.id);
    game.parties.answer(b, true);
    a.lastTravel = 0;
    const t = dispatch(game, a, 'travel.party', { member: b.hero.id });
    assert.equal(t.to, 'stone_testvale');
    assert.equal(t.fee, W.travelFee(W.STONES.find((s) => s.id === 'stone_wildwatch'), W.STONES.find((s) => s.id === 'stone_testvale')));
    assert.equal(townAt(a.ent.x, a.ent.z)?.id, 'testvale');
  } finally {
    game.disconnect(a);
    game.disconnect(b);
  }
});

test('a Hearth Charm takes you to your home stone, once', () => {
  assert.equal(homeStone('hearthvale').id, 'stone_square', 'the stone in Hearthvale nearest its centre');
  assert.equal(homeStone('testvale').id, 'stone_testvale', "the region's own stone");
  const c = hero('Homer');
  try {
    assert.equal(c.hero.home, 'hearthvale', 'everyone starts out at home in Hearthvale');
    put(c, TV.x, TV.z + 20);
    assert.match(err(() => dispatch(game, c, 'travel.home')), /need a Hearth Charm/);
    game.heroes.addItem(c.hero.id, 'hearth_charm', 1);
    game.heroes.addItem(c.hero.id, 'tv_letter', 1);
    assert.match(err(() => dispatch(game, c, 'travel.home')), /won't carry/);
    game.heroes.takeItem(c.hero.id, 'tv_letter', 1);
    const gold = game.heroes.gold(c.hero.id);
    const r = dispatch(game, c, 'travel.home');
    assert.equal(r.to, 'stone_square');
    assert.equal(game.heroes.gold(c.hero.id), gold, 'free');
    assert.equal(game.heroes.count(c.hero.id, 'hearth_charm'), 0, 'the charm is used up');
    assert.equal(townAt(c.ent.x, c.ent.z)?.id, 'hearthvale');
    assert.ok(c.hero.stones.includes('stone_square'), 'and attuned on arrival');
    // Home is a hero field that later packages set.
    game.heroes.setField(c.hero.id, 'home', 'testvale');
    assert.equal(game.heroes.load(c.hero.id).home, 'testvale');
  } finally {
    game.disconnect(c);
  }
});
