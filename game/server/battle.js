// Turn-based co-op battles, fought in a channel (the town or a dungeon run).
import { ITEMS, isItem } from '../shared/items.js';
import { damage } from '../shared/monsters.js';
import { fail } from './db.js';
import { emit } from './events.js';
import { rint } from './channel.js';

export const ROUND_MS = 12000;

// ─────────────────────────────────────────────────────────────────────────
// Turn-based co-op battle, fought *in the world* where the monster stands.
// Up to 4 heroes; anyone nearby can tap the monster to join mid-fight.
// ─────────────────────────────────────────────────────────────────────────
export class Battle {
  // A fight against one monster, or (in a dungeon) a room's whole pack: the
  // others wait their turn and step in one after another (`queue`).
  constructor(ch, mob) {
    this.ch = ch;
    this.id = `b${++ch.seq}`;
    this.mob = mob;
    this.queue = (ch.packFor?.(mob) ?? []).filter((m) => m !== mob && m.state !== 'dead' && !m.battle);
    for (const m of [mob, ...this.queue]) {
      m.state = 'battle';
      m.path = null;
      m.battle = this;
    }
    this.def = ch.monsterDef(mob, 1);
    this.mobMax = this.def.hp;
    this.mobHp = this.def.hp;
    this.fighters = new Map(); // id → {c, hp, max, atk, def, charge, need, mend, choice, alive}
    this.spoils = new Map(); // id → {gold, loot, xp} won so far (paid as each monster falls)
    this.peak = 0;
    this.round = 1;
    this.deadline = Date.now() + ROUND_MS;
    this.over = false;
    this.pending = null; // a telegraphed move landing next round
  }

  publicState() {
    return {
      id: this.id,
      mob: this.mob.id,
      mobHp: this.mobHp,
      mobMax: this.mobMax,
      queue: this.queue.map((m) => m.id),
      warn: this.pending ? this.pending.name : null,
      round: this.round,
      endsIn: Math.max(0, this.deadline - Date.now()),
      fighters: [...this.fighters.entries()].map(([id, f]) => ({ id, name: f.c.hero.name, hp: Math.round(f.hp), max: f.max, charge: f.charge, need: f.need, alive: f.alive, ready: !!f.choice })),
    };
  }

  push(extra = {}) {
    this.ch.broadcast({ t: 'battle', b: this.publicState(), ...extra });
  }

