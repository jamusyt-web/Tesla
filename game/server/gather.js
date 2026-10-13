// Gathering and fishing: swinging at trees, rocks and herbs (shared nodes,
// everyone who helped gets a roll), casting, hooking and the reel fight.
import { ITEMS } from '../shared/items.js';
import { levelFromXp, doubleChance } from '../shared/skills.js';
import { NODE_TYPES, INTERACT_RANGE, FISH_RANGE, SWING_FLOOR, isPerfectSwing } from '../shared/world.js';
import { fightRating, replayFight, FISH, FISH_MAX_TICKS } from '../shared/fishing.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { rint, q2 } from './channel.js';

export const GATHER_ACTS = new Set(['chop', 'mine', 'pick']);

export function hitNode(g, c, nodeId, now) {
  const ch = c.ch;
  const n = ch.nodes.get(nodeId);
  if (!n) fail('Nothing there.');
  const t = NODE_TYPES[n.type];
  if (t.kind === 'fish') fail('Cast your rod to fish here.');
  if (c.room) fail("You're inside a shop.");
  if (c.craft) fail('Finish your craft first.');
  if (!n.alive) {
    // A swing that was already in flight when it fell (yours or a co-op
    // partner's) isn't an error, just too late.
    if (now - (n.brokeAt || 0) < 2000) return { gone: true };
    fail(`This ${t.name} is regrowing.`);
  }
  if (c.battle) fail("You're in a battle!");
  const e = c.ent;
  if (Math.hypot(e.x - n.x, e.z - n.z) > INTERACT_RANGE + t.r * n.s + 0.4) fail('Get closer first.');
  const lvl = levelFromXp(c.hero.skills[t.skill] || 0);
  if (lvl < t.lvl) fail(`Requires ${t.skill[0].toUpperCase() + t.skill.slice(1)} level ${t.lvl}.`);
  let power = 1;
  let period = 450;
  if (t.tool) {
    const tool = ITEMS[c.hero.equip[t.tool]];
    if (!tool || g.heroes.count(c.hero.id, c.hero.equip[t.tool]) < 1) fail(`You need ${t.tool === 'axe' ? 'an axe' : 'a pickaxe'}.`);
    if (tool.tier < t.tier) fail(`Needs a tier ${t.tier} ${t.tool === 'axe' ? 'axe' : 'pickaxe'} or better.`);
    power = tool.power;
    period = tool.speed;
  }
  const since = now - e.lastSwing;
  if (since < period * SWING_FLOOR) return { tooFast: true, wait: Math.ceil(period * SWING_FLOOR - since) }; // swing still in progress
  // Rhythm bonus: swing again right as the timing ring closes = PERFECT (2x).
  const perfect = !!t.tool && e.lastNode === n.id && isPerfectSwing(since, period);
  e.lastSwing = now;
  e.lastNode = n.id;
  e.act = t.kind === 'tree' ? 'chop' : t.kind === 'rock' ? 'mine' : 'pick';
  e.path = null;
  e.rot = Math.atan2(n.x - e.x, n.z - e.z);
  const dmg = power * (perfect ? 2 : 1);
  n.hp = Math.max(0, n.hp - dmg);
  n.hitters.add(c.hero.id);
  ch.broadcast({ t: 'nh', id: n.id, by: c.hero.id, hp: n.hp, dmg, perfect, rot: q2(e.rot) });
  if (n.hp > 0) return { hp: n.hp, perfect };

  // Broken! Everyone who helped gets a full roll (co-op friendly).
  n.alive = false;
  n.brokeAt = now;
  n.respawnAt = now + t.respawn * 1000;
  // Everyone working it puts their tool away (others saw them frozen mid-chop).
  for (const pid of n.hitters) {
    const pe = ch.players.get(pid)?.ent;
    if (pe && pe.lastNode === n.id && GATHER_ACTS.has(pe.act)) pe.act = 'idle';
  }
  ch.broadcast({ t: 'node', id: n.id, alive: false, hp: 0, by: c.hero.id, respawnIn: t.respawn * 1000 });
  for (const pid of n.hitters) {
    const pc = ch.players.get(pid);
    if (pc) grantGather(g, pc, t, n, pc === c);
  }
  n.hitters.clear();
  return { broke: true, perfect };
}

export function grantGather(g, c, t, n, finisher) {
  const lvl = levelFromXp(c.hero.skills[t.skill] || 0);
  const loot = {};
  for (const d of t.drops) {
    let q = rint(d.min, d.max);
    if (q && Math.random() < doubleChance(lvl)) q *= 2;
    if (q) loot[d.id] = (loot[d.id] || 0) + q;
  }
  const rares = [];
  for (const r of t.rare)
    if (Math.random() < r.p * (finisher ? 1.5 : 1)) {
      loot[r.id] = (loot[r.id] || 0) + 1;
      rares.push(r.id);
    }
  for (const [id, q] of Object.entries(loot)) g.heroes.addItem(c.hero.id, id, q);
  const xp = g.heroes.addXp(c.hero, t.skill, t.xp);
  c.send({ t: 'loot', node: n.id, loot, xp, rare: rares });
  for (const r of rares) g.announce(`${c.hero.name} found a ${ITEMS[r].name}!`);
  c.pushInventory();
  emit(c, 'gather', { node: n.id, type: n.type, kind: t.kind, skill: t.skill, loot, rare: rares, finisher });
}

