// Going to the town's services: walking to a building, a crafting station,
// the bulletin board, a waystone or the crypt door, then opening it; the
// hands-on craft's life cycle; and the context action (the best thing to do
// right here, which today only the crypt offers). Each takes the GameClient g.
import * as THREE from 'three';
import { CraftGame } from '../ui/craftgame.js';
import { RECIPE_BY_ID } from '../../../shared/recipes.js';
import { spotsOf, stationPos } from '../../../shared/stations.js';
import { STATIONS } from '../../../shared/crafting.js';
import { ITEMS } from '../../../shared/items.js';
import { BUILDINGS, GATE, PROPS, doorPoint, stoneById, stoneFront, STONE_RANGE, ENTRANCES, entranceFront } from '../../../shared/world.js';
import { ENTRANCE_RANGE } from '../../../shared/dungeon.js';

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
  const sp = spotsOf(r.station)
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
      if (step.k === 'strike') g.me.av.play('swing', 0.32);
      else if (step.k === 'sweep') g.me.av.play('pick', 0.4);
      else g.me.av.play('cast', 0.45);
      const p = stationPos(station);
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
  cg.showResult(res, {
    onAgain: cr ? () => (cg.close(), g.goCraft(cr.recipe, cr.batch)) : null,
    onEquip: (id) => g.sock.rpc('equip', { item: id }).then(() => g.hud.toast(`Equipped ${ITEMS[id].name}!`, 'good')).catch((e) => g.hud.toast(e.message, 'err')),
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
      .rpc('craft.finish', { sid: c.sid, toggles: [], end: 0, off: [0, 0], stop: true })
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
  if (id === 'gate') return g.walkTo(GATE.x, GATE.z - 6, true);
  const b = BUILDINGS.find((x) => x.id === id);
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
    g.hud.toast(`Travelled to ${stoneById(r.to)?.name ?? 'the waystone'} (−${r.fee} 🪙)`, 'gold');
    return true;
  } catch (e) {
    g.hud.toast(e.message, 'err');
    return false;
  } finally {
    g.travelling = false;
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
  g.hud.toast('Walking to the crypt…');
  if (!g.walkTo(fx, fz, true, go)) g.hud.toast("Can't find the way there.", 'err');
}

// Show the way to the crypt (the guide beacon).
export function guideToCrypt(g, kind = 'hollow_crypt') {
  const e = ENTRANCES.find((x) => x.kind === kind);
  if (!e || g.dungeon) return;
  const [fx, fz] = entranceFront(e);
  g.walkTo(fx, fz, true);
}

// The best thing to do right now in the crypt (the round button and E/Space).
export function contextAction(g) {
  const v = g.dungeon;
  const L = g.me?.local;
  if (!v || !L || g.battle) return null;
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
