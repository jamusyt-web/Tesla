import { ROOM, SHOP, roomNav } from '../shared/shop.js';
import { stepPath } from '../shared/world.js';

const q2 = (v) => Math.round(v * 100) / 100;

// The inside of one player's shop. A room exists while someone is in it and
// is shared by everyone inside (owner and visitors, from any channel), with
// its own small coordinate space; its occupants are hidden from the town.
export class ShopRoom {
  constructor(game, owner) {
    this.game = game;
    this.owner = owner;
    this.occ = new Map(); // accountId → Client
    this.tickNo = 0;
    this.npcSeq = 0;
  }

  get visitors() {
    return this.occ.size - (this.occ.has(this.owner) ? 1 : 0);
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const c of this.occ.values()) if (c !== except) c.sendRaw(data);
  }

  add(c) {
    c.room = this;
    // Step in through the door, a little apart from anyone already there.
    const x = ROOM.spawn.x + ((this.occ.size % 3) - 1) * 0.6;
    c.rent = { x, z: ROOM.spawn.z, rot: ROOM.spawn.rot, path: null, act: 'idle', lastSnap: '' };
    this.occ.set(c.hero.id, c);
    this.broadcast({ t: 'rjoin', p: c.roomInfo() }, c);
    return this.payload(c);
  }

  remove(c, why = 'left') {
    if (this.occ.get(c.hero.id) !== c) return;
    this.occ.delete(c.hero.id);
    c.room = null;
    c.rent = null;
    this.broadcast({ t: 'rleave', id: c.hero.id, why });
    if (!this.occ.size) this.game.rooms.delete(this.owner);
  }

  move(c, x, z) {
    const b = ROOM.bounds;
    x = Math.max(b.x0, Math.min(b.x1, x));
    z = Math.max(b.z0, Math.min(b.z1, z));
    const path = roomNav().findPath(c.rent.x, c.rent.z, x, z);
    if (path) {
      c.rent.path = path;
      c.rent.act = 'walk';
    }
  }

  tick(now, dt) {
    this.tickNo++;
    for (const c of this.occ.values()) {
      const e = c.rent;
      if (e.path) {
        stepPath(e, dt, ROOM.speed);
        if (!e.path && e.act === 'walk') e.act = 'idle';
      }
    }
    if (this.tickNo % 2 === 0) this.#snapshot();
    // Visitors who wander off and leave the tab open don't hold a spot forever.
    if (this.tickNo % 20 === 0)
      for (const c of [...this.occ.values()])
        if (c.hero.id !== this.owner && now - c.lastInput > SHOP.VISITOR_IDLE_MS) {
          this.game.exitShop(c, 'idle');
          c.send({ t: 'rexit', why: 'idle' });
        }
  }

  #snapshot() {
    const full = this.tickNo % 60 === 0;
    const p = [];
    for (const c of this.occ.values()) {
      const e = c.rent;
      const row = [c.hero.id, q2(e.x), q2(e.z), q2(e.rot), e.act];
      const key = row.join(',');
      if (full || key !== e.lastSnap) {
        e.lastSnap = key;
        p.push(row);
      }
    }
    if (p.length) this.broadcast({ t: 'rs', p, full });
  }

  // An NPC customer the simulation already decided on: clients replay it as a
  // villager walking in, looking at a display, maybe paying at the counter.
  npcVisit(ev) {
    this.broadcast({ t: 'rnpc', id: `n${++this.npcSeq}`, cust: ev.cust, slot: ev.slot, buy: ev.sale ? { qty: ev.sale.qty, gold: ev.sale.gross } : null });
    if (ev.sale) this.shelf(ev.slot, 'npc');
  }

  // A display changed (stocked, repriced, sold from).
  shelf(slot, by) {
    this.broadcast({ t: 'rshelf', slot, s: this.game.shops.slot(this.owner, slot), by });
  }

  payload(c) {
    const st = this.game.shops.state(this.owner, c.hero.id);
    const out = {
      ...st,
      occ: [...this.occ.values()].filter((o) => o !== c).map((o) => o.roomInfo()),
      you: { x: q2(c.rent.x), z: q2(c.rent.z), rot: q2(c.rent.rot) },
      trophies: this.game.journal?.trophies(this.owner) ?? [], // the owner's trophy wall
    };
    if (c.hero.id === this.owner) out.presence = 'inside';
    return out;
  }
}
