// Item catalog shared by server (rules) and client (display).
// value = base NPC value in gold. Market prices float freely around it.
import { CONTENT, mergeInto } from './content/index.js';

export const RARITY = {
  common: { label: 'Common', color: '#8a8f98' },
  uncommon: { label: 'Uncommon', color: '#3fae5a' },
  rare: { label: 'Rare', color: '#3b82f6' },
  epic: { label: 'Epic', color: '#a855f7' },
  legendary: { label: 'Legendary', color: '#f59e0b' },
};

export const CATEGORIES = {
  resource: 'Resources',
  material: 'Materials',
  consumable: 'Consumables',
  tool: 'Tools',
  gear: 'Gear',
};

// Tool skins drive the 3D model: head shape + colors. New skins (cosmetics)
// only need a new entry here — the model builder reads these fields.
const toolSkin = (handle, head, edge, glow = null) => ({ handle, head, edge, glow });

export const ITEMS = {
  // ── Foraging ────────────────────────────────────────────
  oak_log: { name: 'Oak Log', icon: '🪵', cat: 'resource', value: 4, rarity: 'common' },
  birch_log: { name: 'Birch Log', icon: '🪵', cat: 'resource', value: 9, rarity: 'common' },
  pine_log: { name: 'Ancient Pine Log', icon: '🪵', cat: 'resource', value: 18, rarity: 'uncommon' },
  golden_acorn: { name: 'Golden Acorn', icon: '🌰', cat: 'resource', value: 120, rarity: 'rare' },
  // ── Mining ──────────────────────────────────────────────
  stone: { name: 'Stone', icon: '🪨', cat: 'resource', value: 3, rarity: 'common' },
  copper_ore: { name: 'Copper Ore', icon: '🟠', cat: 'resource', value: 8, rarity: 'common' },
  iron_ore: { name: 'Iron Ore', icon: '⚙️', cat: 'resource', value: 16, rarity: 'uncommon' },
  gold_ore: { name: 'Gold Ore', icon: '🟡', cat: 'resource', value: 34, rarity: 'rare' },
  sapphire: { name: 'Sapphire', icon: '💎', cat: 'resource', value: 150, rarity: 'epic' },
  // ── Herbalism ───────────────────────────────────────────
  mint_leaf: { name: 'Mint Leaf', icon: '🌿', cat: 'resource', value: 5, rarity: 'common' },
  sunpetal: { name: 'Sunpetal', icon: '🌼', cat: 'resource', value: 11, rarity: 'uncommon' },
  moonbloom: { name: 'Moonbloom', icon: '🪻', cat: 'resource', value: 24, rarity: 'rare' },
  // ── Fishing ─────────────────────────────────────────────
  minnow: { name: 'Minnow', icon: '🐟', cat: 'resource', value: 6, rarity: 'common' },
  perch: { name: 'Perch', icon: '🐠', cat: 'resource', value: 10, rarity: 'common' },
  trout: { name: 'Rainbow Trout', icon: '🎏', cat: 'resource', value: 16, rarity: 'uncommon' },
  pike: { name: 'Northern Pike', icon: '🦈', cat: 'resource', value: 45, rarity: 'rare' },
  golden_koi: { name: 'Golden Koi', icon: '🐡', cat: 'resource', value: 90, rarity: 'epic' },
  lake_king: { name: 'Old Whiskers', icon: '🐋', cat: 'resource', value: 420, rarity: 'legendary' },
  old_boot: { name: 'Old Boot', icon: '🥾', cat: 'resource', value: 1, rarity: 'common' },
  // ── Monster drops ───────────────────────────────────────
  slime_gel: { name: 'Slime Gel', icon: '🫧', cat: 'resource', value: 7, rarity: 'common' },
  wolf_pelt: { name: 'Wolf Pelt', icon: '🐺', cat: 'resource', value: 15, rarity: 'common' },
  goblin_coin: { name: 'Goblin Coin', icon: '🪙', cat: 'resource', value: 25, rarity: 'uncommon' },
  golem_core: { name: 'Golem Core', icon: '🔮', cat: 'resource', value: 80, rarity: 'rare' },
  grave_dust: { name: 'Grave Dust', icon: '⚱️', cat: 'resource', value: 18, rarity: 'uncommon' },

  // ── Materials ───────────────────────────────────────────
  oak_plank: { name: 'Oak Plank', icon: '🟫', cat: 'material', value: 10, rarity: 'common' },
  birch_plank: { name: 'Birch Plank', icon: '🟨', cat: 'material', value: 22, rarity: 'common' },
  stone_brick: { name: 'Stone Brick', icon: '🧱', cat: 'material', value: 8, rarity: 'common' },
  copper_bar: { name: 'Copper Bar', icon: '🟧', cat: 'material', value: 22, rarity: 'common' },
  iron_bar: { name: 'Iron Bar', icon: '🔩', cat: 'material', value: 42, rarity: 'uncommon' },
  gold_bar: { name: 'Gold Bar', icon: '🥇', cat: 'material', value: 85, rarity: 'rare' },
  leather: { name: 'Leather', icon: '🟤', cat: 'material', value: 34, rarity: 'common' },

  // ── Consumables ─────────────────────────────────────────
  fish_stew: { name: 'Fish Stew', icon: '🍲', cat: 'consumable', value: 30, rarity: 'common', heal: 45 },
  grilled_fish: { name: 'Grilled Fish', icon: '🍢', cat: 'consumable', value: 18, rarity: 'common', heal: 30 },
  health_potion: { name: 'Health Potion', icon: '🧪', cat: 'consumable', value: 30, rarity: 'common', heal: 60 },
  moon_elixir: { name: 'Moon Elixir', icon: '⚗️', cat: 'consumable', value: 110, rarity: 'rare', heal: 150 },
  // Used up for one free trip to your home stone (travel.home).
  hearth_charm: { name: 'Hearth Charm', icon: '🏡', cat: 'consumable', tag: 'kit', value: 44, rarity: 'uncommon' },

  // ── Tools (power = damage per swing, speed = rhythm period ms) ──
  axe_wood: { name: 'Wooden Axe', icon: '🪓', cat: 'tool', tool: 'axe', tier: 1, power: 1, speed: 700, value: 15, rarity: 'common', skin: toolSkin('#9a6b3f', '#c89a62', '#e0bd8a') },
  axe_copper: { name: 'Copper Axe', icon: '🪓', cat: 'tool', tool: 'axe', tier: 2, power: 2, speed: 620, value: 90, rarity: 'uncommon', skin: toolSkin('#7a4f2a', '#d9783a', '#f3a56b') },
  axe_iron: { name: 'Iron Axe', icon: '🪓', cat: 'tool', tool: 'axe', tier: 3, power: 3, speed: 560, value: 240, rarity: 'rare', skin: toolSkin('#5a3b22', '#a9b4c2', '#e8eef5') },
  axe_gold: { name: 'Golden Axe', icon: '🪓', cat: 'tool', tool: 'axe', tier: 4, power: 5, speed: 500, value: 650, rarity: 'epic', skin: toolSkin('#3b2a1a', '#f2c230', '#fff1a8', '#ffd84a') },
  pick_wood: { name: 'Wooden Pickaxe', icon: '⛏️', cat: 'tool', tool: 'pick', tier: 1, power: 1, speed: 720, value: 15, rarity: 'common', skin: toolSkin('#9a6b3f', '#c89a62', '#e0bd8a') },
  pick_copper: { name: 'Copper Pickaxe', icon: '⛏️', cat: 'tool', tool: 'pick', tier: 2, power: 2, speed: 640, value: 90, rarity: 'uncommon', skin: toolSkin('#7a4f2a', '#d9783a', '#f3a56b') },
  pick_iron: { name: 'Iron Pickaxe', icon: '⛏️', cat: 'tool', tool: 'pick', tier: 3, power: 3, speed: 580, value: 240, rarity: 'rare', skin: toolSkin('#5a3b22', '#a9b4c2', '#e8eef5') },
  pick_gold: { name: 'Golden Pickaxe', icon: '⛏️', cat: 'tool', tool: 'pick', tier: 4, power: 5, speed: 520, value: 650, rarity: 'epic', skin: toolSkin('#3b2a1a', '#f2c230', '#fff1a8', '#ffd84a') },
  rod_basic: { name: 'Bamboo Rod', icon: '🎣', cat: 'tool', tool: 'rod', tier: 1, power: 1, value: 15, rarity: 'common', skin: toolSkin('#b9c46a', '#b9c46a', '#ffffff') },
  rod_fine: { name: 'Angler Rod', icon: '🎣', cat: 'tool', tool: 'rod', tier: 2, power: 2, value: 160, rarity: 'rare', skin: toolSkin('#2f5f8a', '#c0c8d0', '#ffd84a') },
  rod_master: { name: 'Starcatcher Rod', icon: '🎣', cat: 'tool', tool: 'rod', tier: 3, power: 3, value: 720, rarity: 'epic', skin: toolSkin('#3b2a1a', '#f2c230', '#fff1a8', '#ffd84a') },

  // ── Gear ────────────────────────────────────────────────
  sword_wood: { name: 'Training Sword', icon: '🗡️', cat: 'gear', slot: 'weapon', atk: 4, value: 12, rarity: 'common', skin: toolSkin('#9a6b3f', '#c89a62', '#e0bd8a') },
  sword_copper: { name: 'Copper Sword', icon: '🗡️', cat: 'gear', slot: 'weapon', atk: 9, value: 110, rarity: 'uncommon', skin: toolSkin('#5a3b22', '#d9783a', '#f3a56b') },
  sword_iron: { name: 'Iron Sword', icon: '⚔️', cat: 'gear', slot: 'weapon', atk: 16, value: 260, rarity: 'rare', skin: toolSkin('#3b2a1a', '#a9b4c2', '#e8eef5') },
  sword_gold: { name: 'Sunforged Blade', icon: '⚔️', cat: 'gear', slot: 'weapon', atk: 26, value: 700, rarity: 'epic', skin: toolSkin('#3b2a1a', '#f2c230', '#fff1a8', '#ffd84a') },
  armor_leather: { name: 'Leather Vest', icon: '🦺', cat: 'gear', slot: 'armor', def: 4, value: 90, rarity: 'uncommon' },
  armor_iron: { name: 'Iron Plate', icon: '🛡️', cat: 'gear', slot: 'armor', def: 10, value: 320, rarity: 'rare' },
  amulet_sapphire: { name: 'Sapphire Amulet', icon: '📿', cat: 'gear', slot: 'trinket', atk: 5, def: 5, hp: 40, value: 520, rarity: 'epic' },
  // Dungeon gear: crafted from Grave Dust (the Hollow Crypt), now and then found in its chests.
  // `perk`: Wraithsteel charges your special faster; the Ghostlight Amulet makes healing items heal more.
  wraith_blade: { name: 'Wraithsteel Blade', icon: '🗡️', cat: 'gear', slot: 'weapon', atk: 19, value: 430, rarity: 'rare', perk: 'quickSpecial', skin: toolSkin('#2a2238', '#9aa6d8', '#dfe6ff', '#8fb0ff') },
  barrow_plate: { name: 'Barrow Plate', icon: '🛡️', cat: 'gear', slot: 'armor', def: 8, hp: 35, value: 400, rarity: 'rare' },
  ghostlight_amulet: { name: 'Ghostlight Amulet', icon: '🧿', cat: 'gear', slot: 'trinket', atk: 2, def: 2, hp: 20, value: 320, rarity: 'rare', perk: 'mender' },
};
mergeInto(ITEMS, CONTENT.items, 'items');

