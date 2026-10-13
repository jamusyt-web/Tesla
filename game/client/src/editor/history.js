// The editor's memory: edits stored as diffs (only the entries that changed,
// so a long undo history stays small even on a big map), and unsaved drafts
// kept in IndexedDB (localStorage's 5 MB fills up at about a 2.5 MB map).

// A snapshot to diff against: each list entry as JSON by id, plus the rest.
export function snap(map) {
  const lists = {};
  const top = {};
  for (const [k, v] of Object.entries(map)) {
    if (Array.isArray(v) && v.every((e) => e && typeof e === 'object' && 'id' in e)) lists[k] = new Map(v.map((e, i) => [e.id, [i, JSON.stringify(e)]]));
    else top[k] = JSON.stringify(v);
  }
  return { lists, top };
}

// What changed since the snapshot: [{ list, id, i, before, after }] (JSON
// strings; null for added/removed) and { key: [before, after] } for the rest.
export function diff(s, map) {
  const changes = [];
  const top = {};
  const now = snap(map);
  for (const k of new Set([...Object.keys(s.lists), ...Object.keys(now.lists)])) {
    const a = s.lists[k] ?? new Map();
    const b = now.lists[k] ?? new Map();
    for (const [id, [i, j]] of a) if (b.get(id)?.[1] !== j) changes.push({ list: k, id, i, before: j, after: b.get(id)?.[1] ?? null, at: b.get(id)?.[0] ?? null });
    for (const [id, [i, j]] of b) if (!a.has(id)) changes.push({ list: k, id, i: null, at: i, before: null, after: j });
  }
  for (const k of new Set([...Object.keys(s.top), ...Object.keys(now.top)])) if (s.top[k] !== now.top[k] && !(k in now.lists) && !(k in s.lists)) top[k] = [s.top[k] ?? null, now.top[k] ?? null];
  return changes.length || Object.keys(top).length ? { changes, top } : null;
}

// Put a diff's `before` (undo) or `after` (redo) side back into the map.
export function apply(map, d, side) {
  const list = (k) => (map[k] ??= []);
  const order = side === 'before' ? [...d.changes].reverse() : d.changes;
  for (const c of order) {
    const L = list(c.list);
    const idx = L.findIndex((e) => e.id === c.id);
    const want = c[side];
    if (want == null) {
      if (idx >= 0) L.splice(idx, 1);
    } else if (idx >= 0) L[idx] = JSON.parse(want);
    else {
      const at = side === 'before' ? c.i : c.at;
      L.splice(Math.min(at ?? L.length, L.length), 0, JSON.parse(want));
    }
  }
  for (const [k, [before, after]] of Object.entries(d.top)) {
    const v = side === 'before' ? before : after;
    if (v == null) delete map[k];
    else map[k] = JSON.parse(v);
  }
}

// The points a diff touched, for rebuilding only those chunks: [{ x, z, r }].
export function touched(d) {
  const out = [];
  for (const c of d.changes)
    for (const j of [c.before, c.after]) {
      if (!j) continue;
      const e = JSON.parse(j);
      if (Number.isFinite(e.x)) out.push({ x: e.x, z: e.z, r: Math.max(e.r ?? 0, (e.w ?? 0) / 2, (e.d ?? 0) / 2, (e.scale ?? 0) * 4) + 4 });
      if (Number.isFinite(e.tx)) out.push({ x: e.tx, z: e.tz, r: 4 });
    }
  return out;
}

// ── Drafts in IndexedDB (falls back to localStorage) ──
const DB = 'hv_editor';
const STORE = 'drafts';
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}
export async function saveDraft(key, value) {
  try {
    await tx('readwrite', (s) => s.put(value, key));
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
}
export async function loadDraft(key) {
  try {
    const v = await tx('readonly', (s) => s.get(key));
    if (v) return v;
  } catch {}
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
export async function dropDraft(key) {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {}
  try {
    localStorage.removeItem(key);
  } catch {}
}
