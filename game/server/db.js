import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');

export function openDb(file = process.env.DB_FILE || path.join(DATA_DIR, 'hearthvale.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
  `);
  db.exec(SCHEMA_V0);
  migrate(db);
  return db;
}

// The original schema. Never edit it: change the database with a new entry
// in MIGRATIONS instead, so existing saves upgrade in place.
export const SCHEMA_V0 = `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      invited_by INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      created_by INTEGER,
      used_by INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS heroes (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      avatar TEXT NOT NULL,
      gold INTEGER NOT NULL DEFAULT 0,
      skills TEXT NOT NULL DEFAULT '{}',
      equip TEXT NOT NULL DEFAULT '{}',
      tutorial INTEGER NOT NULL DEFAULT 0,
      x REAL, z REAL,
      shop_name TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      item TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty >= 0),
      PRIMARY KEY (account_id, item)
    );
    CREATE TABLE IF NOT EXISTS market_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      side TEXT NOT NULL CHECK (side IN ('buy','sell')),
      item TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price > 0),
      qty INTEGER NOT NULL CHECK (qty > 0),
      filled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_book ON market_orders(item, side, status, price);
    CREATE INDEX IF NOT EXISTS idx_orders_owner ON market_orders(account_id, status);
    CREATE TABLE IF NOT EXISTS market_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      buyer INTEGER NOT NULL,
      seller INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_item ON market_trades(item, ts);
    CREATE TABLE IF NOT EXISTS shop_slots (
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      slot INTEGER NOT NULL,
      item TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      price INTEGER NOT NULL CHECK (price > 0),
      PRIMARY KEY (account_id, slot)
    );
    CREATE TABLE IF NOT EXISTS shop_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      item TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,
      buyer TEXT NOT NULL,
      ts INTEGER NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_shoplog ON shop_log(account_id, seen);
`;

// Each migration runs once, in order, inside a transaction; PRAGMA
// user_version records how far a database has got.
const MIGRATIONS = [
  // 1: walk-in shops with passive selling (till, open/closed, NPC demand pools, fees).
  (db, now) => {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE shops (
        account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
        name TEXT,
        open INTEGER NOT NULL DEFAULT 1,
        till INTEGER NOT NULL DEFAULT 0 CHECK (till >= 0),
        seen_upto INTEGER NOT NULL DEFAULT 0,
        sales INTEGER NOT NULL DEFAULT 0,
        earned INTEGER NOT NULL DEFAULT 0,
        last_sale_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE npc_demand (item TEXT PRIMARY KEY, fill REAL NOT NULL, at INTEGER NOT NULL);
      ALTER TABLE heroes ADD COLUMN last_active INTEGER;
      ALTER TABLE heroes ADD COLUMN fee_milli INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shop_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'npc';
      ALTER TABLE shop_log ADD COLUMN buyer_id INTEGER;
      ALTER TABLE shop_log ADD COLUMN fee INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shop_log ADD COLUMN slot INTEGER;
      CREATE INDEX idx_shoplog_owner ON shop_log(account_id, id);
    `);
    // Old sales were already paid out, so all existing history counts as seen.
    db.prepare(
      `INSERT INTO shops (account_id, name, seen_upto, created_at)
       SELECT h.account_id, h.shop_name, COALESCE((SELECT MAX(id) FROM shop_log l WHERE l.account_id = h.account_id), 0), ? FROM heroes h`,
    ).run(now);
    db.prepare('UPDATE heroes SET last_active = ?').run(now);
    db.prepare("INSERT INTO meta (key, value) VALUES ('shop_sim_at', ?)").run(String(now));
  },
  // 2: hands-on crafting (materials held in escrow during a craft, results log, mastery).
  (db) => {
    db.exec(`
      CREATE TABLE craft_sessions (
        account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
        sid TEXT NOT NULL,
        recipe TEXT NOT NULL,
        batch INTEGER NOT NULL CHECK (batch > 0),
        station TEXT NOT NULL,
        spec TEXT NOT NULL,
        escrow TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE craft_mastery (
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        recipe TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        best INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, recipe)
      );
      CREATE TABLE craft_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        sid TEXT NOT NULL,
        recipe TEXT NOT NULL,
        batch INTEGER NOT NULL,
        score INTEGER NOT NULL,
        grade TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        via TEXT NOT NULL,
        result TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_craftlog_sid ON craft_log(account_id, sid);
      CREATE INDEX idx_craftlog_ts ON craft_log(ts);
    `);
  },
];

export function migrate(db) {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRATIONS.length; v++)
    tx(db, () => {
      MIGRATIONS[v](db, Date.now());
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
}

// Run fn inside a transaction; rolls back on throw. node:sqlite is synchronous
// and the server is single-threaded, so this is fully atomic.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Errors meant for the player (shown as a toast), as opposed to bugs.
export class GameError extends Error {}
export const fail = (msg) => {
  throw new GameError(msg);
};
