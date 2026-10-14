// Going to the town's services: walking to a building, a crafting station,
// the bulletin board, a waystone or the crypt door, then opening it; the
// hands-on craft's life cycle; and the context action (the best thing to do
// right here, which today only the crypt offers). Each takes the GameClient g.
import * as THREE from 'three';
import { CraftGame } from '../ui/craftgame.js';
import { RECIPE_BY_ID, RECIPES } from '../../../shared/recipes.js';
import { spotsOf, stationPos, inYard } from '../../../shared/stations.js';
import { STATIONS } from '../../../shared/crafting.js';
import { ITEMS } from '../../../shared/items.js';
import { BUILDINGS, GATES, PROPS, STONES, LANDMARKS, NODE_TYPES, FISH_RANGE, doorPoint, stoneById, stoneFront, STONE_RANGE, ENTRANCES, entranceFront } from '../../../shared/world.js';
import { ENTRANCE_RANGE, word } from '../../../shared/dungeon.js';
import { passageAt, passageOpen, passageNeeds } from '../../../shared/travel.js';
import { LANDMARK_INFO, LANDMARK_RANGE } from '../../../shared/journal.js';
import { townBuilding, townAt } from '../../../shared/places.js';
import { MONSTERS } from '../../../shared/monsters.js';
import { levelFromXp } from '../../../shared/skills.js';
import { pickContext } from '../../../shared/goals.js';

// Walk to the recipe's station, then make it by hand.
export function goCraft(g, recipe, batch = 1) {
  const r = RECIPE_BY_ID[recipe];
  if (!r || !g.me) return;
  if (g.dungeon) return g.underground();
  if (g.battle || g.room) return g.hud.toast('Not right now!', 'err');
  if (g.craft) return g.hud.toast("You're already crafting.", 'err');
  if (g.fishing) g.endFishing();
  g.stopGather();
  const L = g.me.local;
  const sp = spotsOf(r.station, L.x, L.z)
    .slice(0, 2)
    .sort((a, b) => Math.hypot(a.x - L.x, a.z - L.z) - Math.hypot(b.x - L.x, b.z - L.z))[0];
  const start = () => startCraft(g, recipe, batch);
  if (Math.hypot(L.x - sp.x, L.z - sp.z) < 1.5) return start();
  g.hud.toast(`Off to the ${STATIONS[r.station].label}…`);
  if (!g.walkTo(sp.x, sp.z, true, start)) g.hud.toast("Can't reach the station.", 'err');
}

async function startCraft(g, recipe, batch) {
  try {
    const st = await g.sock.rpc('craft.start', { recipe, batch });
    beginCraft(g, st, recipe, batch);
  } catch (e) {
    g.hud.toast(e.message, 'err');
  }
}

function beginCraft(g, st, recipe, batch) {
  g.hud.worldMap.close();
  g.craft = { ...st, recipe, batch };
  const L = g.me.local;
  L.path = [[st.spot.x, st.spot.z]];
  g.intent = null;
  g.me.av.hold(st.station === 'anvil' ? 'pick' : null);
  g.me.av.setState('gather');
  const station = st.station;
  g.hud.craftGame = new CraftGame(g.hud, st, {
    onDone: (fin) => finishCraft(g, fin),
    onStop: (fin) => finishCraft(g, fin),
    onStep: (step, q) => {
      if (step.k === 'tap') g.me.av.play('swing', 0.32);
      else if (step.k === 'hold') g.me.av.play('cast', 0.45);
      else g.me.av.play('pick', 0.4);
      const p = stationPos(station, g.me.local.x, g.me.local.z);
      if (p && q !== 'M') g.fx.burst(new THREE.Vector3(p.x, 1.1, p.z), { n: q === 'P' ? 14 : 6, color: station === 'cookpot' ? ['#ffffff', '#d9f3ff'] : station === 'forge' || station === 'anvil' ? ['#ffd84a', '#ff9a3c', '#fff1a8'] : ['#e0bd8a', '#c89a62'], speed: 4, up: 3, size: 0.12, life: 0.5, gravity: 6 });
    },
  });
}

