// The economy's books and the phones' performance reports (SPEC §6.5, §9.4).
export default (db) => {
  db.exec(`
    CREATE TABLE gold_flow (day INTEGER NOT NULL, town TEXT NOT NULL, reason TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
      n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, town, reason));
    CREATE TABLE item_flow (day INTEGER NOT NULL, item TEXT NOT NULL, kind TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, item, kind));
    CREATE TABLE perf_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL, device TEXT NOT NULL, region TEXT NOT NULL,
      fps_p50 REAL, fps_p5 REAL, draws_p95 INTEGER, tris_p95 INTEGER, load_ms INTEGER, at INTEGER NOT NULL);
    CREATE INDEX idx_perf_day ON perf_samples(day, device, region);
  `);
};
