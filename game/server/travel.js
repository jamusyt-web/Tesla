// Getting around fast: waystones (attune by walking up, then travel between
// any you know, for a fee and a toll), to a party member, home with a Hearth
// Charm, through passages, and the server owner's free teleport.
import { regionAt } from '../shared/places.js';
import { stoneById, stoneNear, stoneFront, travelFee, STONE_RANGE, landDistance, isWalkable } from '../shared/world.js';
import { travelToll, nowarpItem, homeStone, passageById, passageAt, passageOpen, passageNeeds, PASSAGE_RANGE } from '../shared/travel.js';
import { ITEMS } from '../shared/items.js';
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

// Checks shared by every trip: not mid-something, nothing waystones refuse.
function canWarp(g, c) {
  if (c.room) fail('Leave the shop first.');
  if (c.ch?.isRun) fail("Waystones don't work underground. Leave the dungeon first.");
  if (c.battle) fail("You can't travel in the middle of a battle!");
  if (c.craft) fail('Finish your craft first.');
  const bag = g.heroes.inventory(c.hero.id);
  const nw = nowarpItem(bag);
  if (nw) fail(`The waystones won't carry your ${ITEMS[nw].name}. You'll have to walk.`);
  return bag;
}

// Where you'd stand at a waystone, or a refusal if its front is blocked.
function frontOf(dest) {
  const [fx, fz] = stoneFront(dest);
  const open = isWalkable(fx, fz, world().col) ? [fx, fz] : world().nav.nearestOpen(fx, fz);
  if (!open || Math.hypot(open[0] - dest.x, open[1] - dest.z) > STONE_RANGE) fail("That waystone's way is blocked.");
  return open;
}

// Put the hero at (x, z) (making room if someone's there, within `keep`).
function moveTo(g, c, x, z, keep, rot) {
  c.cancelFishing();
  const e = c.ent;
  const from = { x: e.x, z: e.z };
  [e.x, e.z] = c.ch.freeSpot(x, z, c, keep);
  Object.assign(e, { path: null, act: 'idle', ...(rot != null ? { rot } : {}) });
  g.heroes.savePos(c.hero.id, e.x, e.z);
  c.ch.teleported(c, from);
}

// Arrive at waystone `dest`: in front of it, on this side of any wall.
function arrive(g, c, dest, open) {
  moveTo(g, c, open[0], open[1], (nx, nz) => Math.hypot(nx - dest.x, nz - dest.z) <= STONE_RANGE - 1 && world().nav.clear(open[0], open[1], nx, nz), dest.rot ?? 0);
}

// From the waystone you're standing at to another you've attuned to, for a
// fee, plus the toll on the raw goods you carry (SPEC §6.3).
export function travel(g, c, to, now = Date.now()) {
  const bag = canWarp(g, c);
  const dest = stoneById(to);
  if (!dest) fail('No such waystone.');
  const here = stoneNear(c.ent.x, c.ent.z);
  if (!here) fail('Walk up to a waystone first.');
  attuneNearby(c); // just arrived and travelling straight on
  if (here.id === dest.id) fail("You're already here.");
  if (!c.hero.stones.includes(dest.id)) fail(`You haven't been to ${dest.name} yet. Walk there once to attune to it.`);
  if (now - (c.lastTravel || 0) < TRAVEL_COOLDOWN_MS) fail('The stone is still humming. Try again in a moment.');
  // A region you've fully discovered halves the fee to its stones (the journal).
  const fee = Math.ceil(travelFee(here, dest) * (1 - (g.journal?.discount(c.hero.id, regionAt(dest.x, dest.z)?.id) ?? 0)));
  const toll = travelToll(bag);
  if (g.heroes.gold(c.hero.id) < fee + toll) fail(`Travelling to ${dest.name} costs ${fee + toll} gold${toll ? ` (${toll} of it the toll on your goods)` : ''}.`);
  const open = frontOf(dest);
  g.heroes.addGold(c.hero.id, -fee, 'travel');
  if (toll) g.heroes.addGold(c.hero.id, -toll, 'toll');
  arrive(g, c, dest, open);
  c.lastTravel = now;
  c.pushInventory();
  emit(c, 'travel', { from: here.id, to: dest.id, fee, toll });
  return { to: dest.id, fee, toll, x: q2(c.ent.x), z: q2(c.ent.z) };
}

