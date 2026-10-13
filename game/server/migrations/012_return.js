// Coming back (SPEC §5.6): things that happened while you were away (a job
// delivered, an order expired, a market fill…), kept until you've seen them.
export default (db) => {
  db.exec(`
    CREATE TABLE notices (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, kind TEXT NOT NULL,
      data TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX idx_notices ON notices(account_id, seen, id);
  `);
};
