// Engagement telemetry (SPEC §5.8): per hero per day, time played, sessions,
// dead air (in the world with nothing happening) and Compass goals shown,
// taken and done; and per Compass source per day.
export default (db) => {
  db.exec(`
    CREATE TABLE engage_day (day INTEGER NOT NULL, account_id INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 0,
      sessions INTEGER NOT NULL DEFAULT 0, dead_air_s INTEGER NOT NULL DEFAULT 0, goals_shown INTEGER NOT NULL DEFAULT 0,
      goals_taken INTEGER NOT NULL DEFAULT 0, goals_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, account_id));
    CREATE TABLE goal_log (day INTEGER NOT NULL, src TEXT NOT NULL, shown INTEGER NOT NULL DEFAULT 0,
      taken INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src));
  `);
};
