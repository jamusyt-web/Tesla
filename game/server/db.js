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
  `);
  return db;
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