// ── Crafted quality: Fine and Masterwork versions of tools and gear ──
// (made at the Anvil/Workbench/Grindstone by crafting well; see shared/crafting.js).
// Stored as their own item ids, e.g. "sword_iron~fine", so inventory, the
// market and shops treat them like any other item.
export const QUALITY = [
  { key: '', label: 'Standard', stat: 1, speed: 1, zone: 0, value: 1 },
  { key: 'fine', label: 'Fine', stat: 1.15, speed: 0.95, zone: 0.015, value: 1.4 },
  { key: 'master', label: 'Masterwork', stat: 1.3, speed: 0.9, zone: 0.03, value: 2.2 },
];
export const QUALITY_BASES = ['axe_copper', 'axe_iron', 'axe_gold', 'pick_copper', 'pick_iron', 'pick_gold', 'rod_fine', 'rod_master', 'sword_copper', 'sword_iron', 'sword_gold', 'armor_leather', 'armor_iron', 'amulet_sapphire', 'wraith_blade', 'barrow_plate', 'ghostlight_amulet'];
export const qualityId = (base, q) => (q ? `${base}~${QUALITY[q].key}` : base);
for (const base of QUALITY_BASES) {
  const it = ITEMS[base];
  for (const q of [1, 2]) {
    const Q = QUALITY[q];
    const v = { ...it, base, q, name: `${Q.label} ${it.name}`, value: Math.round(it.value * Q.value) };
    for (const k of ['atk', 'def', 'hp']) if (it[k]) v[k] = Math.max(Math.round(it[k] * Q.stat), it[k] + q);
    if (it.speed) v.speed = Math.round(it.speed * Q.speed);
    if (it.tool === 'rod') v.rodZone = Q.zone;
    if (q === 2 && it.skin) v.skin = { ...it.skin, glow: it.skin.glow ?? '#ffd84a' };
    ITEMS[qualityId(base, q)] = v;
  }
}
export const baseOf = (id) => ITEMS[id]?.base ?? id;
export const qOf = (id) => ITEMS[id]?.q ?? 0;

export const ITEM_IDS = Object.keys(ITEMS);
export const item = (id) => ITEMS[id];
export const isItem = (id) => Object.prototype.hasOwnProperty.call(ITEMS, id);

// Starter kit every new hero gets.
export const STARTER_INVENTORY = { axe_wood: 1, pick_wood: 1, rod_basic: 1, sword_wood: 1, health_potion: 2 };
export const STARTER_EQUIP = { axe: 'axe_wood', pick: 'pick_wood', rod: 'rod_basic', weapon: 'sword_wood', armor: null, trinket: null };
export const STARTER_GOLD = 100;
