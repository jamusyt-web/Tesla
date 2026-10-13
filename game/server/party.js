import { regionAt } from '../shared/places.js';
import { fail } from './db.js';

// Parties: up to four heroes who adventure together (dungeon runs, for now).
// Kept in memory: a party lasts while its members are online (a dropped
// connection keeps your place for a few minutes).
export const PARTY_MAX = 4;
const INVITE_MS = 60_000;
const OFFLINE_KEEP_MS = 5 * 60_000;

export class Parties {
  constructor(game) {
    this.game = game;
    this.parties = new Map(); // id → { id, leader, members: [heroId], names: Map, offline: Map(heroId → since) }
    this.of = new Map(); // heroId → party id
    this.invites = new Map(); // invitee → { from, party, at }
    this.seq = 0;
  }

  get(heroId) {
    const id = this.of.get(heroId);
    return id ? this.parties.get(id) : null;
  }

  // What members see about their party.
  view(p) {
    const g = this.game;
    return {
      id: p.id,
      leader: p.leader,
      members: p.members.map((id) => {
        const c = g.online.get(id);
        return {
          id,
          name: p.names.get(id),
          level: c?.hero.level ?? null,
          online: !!c,
          where: !c ? 'offline' : c.ch?.isRun ? 'dungeon' : c.room ? 'shop' : 'town',
          // The region they're in (a town, the wilds…), for "In Amberfold".
          region: c && !c.ch?.isRun ? (regionAt(c.ent.x, c.ent.z)?.name ?? null) : null,
          run: c?.ch?.isRun ? c.ch.id : null,
          hp: c ? Math.round(c.ent.hp) : null,
          maxHp: c ? c.ent.maxHp : null,
        };
      }),
      run: this.game.runForParty(p.id)?.id ?? null,
      ready: p.ready ? { kind: p.ready.kind, tier: p.ready.tier, mode: p.ready.mode, yes: [...p.ready.yes], no: [...p.ready.no], endsIn: Math.max(0, p.ready.until - Date.now()) } : null,
    };
  }
  push(p) {
    const v = p ? this.view(p) : null;
    for (const id of p?.members ?? []) this.game.online.get(id)?.send({ t: 'party', party: v });
  }

  invite(c, toId) {
    const g = this.game;
    toId = Number(toId);
    if (toId === c.hero.id) fail("You can't invite yourself.");
    const to = g.online.get(toId);
    if (!to) fail("They're not online.");
    let p = this.get(c.hero.id);
    if (p && p.leader !== c.hero.id) fail('Only the party leader can invite.');
    if (p && p.members.length >= PARTY_MAX) fail(`A party can have at most ${PARTY_MAX} heroes.`);
    if (p && p.members.includes(toId)) fail(`${to.hero.name} is already in your party.`);
    if (this.get(toId)) fail(`${to.hero.name} is already in a party.`);
    const prev = this.invites.get(toId);
    if (prev && prev.from === c.hero.id && Date.now() - prev.at < 5000) fail('Invite sent already.');
    if (!p) {
      p = { id: `p${++this.seq}`, leader: c.hero.id, members: [c.hero.id], names: new Map([[c.hero.id, c.hero.name]]), offline: new Map() };
      this.parties.set(p.id, p);
      this.of.set(c.hero.id, p.id);
      this.push(p);
    }
    this.invites.set(toId, { from: c.hero.id, party: p.id, at: Date.now() });
    to.send({ t: 'partyInvite', from: { id: c.hero.id, name: c.hero.name }, party: p.id, expiresIn: INVITE_MS });
    return { party: p.id };
  }

  answer(c, accept) {
    const inv = this.invites.get(c.hero.id);
    this.invites.delete(c.hero.id);
    if (!inv || Date.now() - inv.at > INVITE_MS) fail('That invite has run out.');
    const p = this.parties.get(inv.party);
    const from = this.game.online.get(inv.from);
    if (!accept) {
      from?.send({ t: 'toast', text: `${c.hero.name} declined your party invite.` });
      return { joined: false };
    }
    if (!p) fail('That party has broken up.');
    if (this.get(c.hero.id)) fail("You're already in a party.");
    if (p.members.length >= PARTY_MAX) fail('That party is full.');
    p.members.push(c.hero.id);
    p.names.set(c.hero.id, c.hero.name);
    this.of.set(c.hero.id, p.id);
    this.push(p);
    for (const id of p.members) if (id !== c.hero.id) this.game.online.get(id)?.send({ t: 'toast', kind: 'good', text: `${c.hero.name} joined the party.` });
    return { joined: true, party: this.view(p) };
  }

  leave(heroId, why = 'left') {
    const p = this.get(heroId);
    if (!p) return;
    p.members = p.members.filter((id) => id !== heroId);
    if (p.ready?.leader === heroId) p.ready = null;
    p.ready?.yes.delete(heroId);
    p.offline.delete(heroId);
    this.of.delete(heroId);
    const name = p.names.get(heroId);
    this.game.online.get(heroId)?.send({ t: 'party', party: null });
    if (p.members.length <= 1) {
      // A party of one is no party.
      for (const id of p.members) {
        this.of.delete(id);
        this.game.online.get(id)?.send({ t: 'party', party: null });
        this.game.online.get(id)?.send({ t: 'toast', text: why === 'kicked' ? 'Your party broke up.' : `${name} left; the party broke up.` });
      }
      this.parties.delete(p.id);
      return;
    }
    if (p.leader === heroId) p.leader = p.members.find((id) => this.game.online.has(id)) ?? p.members[0];
    this.push(p);
    for (const id of p.members) this.game.online.get(id)?.send({ t: 'toast', text: `${name} ${why === 'kicked' ? 'was removed from' : 'left'} the party.` });
  }

  kick(c, heroId) {
    const p = this.get(c.hero.id);
    heroId = Number(heroId);
    if (!p || p.leader !== c.hero.id) fail('Only the party leader can do that.');
    if (!p.members.includes(heroId) || heroId === c.hero.id) fail('Not in your party.');
    this.leave(heroId, 'kicked');
  }

  promote(c, heroId) {
    const p = this.get(c.hero.id);
    heroId = Number(heroId);
    if (!p || p.leader !== c.hero.id) fail('Only the party leader can do that.');
    if (!p.members.includes(heroId)) fail('Not in your party.');
    p.leader = heroId;
    this.push(p);
  }

  // Connection changes: keep an offline member's place for a while.
  online(c) {
    const p = this.get(c.hero.id);
    if (!p) return;
    p.offline.delete(c.hero.id);
    this.push(p);
  }
  offline(heroId) {
    const p = this.get(heroId);
    if (!p) return;
    p.offline.set(heroId, Date.now());
    if (p.leader === heroId) p.leader = p.members.find((id) => id !== heroId && this.game.online.has(id)) ?? p.leader;
    this.push(p);
  }
  // Drop members who've been gone too long (called now and then).
  sweep(now = Date.now()) {
    for (const p of [...this.parties.values()]) for (const [id, since] of p.offline) if (now - since > OFFLINE_KEEP_MS) this.leave(id, 'left');
    for (const [id, inv] of this.invites) if (now - inv.at > INVITE_MS) this.invites.delete(id);
  }
}
