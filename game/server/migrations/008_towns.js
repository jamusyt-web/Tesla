// Every town its own economy (SPEC §6.1, §7.1): market books, NPC demand and
// merchant pools per town; each hero's storage in each town; the supplier
// stalls' daily stock; and the town a shop or a job belongs to. Everything
// that exists already becomes Hearthvale's.
export default (db) => {
  db.exec(`
    ALTER TABLE market_orders ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
    ALTER TABLE market_trades ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
    CREATE INDEX idx_orders_town_book ON market_orders(town, item, side, status, price);
    CREATE INDEX idx_trades_town_item ON market_trades(town, item, ts);
    CREATE TABLE town_demand (town TEXT NOT NULL, item TEXT NOT NULL, fill REAL NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (town, item));
    INSERT INTO town_demand SELECT 'hearthvale', item, fill, at FROM npc_demand;
    CREATE TABLE merchant_pool (town TEXT NOT NULL, item TEXT NOT NULL, floor_left REAL NOT NULL, prem_fill REAL NOT NULL,
      at INTEGER NOT NULL, PRIMARY KEY (town, item));
    CREATE TABLE town_storage (account_id INTEGER NOT NULL REFERENCES accounts(id), town TEXT NOT NULL, item TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty >= 0), PRIMARY KEY (account_id, town, item));
    CREATE TABLE town_supply (town TEXT NOT NULL, item TEXT NOT NULL, day INTEGER NOT NULL, sold INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (town, item));
    ALTER TABLE shops ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
    ALTER TABLE jobs ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
  `);
};
