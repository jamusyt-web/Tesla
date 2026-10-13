// Town orders, the Big Order and reputation (SPEC §5.4): each hero's order
// slots per town, each town's shared Big Order per day and who gave to it,
// and reputation points per town.
export default (db) => {
  db.exec(`
    CREATE TABLE order_slots (account_id INTEGER NOT NULL, town TEXT NOT NULL, slot INTEGER NOT NULL, order_key TEXT NOT NULL,
      day INTEGER NOT NULL, got INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'open',
      PRIMARY KEY (account_id, town, slot));
    CREATE TABLE big_orders (town TEXT NOT NULL, day INTEGER NOT NULL, item TEXT NOT NULL, need INTEGER NOT NULL,
      got INTEGER NOT NULL DEFAULT 0, done_at INTEGER, PRIMARY KEY (town, day));
    CREATE TABLE big_order_shares (town TEXT NOT NULL, day INTEGER NOT NULL, account_id INTEGER NOT NULL,
      qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (town, day, account_id));
    CREATE TABLE town_rep (account_id INTEGER NOT NULL, town TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (account_id, town));
  `);
};