  // The monster's stats for the heroes fighting it now (more heroes, more
  // HP; the wound it already has stays in proportion).
  #rescale() {
    const n = this.fighters.size;
    if (n <= this.peak) return;
    this.peak = n;
    const def = this.ch.monsterDef(this.mob, n);
    const frac = this.mobHp / this.mobMax;
    this.def = def;
    this.mobMax = def.hp;
    this.mobHp = Math.max(1, Math.round(def.hp * frac));
  }

  join(c) {
    if (this.over) fail('That battle just ended.');
    if (this.fighters.size >= 4) fail('This battle is full (4 heroes).');
    const st = c.stats();
    const perks = c.perks?.() ?? new Set();
    this.fighters.set(c.hero.id, { c, hp: Math.max(1, Math.min(c.ent.hp, st.hp)), max: st.hp, atk: st.atk, def: st.def, charge: 0, need: perks.has('quickSpecial') ? 2 : 3, mend: perks.has('mender') ? 1.4 : 1, choice: null, alive: true });
    c.cancelFishing();
    c.battle = this;
    c.ent.act = 'battle';
    this.#rescale();
    // Line up facing the monster in a little arc.
    const n = this.fighters.size - 1;
    const ang = Math.atan2(c.ent.x - this.mob.x, c.ent.z - this.mob.z);
    const spread = [0, 0.55, -0.55, 1.1][n];
    const tx = this.mob.x + Math.sin(ang + spread) * 3.4;
    const tz = this.mob.z + Math.cos(ang + spread) * 3.4;
    c.ent.path = this.ch.walkable(tx, tz) && this.ch.nav.clear(c.ent.x, c.ent.z, tx, tz) ? [[tx, tz]] : null;
    this.mob.rot = Math.atan2(c.ent.x - this.mob.x, c.ent.z - this.mob.z);
    this.push({ joined: c.hero.id });
  }

  leave(c, why) {
    const f = this.fighters.get(c.hero.id);
    if (!f) return;
    c.ent.hp = Math.max(1, f.hp);
    this.fighters.delete(c.hero.id);
    c.battle = null;
    c.ent.act = 'idle';
    // Tell everyone (the leaver too, so their battle screen closes) before
    // the battle possibly ends for lack of fighters.
    this.push({ left: c.hero.id, why });
    c.pushInventory();
    if (!this.over && ![...this.fighters.values()].some((x) => x.alive)) this.end(false);
  }

  // `to`: with a potion, a knocked-out ally to help back up.
  choose(c, a, itemId, to = null) {
    const f = this.fighters.get(c.hero.id);
    if (!f || !f.alive || this.over) return;
    if (!['attack', 'skill', 'defend', 'potion', 'flee'].includes(a)) return;
    if (a === 'skill' && f.charge < f.need) fail('Your special is not charged yet.');
    if (a === 'potion') {
      if (!isItem(itemId) || !ITEMS[itemId].heal) fail('Pick a healing item.');
      if (this.ch.game.heroes.count(c.hero.id, itemId) < 1) fail(`No ${ITEMS[itemId].name} left.`);
      if (to != null) {
        const t = this.fighters.get(Number(to));
        if (!t || t.alive) fail('They are still standing.');
      }
    }
    if (a === 'flee') {
      this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev: [{ k: 'flee', who: c.hero.id }] });
      this.leave(c, 'fled');
      return;
    }
    f.choice = { a, itemId, to: to == null ? null : Number(to) };
    const alive = [...this.fighters.values()].filter((x) => x.alive);
    if (alive.every((x) => x.choice)) this.deadline = Math.min(this.deadline, Date.now() + 250);
    else this.push();
  }

  tick(now) {
    if (!this.over && now >= this.deadline) this.resolve();
  }

  // Pay every hero in the fight for the monster that just fell.
  #reward(def) {
    const g = this.ch.game;
    for (const [id, f] of this.fighters) {
      const s = this.spoils.get(id) ?? { gold: 0, loot: {}, xp: null };
      const gold = rint(...def.gold);
      const loot = {};
      for (const d of def.drops) if (Math.random() < d.p) loot[d.id] = (loot[d.id] || 0) + rint(d.min, d.max);
      try {
        g.heroes.addGold(id, gold, 'loot');
        for (const [it, n] of Object.entries(loot)) g.heroes.addItem(id, it, n);
      } catch (e) {
        console.error('battle reward failed', e);
      }
      const xp = g.heroes.addXp(f.c.hero, 'combat', def.xp);
      emit(f.c, 'kill', { monster: this.mob.type, lvl: def.lvl, boss: !!def.boss, elite: !!def.elite, inRun: !!this.ch.isRun, gold, loot });
      s.gold += gold;
      for (const [it, n] of Object.entries(loot)) s.loot[it] = (s.loot[it] || 0) + n;
      s.xp = s.xp ? { ...xp, amount: s.xp.amount + xp.amount, leveled: s.xp.leveled || xp.leveled } : xp;
      this.spoils.set(id, s);
      f.c.pushInventory();
    }
  }

  resolve() {
    const ev = [];
    const H = this.ch.game.heroes;
    for (const [id, f] of this.fighters) {
      if (!f.alive) continue;
      const ch = f.choice || { a: 'attack' }; // idle heroes auto-attack so nobody stalls the party
      f.defending = false;
      if (ch.a === 'attack' || ch.a === 'skill') {
        const skill = ch.a === 'skill' && f.charge >= f.need;
        const crit = Math.random() < 0.12;
        let dmg = damage(f.atk, this.def.def, skill ? 2.4 : 1);
        if (crit) dmg = Math.round(dmg * 1.6);
        this.mobHp = Math.max(0, this.mobHp - dmg);
        f.charge = skill ? 0 : Math.min(f.need, f.charge + 1);
        ev.push({ k: 'hit', from: id, to: 'mob', dmg, crit, skill });
        // Thorns: hitting it hurts back.
        if (this.def.thorns && this.mobHp > 0) {
          const back = Math.max(1, Math.round(dmg * this.def.thorns));
          f.hp = Math.max(0, f.hp - back);
          ev.push({ k: 'thorns', to: id, dmg: back });
          if (f.hp <= 0) {
            f.alive = false;
            ev.push({ k: 'ko', who: id });
          }
        }
        if (this.mobHp <= 0) break;
      } else if (ch.a === 'defend') {
        f.defending = true;
        f.charge = Math.min(f.need, f.charge + 1);
        ev.push({ k: 'defend', who: id });
      } else if (ch.a === 'potion') {
        try {
          H.takeItem(id, ch.itemId, 1);
          const t = ch.to != null ? this.fighters.get(ch.to) : null;
          if (t && !t.alive) {
            // Help a fallen ally up.
            t.alive = true;
            t.hp = Math.min(t.max, Math.max(Math.round(t.max * 0.25), Math.round(ITEMS[ch.itemId].heal * f.mend)));
            ev.push({ k: 'revive', who: ch.to, by: id, amt: Math.round(t.hp), item: ch.itemId });
          } else {
            const heal = Math.min(f.max - f.hp, ITEMS[ch.itemId].heal * f.mend);
            f.hp += heal;
            ev.push({ k: 'heal', who: id, amt: Math.round(heal), item: ch.itemId });
          }
          f.c.pushInventory();
        } catch {
          ev.push({ k: 'defend', who: id });
          f.defending = true;
        }
      }
    }
    if (this.mobHp <= 0) {
      const fallen = this.mob;
      ev.push({ k: 'mobDown', mob: fallen.id });
      this.#reward(this.def);
      fallen.battle = null;
      this.ch.mobFell(this, fallen);
      const next = this.queue.shift();
      if (!next || ![...this.fighters.values()].some((f) => f.alive)) {
        this.ch.broadcast({ t: 'bres', id: this.id, mob: fallen.id, ev });
        this.end(true);
        return;
      }
      // The next of the pack steps in; it gets its turn next round.
      next.x = fallen.x + (next.x - fallen.x) * 0.25;
      next.z = fallen.z + (next.z - fallen.z) * 0.25;
      this.mob = next;
      this.peak = 0;
      this.def = this.ch.monsterDef(next, 1);
      this.mobMax = this.mobHp = this.def.hp;
      this.#rescale();
      this.pending = null;
      ev.push({ k: 'next', mob: next.id });
      for (const f of this.fighters.values()) f.choice = null;
      this.round++;
      this.deadline = Date.now() + ROUND_MS;
      this.ch.broadcast({ t: 'bres', id: this.id, mob: fallen.id, ev });
      this.push();
      return;
    }
    this.#monsterTurn(ev);
    for (const f of this.fighters.values()) f.choice = null;
    this.round++;
    this.deadline = Date.now() + ROUND_MS;
    // A big move is announced a round ahead (Defend!).
    const tg = this.def.telegraph;
    if (tg && this.round >= tg.start && (this.round - tg.start) % tg.every === 0) {
      this.pending = tg.move;
      ev.push({ k: 'warn', mob: this.mob.id, move: tg.move.name });
    }
    this.ch.broadcast({ t: 'bres', id: this.id, mob: this.mob.id, ev });
    if (![...this.fighters.values()].some((f) => f.alive)) this.end(false);
    else this.push();
  }

  // The monster's turn. Town monsters act once; dungeon monsters act once per
  // hero still standing (at different heroes where they can). An area move
  // takes the whole turn; a frenzied monster gets one more action when hurt.
  #monsterTurn(ev) {
    const d = this.def;
    const aliveCount = () => [...this.fighters.values()].filter((f) => f.alive).length;
    let actions = d.perFighter ? aliveCount() : 1;
    if (d.frenzy && this.mobHp < this.mobMax / 2) actions++;
    const hitThisRound = new Set();
    for (let a = 0; a < actions; a++) {
      const alive = [...this.fighters.entries()].filter(([, f]) => f.alive);
      if (!alive.length) break;
      let move;
      if (this.pending && a === 0) {
        move = this.pending; // the announced move lands, and takes the whole turn
        this.pending = null;
      } else {
        // An area move needs the whole turn, so only the first action can be one.
        const pool = a > 0 ? d.moves.filter((m) => !m.aoe) : d.moves;
        move = pool[Math.floor(Math.random() * pool.length)] ?? d.moves[0];
      }
      const fresh = alive.filter(([id]) => !hitThisRound.has(id));
      const pool = fresh.length ? fresh : alive;
      const targets = move.aoe ? alive : [pool[Math.floor(Math.random() * pool.length)]];
      let dealt = 0;
      for (const [id, f] of targets) {
        hitThisRound.add(id);
        let dmg = damage(d.atk, f.def, move.mult * (move.aoe && !move.full ? 0.7 : 1));
        if (f.defending) dmg = Math.max(1, Math.round(dmg * 0.35));
        f.hp = Math.max(0, f.hp - dmg);
        dealt += dmg;
        ev.push({ k: 'hit', from: 'mob', to: id, dmg, move: move.name, aoe: !!move.aoe || undefined, blocked: !!f.defending });
        if (f.hp <= 0) {
          f.alive = false;
          ev.push({ k: 'ko', who: id });
        }
      }
      const drain = move.drain ?? d.drain ?? 0;
      if (drain && dealt) {
        const heal = Math.min(this.mobMax - this.mobHp, Math.round(dealt * drain));
        if (heal > 0) {
          this.mobHp += heal;
          ev.push({ k: 'mobHeal', amt: heal });
        }
      }
      if (move.aoe) break;
    }
  }

  end(victory) {
    if (this.over) return;
    this.over = true;
    const results = {};
    for (const [id, f] of this.fighters) {
      const c = f.c;
      c.battle = null;
      c.ent.act = 'idle';
      c.ent.hp = f.alive ? Math.max(1, f.hp) : Math.round(f.max * this.ch.koHp);
      const s = this.spoils.get(id);
      results[id] = { victory, gold: s?.gold ?? 0, loot: s?.loot ?? {}, xp: s?.xp ?? null };
      c.pushInventory(); // the HUD shows the HP you're left with
    }
    for (const m of [this.mob, ...this.queue]) if (m.battle === this) m.battle = null;
    this.ch.battles.delete(this.id);
    this.ch.broadcast({ t: 'battleEnd', id: this.id, mob: this.mob.id, victory, results, inRun: !!this.ch.isRun || undefined });
    this.ch.battleOver(this, victory);
  }
}
