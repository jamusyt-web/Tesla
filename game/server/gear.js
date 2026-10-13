// What a hero wears, carries and looks like: equipping, using an item (a
// healing item outside battle, or a meal, tonic or lure buff), changing
// your look, and looking at someone's profile.
import { ITEMS } from '../shared/items.js';
import { levelFromXp } from '../shared/skills.js';
import { applyBuff } from '../shared/buffs.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { register } from './rpc.js';

// Gear can need a Combat level (`req`), checked only when you put it on, so
// anything already worn stays on.
export function equip(g, c, item) {
  const it = ITEMS[item];
  if (!it) fail('Unknown item.');
  if (g.heroes.count(c.hero.id, item) < 1) fail("You don't have that.");
  const slot = it.cat === 'tool' ? it.tool : it.slot;
  if (!slot) fail("That can't be equipped.");
  const need = it.req?.combat ?? 0;
  if (need && levelFromXp(c.hero.skills.combat || 0) < need) fail(`${it.name} needs Combat level ${need}.`);
  g.heroes.setEquip(c.hero, slot, item);
  c.fxChanged();
  c.syncSpeed();
  c.pushInventory();
  g.tellAudience(c, { t: 'equip', id: c.hero.id, equip: c.hero.equip });
  return { slot };
}

// Use an item: a healing item heals (outside a battle; in a dungeon nothing
// heals on its own), a buff item starts its buff (replacing that slot's).
export function use(g, c, a) {
  const id = String(a.item ?? '');
  const it = ITEMS[id];
  if (!it?.heal && !it?.buff) fail(it ? `You can't use ${it.name} like that.` : 'Pick something to use.');
  if (it.heal) {
    if (c.battle) fail('Use it from the battle menu.');
    if (c.ent.hp >= c.ent.maxHp) fail("You're already at full health.");
  }
  g.heroes.takeItem(c.hero.id, id, 1, { kind: 'use' });
  const out = {};
  if (it.heal) {
    const heal = Math.min(c.ent.maxHp - c.ent.hp, Math.round(it.heal * (1 + (c.effects().mender || 0))));
    c.ent.hp += heal;
    Object.assign(out, { heal, hp: Math.round(c.ent.hp) });
  }
  if (it.buff) {
    c.hero.buffs = applyBuff(c.hero.buffs, id);
    g.heroes.saveBuffs(c.hero);
    c.fxChanged();
    c.syncSpeed();
    c.send({ t: 'buffs', buffs: c.hero.buffs });
    out.buff = { slot: it.buff.slot, ...c.hero.buffs[it.buff.slot] };
  }
  c.pushInventory();
  emit(c, 'use', { item: id });
  return out;
}
// The old name for using a healing item.
export function drink(g, c, a) {
  if (!ITEMS[a.item]?.heal) fail('Pick a healing item.');
  return use(g, c, a);
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
register('use', use, { inRun: true });
register('drink', drink, { inRun: true });
register(
  'avatar',
  (g, c, a) => {
    // A cloak tint has to be earned (the journal, 75% of a region).
    const tint = a.avatar?.cloakTint;
    if (tint && tint !== 'none' && !g.journal?.has(c.hero.id, 'unlock', `cloak:${tint}`)) a = { ...a, avatar: { ...a.avatar, cloakTint: c.hero.avatar.cloakTint ?? 'none' } };
    g.heroes.setAvatar(c.hero, a.avatar);
    g.tellAudience(c, { t: 'avatar', id: c.hero.id, avatar: c.hero.avatar });
  },
  { inRun: true },
);
register('profile', profile, { inRun: true });
