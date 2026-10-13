// Exploring (SPEC §5.5): which 16 m cells each hero has walked near, and
// the places they've found. Sampled once a second from the 'pos' event; the
// bits live on the client object while you play and are saved every 30 s
// and when you leave (table explore). Finding a place is a 'discover' event.
import { grid, bytesFor, markAround, reproject, discoverables, regionCells, hasBit, pagePct } from '../shared/journal.js';
import { STONES, SPAWN } from '../shared/world.js';
import { on, emit } from './events.js';
import { register } from './rpc.js';

export class Explore {
  constructor(game) {
    this.game = game;
    const p = (s) => game.db.prepare(s);
    this.q = {
      get: p('SELECT bits, w, h, x0, z0 FROM explore WHERE account_id = ?'),
      put: p('INSERT INTO explore (account_id, bits, w, h, x0, z0, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET bits = excluded.bits, w = excluded.w, h = excluded.h, x0 = excluded.x0, z0 = excluded.z0, updated_at = excluded.updated_at'),
    };
    this.places = null; // discoverables(), worked out once per world
  }

  // On connect: the hero's bits (re-projected if the world grew). A hero from
  // before the journal starts with the town around the square known, and
  // the waystones they've attuned found.
  load(c, now = Date.now()) {
    const G = grid();
    const row = this.q.get.get(c.hero.id);
    let bits;
    if (row) bits = reproject(new Uint8Array(row.bits), row, G);
    else {
      bits = new Uint8Array(bytesFor(G));
      const old = (c.hero.tutorial ?? 0) > 0 || (c.hero.stones?.length ?? 0) > 0;
      if (old) markAround(bits, G, SPAWN.x, SPAWN.z, 40);
      for (const id of c.hero.stones ?? []) if (STONES.some((s) => s.id === id)) this.game.journal.note(c.hero.id, 'place', id, { now });
    }
    if (bits.length !== bytesFor(G)) bits = Object.assign(new Uint8Array(bytesFor(G)), bits.slice(0, bytesFor(G)));
    c.explore = { bits, G, dirty: !row };
    this.visit(c, c.ent.x, c.ent.z, now, { quiet: true });
  }
  bitsOf(c) {
    if (!c.explore) this.load(c);
    return c.explore.bits;
  }
  save(c, now = Date.now()) {
    const e = c.explore;
    if (!e?.dirty) return;
    this.q.put.run(c.hero.id, e.bits, e.G.w, e.G.h, e.G.x0, e.G.z0, now);
    e.dirty = false;
  }

  // The hero is at (x, z): mark the cells around, and find any place in reach.
  visit(c, x, z, now = Date.now(), { quiet = false } = {}) {
    const e = c.explore;
    if (!e) return;
    const fresh = markAround(e.bits, e.G, x, z);
    if (fresh.length) {
      e.dirty = true;
      if (!quiet) c.send({ t: 'cells', k: fresh });
    }
    this.places ??= discoverables();
    for (const d of this.places) {
      if (Math.abs(d.x - x) > d.r || Math.abs(d.z - z) > d.r || Math.hypot(d.x - x, d.z - z) > d.r) continue;
      this.discover(c, d, now);
    }
  }

  // Found a place: journal it, raise 'discover', tell the hero (with the
  // region's new percentage).
  discover(c, d, now = Date.now()) {
    const J = this.game.journal;
    if (!J.note(c.hero.id, 'place', d.id, { now }).first) return false;
    const page = d.region ? this.regionPct(c, d.region) : null;
    c.send({ t: 'discover', id: d.id, kind: d.kind, name: d.name, region: d.region, pct: page });
    emit(c, 'discover', { id: d.id, kind: d.kind, region: d.region });
    return true;
  }

  // A region's discovery for a hero, without building the whole page.
  regionPct(c, region) {
    const land = regionCells().get(region) ?? [];
    const walked = land.filter((k) => hasBit(c.explore.bits, k)).length;
    this.places ??= discoverables();
    const places = this.places.filter((d) => d.region === region);
    const found = this.game.journal.ids(c.hero.id, 'place');
    return pagePct(walked, land.length, places.filter((d) => found.has(d.id)).length, places.length);
  }

  // After the map changes (the editor saved, a patch applied).
  worldChanged() {
    this.places = null;
  }
}

on('pos', (c, d) => !d.run && c?.game?.explore?.visit(c, d.x, d.z));
on('attune', (c, d) => {
  const X = c?.game?.explore;
  const st = STONES.find((s) => s.id === d.id);
  if (X && st) X.discover(c, { id: st.id, kind: 'stone', name: st.name, region: X.places?.find((p) => p.id === st.id)?.region ?? null });
});

register('explore.bits', (g, c) => {
  const e = g.explore.bitsOf(c) && c.explore;
  return { x0: e.G.x0, z0: e.G.z0, w: e.G.w, h: e.G.h, bits: Buffer.from(e.bits).toString('base64') };
}, { inRun: true });
