// Amberfold's goods (SPEC §4.5, tier 2): maple, coal and hearthcap from the
// Amberwood, venison and honey from its creatures, the Mill Pond's fish,
// steel, smokehouse food, and the Thornroot set from the Warren.
// Values follow the ladder: raw goods ×1.35–1.4 a town, bars and planks
// their inputs + 10%, gear and tools ×1.8 a tier. Gear needs Combat 12.
const T = 'amberfold';
const skin = (handle, head, edge, glow = null) => ({ handle, head, edge, glow });
const STEEL = skin('#4a3322', '#8f9aa8', '#dfe6ee', null);
const REQ = { combat: 12 };

export default {
  // ── Gathered ───────────────────────────────────────────
  maple_log: { name: 'Maple Log', icon: '🪵', cat: 'resource', tag: 'wood', value: 26, rarity: 'common' },
  coal: { name: 'Coal', icon: '⚫', cat: 'resource', tag: 'ore', value: 22, rarity: 'common', text: 'Burns hot and slow. Every smith past Hearthvale needs it.' },
  hearthcap: { name: 'Hearthcap', icon: '🍄', cat: 'resource', tag: 'herb', value: 30, rarity: 'uncommon' },
  amber_sap: { name: 'Amber Sap', icon: '🍯', cat: 'resource', tag: 'gem', value: 160, rarity: 'rare', text: 'A bead of maple sap gone hard and golden.' },
  // ── From Amberfold's creatures ─────────────────────────
  venison: { name: 'Venison', icon: '🍖', cat: 'resource', tag: 'monster', value: 28, rarity: 'common' },
  antler: { name: 'Antler', icon: '🦌', cat: 'resource', tag: 'monster', value: 60, rarity: 'uncommon' },
  honeycomb: { name: 'Honeycomb', icon: '🍯', cat: 'resource', tag: 'monster', value: 40, rarity: 'uncommon' },
  elder_antler: { name: 'Elder Antler', icon: '🦌', cat: 'resource', tag: 'monster', value: 180, rarity: 'rare', text: 'Shed by the Antlered Elder. Still warm.' },
  bandit_map: { name: "Bandit's Map", icon: '🗺️', cat: 'consumable', tag: 'monster', value: 50, rarity: 'rare', reveal: 'glimmer', text: 'Scrawled by a hedge bandit. Read it to learn where this week’s glimmering caches are.' },
  heartwood_sap: { name: 'Heartwood Sap', icon: '🫙', cat: 'resource', tag: 'reagent', value: 45, rarity: 'uncommon', text: 'From the roots of the Thornroot Warren. Smiths make the Thornroot set from it.' },
  // ── The Mill Pond ───────────────────────────────────────
  rivercarp: { name: 'Rivercarp', icon: '🐟', cat: 'resource', tag: 'fish', value: 30, rarity: 'common' },
  amber_trout: { name: 'Amber Trout', icon: '🐠', cat: 'resource', tag: 'fish', value: 40, rarity: 'common' },
  leaf_eel: { name: 'Leaf Eel', icon: '🐍', cat: 'resource', tag: 'fish', value: 55, rarity: 'uncommon' },
  legend_millcarp: { name: 'Grandfather Carp', icon: '🐋', cat: 'resource', tag: 'fish', value: 900, rarity: 'legendary', text: 'Older than the mill. Rises from the deep pond only while the leaves are falling.' },
  // ── Materials ──────────────────────────────────────────
  maple_plank: { name: 'Maple Plank', icon: '🟧', cat: 'material', tag: 'plank', value: 58, rarity: 'common' },
  steel_bar: { name: 'Steel Bar', icon: '🔩', cat: 'material', tag: 'bar', value: 125, rarity: 'uncommon' },
  // ── Food (the Smokehouse) ──────────────────────────────
  carp_chowder: { name: 'Carp Chowder', icon: '🍲', cat: 'consumable', tag: 'food', value: 45, rarity: 'common', heal: 90 },
  maple_glazed_carp: { name: 'Maple-glazed Carp', icon: '🍢', cat: 'consumable', tag: 'food', value: 70, rarity: 'uncommon', heal: 60, buff: { slot: 'meal', fx: { gatherXp: 0.1 }, uses: { per: 'gather', n: 60 } } },
  hearthcap_pie: { name: 'Hearthcap Pie', icon: '🥧', cat: 'consumable', tag: 'food', value: 75, rarity: 'uncommon', heal: 60, buff: { slot: 'meal', fx: { tonicDef: 0.1 }, uses: { per: 'battle', n: 5 } } },
  venison_skewer: { name: 'Venison Skewer', icon: '🍡', cat: 'consumable', tag: 'food', value: 80, rarity: 'uncommon', heal: 60, buff: { slot: 'meal', fx: { tonicAtk: 0.08 }, uses: { per: 'battle', n: 5 } } },
  // ── Tools ──────────────────────────────────────────────
  axe_steel: { name: 'Steel Axe', icon: '🪓', cat: 'tool', tag: 'tool', tool: 'axe', tier: 5, power: 6, speed: 495, value: 1100, rarity: 'epic', skin: STEEL },
  pick_steel: { name: 'Steel Pickaxe', icon: '⛏️', cat: 'tool', tag: 'tool', tool: 'pick', tier: 5, power: 6, speed: 515, value: 1100, rarity: 'epic', skin: STEEL },
  rod_amber: { name: 'Amberline Rod', icon: '🎣', cat: 'tool', tag: 'tool', tool: 'rod', tier: 4, power: 4, value: 1000, rarity: 'epic', skin: skin('#8a4f22', '#d9a441', '#fff1c4', '#ffb340') },
  climbing_rope: { name: 'Climbing Rope', icon: '🪢', cat: 'tool', tag: 'kit', kit: 'rope', value: 400, rarity: 'rare', text: 'A passage kit: climb where a rope helps (the Eyrie). Never used up.' },
  // ── Gear (Combat 12) ───────────────────────────────────
  steel_saber: { name: 'Steel Saber', icon: '⚔️', cat: 'gear', tag: 'gear', slot: 'weapon', atk: 36, req: REQ, value: 1250, rarity: 'epic', skin: STEEL },
  steel_brigandine: { name: 'Steel Brigandine', icon: '🛡️', cat: 'gear', tag: 'gear', slot: 'armor', def: 16, hp: 20, req: REQ, value: 1150, rarity: 'epic' },
  amber_pendant: { name: 'Amber Pendant', icon: '📿', cat: 'gear', tag: 'gear', slot: 'trinket', atk: 7, def: 6, hp: 60, req: REQ, value: 1000, rarity: 'epic' },
  // The Thornroot set (the Warren's Heartwood Sap): 2 pieces reflect damage, 3 add forest xp.
  thornwood_blade: { name: 'Thornwood Blade', icon: '🗡️', cat: 'gear', tag: 'gear', slot: 'weapon', atk: 33, req: REQ, value: 1100, rarity: 'epic', set: 'thornroot', skin: skin('#3d2a1a', '#7a9a4a', '#cfe39a', '#9fd36a') },
  thornroot_jerkin: { name: 'Thornroot Jerkin', icon: '🦺', cat: 'gear', tag: 'gear', slot: 'armor', def: 15, hp: 20, req: REQ, value: 1050, rarity: 'epic', set: 'thornroot' },
  heartwood_amulet: { name: 'Heartwood Amulet', icon: '🧿', cat: 'gear', tag: 'gear', slot: 'trinket', atk: 6, def: 6, hp: 55, req: REQ, value: 950, rarity: 'epic', set: 'thornroot' },
  // Charms: an effect, not stats.
  charm_forager_1: { name: "Forager's Charm I", icon: '🍁', cat: 'gear', tag: 'charm', slot: 'charm', value: 800, rarity: 'rare', fx: { treePower: 1, doubleLog: 0.05 } },
  charm_forager_2: { name: "Forager's Charm II", icon: '🍁', cat: 'gear', tag: 'charm', slot: 'charm', value: 3200, rarity: 'epic', fx: { treePower: 2, doubleLog: 0.1 } },
  // ── Keepsakes ──────────────────────────────────────────
  trophy_amberfold: { name: 'Amberfold Trophy', icon: '🏆', cat: 'special', tag: 'trophy', value: 0, rarity: 'rare', bound: true },
  lost_scythe: { name: "Miller Hodge's Scythe", icon: '🌾', cat: 'special', tag: 'curio', value: 0, rarity: 'uncommon', bound: true, town: T, text: 'Left in the long grass after the harvest. Hand it in at the Amberfold Town Hall.' },
};
