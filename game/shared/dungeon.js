// Procedurally generated dungeons, shared by the server (which generates and
// runs them) and the client (which draws the layout the server sends and
// predicts movement in it; it never generates one itself).
//
// A dungeon is a grid of 4 m cells (the size of the Modular Dungeon Kit's
// floor tiles and wall segments): rooms joined by corridors. A main path of
// at least seven rooms winds from the Entry Hall to the Boss Chamber, with
// side rooms off it (the Vault, the Shrine, extra halls). Doorways out of a
// room are barred until its pack is beaten; the Vault also needs the Bone Key
// an Elite drops. Everything here is deterministic from the seed.
import { mulberry32 } from './world.js';

export const CELL = 4; // metres per cell
export const PLAYER_R = 0.45;
export const ORIGIN = { x: 5000, z: 5000 }; // every run lives here, far from the island (each run is its own space)
const ROCK = 0;
const ROOM = 1;
const HALL = 2; // corridor
const GRID = 26;

// ── Dungeons, tiers and the day's twist ───────────────────────────────
export const DUNGEONS = {
  hollow_crypt: {
    name: 'The Hollow Crypt',
    blurb: 'An old barrow under the Wilds, where the dead do not stay down. Its master, the Pale Count, keeps a fortune in his chamber.',
    pool: ['thrall', 'crypt_skeleton', 'crypt_wisp'],
    elite: ['crypt_skeleton', 'thrall'],
    boss: { monster: 'pale_count', adds: ['thrall', 'thrall', 'crypt_skeleton'] },
  },
};
// Each tier is the same crypt, harder; clearing one unlocks the next.
export const TIERS = {
  1: { name: 'Tier 1', hp: 1, atk: 1, def: 0, loot: 1, rec: { level: 5, gear: 'a Copper Sword' } },
  2: { name: 'Tier 2', hp: 1.6, atk: 1.35, def: 3, loot: 1.6, rec: { level: 8, gear: 'an Iron Sword and Iron Plate' } },
  3: { name: 'Tier 3', hp: 2.45, atk: 1.9, def: 5, loot: 2.5, rec: { level: 12, gear: 'a Sunforged Blade, Iron Plate and a Sapphire Amulet' } },
};
// One twist a day, the same for everyone.
export const MODIFIERS = {
  restless: { name: 'Restless Dead', text: 'One more monster in every hall, but they carry 30% more gold.', extra: 1, gold: 1.3 },
  bloodmoon: { name: 'Blood Moon', text: 'Monsters hit 15% harder; chests hold one more treasure.', atk: 1.15, rolls: 1 },
  brittle: { name: 'Brittle Bones', text: 'Monsters have 15% less health, and 20% less gold.', hp: 0.85, gold: 0.8 },
  still: { name: 'Still Night', text: 'Nothing stirs out of the ordinary.' },
};
const MOD_ORDER = ['still', 'restless', 'bloodmoon', 'brittle'];
export const dayIndex = (now = Date.now()) => Math.floor(now / 86_400_000);
export const weekIndex = (now = Date.now()) => Math.floor((dayIndex(now) + 3) / 7); // weeks start on Monday
export const modifierFor = (now = Date.now()) => MOD_ORDER[dayIndex(now) % MOD_ORDER.length];
// This week's crypt: the same layout for everyone, for a fair leaderboard.
export const weeklySeed = (kind, tier, now = Date.now()) => {
  let h = 2166136261;
  for (const ch of `${kind}:${tier}:${weekIndex(now)}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

// ── Run rules ─────────────────────────────────────────────────────────
export const MAX_RUN_HEROES = 4;
export const MAX_RUNS = 16;
export const ROOM_HEAL = 0.2; // clearing a room gives the heroes in it this share of their health back
export const KO_HP = 0.5; // after a wipe you wake in the Entry Hall with this much
export const MAX_WIPES = 3; // the fourth wipe ends the run
export const USE_RANGE = 4; // metres from a brazier, shrine, chest or the stairs to use it
export const RUN_MAX_MS = 60 * 60_000; // a run closes after an hour (warned at 55 min)
export const SEAT_GRACE_MS = 3 * 60_000; // a dropped connection keeps your place this long
export const ENTRANCE_RANGE = 9; // how close to the crypt door you must be to go in
export const ENGAGE_PATH = 9; // you must be able to walk to a monster within this many metres to fight it
export const READY_MS = 15_000; // a party's ready check
export const ENTER_COOLDOWN_MS = 10_000;
// Spike traps: down, a 0.4 s warning glow, then up for a moment; on a loop.
export const TRAP = { cycle: 2800, warn: 400, up: 900, damage: 0.06 };
const trapT = (t, ms) => (((ms + t.phase * 1000) % TRAP.cycle) + TRAP.cycle) % TRAP.cycle;
export const trapUp = (t, ms) => trapT(t, ms) >= TRAP.cycle - TRAP.up;
export const trapWarn = (t, ms) => trapT(t, ms) >= TRAP.cycle - TRAP.up - TRAP.warn;

// Elite affixes (battle effects the engine understands: see server/channel.js).
export const AFFIXES = {
  armored: { name: 'Armored', text: '+8 defence' },
  frenzied: { name: 'Frenzied', text: 'attacks twice as often when hurt' },
  vampiric: { name: 'Vampiric', text: 'heals from the harm it deals' },
  thorns: { name: 'Thorny', text: 'hurts whoever strikes it' },
};

// How a party's size changes things. n = heroes.
export const partyScale = (n) => {
  n = Math.max(1, Math.min(4, n | 0));
  return {
    // Monster health. Each monster also acts once per hero standing, so a
    // group's fights last a little longer and press everyone as hard as a
    // hero alone; a knocked-out friend makes it harder still. (Tuned with a
    // run simulator: equal heroes clear about 90% alone, 75% as two, 60% as
    // three or four. Groups of three or more also get two more halls, an
    // elite with two affixes and an extra roll in the boss chest.)
    hp: [1, 2.16, 3.3, 4.4][n - 1],
    reward: 1 + 0.25 * (n - 1), // gold / xp per hero from kills and chests
    extraPerRoom: 0, // more monsters per pack (a tuning knob; the halls above are enough for now)
    eliteAffixes: n >= 3 ? 2 : 1,
    bossRolls: n >= 3 ? 1 : 0,
  };
};

// A monster's battle stats in a run: base stats (shared/monsters.js) for the
// heroes fighting it, the tier, the day's twist, and an elite's affixes. It
// acts once per hero standing each round (the battle engine's perFighter), so
// a group is pressed at least as hard as a hero alone.
export function scaledDef(base, n, { elite = false, affixes = [], tier = 1, mod = 'still' } = {}) {
  const s = partyScale(n);
  const T = TIERS[tier] ?? TIERS[1];
  const M = MODIFIERS[mod] ?? MODIFIERS.still;
  const def = {
    ...base,
    hp: Math.round(base.hp * s.hp * (elite ? 2 : 1) * T.hp * (M.hp ?? 1)),
    atk: Math.round(base.atk * (elite ? 1.2 : 1) * T.atk * (M.atk ?? 1)),
    def: base.def + T.def,
    xp: Math.round(base.xp * s.reward * (elite ? 3 : 1) * T.loot),
    gold: base.gold.map((g) => Math.round(g * s.reward * (elite ? 3 : 1) * T.loot * (M.gold ?? 1))),
    moves: [...base.moves],
    perFighter: true,
    elite,
  };
  for (const a of affixes) {
    if (a === 'armored') def.def += 8;
    if (a === 'frenzied') def.frenzy = true;
    if (a === 'vampiric') def.drain = 0.5;
    if (a === 'thorns') def.thorns = 0.2;
  }
  if (elite) def.name = `${affixes.map((a) => AFFIXES[a]?.name).filter(Boolean).join(' ')} ${base.name}`.trim();
  return def;
}

// ── Chests ──────────────────────────────────────────────────────────────
// Gold, Grave Dust, and one roll on a table (more rolls for big parties, the
// day's twist, and the first clear of the day).
export const CHESTS = {
  hollow_crypt: {
    vault: {
      gold: [50, 90],
      dust: [2, 3],
      table: [
        { id: 'health_potion', w: 40, n: 2 },
        { id: 'iron_ore', w: 35, n: 3 },
        { id: 'moon_elixir', w: 20, n: 1 },
        { id: 'sapphire', w: 5, n: 1 },
      ],
    },
    boss: {
      gold: [120, 200],
      dust: [3, 5],
      table: [
        { id: 'iron_bar', w: 44, n: 2 },
        { id: 'moon_elixir', w: 25, n: 1 },
        { id: 'gold_bar', w: 18, n: 1 },
        { id: 'golem_core', w: 8, n: 1 },
        { id: 'sapphire', w: 3, n: 1 },
        { id: ['wraith_blade~fine', 'barrow_plate~fine', 'ghostlight_amulet~fine'], w: 2, n: 1 },
      ],
    },
  },
};
export const FIRST_CLEAR_GOLD = 150;
export function rollChest(kind, chest, { party = 1, tier = 1, mod = 'still', firstToday = false, rng = Math.random } = {}) {
  const C = CHESTS[kind][chest];
  const s = partyScale(party);
  const T = TIERS[tier] ?? TIERS[1];
  const M = MODIFIERS[mod] ?? MODIFIERS.still;
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  let gold = Math.round(ri(...C.gold) * s.reward * T.loot * (M.gold ?? 1));
  const items = { grave_dust: Math.max(1, Math.round(ri(...C.dust) * T.loot)) };
  let rolls = 1 + (chest === 'boss' ? s.bossRolls : 0) + (M.rolls ?? 0);
  if (chest === 'boss' && firstToday) {
    rolls *= 2;
    gold += Math.round(FIRST_CLEAR_GOLD * T.loot);
  }
  const total = C.table.reduce((a, e) => a + e.w, 0);
  for (let r = 0; r < rolls; r++) {
    let x = rng() * total;
    const e = C.table.find((t) => (x -= t.w) < 0) ?? C.table[0];
    const id = Array.isArray(e.id) ? e.id[Math.floor(rng() * e.id.length)] : e.id;
    const n = e.n > 1 ? Math.max(1, Math.round(e.n * T.loot)) : 1;
    items[id] = (items[id] || 0) + n;
  }
  return { gold, items };
}

// ── Layout ─────────────────────────────────────────────────────────────
const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

// Generate a dungeon. opts: { kind, party (1-4), tier, mod }. Returns plain
// JSON (sent to clients as is). Bounded: it never loops forever.
export function generateDungeon(seed, { kind = 'hollow_crypt', party = 1, tier = 1, mod = 'still', ox = ORIGIN.x, oz = ORIGIN.z } = {}) {
  const K = DUNGEONS[kind];
  for (let attempt = 0; attempt < 200; attempt++) {
    const d = tryGenerate((seed + attempt * 7919) >>> 0, K, kind, party, tier, mod, ox, oz);
    if (d) return { ...d, seed };
  }
  throw new Error('Could not generate a dungeon');
}

function tryGenerate(seed, K, kind, party, tier, mod, ox, oz) {
  const rng = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const W = GRID;
  const H = GRID;
  const grid = new Uint8Array(W * H);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : grid[y * W + x]);
  const set = (x, y, v) => (grid[y * W + x] = v);
  const rooms = [];
  const links = []; // { a, b, cells: [[x,y]...], dir (from a) }

  // Rock all round (8-way), except cells we allow.
  const freeRect = (x, y, w, h, allow) => {
    for (let j = y - 1; j <= y + h; j++)
      for (let i = x - 1; i <= x + w; i++) {
        if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) return false;
        if (at(i, j) !== ROCK && !allow.has(`${i},${j}`)) return false;
      }
    return true;
  };
  const addRoom = (x, y, w, h, parent, kindName) => {
    const r = { id: rooms.length, x, y, w, h, parent, kind: kindName, depth: parent == null ? 0 : rooms[parent].depth + 1, kids: [] };
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, ROOM);
    rooms.push(r);
    if (parent != null) rooms[parent].kids.push(r.id);
    return r;
  };
  // Try once to grow a corridor + room off room `base`.
  const growOnce = (base, [w, h], kindName) => {
    const r = rooms[base];
    const side = pick(['n', 'e', 's', 'w']);
    const [dx, dy] = DIRS[side];
    const len = ri(1, 3);
    let sx;
    let sy;
    if (side === 'n' || side === 's') {
      sx = ri(r.x, r.x + r.w - 1);
      sy = side === 'n' ? r.y - 1 : r.y + r.h;
    } else {
      sx = side === 'w' ? r.x - 1 : r.x + r.w;
      sy = ri(r.y, r.y + r.h - 1);
    }
    const cells = [];
    for (let k = 0; k < len; k++) cells.push([sx + dx * k, sy + dy * k]);
    const [ex, ey] = cells[cells.length - 1];
    let nx;
    let ny;
    if (side === 'n' || side === 's') {
      nx = ex - ri(0, w - 1);
      ny = side === 'n' ? ey - h : ey + 1;
    } else {
      nx = side === 'w' ? ex - w : ex + 1;
      ny = ey - ri(0, h - 1);
    }
    for (const [cx, cy] of cells) {
      if (at(cx, cy) !== ROCK) return null;
      const across = side === 'n' || side === 's' ? [[cx - 1, cy], [cx + 1, cy]] : [[cx, cy - 1], [cx, cy + 1]];
      for (const [qx, qy] of across) if (at(qx, qy) !== ROCK) return null;
    }
    if (!freeRect(nx, ny, w, h, new Set(cells.map(([a, b]) => `${a},${b}`)))) return null;
    for (const [cx, cy] of cells) set(cx, cy, HALL);
    const nr = addRoom(nx, ny, w, h, base, kindName);
    links.push({ a: base, b: nr.id, cells, dir: side });
    return nr;
  };
  const grow = (base, size, kindName, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const r = growOnce(base, typeof size === 'function' ? size() : size, kindName);
      if (r) return r;
    }
    return null;
  };
  const hallSize = () => [ri(3, 4), ri(3, 4)];

  // The main path: Entry Hall, then a chain of rooms, then the Boss Chamber.
  const start = Math.floor(GRID / 2) - 1;
  addRoom(start, start, 3, 3, null, 'entry');
  const mainLen = ri(6, 7); // rooms between the entry and the boss
  let last = 0;
  for (let k = 0; k < mainLen; k++) {
    const r = grow(last, hallSize, 'hall');
    if (!r) return null;
    last = r.id;
  }
  const boss = grow(last, [5, 5], 'boss', 60);
  if (!boss) return null;
  const mainIds = [];
  for (let r = boss; r; r = r.parent == null ? null : rooms[r.parent]) mainIds.unshift(r.id);
  const main = new Set(mainIds);
  // Side rooms off the main path (and now and then off a side room).
  const target = ri(11, 13) + (party >= 3 ? 2 : 0);
  const middle = mainIds.slice(2, -2); // not right by the entry, nor the boss
  const half = Math.floor(mainIds.length / 2);
  const shrine = grow(pick(mainIds.slice(half - 1, half + 1)), [3, 3], 'shrine', 60);
  if (!shrine) return null;
  const vault = grow(pick(middle), [3, 3], 'vault', 60);
  if (!vault) return null;
  for (let t = 0; rooms.length < target && t < 60; t++) {
    const sideHalls = rooms.filter((r) => !main.has(r.id) && r.kind === 'hall').map((r) => r.id);
    const from = rng() < 0.75 || !sideHalls.length ? pick(mainIds.slice(1, -1)) : pick(sideHalls);
    grow(from, hallSize, 'hall', 8);
  }
  if (rooms.length < 10) return null;
  // The Elite (with the Bone Key) guards the middle of the main path.
  const eliteRoom = rooms[mainIds[Math.max(2, half)]];
  if (!eliteRoom || eliteRoom.kind !== 'hall') return null;
  eliteRoom.kind = 'elite';
  const DRESS = ['pillars', 'crypt', 'armory', 'collapsed', 'ossuary'];
  for (const r of rooms) r.dress = r.kind === 'hall' || r.kind === 'elite' ? pick(DRESS) : r.kind;

  // ── To world space ───────────────────────────────────────────────────
  const cx = (i) => ox + (i + 0.5) * CELL;
  const cz = (j) => oz + (j + 0.5) * CELL;

  // Gates: one per link, in the wall between the parent room and the
  // corridor; locked until the parent room is clear (and, for the Vault,
  // until the party has the key).
  const gates = links.map((l, id) => {
    const [gx, gy] = l.cells[0];
    const [dx, dy] = DIRS[l.dir];
    return { id: `g${id}`, x: +(cx(gx) - (dx * CELL) / 2).toFixed(2), z: +(cz(gy) - (dy * CELL) / 2).toFixed(2), dir: l.dir, from: l.a, to: l.b, key: rooms[l.b].kind === 'vault' };
  });
  // The open arch at the other end of each corridor.
  const arches = links.map((l, id) => {
    const [lx, ly] = l.cells[l.cells.length - 1];
    const [dx, dy] = DIRS[l.dir];
    return { id: `a${id}`, x: +(cx(lx) + (dx * CELL) / 2).toFixed(2), z: +(cz(ly) + (dy * CELL) / 2).toFixed(2), dir: l.dir };
  });

  // ── Dressing: props per room (world metres; r > 0 blocks walking) ──────
  const props = [];
  const busy = new Set(); // cells next to doorways stay clear
  for (const l of links) {
    const [gx, gy] = l.cells[0];
    const [dx, dy] = DIRS[l.dir];
    busy.add(`${gx - dx},${gy - dy}`);
    const [lx, ly] = l.cells[l.cells.length - 1];
    busy.add(`${lx + dx},${ly + dy}`);
  }
  const P = (slot, x, z, rot = 0, r = 0, extra = {}) => props.push({ slot, x: +x.toFixed(2), z: +z.toFixed(2), rot: +rot.toFixed(3), r, ...extra });
  const wallSlots = (r) => {
    const out = [];
    for (let i = r.x; i < r.x + r.w; i++) {
      if (at(i, r.y - 1) === ROCK) out.push({ x: cx(i), z: cz(r.y) - CELL / 2 + 0.55, rot: 0, cell: [i, r.y] });
      if (at(i, r.y + r.h) === ROCK) out.push({ x: cx(i), z: cz(r.y + r.h - 1) + CELL / 2 - 0.55, rot: Math.PI, cell: [i, r.y + r.h - 1] });
    }
    for (let j = r.y; j < r.y + r.h; j++) {
      if (at(r.x - 1, j) === ROCK) out.push({ x: cx(r.x) - CELL / 2 + 0.55, z: cz(j), rot: Math.PI / 2, cell: [r.x, j] });
      if (at(r.x + r.w, j) === ROCK) out.push({ x: cx(r.x + r.w - 1) + CELL / 2 - 0.55, z: cz(j), rot: -Math.PI / 2, cell: [r.x + r.w - 1, j] });
    }
    return out.filter((p) => !busy.has(`${p.cell[0]},${p.cell[1]}`));
  };
  const centre = (r) => [ox + (r.x + r.w / 2) * CELL, oz + (r.y + r.h / 2) * CELL];
  const corners = (r, inset = 1.2) =>
    [
      [ox + r.x * CELL + inset, oz + r.y * CELL + inset],
      [ox + (r.x + r.w) * CELL - inset, oz + r.y * CELL + inset],
      [ox + r.x * CELL + inset, oz + (r.y + r.h) * CELL - inset],
      [ox + (r.x + r.w) * CELL - inset, oz + (r.y + r.h) * CELL - inset],
    ].filter(([x, z]) => !busy.has(`${Math.floor((x - ox) / CELL)},${Math.floor((z - oz) / CELL)}`));
  const inward = (t, d) => [t.x + Math.sin(t.rot) * d, t.z + Math.cos(t.rot) * d];
  let exitStairs = null;
  for (const r of rooms) {
    const ws = shuffle(wallSlots(r));
    const [mx, mz] = centre(r);
    if (r.kind === 'entry') {
      // The way back up: stairs against the north wall if it's solid.
      const n = ws.find((t) => t.rot === 0) ?? ws[0];
      exitStairs = { x: n.x, z: n.z + 0.6, rot: n.rot };
      P('dg_stairs', exitStairs.x, exitStairs.z, n.rot, 0, { use: 'exit' });
      ws.splice(ws.indexOf(n), 1);
    }
    // Torches every few metres of wall.
    ws.filter((_, k) => k % 3 === 0).forEach((t) => P('dg_torch', t.x, t.z, t.rot, 0, { light: 1 }));
    if (r.kind === 'entry') {
      P('dg_brazier', mx, mz, 0, 0.9, { use: 'rest', light: 2 });
      for (const [x, z] of corners(r)) P('dg_barrel', x, z, rng() * 6, 0.6);
    } else if (r.kind === 'boss') {
      for (const [x, z] of corners(r, 3)) P('dg_pillar', x, z, 0, 0.8);
      for (const t of ws.filter((_, k) => k % 2 === 1).slice(0, 4)) P('dg_fire', ...inward(t, 0.6), 0, 0.55, { light: 2 });
      for (const t of ws.slice(5, 8)) P('dg_coffin', ...inward(t, 0.5), t.rot, 0.7);
    } else if (r.kind === 'shrine') {
      P('dg_altar', mx, mz, 0, 0.95, { use: 'shrine', light: 2 });
      for (const [x, z] of corners(r)) P('dg_candles', x, z, rng() * 6, 0);
    } else if (r.kind === 'vault') {
      P('dg_chest', mx, mz, 0, 0.75, { use: 'vault' });
      for (const [x, z] of corners(r)) P(rng() < 0.5 ? 'dg_pot' : 'dg_urn', x, z, rng() * 6, 0.5);
      for (const t of ws.slice(1, 3)) P('dg_banner', t.x, t.z, t.rot, 0);
    } else {
      if (r.dress === 'pillars') for (const [x, z] of corners(r, 2.6)) P('dg_pillar', x, z, 0, 0.8);
      if (r.dress === 'crypt') for (const t of ws.slice(1, 5)) P('dg_coffin', ...inward(t, 0.5), t.rot, 0.7);
      if (r.dress === 'armory') for (const t of ws.slice(1, 4)) P('dg_rack', ...inward(t, 0.2), t.rot, 0.6);
      if (r.dress === 'collapsed') for (const [x, z] of corners(r).slice(0, 2)) P('dg_rubble', x, z, rng() * 6, 1.0);
      if (r.dress === 'ossuary') for (const t of ws.slice(1, 4)) P('dg_urn', ...inward(t, 0.2), rng() * 6, 0.45);
      for (const t of ws.slice(5, 7)) P('dg_banner', t.x, t.z, t.rot, 0);
      for (const [x, z] of corners(r, 0.9).slice(0, 2)) if (rng() < 0.6) P('dg_candles', x, z, rng() * 6, 0);
    }
  }
  // Spike traps guard the way to the side rooms (the Vault and the Shrine):
  // a risk for a reward, never on the main path or in a room with monsters.
  const traps = [];
  for (const l of links) {
    const kind = rooms[l.b].kind;
    if (kind !== 'vault' && kind !== 'shrine') continue;
    const [x, y] = l.cells[Math.floor(l.cells.length / 2)];
    traps.push({ id: `t${traps.length}`, x: +cx(x).toFixed(2), z: +cz(y).toFixed(2), phase: +(rng() * 2.8).toFixed(2) });
  }

  // ── Monsters ───────────────────────────────────────────────────────────
  const s = partyScale(party);
  const M = MODIFIERS[mod] ?? MODIFIERS.still;
  const spawns = [];
  const spotIn = (r, used) => {
    for (let t = 0; t < 60; t++) {
      const x = ox + r.x * CELL + 2 + rng() * (r.w * CELL - 4);
      const z = oz + r.y * CELL + 2 + rng() * (r.h * CELL - 4);
      if (busy.has(`${Math.floor((x - ox) / CELL)},${Math.floor((z - oz) / CELL)}`)) continue;
      if (used.some((u) => Math.hypot(u[0] - x, u[1] - z) < 3.4)) continue;
      if (props.some((p) => p.r > 0 && Math.hypot(p.x - x, p.z - z) < p.r + 1.6)) continue;
      used.push([x, z]);
      return [+x.toFixed(2), +z.toFixed(2)];
    }
    return null;
  };
  // Packs grow going deeper: 2, 2, 3, 3, 3, 4… on the main path.
  const PACKS = [2, 2, 3, 3, 3, 4, 4, 4];
  let mainHall = 0;
  for (const id of mainIds) {
    const r = rooms[id];
    const used = [];
    if (r.kind === 'hall') {
      const n = PACKS[Math.min(PACKS.length - 1, mainHall++)] + s.extraPerRoom + (M.extra ?? 0);
      for (let k = 0; k < n; k++) {
        const p = spotIn(r, used);
        if (p) spawns.push({ room: r.id, monster: pick(K.pool), x: p[0], z: p[1] });
      }
    } else if (r.kind === 'elite') {
      const p = spotIn(r, used);
      const affixes = shuffle(Object.keys(AFFIXES)).slice(0, s.eliteAffixes);
      if (p) spawns.push({ room: r.id, monster: pick(K.elite), x: p[0], z: p[1], elite: true, affixes, key: true });
      for (let k = 0; k < s.extraPerRoom; k++) {
        const q = spotIn(r, used);
        if (q) spawns.push({ room: r.id, monster: pick(K.pool), x: q[0], z: q[1] });
      }
    } else if (r.kind === 'boss') {
      const [mx, mz] = centre(r);
      used.push([mx, mz - 2]);
      for (const add of K.boss.adds.slice(0, 2 + s.extraPerRoom)) {
        const q = spotIn(r, used);
        if (q) spawns.push({ room: r.id, monster: add, x: q[0], z: q[1] });
      }
      // The boss steps in last.
      spawns.push({ room: r.id, monster: K.boss.monster, x: +mx.toFixed(2), z: +(mz - 2).toFixed(2), boss: true });
    }
  }
  // Side halls: optional fights for extra loot.
  for (const r of rooms) {
    if (main.has(r.id) || r.kind !== 'hall') continue;
    const used = [];
    for (let k = 0; k < 2 + s.extraPerRoom + (M.extra ?? 0); k++) {
      const p = spotIn(r, used);
      if (p) spawns.push({ room: r.id, monster: pick(K.pool), x: p[0], z: p[1] });
    }
  }
  if (!spawns.some((x) => x.key) || !spawns.some((x) => x.boss)) return null;

  const entry = rooms[0];
  const [ex, ez] = centre(entry);
  const [bx, bz] = centre(boss);
  const layout = {
    kind,
    name: K.name,
    tier,
    mod,
    party,
    cell: CELL,
    ox,
    oz,
    w: W,
    h: H,
    cells: Array.from({ length: H }, (_, j) => Array.from({ length: W }, (_, i) => '#.c'[at(i, j)]).join('')),
    rooms: rooms.map((r) => ({ id: r.id, kind: r.kind, dress: r.dress, x: r.x, y: r.y, w: r.w, h: r.h, parent: r.parent, depth: r.depth, main: main.has(r.id) })),
    links: links.map((l) => ({ a: l.a, b: l.b, cells: l.cells })),
    gates,
    arches,
    props,
    traps,
    spawns,
    entry: { x: +ex.toFixed(2), z: +(ez + 3).toFixed(2) }, // in front of the brazier
    exit: exitStairs,
    bossChest: { x: +bx.toFixed(2), z: +(bz + 2.4).toFixed(2) },
  };
  if (!allReachable(layout)) return null;
  return layout;
}

// ── Walking ────────────────────────────────────────────────────────────
// The runtime state a walkability test needs: the layout plus which gates
// are closed. Build once per layout; open gates with setGate().
export function dungeonCol(layout) {
  const byCell = new Map();
  for (const p of layout.props.filter((q) => q.r > 0)) {
    const i = Math.floor((p.x - layout.ox) / CELL);
    const j = Math.floor((p.z - layout.oz) / CELL);
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++) {
        const k = `${a},${b}`;
        if (!byCell.has(k)) byCell.set(k, []);
        byCell.get(k).push(p);
      }
  }
  return { layout, byCell, closed: new Set(layout.gates.map((g) => g.id)), gateAt: new Map(layout.gates.map((g) => [g.id, g])) };
}
export function setGate(col, id, open) {
  if (open) col.closed.delete(id);
  else col.closed.add(id);
}

const cellAt = (L, i, j) => (i < 0 || j < 0 || i >= L.w || j >= L.h ? '#' : L.cells[j][i]);
export const isFloor = (L, x, z) => cellAt(L, Math.floor((x - L.ox) / CELL), Math.floor((z - L.oz) / CELL)) !== '#';

// Walkable: on a floor cell, a hero's width away from rock, closed gates and
// solid props.
export function dungeonWalkable(x, z, col) {
  const L = col.layout;
  const fx = (x - L.ox) / CELL;
  const fz = (z - L.oz) / CELL;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (cellAt(L, i, j) === '#') return false;
  const lx = (fx - i) * CELL;
  const lz = (fz - j) * CELL;
  const R = PLAYER_R;
  if ((cellAt(L, i - 1, j) === '#' && lx < R) || (cellAt(L, i + 1, j) === '#' && lx > CELL - R) || (cellAt(L, i, j - 1) === '#' && lz < R) || (cellAt(L, i, j + 1) === '#' && lz > CELL - R)) return false;
  // Inside corners (a corridor meeting a room): keep off the rock cell's corner.
  const corner = (di, dj, ax, az) => cellAt(L, i + di, j + dj) === '#' && Math.hypot(ax, az) < R;
  if (corner(-1, -1, lx, lz) || corner(1, -1, CELL - lx, lz) || corner(-1, 1, lx, CELL - lz) || corner(1, 1, CELL - lx, CELL - lz)) return false;
  // Closed gates act as walls on their edge.
  for (const id of col.closed) {
    const g = col.gateAt.get(id);
    if (g.dir === 'n' || g.dir === 's') {
      if (Math.abs(z - g.z) < R + 0.15 && Math.abs(x - g.x) < CELL / 2 + 0.1) return false;
    } else if (Math.abs(x - g.x) < R + 0.15 && Math.abs(z - g.z) < CELL / 2 + 0.1) return false;
  }
  for (const p of col.byCell.get(`${i},${j}`) ?? []) if ((x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + R) ** 2) return false;
  return true;
}

export const dungeonBounds = (L) => ({ x0: L.ox, z0: L.oz, x1: L.ox + L.w * CELL, z1: L.oz + L.h * CELL });
export const roomAt = (L, x, z) => {
  const i = Math.floor((x - L.ox) / CELL);
  const j = Math.floor((z - L.oz) / CELL);
  return L.rooms.find((r) => i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h) ?? null;
};
// The corridor a point is in (with the two rooms it joins), if any.
export const linkAt = (L, x, z) => {
  const i = Math.floor((x - L.ox) / CELL);
  const j = Math.floor((z - L.oz) / CELL);
  return L.links.find((l) => l.cells.some(([a, b]) => a === i && b === j)) ?? null;
};

// Flood fill over floor from the entry, with every gate open and props in
// place, at the walking test's resolution (1 m).
function allReachable(L) {
  const col = dungeonCol(L);
  col.closed.clear();
  const b = dungeonBounds(L);
  const nx = Math.ceil(b.x1 - b.x0);
  const nz = Math.ceil(b.z1 - b.z0);
  const seen = new Uint8Array(nx * nz);
  const ok = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && dungeonWalkable(b.x0 + i + 0.5, b.z0 + j + 0.5, col);
  const si = Math.floor(L.entry.x - b.x0);
  const sj = Math.floor(L.entry.z - b.z0);
  if (!ok(si, sj)) return false;
  const stack = [[si, sj]];
  seen[sj * nx + si] = 1;
  while (stack.length) {
    const [i, j] = stack.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz || seen[c * nx + a] || !ok(a, c)) continue;
      seen[c * nx + a] = 1;
      stack.push([a, c]);
    }
  }
  const reach = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (seen[Math.floor(z - b.z0 + dz) * nx + Math.floor(x - b.x0 + dx)] === 1) return true;
    return false;
  };
  for (const r of L.rooms) {
    let any = false;
    for (let j = r.y; j < r.y + r.h && !any; j++) for (let i = r.x; i < r.x + r.w && !any; i++) any = reach(L.ox + (i + 0.5) * CELL, L.oz + (j + 0.5) * CELL);
    if (!any) return false;
  }
  for (const s of L.spawns) if (!reach(s.x, s.z)) return false;
  for (const p of L.props) if (p.use && !reach(p.x + 1.6, p.z) && !reach(p.x - 1.6, p.z) && !reach(p.x, p.z + 1.6) && !reach(p.x, p.z - 1.6)) return false;
  return reach(L.bossChest.x, L.bossChest.z) && reach(L.entry.x, L.entry.z);
}
