// Loads the world map before anything else on the server uses it.
//
// The game ships with maps/world.json. A map saved on this machine (later, by
// the in-game editor) lives in <DATA_DIR>/maps/world.json, next to the saves,
// so it survives updating the game. Whichever of the two has the higher `rev`
// wins: an update that ships a newer map replaces an older local one.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setWorld, mapProblems, formatMap, upgradeMap } from '../shared/world.js';
import { MONSTERS } from '../shared/monsters.js';
import { DUNGEONS } from '../shared/dungeon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHIPPED_MAP = path.join(ROOT, 'maps', 'world.json');
export const LOCAL_MAP = path.join(process.env.DATA_DIR || path.resolve('data'), 'maps', 'world.json');

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`Can't read the map ${file}: ${e.message}`);
  }
}

// Map problems the shared check can't see (it doesn't know the monster list).
export function serverMapProblems(m) {
  m = upgradeMap(m);
  const out = mapProblems(m);
  for (const e of m?.entrances ?? []) if (!DUNGEONS[e.kind]) out.push(`entrances (${e.id}): unknown dungeon "${e.kind}".`);
  for (const s of m?.spawns ?? []) {
    if (!MONSTERS[s.monster]) out.push(`spawns (${s.id}): unknown monster "${s.monster}".`);
    if (!(s.r > 0) || !(s.count >= 0)) out.push(`spawns (${s.id}) needs r > 0 and a count.`);
  }
  return out;
}

// The map currently in use, plus what /api/map serves to clients.
export const current = { file: null, map: null, body: null, gzip: null, etag: null };

export function useMap(map, file = null) {
  map = upgradeMap(map);
  const bad = serverMapProblems(map);
  if (bad.length) throw new Error(`Invalid map${file ? ` (${file})` : ''}:\n- ${bad.join('\n- ')}`);
  setWorld(map);
  const body = JSON.stringify(map);
  Object.assign(current, { file, map, body, gzip: zlib.gzipSync(body), etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` });
  return map;
}

// Save an edited map as this server's own copy and start using it. The
// previous copy is kept in data/maps/backups (the newest 30 are kept).
// `base` is the ETag the editor started from: if the map changed meanwhile
// (another owner saved), refuse rather than silently overwrite their work.
export function saveMap(map, base) {
  if (base && base !== current.etag) {
    const e = new Error('The world was changed by someone else since you opened the editor. Reload the editor to get their changes (export yours first if you want to keep them).');
    e.conflict = true;
    throw e;
  }
  const shippedRev = read(SHIPPED_MAP)?.rev ?? 0;
  const next = { ...upgradeMap(map), rev: Math.max(current.map?.rev ?? 0, shippedRev) + 1 };
  const bad = serverMapProblems(next);
  if (bad.length) {
    const e = new Error(`The map has problems:\n- ${bad.join('\n- ')}`);
    e.problems = bad;
    throw e;
  }
  const dir = path.dirname(LOCAL_MAP);
  const backups = path.join(dir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  if (fs.existsSync(LOCAL_MAP)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(LOCAL_MAP, path.join(backups, `world-rev${current.map?.rev ?? 0}-${stamp}.json`));
    const old = fs.readdirSync(backups).filter((f) => f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.rmSync(path.join(backups, f));
  }
  const tmp = `${LOCAL_MAP}.tmp`;
  fs.writeFileSync(tmp, formatMap(next));
  fs.renameSync(tmp, LOCAL_MAP);
  return useMap(next, LOCAL_MAP);
}

export function loadMap() {
  const shipped = read(SHIPPED_MAP);
  const local = read(LOCAL_MAP);
  if (!shipped && !local) throw new Error(`No world map found (looked for ${SHIPPED_MAP}).`);
  const useLocal = local && (!shipped || (local.rev ?? 0) >= (shipped.rev ?? 0));
  return useMap(useLocal ? local : shipped, useLocal ? LOCAL_MAP : SHIPPED_MAP);
}

loadMap();