// To a party member: the waystone you've attuned to that's nearest them,
// for the normal fee.
export function travelParty(g, c, member, now = Date.now()) {
  const p = g.parties.get(c.hero.id);
  const id = Number(member);
  if (!p || !p.members.includes(id) || id === c.hero.id) fail("They're not in your party.");
  const m = g.online.get(id);
  if (!m?.ent) fail(`${p.names.get(id) ?? 'They'} isn't online.`);
  if (m.ch?.isRun) fail(`${m.hero.name} is in a dungeon.`);
  let best = null;
  let bd = Infinity;
  for (const sid of c.hero.stones) {
    const st = stoneById(sid);
    const d = st ? Math.hypot(st.x - m.ent.x, st.z - m.ent.z) : Infinity;
    if (d < bd) (best = st), (bd = d);
  }
  if (!best) fail("You haven't attuned to any waystones yet.");
  const here = stoneNear(c.ent.x, c.ent.z);
  if (here?.id === best.id) fail(`This is already the nearest waystone to ${m.hero.name}.`);
  return { ...travel(g, c, best.id, now), member: id };
}

// A Hearth Charm: used up for one free trip, from anywhere, to your home
// stone (the toll on raw goods still applies).
export function travelHome(g, c, now = Date.now()) {
  const bag = canWarp(g, c);
  if (!(bag.hearth_charm > 0)) fail('You need a Hearth Charm.');
  const dest = homeStone(c.hero.home);
  if (!dest) fail('There is no home stone.');
  if (Math.hypot(dest.x - c.ent.x, dest.z - c.ent.z) < STONE_RANGE) fail("You're already home.");
  if (now - (c.lastTravel || 0) < TRAVEL_COOLDOWN_MS) fail('The charm is still warm. Try again in a moment.');
  const toll = travelToll(bag);
  if (g.heroes.gold(c.hero.id) < toll) fail(`The toll on your goods is ${toll} gold.`);
  const open = frontOf(dest);
  g.heroes.takeItem(c.hero.id, 'hearth_charm', 1, { kind: 'use' });
  if (toll) g.heroes.addGold(c.hero.id, -toll, 'toll');
  arrive(g, c, dest, open);
  attuneNearby(c);
  c.lastTravel = now;
  c.pushInventory();
  emit(c, 'travel', { from: null, to: dest.id, fee: 0, toll, charm: true });
  return { to: dest.id, fee: 0, toll, x: q2(c.ent.x), z: q2(c.ent.z) };
}

// Hop through a passage from the end you're standing at to the other. It
// needs its skill level, or its kit in the bag (never used up).
export function usePassage(g, c, id) {
  if (c.room) fail('Leave the shop first.');
  if (c.ch?.isRun) fail('Leave the dungeon first.');
  if (c.battle) fail("You're in a battle!");
  if (c.craft) fail('Finish your craft first.');
  const p = passageById(id);
  if (!p) fail('No such passage.');
  const at = passageAt(c.ent.x, c.ent.z);
  if (!at || at.p.id !== p.id) fail(`Walk up to the ${p.name ?? 'passage'} first.`);
  if (!passageOpen(p, c.hero.skills, g.heroes.inventory(c.hero.id))) fail(`You need ${passageNeeds(p)}.`);
  const [tx, tz] = at.to;
  const open = isWalkable(tx, tz, world().col) ? [tx, tz] : world().nav.nearestOpen(tx, tz);
  if (!open || Math.hypot(open[0] - tx, open[1] - tz) > PASSAGE_RANGE) fail('The way through is blocked.');
  moveTo(g, c, open[0], open[1], (nx, nz) => Math.hypot(nx - tx, nz - tz) <= PASSAGE_RANGE);
  emit(c, 'passage', { id: p.id });
  return { id: p.id, x: q2(c.ent.x), z: q2(c.ent.z) };
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
  moveTo(g, c, open[0], open[1]);
  return { x: q2(c.ent.x), z: q2(c.ent.z) };
}

register('travel', (g, c, a) => travel(g, c, String(a.to ?? '')));
register('travel.party', (g, c, a) => travelParty(g, c, a.member));
register('travel.home', (g, c) => travelHome(g, c));
register('passage.use', (g, c, a) => usePassage(g, c, String(a.id ?? '')));
register('owner.teleport', (g, c, a) => ownerTeleport(g, c, a.x, a.z));
