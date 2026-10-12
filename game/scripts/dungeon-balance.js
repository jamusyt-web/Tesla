// Dungeon balance check: simulates whole runs (every room, the boss, wipes,
// Last Light, the shrine, potions and revives) with the real numbers from
// shared/, for heroes of different levels, gear and party sizes.
//   node scripts/dungeon-balance.js        (N=500 for steadier numbers)
import { generateDungeon, scaledDef, ROOM_HEAL, KO_HP, MAX_WIPES } from '../shared/dungeon.js';
import { MONSTERS, heroStats, damage } from '../shared/monsters.js';
import { ITEMS } from '../shared/items.js';

function sim({ n, level, gear, tier = 1, potions = 3, seed }) {
  const L = generateDungeon(seed, { party: n, tier });
  const st = heroStats(level, level, gear.map((g) => ITEMS[g]));
  const heroes = Array.from({ length: n }, () => ({ ...st, max: st.hp, charge: 0, pots: potions, alive: true, ll: false }));
  let wipes = 0, rounds = 0, shrine = false;
  const rooms = [...new Set(L.spawns.map((s) => s.room))].sort((a, b) => L.rooms[a].depth - L.rooms[b].depth || (L.rooms[a].kind === 'boss') - (L.rooms[b].kind === 'boss'));
  for (const room of rooms) {
    // Main path only, plus side halls (players clear most).
    let pack = L.spawns.filter((s) => s.room === room);
    for (;;) {
      // Before a fight: heal up with Last Light / shrine if low.
      for (const h of heroes) if (h.hp < h.max * 0.5 && !h.ll) { h.hp = h.max; h.ll = true; }
      if (!shrine && heroes.some((h) => h.hp < h.max * 0.5) && L.rooms[room].depth >= 4) { shrine = true; for (const h of heroes) h.hp = h.max; }
      let i = 0;
      let lost = false;
      while (i < pack.length) {
        const s = pack[i];
        const def = scaledDef(MONSTERS[s.monster], n, { elite: s.elite, affixes: s.affixes ?? [], tier });
        let hp = def.hp, round = 1, pending = null;
        while (hp > 0) {
          rounds++;
          const warn = pending;
          for (const h of heroes.filter((x) => x.alive)) {
            h.defending = false;
            if (warn) { h.defending = true; h.charge = Math.min(3, h.charge + 1); continue; }
            const down = heroes.find((x) => !x.alive);
            if (down && h.pots > 0 && h.hp > h.max * 0.4) { h.pots--; down.alive = true; down.hp = Math.max(Math.round(down.max * 0.25), 60); continue; }
            if (h.hp < h.max * 0.35 && h.pots > 0) { h.pots--; h.hp = Math.min(h.max, h.hp + 60); continue; }
            const skill = h.charge >= 3;
            let d = damage(h.atk, def.def, skill ? 2.4 : 1);
            if (Math.random() < 0.12) d = Math.round(d * 1.6);
            hp -= d; h.charge = skill ? 0 : h.charge + 1;
            if (def.thorns && hp > 0) { h.hp -= Math.max(1, Math.round(d * def.thorns)); if (h.hp <= 0) h.alive = false; }
            if (hp <= 0) break;
          }
          if (hp <= 0) break;
          let actions = heroes.filter((h) => h.alive).length;
          if (def.frenzy && hp < def.hp / 2) actions++;
          const hitR = new Set();
          for (let a = 0; a < actions; a++) {
            const alive0 = heroes.filter((h) => h.alive);
            const fresh = alive0.filter((h) => !hitR.has(h));
            const alive = fresh.length ? fresh : alive0;
            if (!alive.length) break;
            let move = a === 0 && pending ? pending : null;
            if (move) pending = null;
            else { const pool = a > 0 ? def.moves.filter((m) => !m.aoe) : def.moves; move = pool[Math.floor(Math.random() * pool.length)]; }
            const targets = move.aoe ? alive0 : [alive[Math.floor(Math.random() * alive.length)]];
            for (const t of targets) hitR.add(t);
            let dealt = 0;
            for (const t of targets) {
              let d = damage(def.atk, t.def, move.mult * (move.aoe && !move.full ? 0.7 : 1));
              if (t.defending) d = Math.max(1, Math.round(d * 0.35));
              t.hp -= d; dealt += d;
              if (t.hp <= 0) t.alive = false;
            }
            const dr = move.drain ?? def.drain ?? 0;
            if (dr) hp = Math.min(def.hp, hp + Math.round(dealt * dr));
            if (move.aoe) break;
          }
          round++;
          const tg = def.telegraph;
          if (tg && round >= tg.start && (round - tg.start) % tg.every === 0) pending = tg.move;
          if (!heroes.some((h) => h.alive)) break;
        }
        if (!heroes.some((h) => h.alive)) { lost = true; break; }
        i++;
      }
      if (!lost) {
        for (const h of heroes) { if (!h.alive) { h.alive = true; h.hp = Math.round(h.max * KO_HP); } h.hp = Math.min(h.max, h.hp + h.max * ROOM_HEAL); }
        break;
      }
      wipes++;
      if (wipes > MAX_WIPES) return { ok: false, wipes, rounds };
      pack = pack.slice(i); // the fallen stay dead
      for (const h of heroes) { h.alive = true; h.hp = Math.round(h.max * KO_HP); }
    }
  }
  return { ok: true, wipes, rounds };
}
const cases = [
  ['solo L3 wood', { n: 1, level: 3, gear: ['sword_wood'] }],
  ['solo L5 copper', { n: 1, level: 5, gear: ['sword_copper'] }],
  ['solo L5 copper+leather', { n: 1, level: 5, gear: ['sword_copper', 'armor_leather'] }],
  ['solo L7 iron', { n: 1, level: 7, gear: ['sword_iron', 'armor_leather'] }],
  ['duo L5 copper+leather', { n: 2, level: 5, gear: ['sword_copper', 'armor_leather'] }],
  ['three L5 copper+leather', { n: 3, level: 5, gear: ['sword_copper', 'armor_leather'] }],
  ['four L5 copper+leather', { n: 4, level: 5, gear: ['sword_copper', 'armor_leather'] }],
  ['four L6 copper+leather', { n: 4, level: 6, gear: ['sword_copper', 'armor_leather'] }],
  ['four L7 iron', { n: 4, level: 7, gear: ['sword_iron', 'armor_leather'] }],
  ['T2 solo L8 iron+plate', { n: 1, level: 8, gear: ['sword_iron', 'armor_iron'], tier: 2 }],
  ['T2 duo L8 iron+plate', { n: 2, level: 8, gear: ['sword_iron', 'armor_iron'], tier: 2 }],
  ['T2 four L8 iron+plate', { n: 4, level: 8, gear: ['sword_iron', 'armor_iron'], tier: 2 }],
  ['T3 solo L12 gold', { n: 1, level: 12, gear: ['sword_gold', 'armor_iron', 'amulet_sapphire'], tier: 3 }],
  ['T3 four L12 gold', { n: 4, level: 12, gear: ['sword_gold', 'armor_iron', 'amulet_sapphire'], tier: 3 }],
];
for (const [name, c] of cases) {
  let ok = 0, w = 0, r = 0; const N = +(process.env.N || 200);
  for (let s = 1; s <= N; s++) { const x = sim({ ...c, seed: s }); ok += x.ok; w += x.wipes; r += x.rounds; }
  console.log(name.padEnd(26), 'clear', ((ok / N) * 100).toFixed(0).padStart(3) + '%', ' wipes/run', (w / N).toFixed(2), ' rounds', (r / N).toFixed(0));
}
