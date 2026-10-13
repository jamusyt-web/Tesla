// Quests (SPEC §5.2, §7.1): each hero's progress through every quest, by
// period (0 for one-off quests, the day for dailies, the week for weeklies).
// Today's four-step tutorial becomes the first four steps of hv_intro, so a
// hero who finished it carries on at step 5. (heroes.tutorial is kept.)
export default (db) => {
  db.exec(`
    CREATE TABLE quest_progress (account_id INTEGER NOT NULL REFERENCES accounts(id), quest TEXT NOT NULL,
      period INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'active', started_at INTEGER NOT NULL, done_at INTEGER,
      PRIMARY KEY (account_id, quest, period));
    CREATE INDEX idx_quest_active ON quest_progress(account_id, state);
    INSERT INTO quest_progress (account_id, quest, period, step, n, state, started_at)
      SELECT account_id, 'hv_intro', 0, MIN(tutorial, 4), 0, 'active', created_at FROM heroes;
    CREATE TABLE almanac_meta (account_id INTEGER PRIMARY KEY, rerolled_day INTEGER NOT NULL DEFAULT -1, pins TEXT NOT NULL DEFAULT '[]');
  `);
};