async function finishCraft(g, fin) {
  const cr = g.craft;
  try {
    const res = await g.sock.rpc('craft.finish', fin);
    craftDone(g, res, cr);
  } catch (e) {
    if (/Disconnected|Not connected|too long/.test(e.message)) {
      g.pendingFinish = fin; // send it again once we're back
      return;
    }
    g.hud.toast(e.message, 'err');
    g.hud.craftGame?.close();
    endCraftLocal(g);
  }
}

export function craftDone(g, res, cr) {
  endCraftLocal(g);
  if (res.refunded) {
    g.hud.craftGame?.close();
    return g.hud.toast('That craft was interrupted — your materials are back in your bag.');
  }
  if (res.xp) g.hud.onXp(res.xp);
  const cg = g.hud.craftGame;
  if (!cg) return g.hud.toast(`${res.out.qty}× ${ITEMS[res.out.item].name} (grade ${res.grade})`, 'good');
  // What next: sell them to this town's merchant, or the recipe they go into.
  const out = res.out;
  const qty = g.hud.me.inv?.[out.item] ?? out.qty;
  const use = RECIPES.find((r) => r.in[out.item] && !r.town && (g.hud.me.inv?.[out.item] ?? 0) >= r.in[out.item]);
  cg.showResult(res, {
    onAgain: cr ? () => (cg.close(), g.goCraft(cr.recipe, cr.batch)) : null,
    onEquip: (id) => g.sock.rpc('equip', { item: id }).then(() => g.hud.toast(`Equipped ${ITEMS[id].name}!`, 'good')).catch((e) => g.hud.toast(e.message, 'err')),
    onSell: ITEMS[out.item]?.cat !== 'gear' && ITEMS[out.item]?.cat !== 'tool' ? { label: `Sell ${qty} here`, run: () => g.sock.rpc('npcSell', { item: out.item, qty }).then((r) => (g.hud.toast(`Sold ${qty}× ${ITEMS[out.item].name}: +${r.gold} 🪙`, 'gold'), cg.close())).catch((e) => g.hud.toast(e.message, 'err')) } : null,
    useIn: use ? { label: `Make ${ITEMS[use.out]?.name}`, run: () => (cg.close(), g.goCraft(use.id)) } : null,
  });
}

function endCraftLocal(g) {
  g.craft = null;
  g.pendingFinish = null;
  if (g.me) {
    g.me.av.hold(null);
    g.me.av.setState('idle');
  }
}

// After (re)connecting: carry on, finish as-is, or report what happened.
export function resumeCraft(g, you) {
  const c = you.craft;
  if (g.pendingFinish && c?.sid === g.pendingFinish.sid) {
    const fin = g.pendingFinish;
    g.pendingFinish = null;
    return finishCraft(g, fin);
  }
  if (c && g.craft?.sid === c.sid) return; // still playing it here
  if (c) {
    // Reloaded or another device: it can only be finished as it is.
    g.sock
      .rpc('craft.finish', { sid: c.sid, inputs: [], end: 0, off: [0, 0], stop: true })
      .then((res) => g.hud.toast(`Your ${ITEMS[res.out?.item]?.name || 'craft'} was finished as it was (grade ${res.grade}).`))
      .catch(() => {});
  } else if (g.craft) {
    g.hud.craftGame?.close();
    endCraftLocal(g);
  }
}

export function goBuilding(g, id) {
  if (g.battle) return;
  if (g.dungeon) return g.underground();
  // A gate: walk to just outside it (away from the middle of the town it guards).
  const gate = GATES.find((x) => x.id === id);
  if (gate) {
    const t = townAt(gate.x, gate.z) ?? { x: 0, z: 0 };
    const d = Math.hypot(gate.x - t.x, gate.z - t.z) || 1;
    return g.walkTo(gate.x + ((gate.x - t.x) / d) * 6, gate.z + ((gate.z - t.z) / d) * 6, true);
  }
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) return;
  const [dx, dz] = doorPoint(b);
  const L = g.me.local;
  const open = () => (b.action === 'shop' ? g.enterShop(g.myId) : g.hud.openBuilding(b.action));
  if (Math.hypot(L.x - dx, L.z - dz) < 2.5) return open();
  g.stopGather();
  g.walkTo(dx, dz, true, open);
}

