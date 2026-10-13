// Skill milestones on the server (SPEC §4.8): the level-up message listing
// what unlocked, the level-50 titles, the level-40 choice and its respec at
// a Town Hall, and Salvage (Crafting 10).
import { ITEMS, baseOf } from '../shared/items.js';
import { RECIPES } from '../shared/recipes.js';
import { levelFromXp } from '../shared/skills.js';
import { PICKS, PICK_LVL } from '../shared/perks.js';
import { unlocksAt, GRAND_TITLES } from '../shared/milestones.js';
import { nearestStation, YARD_RANGE } from '../shared/stations.js';
import { townBuilding } from '../shared/places.js';
import { doorPoint } from '../shared/world.js';
import { tx, fail } from './db.js';
import { on } from './events.js';
import { register } from './rpc.js';

export const RESPEC_BASE = 500;
export const RESPEC_MAX = 8000;
export const respecFee = (n) => Math.min(RESPEC_MAX, RESPEC_BASE * 2 ** n);
export const SALVAGE_SHARE = 0.5;

// A skill level went up: say what it opened (every level crossed), and at
// 50 hand over the skill's title.
on('xp', (c, xp) => {
  if (!xp.leveled || !c?.hero) return;
  const from = levelFromXp((c.hero.skills[xp.skill] || 0) - xp.amount) + 1;
  for (let L = Math.max(2, from); L <= xp.level; L++) {
    const list = unlocksAt(xp.skill, L);
    if (list.length) c.send({ t: 'unlock', skill: xp.skill, lvl: L, list });
    if (L === 50) c.game.journal?.unlockTitle(c, GRAND_TITLES[xp.skill]);
  }
  c.fxChanged(); // a milestone may change what the hero can do
});

const savePerks = (g, c) => {
  g.heroes.setField(c.hero.id, 'perks', JSON.stringify(c.hero.perks ?? {}));
  c.fxChanged();
};

// The level-40 choice: free the first time.
export function choose(g, c, skill, pick) {
  if (!PICKS[skill]?.[pick]) fail('No such choice.');
  if (levelFromXp(c.hero.skills[skill] || 0) < PICK_LVL) fail(`Reach ${skill[0].toUpperCase() + skill.slice(1)} ${PICK_LVL} first.`);
  if (c.hero.perks?.[skill]) fail('You have chosen already. A Town Hall can change it (a respec).');
  c.hero.perks = { ...(c.hero.perks ?? {}), [skill]: pick };
  savePerks(g, c);
  c.pushInventory();
  return { perks: c.hero.perks };
}

// Change it at a Town Hall: 500 g, doubling each time, up to 8,000 g.
export function respec(g, c, skill, pick) {
  if (!PICKS[skill]?.[pick]) fail('No such choice.');
  const cur = c.hero.perks?.[skill];
  if (!cur) fail('Choose first: the first choice is free.');
  if (cur === pick) fail('That is your choice already.');
  const hall = townBuilding('townhall', c.ent.x, c.ent.z);
  const [dx, dz] = hall ? doorPoint(hall) : [Infinity, Infinity];
  if (Math.hypot(dx - c.ent.x, dz - c.ent.z) > 15) fail('Changing a choice is done at a Town Hall.');
  const n = Number(g.heroes.getField(c.hero.id, 'respecs')) || 0;
  const fee = respecFee(n);
  tx(g.db, () => {
    g.heroes.addGold(c.hero.id, -fee, 'respec');
    g.heroes.setField(c.hero.id, 'respecs', n + 1);
  });
  c.hero.perks = { ...c.hero.perks, [skill]: pick };
  savePerks(g, c);
  c.pushInventory();
  return { perks: c.hero.perks, fee, next: respecFee(n + 1) };
}

// Salvage (Crafting 10): break a tool or piece of gear down at the anvil
// for half the bars that went into it.
export function salvage(g, c, item) {
  if (!ITEMS[item]) fail('Unknown item.');
  if ((c.effects().salvage || 0) <= 0) fail('Salvage opens at Crafting 10.');
  const r = RECIPES.find((x) => x.out === baseOf(item));
  const bars = r ? Object.entries(r.in).filter(([id]) => ITEMS[id]?.tag === 'bar') : [];
  if (!bars.length) fail('There is nothing to salvage in that.');
  const st = nearestStation('anvil', c.ent.x, c.ent.z);
  if (!st || Math.hypot(st.x - c.ent.x, st.z - c.ent.z) > YARD_RANGE) fail('Salvage at an anvil.');
  const back = Object.fromEntries(bars.map(([id, n]) => [id, Math.max(1, Math.floor(n * SALVAGE_SHARE))]));
  tx(g.db, () => {
    g.heroes.takeItem(c.hero.id, item, 1, { keepEquipped: true, kind: 'salvage' });
    for (const [id, n] of Object.entries(back)) g.heroes.addItem(c.hero.id, id, n, 'salvage');
  });
  c.pushInventory();
  return { back };
}

register('perks.choose', (g, c, a) => choose(g, c, String(a.skill), String(a.pick)));
register('perks.respec', (g, c, a) => respec(g, c, String(a.skill), String(a.pick)));
register('perks.info', (g, c) => ({ perks: c.hero.perks ?? {}, nextRespec: respecFee(Number(g.heroes.getField(c.hero.id, 'respecs')) || 0) }), { inRun: true });
register('craft.salvage', (g, c, a) => salvage(g, c, String(a.item)));
