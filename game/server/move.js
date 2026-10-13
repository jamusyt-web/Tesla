// Walking: a tap or key press asks for a path to a point; the server plans
// it on the nav grid and the channel tick walks the hero along it.

const num = (v) => (Number.isFinite(+v) ? +v : 0);

// A walkable path for c from where they stand to (x, z), or null.
export function pathFor(c, x, z) {
  return c.ch.nav.findPath(c.ent.x, c.ent.z, x, z);
}

export function onMove(g, c, m, now) {
  if (c.battle || c.craft) return;
  if ((m.v === 'room') !== !!c.room) return; // a stale move from the other view
  if (now - (c.lastMove || 0) < 80) return; // pathfinding is the expensive bit; cap it
  c.lastMove = now;
  const x = num(m.x);
  const z = num(m.z);
  if (c.room) return c.room.move(c, x, z);
  if (!c.ch.inBounds(x, z)) return;
  const path = pathFor(c, x, z);
  c.cancelFishing();
  if (path) {
    c.ent.path = path;
    c.ent.act = 'walk';
  }
}

