// A made-up world as big and busy as the five-town Hearthlands will be: 12
// islands on a 700 m ring, each joined to the next by a land bridge and a
// ring road, with 410 gathering nodes and 60 camps of 4 monsters. (Tests
// only; the perf census uses maps/fixtures/stress.json.)
import { mulberry32 } from '../../shared/world.js';

export const TOWNS = 12;
export const RING = 700;
const TYPES = ['tree_oak', 'tree_birch', 'tree_pine', 'rock_stone', 'rock_copper', 'herb_mint', 'herb_sun'];

export function stressWorld() {
  const rng = mulberry32(42);
  const lands = [];
  const nodes = [];
  const spawns = [];
  const ring = [];
  const towns = [];
  for (let k = 0; k < TOWNS; k++) {
    const a = (k / TOWNS) * Math.PI * 2;
    const b = a + Math.PI / TOWNS;
    const t = { x: Math.round(Math.cos(a) * RING), z: Math.round(Math.sin(a) * RING) };
    const bridge = { x: Math.round(Math.cos(b) * RING), z: Math.round(Math.sin(b) * RING) };
    towns.push(t);
    lands.push({ id: `town${k}`, ...t, r: 160 }, { id: `bridge${k}`, ...bridge, r: 120 });
    ring.push([t.x, t.z], [bridge.x, bridge.z]);
    for (let i = 0; i < Math.floor(410 / TOWNS) + (k < 410 % TOWNS ? 1 : 0); i++) {
      const r = 20 + rng() * 120;
      const q = rng() * Math.PI * 2;
      nodes.push({ id: `n${nodes.length}`, type: TYPES[nodes.length % TYPES.length], x: Math.round(t.x + Math.cos(q) * r), z: Math.round(t.z + Math.sin(q) * r), rot: 0, s: 1 });
    }
    for (let i = 0; i < 5; i++) {
      const r = 40 + rng() * 90;
      const q = rng() * Math.PI * 2;
      spawns.push({ id: `camp${spawns.length}`, monster: 'slime', x: Math.round(t.x + Math.cos(q) * r), z: Math.round(t.z + Math.sin(q) * r), r: 8, count: 4 });
    }
  }
  ring.push(ring[0]);
  return {
    world: { format: 2, name: 'Stress', rev: 1, spawn: towns[0], lands, nodes: nodes.slice(0, 410), spawns, paths: [{ id: 'ring', pts: ring, w: 3 }] },
    towns,
  };
}
