// Database changes after the first six (those stay in db.js, counted by
// PRAGMA user_version). Each is a file here named NNN_name.js that does
// `export default (db, now) => { ... }`. They run in number order, once each,
// every one in its own transaction, and schema_migrations remembers which
// have run. Numbers are handed out in advance (SPEC §7.1), so changes made
// side by side never collide.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FILE_RE = /^(\d{3})_[a-z0-9_]+\.js$/;

async function load(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => FILE_RE.test(f))
    .sort();
  const out = [];
  for (const f of files) {
    const fn = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    if (typeof fn !== 'function') throw new Error(`Migration ${f} must export a default function (db, now).`);
    out.push({ id: f.replace(/\.js$/, ''), fn });
  }
  return out;
}

export const MIGRATIONS = await load(DIR);

// Apply every migration not yet recorded. With none to apply this touches
// nothing at all (not even schema_migrations).
export function applyMigrations(db, list = MIGRATIONS, now = Date.now()) {
  if (!list.length) return [];
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const ran = [];
  for (const m of list) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.fn(db, now);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} failed: ${e.message}`);
    }
    ran.push(m.id);
  }
  return ran;
}