// Walk up to a bulletin board (by prop id, or the one tapped), then open it.
export function goBoard(g, id, point = null) {
  const pr = id ? PROPS.find((p) => p.id === id) : PROPS.filter((p) => p.slot === 'proc_job_board').sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0];
  if (!pr || g.battle) return;
  if (g.dungeon) return g.underground();
  const open = () => g.hud.panels.open('jobs');
  const [fx, fz] = [pr.x + Math.sin(pr.rot || 0) * 1.8, pr.z + Math.cos(pr.rot || 0) * 1.8];
  const L = g.me.local;
  if (Math.hypot(L.x - fx, L.z - fz) < 3) return open();
  g.stopGather();
  if (!g.walkTo(fx, fz, true, open)) open();
}

// Walk up to a waystone; with openMap, open the world map on arrival to
// pick where to go. Returns false if there's no way there.
export function goStone(g, id, { openMap = false } = {}) {
  const st = stoneById(id);
  if (!st || g.battle) return false;
  if (g.dungeon) return g.underground(), false;
  const L = g.me.local;
  const arrive = () => openMap && g.hud.worldMap.open(typeof openMap === 'object' ? openMap : {});
  if (Math.hypot(L.x - st.x, L.z - st.z) < STONE_RANGE - 1) return arrive(), true;
  g.stopGather();
  const [fx, fz] = stoneFront(st, 2);
  return g.walkTo(fx, fz, true, arrive);
}

export async function travelTo(g, id) {
  if (g.travelling) return false;
  if (g.dungeon) return g.underground(), false;
  g.travelling = true;
  g.me.local.path = null;
  g.intent = null;
  try {
    const r = await g.sock.rpc('travel', { to: id });
    g.hud.toast(`Travelled to ${stoneById(r.to)?.name ?? 'the waystone'} (−${r.fee + (r.toll ?? 0)} 🪙)`, 'gold');
    return true;
  } catch (e) {
    g.hud.toast(e.message, 'err');
    return false;
  } finally {
    g.travelling = false;
  }
}

// The other trips: home with a Hearth Charm, to a party member, or through a
// passage. Each is one RPC; the server moves you.
async function trip(g, m, a, done) {
  if (g.travelling || !g.me) return false;
  if (g.dungeon) return g.underground(), false;
  if (g.battle) return g.hud.toast("You're in a battle!", 'err'), false;
  g.travelling = true;
  g.me.local.path = null;
  g.intent = null;
  try {
    done(await g.sock.rpc(m, a));
    return true;
  } catch (e) {
    g.hud.toast(e.message, 'err');
    return false;
  } finally {
    g.travelling = false;
  }
}
export const travelHome = (g) => trip(g, 'travel.home', {}, (r) => g.hud.toast(`Home to ${stoneById(r.to)?.name ?? 'your home stone'}${r.toll ? ` (toll −${r.toll} 🪙)` : ''}`, 'gold'));
export const travelToMember = (g, member) => trip(g, 'travel.party', { member }, (r) => g.hud.toast(`Travelled to ${stoneById(r.to)?.name ?? 'the waystone'} (−${r.fee + (r.toll ?? 0)} 🪙)`, 'gold'));
export const usePassage = (g, id) => trip(g, 'passage.use', { id }, () => {});

