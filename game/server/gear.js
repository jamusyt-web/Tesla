// What a hero wears, carries and looks like: equipping, drinking a healing
// item outside battle, changing your look, and looking at someone's profile.
import { ITEMS } from '../shared/items.js';
import { fail } from './db.js';
import { register } from './rpc.js';

export function equip(g, c, item) {
  const it = ITEMS[item];
  if (!it) fail('Unknown item.');
  if (g.heroes.count(c.hero.id, item) < 1) fail("You don't have that.");
  const slot = it.cat === 'tool' ? it.tool : it.slot;
  if (!slot) fail("That can't be equipped.");
  g.heroes.setEquip(c.hero, slot, item);
  c.pushInventory();
  g.tellAudience(c, { t: 'equip', id: c.hero.id, equip: c.hero.equip });
  return { slot };
}

// Drink a healing item outside a battle (in a dungeon nothing heals on its own).
export function drink(g, c, a) {
  const it = ITEMS[a.item];
  if (!it?.heal) fail('Pick a healing item.');
  if (c.battle) fail('Use it from the battle menu.');
  if (c.ent.hp >= c.ent.maxHp) fail("You're already at full health.");
  g.heroes.takeItem(c.hero.id, String(a.item), 1);
  const heal = Math.min(c.ent.maxHp - c.ent.hp, Math.round(it.heal * (c.perks().has('mender') ? 1.4 : 1)));
  c.ent.hp += heal;
  c.pushInventory();
  return { heal, hp: Math.round(c.ent.hp) };
}

export function profile(g, c, a) {
  const h = g.heroes.load(Number(a.id));
  if (!h) fail('No such hero.');
  const on = g.online.get(h.id);
  const shop = g.shops.info(h.id);
  const party = g.parties.get(h.id);
  const mine = g.parties.get(c.hero.id);
  return { id: h.id, name: h.name, avatar: h.avatar, level: h.level, skills: h.skills, equip: h.equip, online: !!on, channel: on?.ch?.isRun ? null : (on?.ch?.id ?? null), dungeon: on?.ch?.isRun ? on.ch.def.name : null, shop: g.shops.slots(h.id).length, shopOpen: shop ? !!shop.open : false, inside: on?.room?.owner ?? null, inParty: !!party, sameParty: !!party && party === mine, canInvite: !!on && h.id !== c.hero.id && !party && (!mine || (mine.leader === c.hero.id && mine.members.length < 4)) };
}

register('equip', (g, c, a) => equip(g, c, a.item), { inRun: true });
register('drink', drink, { inRun: true });
register(
  'avatar',
  (g, c, a) => {
    g.heroes.setAvatar(c.hero, a.avatar);
    g.tellAudience(c, { t: 'avatar', id: c.hero.id, avatar: c.hero.avatar });
  },
  { inRun: true },
);
register('profile', profile, { inRun: true });
