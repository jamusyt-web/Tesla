// What a hero carries between towns (SPEC §7.1): their home town (where a
// Hearth Charm takes them), buffs, level-40 perks, respecs, rested time and
// a title.
export default (db) => {
  db.exec(`
    ALTER TABLE heroes ADD COLUMN home TEXT NOT NULL DEFAULT 'hearthvale';
    ALTER TABLE heroes ADD COLUMN buffs TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE heroes ADD COLUMN perks TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE heroes ADD COLUMN respecs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE heroes ADD COLUMN rested INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE heroes ADD COLUMN title TEXT;
  `);
};