// Out in the world (SPEC §5.3): the context button's rules, first match
// wins. It always offers something: last of all, the Compass's top goal.
const PASSAGE_VERB = { squeeze: 'Squeeze through', climb: 'Climb', swim: 'Swim across' };
const VERB = { tree: 'Chop', rock: 'Mine', herb: 'Pick', fish: 'Cast at' };
function worldAction(g, L, cur) {
  const me = g.hud.me;
  const slack = (key) => (cur === key ? 1.5 : 0); // a little hysteresis for the one showing
  const d = (x, z) => Math.hypot(x - L.x, z - L.z);
  const c = [];
  // 1. A friend's fight nearby.
  for (const b of g.battles.values()) {
    const mv = g.mobs.get(b.mob);
    if (!mv || b.fighters.length >= 4 || b.fighters.some((f) => f.id === g.myId) || d(mv.x, mv.z) > 20 + slack('fight')) continue;
    c.push({ rule: 'fight', d: d(mv.x, mv.z), label: `Join ${b.fighters[0]?.name ?? 'the'}'s fight`, glyph: 'swords', fn: () => g.goMob(b.mob) });
  }
  // 3. Gold or goods waiting right here.
  const shop = townBuilding('shop', L.x, L.z);
  const till = me.shop?.till ?? g.hud.till ?? 0;
  if (shop && till > 0) {
    const [dx, dz] = doorPoint(shop);
    if (d(dx, dz) < 6 + slack('collect')) c.push({ rule: 'collect', d: d(dx, dz), label: `Collect ${till} 🪙`, glyph: 'coins', fn: () => g.enterShop(g.myId) });
  }
  const mk = townBuilding('market', L.x, L.z);
  const town = townAt(L.x, L.z)?.id;
  if (mk && town && (me.storage?.[town] ?? 0) > 0) {
    const [dx, dz] = doorPoint(mk);
    if (d(dx, dz) < 6 + slack('collect')) c.push({ rule: 'collect', d: d(dx, dz), label: 'Collect storage', glyph: 'bag', fn: () => g.sock.rpc('storage.collect').then((r) => g.hud.toast(`Collected ${r.moved?.length ?? 0} kinds of goods.`, 'good')).catch((e) => g.hud.toast(e.message, 'err')) });
  }
  // 4. Something to hand in at the board you're at.
  const board = PROPS.filter((p) => p.slot === 'proc_job_board').find((p) => d(p.x, p.z) < 5 + slack('deliver'));
  if (board) {
    const ready = g.hud.goal.compass?.state().ready.filter((r) => r.kind === 'order') ?? [];
    c.push({ rule: 'deliver', d: d(board.x, board.z), label: ready.length ? `Hand in: ${ready[0].text.replace(/^Hand in at the Order Board: /, '')}` : 'Read the board', glyph: 'scroll', fn: () => g.hud.panels.open('jobs', { tab: 'orders' }) });
  }
  // 4b. Letters and curios for this town's hall.
  const hall = townBuilding('townhall', L.x, L.z);
  if (hall && town) {
    const [dx, dz] = doorPoint(hall);
    const forHere = Object.keys(me.inv ?? {}).filter((id) => me.inv[id] > 0 && ['letter', 'curio'].includes(ITEMS[id]?.tag) && (ITEMS[id].town ?? 'hearthvale') === town);
    if (forHere.length && d(dx, dz) < 7 + slack('deliver')) {
      const letter = forHere.find((id) => ITEMS[id].tag === 'letter');
      c.push({ rule: 'deliver', d: d(dx, dz), label: letter ? 'Deliver the letter' : 'Hand in curios', glyph: 'scroll', fn: () => g.sock.rpc('curio.return').then((r) => g.hud.toast(r.letters?.length ? 'The letter is delivered. The Town Hall thanks you!' : `The Town Hall thanks you: +${r.rep} standing.`, 'gold')).catch((e) => g.hud.toast(e.message, 'err')) });
    }
  }
  // 5. A passage.
  const at = passageAt(L.x, L.z);
  if (at) {
    const p = at.p;
    if (!passageOpen(p, me.skills, me.inv)) c.push({ rule: 'passage', d: 0, label: passageNeeds(p), glyph: 'lock', off: true, fn: () => g.hud.toast(`You need ${passageNeeds(p)}.`, 'err') });
    else c.push({ rule: 'passage', d: 0, label: PASSAGE_VERB[p.kind] ?? 'Go through', glyph: 'run', fn: () => usePassage(g, p.id) });
  }
  // 6. A waystone: travel.
  for (const st of STONES) if (d(st.x, st.z) < STONE_RANGE + slack('stone')) c.push({ rule: 'stone', d: d(st.x, st.z), label: 'Travel', glyph: 'waystone', fn: () => g.hud.worldMap.open({}) });
  // 7. A dungeon door.
  for (const e of ENTRANCES) {
    const [fx, fz] = entranceFront(e);
    if (d(fx, fz) < ENTRANCE_RANGE + slack('door')) c.push({ rule: 'door', d: d(fx, fz), label: `Enter the ${word(e.kind)}`, glyph: 'crypt', fn: () => g.goCrypt(e.id) });
  }
  // 8. A landmark: open, look, read, pray, talk…
  for (const lm of LANDMARKS) {
    const info = LANDMARK_INFO[lm.kind];
    const dd = d(lm.x, lm.z);
    if (!info?.verb || dd > LANDMARK_RANGE + (lm.r ?? 0) * 0.25 + slack('landmark')) continue;
    const wait = g.hud.goal.compass?.landmarkWait?.[lm.id];
    c.push({ rule: 'landmark', d: dd, label: wait ? `${lm.name}: come back later` : info.verb, glyph: info.glyph, off: !!wait, fn: () => (wait ? g.hud.toast(wait) : useLandmark(g, lm)) });
  }
  // 9. The Compass's recipe, in a yard.
  const goal = g.hud.goal.shown;
  if (goal?.recipe && inYard(L.x, L.z)) c.push({ rule: 'craft', d: 0, label: `Make ${ITEMS[RECIPE_BY_ID[goal.recipe]?.out]?.name ?? 'it'}`, glyph: 'hammer', fn: () => goCraft(g, goal.recipe) });
  // 10. Gathering: the next one like the one you just felled, else what's in reach.
  const last = g.lastBroke && Date.now() - g.lastBroke.at < 20_000 ? g.lastBroke : null;
  let node = null;
  for (const n of g.allNodes()) {
    const t = NODE_TYPES[n.type];
    if (!t || t.kind === 'fish' || !g.town.nodes.get(n.id)?.alive) continue;
    const dd = d(n.x, n.z);
    const same = last && n.type === last.type;
    if (dd > (same ? 30 : 12) + slack('node')) continue;
    if (levelFromXp(me.skills?.[t.skill] || 0) < t.lvl) continue;
    const k = (same ? 0 : 1000) + dd;
    if (!node || k < node.k) node = { n, t, dd, k, same };
  }
  const nameOf = (n) => g.town.nodes.get(n.id)?.name ?? NODE_TYPES[n.type]?.name;
  if (node) c.push({ rule: 'node', d: node.dd, label: node.same ? `Next ${node.t.name} (${Math.round(node.dd)} m)` : `${VERB[node.t.kind] ?? 'Gather'} ${nameOf(node.n)}`, glyph: node.t.kind === 'tree' ? 'pine' : node.t.kind === 'rock' ? 'pick' : 'herbs', fn: () => g.goNode(node.n.id) });
  // 11. Fishing: cast (again).
  const spot = g.nearestNode('fish_spot');
  if (spot && d(spot.x, spot.z) < FISH_RANGE + 2 + slack('cast')) c.push({ rule: 'cast', d: d(spot.x, spot.z), label: g.lastFish && Date.now() - g.lastFish < 30_000 ? 'Cast again' : 'Cast', glyph: 'rod', fn: () => g.goNode(spot.id) });
  // 12. A monster you can take on.
  const con = g.conLevel?.() ?? me.level ?? 1;
  for (const m of g.mobs.values()) {
    if (m.state === 'dead' || m.battle) continue;
    const dd = d(m.x, m.z);
    const lvl = MONSTERS[m.type]?.lvl ?? 1;
    if (dd > 15 + slack('monster') || lvl > con + 3) continue;
    c.push({ rule: 'monster', d: dd, label: `Fight ${MONSTERS[m.type]?.name ?? m.type}`, glyph: 'swords', fn: () => g.goMob(m.id) });
  }
  // 13. The Compass's top goal.
  if (goal) c.push({ rule: 'compass', d: 0, label: `→ ${goal.text.replace(/^[^:]*\d+\/\d+: /, '')}`, glyph: 'compass', fn: () => g.hud.goal.take(goal) });
  const best = pickContext(c);
  return best ? { ...best, key: best.rule } : { rule: 'compass', key: 'compass', label: 'Look around', glyph: 'compass', fn: () => g.hud.toggleMap() };
}

