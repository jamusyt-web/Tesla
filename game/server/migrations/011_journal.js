// The journal and exploring (SPEC §5.5): what each hero has found (places,
// creatures, fish records, recipes, titles…), the 16 m cells they've walked,
// landmark uses with their resets, and page rewards claimed. Recipes made
// so far count as found.
export default (db) => {
  db.exec(`
    CREATE TABLE journal (account_id INTEGER NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, id TEXT NOT NULL,
      first_at INTEGER NOT NULL, best REAL, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (account_id, kind, id));
    CREATE TABLE explore (account_id INTEGER PRIMARY KEY REFERENCES accounts(id), bits BLOB NOT NULL, w INTEGER NOT NULL,
      h INTEGER NOT NULL, x0 REAL NOT NULL, z0 REAL NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE landmark_uses (account_id INTEGER NOT NULL, landmark TEXT NOT NULL, period INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (account_id, landmark));
    CREATE TABLE journal_claims (account_id INTEGER NOT NULL, page TEXT NOT NULL, pct INTEGER NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY (account_id, page, pct));
    INSERT OR IGNORE INTO journal (account_id, kind, id, first_at, best, n)
      SELECT account_id, 'recipe', recipe, 0, best, n FROM craft_mastery;
  `);
};