export function cast(g, c, nodeId, now) {
  const n = c.ch.nodes.get(nodeId);
  if (!n || NODE_TYPES[n.type].kind !== 'fish') fail('Not a fishing spot.');
  if (c.battle) fail("You're in a battle!");
  if (c.room) fail("You're inside a shop.");
  if (c.craft) fail('Finish your craft first.');
  const rod = ITEMS[c.hero.equip.rod];
  if (!rod || g.heroes.count(c.hero.id, c.hero.equip.rod) < 1) fail('You need a fishing rod.');
  const e = c.ent;
  if (Math.hypot(e.x - n.x, e.z - n.z) > FISH_RANGE) fail('Get closer to the water.');
  e.path = null;
  e.rot = Math.atan2(n.x - e.x, n.z - e.z);
  e.act = 'fish';
  const window = 900 + rod.tier * 200;
  e.fishing = { node: n.id, state: 'wait', biteAt: now + 1800 + Math.random() * 4200, window };
  c.ch.broadcast({ t: 'cast', by: c.hero.id, node: n.id, rot: q2(e.rot) });
  return { ok: true };
}

// Tap when it bites to hook the fish; then the reel fight starts.
export function reel(g, c, now) {
  const f = c.ent.fishing;
  if (!f || f.state === 'fight') return { ok: false };
  c.ch.broadcast({ t: 'reel', by: c.hero.id });
  const lost = (reason) => {
    c.ent.fishing = null;
    c.ent.act = 'idle';
    c.send({ t: 'fishResult', ok: false, reason });
    return { ok: false };
  };
  if (f.state === 'wait') return lost('Too early! The fish swam off.');
  if (now > f.biteAt + f.window + 450) return lost('Too slow — it got away!');
  f.state = 'fight';
  f.fightAt = now;
  const { d, behavior, seed } = f.fish;
  return { ok: true, fight: true, bite: { fish: { d, behavior, seed }, gear: f.gear, rating: fightRating(d, f.gear) } };
}

// The client reports the ticks at which the reel button toggled; the
// server replays the exact same deterministic fight to decide the outcome.
export function land(g, c, toggles, endTick, now) {
  const f = c.ent.fishing;
  if (!f || f.state !== 'fight') {
    // Always answer, so the client can never be left showing a dead fight.
    c.send({ t: 'fishResult', ok: false, cancelled: true, reason: 'The line went slack.' });
    return { ok: false };
  }
  c.ent.fishing = null;
  c.ent.act = 'idle';
  const end = Math.floor(Number(endTick));
  const ok =
    Array.isArray(toggles) &&
    toggles.length <= FISH_MAX_TICKS &&
    toggles.every((t, i) => Number.isInteger(t) && t >= 0 && t <= FISH_MAX_TICKS && (i === 0 || t > toggles[i - 1])) &&
    Number.isInteger(end) &&
    end > 0 &&
    end <= FISH_MAX_TICKS;
  // You can't finish a fight faster than it takes to play it.
  const tooFast = now - f.fightAt < (end / 60) * 1000 * 0.85 - 400;
  const result = ok && !tooFast ? replayFight(f.fish, f.gear, toggles, end) : null;
  c.ch.broadcast({ t: 'landed', by: c.hero.id, ok: result?.done === 'caught', item: result?.done === 'caught' ? f.fish.id : null });
  if (!result || result.done !== 'caught') {
    c.send({ t: 'fishResult', ok: false, reason: result?.done === 'escaped' || !result ? 'It broke free!' : 'It slipped the hook!' });
    return { ok: false };
  }
  const fish = f.fish;
  const lvl = levelFromXp(c.hero.skills.fishing || 0);
  const qty = Math.random() < doubleChance(lvl) && fish.id !== 'old_boot' && fish.id !== 'lake_king' ? 2 : 1;
  g.heroes.addItem(c.hero.id, fish.id, qty);
  const xp = g.heroes.addXp(c.hero, 'fishing', Math.round(FISH[fish.id].xp * (1 + fish.d / 200)));
  c.send({ t: 'fishResult', ok: true, item: fish.id, qty, kg: fish.kg, xp });
  const rarity = ITEMS[fish.id].rarity;
  if (rarity === 'epic' || rarity === 'legendary') g.announce(`${c.hero.name} landed a ${fish.kg} kg ${ITEMS[fish.id].name}!`);
  c.pushInventory();
  emit(c, 'fish', { item: fish.id, qty, kg: fish.kg, node: f.node });
  return { ok: true };
}

// Message handlers (not RPCs: these are the high-rate gameplay messages).
export const GATHER_HANDLERS = {
  hit: (g, c, m, now) => hitNode(g, c, String(m.node), now),
  cast: (g, c, m, now) => cast(g, c, String(m.node), now),
  reel: (g, c, m, now) => reel(g, c, now),
  land: (g, c, m, now) => land(g, c, m.toggles, m.end, now),
};