// Use a landmark, and show what it gave.
export async function useLandmark(g, lm) {
  try {
    const r = await g.sock.rpc('landmark.use', { id: lm.id });
    const C = g.hud.goal.compass;
    C?.markUsed?.(lm.id, r);
    if (r.kind === 'vista') {
      g.lookToward?.(r.look ?? 0);
      for (const id of r.pins ?? []) C?.seen.add(id);
      g.hud.toast(`You can see the whole region from here: ${r.pins?.length ?? 0} places marked on your map.`, 'good');
    }
    const lootText = r.loot ? [r.loot.gold ? `${r.loot.gold} 🪙` : null, ...Object.entries(r.loot.items ?? {}).map(([id, n]) => `${n}× ${ITEMS[id]?.name ?? id}`)].filter(Boolean).join(', ') : '';
    if (r.kind === 'cache') g.hud.toast(`${r.glimmer ? 'A glimmering cache! ' : ''}${lootText || 'Empty'}`, 'gold');
    if (r.kind === 'shrine') g.hud.toast("Wayfarer's Blessing: +15% walk speed for 10 minutes.", 'good');
    if (r.lore || r.lines || r.page) g.hud.panels.open('lore', { name: r.name, lore: r.lore, lines: r.lines, loot: lootText, page: r.page });
    else if (lootText && r.kind !== 'cache') g.hud.toast(lootText, 'gold');
    if (r.atlasDone) g.hud.levelUp('Cartographer!', "Ysolde's Atlas is complete.");
  } catch (e) {
    g.hud.toast(e.message, 'err');
  }
}

