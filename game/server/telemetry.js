// The economy's books (SPEC §6.5): every gold amount that enters or leaves
// the game, labelled with why, and item flows (gathered, crafted, sold to the
// merchant…), summed per day. Written in the same transaction as the change
// they record, so a rolled-back trade leaves no trace here either.
//
// Phase 0 stub with the final signatures; Phase 1 (P8) writes the rows.

// amount > 0 is gold created (or paid out), < 0 gold removed; reason is a
// short label such as 'loot', 'npcSell', 'tax', 'travel'.
export function goldFlow(db, reason, amount, town = 'hearthvale') {}

// kind: 'gather', 'craft', 'fish', 'loot', 'npcSell', 'used'…
export function itemFlow(db, item, kind, qty) {}
