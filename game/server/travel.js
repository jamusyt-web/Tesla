// Getting around fast: waystones (attune by walking up, then travel between
// any you know, for a fee) and the server owner's free teleport.
import { stoneById, stoneNear, stoneFront, travelFee, STONE_RANGE, landDistance, isWalkable } from '../shared/world.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';
import { world } from './static.js';
import { q2 } from './channel.js';

const TRAVEL_COOLDOWN_MS = 3000;

// Standing at a waystone you haven't been to: attune to it.
export function attuneNearby(c) {
  const st = stoneNear(c.ent.x, c.ent.z);
  if (!st || !c.game.heroes.attune(c.hero, st.id)) return;
  c.send({ t: 'attuned', id: st.id, name: st.name });
  emit(c, 'attune', { id: st.id });
}

// From the waystone you're standing at to another you've attuned to, for a fee.
export function travel(g, c, to, now = Date.now()) {
  if (c.room) fail('Leave the shop first.');
  if (c.ch?.isRun) fail("Waystones don't work underground. Leave the dungeon first.");
  if (c.battle) fail("You can't travel in the middle of a battle!");
  if (c.craft) fail('Finish your craft first.');
  const dest = stoneById(to);
  if (!dest) fail('No such waystone.');
  const here = stoneNear(c.ent.x, c.ent.z);
  if (!here) fail('Walk up to a waystone first.');
  attuneNearby(c); // just arrived and travelling straight on
  if (here.id === dest.id) fail("You're already here.");
  if (!c.hero.stones.includes(dest.id)) fail(`You haven't been to ${dest.name} yet. Walk there once to attune to it.`);
  if (now - (c.lastTravel || 0) < TRAVEL_COOLDOWN_MS) fail('The stone is still humming. Try again in a moment.');
  const fee = travelFee(here, dest);
  if (g.heroes.gold(c.hero.id) < fee) fail(`Travelling to ${dest.name} costs ${fee} gold.`);
  const [fx, fz] = stoneFront(dest);
  const open = isWalkable(fx, fz, world().col) ? [fx, fz] : world().nav.nearestOpen(fx, fz);
  if (!open || Math.hypot(open[0] - dest.x, open[1] - dest.z) > STONE_RANGE) fail("That waystone's way is blocked.");
  g.heroes.addGold(c.hero.id, -fee, 'travel');
  c.cancelFishing();
  const e = c.ent;
  const from = { x: e.x, z: e.z };
  // Make room if someone's standing there, but stay at the stone, on this side of any wall.
  [e.x, e.z] = c.ch.freeSpot(open[0], open[1], c, (nx, nz) => Math.hypot(nx - dest.x, nz - dest.z) <= STONE_RANGE - 1 && world().nav.clear(open[0], open[1], nx, nz));
  Object.assign(e, { path: null, act: 'idle', rot: dest.rot ?? 0 });
  c.lastTravel = now;
  g.heroes.savePos(c.hero.id, e.x, e.z);
  c.ch.teleported(c, from);
  c.pushInventory();
  emit(c, 'travel', { from: here.id, to: dest.id, fee });
  return { to: dest.id, fee, x: q2(e.x), z: q2(e.z) };
}

// Server owners can jump anywhere on land (to check their building), free.
export function ownerTeleport(g, c, x, z) {
  if (!g.auth.isAdmin(c.hero.id)) fail('Only server owners can do that.');
  if (c.room) fail('Leave the shop first.');
  if (c.ch?.isRun) fail('Leave the dungeon first.');
  if (c.battle) fail("You can't travel in the middle of a battle!");
  if (c.craft) fail('Finish your craft first.');
  x = Number(x);
  z = Number(z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || landDistance(x, z) > 0) fail("That's not on land.");
  const open = isWalkable(x, z, world().col) ? [x, z] : world().nav.nearestOpen(x, z);
  if (!open) fail("There's no room to stand there.");
  c.cancelFishing();
  const e = c.ent;
  const from = { x: e.x, z: e.z };
  [e.x, e.z] = c.ch.freeSpot(open[0], open[1], c);
  Object.assign(e, { path: null, act: 'idle' });
  g.heroes.savePos(c.hero.id, e.x, e.z);
  c.ch.teleported(c, from);
  return { x: q2(e.x), z: q2(e.z) };
}

register('travel', (g, c, a) => travel(g, c, String(a.to ?? '')));
register('owner.teleport', (g, c, a) => ownerTeleport(g, c, a.x, a.z));
