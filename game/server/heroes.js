import { ITEMS, isItem, STARTER_INVENTORY, STARTER_EQUIP, STARTER_GOLD } from '../shared/items.js';
import { SKILL_IDS, levelFromXp, heroLevel } from '../shared/skills.js';
import { sanitizeAvatar, NAME_RE } from '../shared/avatar.js';
import { SPAWN } from '../shared/world.js';
import { tx, fail } from './db.js';
import { goldFlow, itemFlow } from './telemetry.js';
import { emit } from './events.js';

// Hero columns other modules may read and write without owning this file.
// (They arrive with migration 009; reading one before it has run fails.)
const FIELDS = new Set(['buffs', 'perks', 'respecs', 'rested', 'home', 'title']);

// Data-access helpers for a hero's persistent state. Every mutation goes
// through here so gold/items can never go negative or appear from nowhere.
const parseJson = (s) => {
  try {
    return JSON.parse(s || '{}') ?? {};
  } catch {
    return {};
  }
};

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
      stones: db.prepare('UPDATE heroes SET stones = ? WHERE account_id = ?'),
      equipOf: db.prepare('SELECT equip FROM heroes WHERE account_id = ?'),
      feeMilli: db.prepare('SELECT fee_milli FROM heroes WHERE account_id = ?'),
      setFeeMilli: db.prepare('UPDATE heroes SET fee_milli = ? WHERE account_id = ?'),
      active: db.prepare('UPDATE heroes SET last_active = ? WHERE account_id = ?'),
      allActive: db.prepare('SELECT account_id, COALESCE(last_active, created_at) AS t FROM heroes'),
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
      goldFlow(this.db, 'start', STARTER_GOLD); // a new hero's purse
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
      stones: JSON.parse(r.stones || '[]'),
      home: r.home ?? 'hearthvale',
      title: r.title ?? null,
      perks: parseJson(r.perks), // level-40 choices: { skill: 'a' | 'b' }
      buffs: parseJson(r.buffs), // shared/buffs.js
      x: r.x ?? SPAWN.x,
      z: r.z ?? SPAWN.z,
    };
  }

  gold(id) {
    return this.q.gold.get(id)?.gold ?? 0;
  }
  // reason labels where the gold came from or went (telemetry, SPEC §6.5).
  addGold(id, n, reason = 'other') {
    if (!Number.isInteger(n)) fail('Bad amount');
    if (n < 0 && this.gold(id) < -n) fail('Not enough gold.');
    this.q.addGold.run(n, id);
    goldFlow(this.db, reason, n);
    emit(null, 'gold', { id, n, reason });
  }

  // A simple hero column (see FIELDS), as stored.
  getField(id, col) {
    if (!FIELDS.has(col)) fail(`Unknown hero field ${col}.`);
    return this.db.prepare(`SELECT ${col} AS v FROM heroes WHERE account_id = ?`).get(id)?.v;
  }
  setField(id, col, value) {
    if (!FIELDS.has(col)) fail(`Unknown hero field ${col}.`);
    this.db.prepare(`UPDATE heroes SET ${col} = ? WHERE account_id = ?`).run(value, id);
  }

  inventory(id) {
    const out = {};
    for (const r of this.q.inv.all(id)) out[r.item] = r.qty;
    return out;
  }
  count(id, item) {
    return this.q.invOne.get(id, item)?.qty ?? 0;
  }
  // kind: where it came from, when it's new to the game ('gather', 'loot',
  // 'craft'…; telemetry). Leave it out for items moving between heroes.
  addItem(id, item, n, kind = null) {
    if (!isItem(item) || !Number.isInteger(n) || n <= 0) fail('Bad item');
    this.q.invAdd.run(id, item, n);
    if (kind) itemFlow(this.db, item, kind, n);
  }
  // keepEquipped: refuse to take the last copy of something equipped (selling
  // or shelving your only axe would leave you unable to chop).
  // kind: where it went, when it leaves the game ('npcSell'…; telemetry).
  takeItem(id, item, n, { keepEquipped = false, kind = null } = {}) {
    if (!isItem(item) || !Number.isInteger(n) || n <= 0) fail('Bad item');
    const have = this.count(id, item);
    if (have < n) fail(`Not enough ${ITEMS[item].name}.`);
    if (keepEquipped && have - n < 1 && Object.values(JSON.parse(this.q.equipOf.get(id)?.equip || '{}')).includes(item)) fail("Keep one — it's equipped.");
    this.q.invSet.run(have - n, id, item);
    if (kind) itemFlow(this.db, item, kind, n);
  }

  // A seller's fee on `gross` gold at ratePm per mille. The fractional part
  // carries over to the next sale, so splitting a sale into tiny pieces can't
  // round the fee away. Call inside a transaction.
  takeFee(id, gross, ratePm) {
    const owed = gross * ratePm + (this.q.feeMilli.get(id)?.fee_milli || 0);
    const fee = Math.floor(owed / 1000);
    this.q.setFeeMilli.run(owed - fee * 1000, id);
    return fee;
  }

  saveActive(id, t) {
    this.q.active.run(t, id);
  }
  loadActive() {
    return new Map(this.q.allActive.all().map((r) => [r.account_id, r.t]));
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

  // Keep a hero's buffs (they survive logging out).
  saveBuffs(hero) {
    this.setField(hero.id, 'buffs', JSON.stringify(hero.buffs ?? {}));
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
  // Remember a waystone this hero has visited (fast travel).
  attune(hero, stoneId) {
    if (hero.stones.includes(stoneId)) return false;
    hero.stones.push(stoneId);
    this.q.stones.run(JSON.stringify(hero.stones), hero.id);
    return true;
  }
}
