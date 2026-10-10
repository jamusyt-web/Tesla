import { ITEMS, isItem, STARTER_INVENTORY, STARTER_EQUIP, STARTER_GOLD } from '../shared/items.js';
import { SKILL_IDS, levelFromXp, heroLevel } from '../shared/skills.js';
import { sanitizeAvatar, NAME_RE } from '../shared/avatar.js';
import { SPAWN } from '../shared/world.js';
import { tx, fail } from './db.js';

// Data-access helpers for a hero's persistent state. Every mutation goes
// through here so gold/items can never go negative or appear from nowhere.
export class Heroes {
  constructor(db) {
    this.db = db;
    this.q = {
      get: db.prepare('SELECT * FROM heroes WHERE account_id = ?'),
      byName: db.prepare('SELECT account_id FROM heroes WHERE name = ?'),
      insert: db.prepare('INSERT INTO heroes (account_id, name, avatar, gold, skills, equip, x, z, created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
      gold: db.prepare('SELECT gold FROM heroes WHERE account_id = ?'),
      addGold: db.prepare('UPDATE heroes SET gold = gold + ? WHERE account_id = ?'),
      inv: db.prepare('SELECT item, qty FROM inventory WHERE account_id = ? AND qty > 0'),
      invOne: db.prepare('SELECT qty FROM inventory WHERE account_id = ? AND item = ?'),
      invAdd: db.prepare('INSERT INTO inventory (account_id, item, qty) VALUES (?,?,?) ON CONFLICT(account_id, item) DO UPDATE SET qty = qty + excluded.qty'),
      invSet: db.prepare('UPDATE inventory SET qty = ? WHERE account_id = ? AND item = ?'),
      skills: db.prepare('UPDATE heroes SET skills = ? WHERE account_id = ?'),
      equip: db.prepare('UPDATE heroes SET equip = ? WHERE account_id = ?'),
      avatar: db.prepare('UPDATE heroes SET avatar = ? WHERE account_id = ?'),
      pos: db.prepare('UPDATE heroes SET x = ?, z = ? WHERE account_id = ?'),
      tutorial: db.prepare('UPDATE heroes SET tutorial = ? WHERE account_id = ?'),
    };
  }

  create(accountId, name, avatar) {
    name = String(name || '').trim();
    if (!NAME_RE.test(name)) fail('Name must be 3–16 letters, numbers or spaces.');
    if (this.q.get.get(accountId)) fail('You already have a hero.');
    if (this.q.byName.get(name)) fail('That name is taken.');
    const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, 0]));
    tx(this.db, () => {
      this.q.insert.run(accountId, name, JSON.stringify(sanitizeAvatar(avatar)), STARTER_GOLD, JSON.stringify(skills), JSON.stringify(STARTER_EQUIP), SPAWN.x, SPAWN.z, Date.now());
      for (const [id, n] of Object.entries(STARTER_INVENTORY)) this.q.invAdd.run(accountId, id, n);
    });
    return this.load(accountId);
  }

  load(accountId) {
    const r = this.q.get.get(accountId);
    if (!r) return null;
    const skills = JSON.parse(r.skills);
    return {
      id: r.account_id,
      name: r.name,
      avatar: sanitizeAvatar(JSON.parse(r.avatar)),
      gold: r.gold,
      skills,
      level: heroLevel(skills),
      equip: { ...STARTER_EQUIP, ...JSON.parse(r.equip) },
      tutorial: r.tutorial,
      x: r.x ?? SPAWN.x,
      z: r.z ?? SPAWN.z,
    };
  }

  gold(id) {
    return this.q.gold.get(id)?.gold ?? 0;
  }
  addGold(id, n) {
    if (!Number.isInteger(n)) fail('Bad amount');
    if (n < 0 && this.gold(id) < -n) fail('Not enough gold.');
    this.q.addGold.run(n, id);
  }

  inventory(id) {
    const out = {};
    for (const r of this.q.inv.all(id)) out[r.item] = r.qty;
    return out;
  }
  count(id, item) {
    return this.q.invOne.get(id, item)?.qty ?? 0;
  }
  addItem(id, item, n) {
    if (!isItem(item) || !Number.isInteger(n) || n <= 0) fail('Bad item');
    this.q.invAdd.run(id, item, n);
  }
  takeItem(id, item, n) {
    if (!isItem(item) || !Number.isInteger(n) || n <= 0) fail('Bad item');
    const have = this.count(id, item);
    if (have < n) fail(`Not enough ${ITEMS[item].name}.`);
    this.q.invSet.run(have - n, id, item);
  }

  // Returns { leveled: bool, level } for UI feedback.
  addXp(hero, skill, amount) {
    const before = levelFromXp(hero.skills[skill] || 0);
    hero.skills[skill] = (hero.skills[skill] || 0) + amount;
    this.q.skills.run(JSON.stringify(hero.skills), hero.id);
    const after = levelFromXp(hero.skills[skill]);
    const prevHero = hero.level;
    hero.level = heroLevel(hero.skills);
    return { skill, amount, leveled: after > before, level: after, heroLeveled: hero.level > prevHero, heroLevel: hero.level };
  }

  setEquip(hero, slot, itemId) {
    hero.equip[slot] = itemId;
    this.q.equip.run(JSON.stringify(hero.equip), hero.id);
  }
  setAvatar(hero, avatar) {
    hero.avatar = sanitizeAvatar(avatar);
    this.q.avatar.run(JSON.stringify(hero.avatar), hero.id);
  }
  savePos(id, x, z) {
    this.q.pos.run(x, z, id);
  }
  setTutorial(hero, step) {
    hero.tutorial = step;
    this.q.tutorial.run(step, hero.id);
  }
}
