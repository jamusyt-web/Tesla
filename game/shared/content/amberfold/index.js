// Amberfold (tier 2, autumn): the harvest and mill town at the end of the
// Westmarch road (SPEC §3.2). Its pack, merged into the game's tables by
// shared/content/index.js. Its map (the town, the Amberwood and the road)
// is maps/patches/020_amberfold.json; its look is shared/biomes/autumn.js.
import items from './items.js';
import nodes from './nodes.js';
import monsters from './monsters.js';
import recipes from './recipes.js';
import { fish, fishTables } from './fish.js';
import { dungeons, chests } from './dungeon.js';
import quests from './quests.js';
import orders from './orders.js';
import { supplies, customers } from './trade.js';

export default { id: 'amberfold', items, nodes, monsters, recipes, fish, fishTables, dungeons, chests, quests, orders, supplies, customers };