// Server owners: jump anywhere on land (to check on building work).
export async function ownerTeleport(g, x, z) {
  if (g.travelling) return false;
  if (g.dungeon) return g.underground(), false;
  g.travelling = true;
  try {
    await g.sock.rpc('owner.teleport', { x, z });
    return true;
  } catch (e) {
    g.hud.toast(e.message, 'err');
    return false;
  } finally {
    g.travelling = false;
  }
}

// The crypt door in town: its panel opens at once; Enter walks you over first.
export function goCrypt(g, id) {
  if (g.dungeon) return;
  const e = ENTRANCES.find((x) => x.id === id) ?? ENTRANCES[0];
  if (e) g.hud.panels.open('dungeon', { kind: e.kind });
}

export function enterCrypt(g, kind, opts = {}) {
  const e = ENTRANCES.find((x) => x.kind === kind);
  if (!e || !g.me) return;
  if (g.battle) return g.hud.toast("You're in a battle!", 'err');
  const [fx, fz] = entranceFront(e);
  const L = g.me.local;
  const go = () =>
    g.sock
      .rpc('dungeon.enter', { kind, ...opts })
      .then((r) => r?.ready && g.hud.toast('Ready check sent: in you go when everyone answers.', 'good'))
      .catch((err) => g.hud.toast(err.message, 'err'));
  if (Math.hypot(L.x - fx, L.z - fz) <= ENTRANCE_RANGE - 2) return go();
  g.stopGather();
  g.hud.toast(`Walking to the ${word(kind)}…`);
  if (!g.walkTo(fx, fz, true, go)) g.hud.toast("Can't find the way there.", 'err');
}

// Show the way to the crypt (the guide beacon).
export function guideToCrypt(g, kind = 'hollow_crypt') {
  const e = ENTRANCES.find((x) => x.kind === kind);
  if (!e || g.dungeon) return;
  const [fx, fz] = entranceFront(e);
  g.walkTo(fx, fz, true);
}

// The best thing to do right here (the round button and E/Space).
export function contextAction(g, cur = null) {
  const v = g.dungeon;
  const L = g.me?.local;
  if (!L || g.battle) return null;
  if (!v) return g.room ? null : worldAction(g, L, cur);
  const room = g.myRoom();
  // A friend fighting in this room: join them.
  for (const b of g.battles.values()) {
    const mv = g.mobs.get(b.mob);
    if (!mv || mv.room !== room || b.fighters.length >= 4 || b.fighters.some((f) => f.id === g.myId)) continue;
    const who = b.fighters[0]?.name ?? 'your party';
    return { label: `Join ${who}'s fight`, glyph: 'swords', fn: () => g.goMob(b.mob) };
  }
  const st = g.run.state;
  let best = null;
  for (const l of v.labels) {
    if (l.hidden || l.lock || !v.isRevealed(l.room)) continue;
    const d = Math.hypot(L.x - l.x, L.z - l.z);
    if (d > 5.5 || (best && d >= best.d)) continue;
    const a =
      l.what === 'rest' ? (!st.lastLight ? ['Rest (Last Light)', 'fire'] : null)
      : l.what === 'shrine' ? (!st.shrine ? ['Pray', 'spark'] : null)
      : l.what === 'vault' ? (st.key ? ['Open the Vault', 'key'] : null)
      : l.what === 'boss' ? (st.boss ? ['Open the chest', 'trophy'] : null)
      : l.what === 'exit' ? ['Leave', 'stairs'] : null;
    if (a) best = { d, label: a[0], glyph: a[1], fn: () => g.useThing(l.what) };
  }
  return best;
}
