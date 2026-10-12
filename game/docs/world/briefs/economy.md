# Brief: economy, social and "town singleton" assumptions

Researcher scope: market, shops, NPC demand, jobs, parties, tutorial/quests, gold flow. All line numbers are from the current branch (`claude/intelligent-brahmagupta-dqjx6n`, clean tree). "Verified" means I read the code. "Guess" marks estimates.

## 0. The headline finding

**Trade has no geography today.** No trade action is checked against the hero's position on the server:

- `market.place` / `market.cancel` (server/game.js:991-1004) take no position. They are even allowed inside a dungeon: `RUN_RPC_OK` lets every `market.*` call through (game.js:946-948).
- `npcSell` (game.js:827-844) pays a flat `NPC_SELL_RATE = 0.6` (game.js:31) from anywhere. The Bag panel's "Sell to merchant" button works anywhere (client/src/ui/panels.js:154, 161-169).
- `jobs.post` / `jobs.deliver` (game.js:1119-1134, server/jobs.js:55, 72) take no position, and a delivery puts the goods straight into the poster's bag wherever the poster is (jobs.js:84).
- `enterShop` (game.js:262-287) has no distance check. The dock's Shop button enters your shop from anywhere (client/src/ui/hud.js:90). The README says remote visiting is a feature ("visit any shop from Town Hall → Shops or a player's profile", README.md:53).
- The dock buttons open Market, Craft and Town "right now, wherever you are" (hud.js:84-91, 455-460, from roadmap task #14).

So adding a second town's market only adds a second door to the same global book. **Regional prices that make hauling pay need three things.** Some trade actions must become location-bound on the server. Goods bought or refunded somewhere must not appear in your bag somewhere else. And the price gaps must be designed, not left to chance in thin books. The rest of this brief works through that.

## 1. Everywhere the code assumes ONE of something

### Market (one global order book)
- `Game` builds a single `Market` (game.js:139). Every prepared statement in server/market.js:18-37 is keyed by `item` only: `bestBuy`, `bestSell`, `depth`, `history` and `summary`. The schema has no place column: `market_orders` (server/db.js:61-71) and `market_trades` (db.js:74-82).
- `book()` reports `npc: ITEMS[item].value` (market.js:133), one reference price for the whole world.
- Client: the title is hard-coded `'Grand Market'` (panels.js:312). The dock calls `openPlace('market')` by the building **id** `market` (hud.js:89, 456-459).
- **What breaks with a second `action:'market'` building.** Walking up works, because `goBuilding` looks up by id and calls `openBuilding(b.action)` (client/src/game.js:1291-1302), but it opens the identical global book. `#placeFor` already picks the *nearest* building with that action for the "Walk there" button (panels.js:74-87), so that part is ready for several towns.

### Workshop / crafting stations (one station of each kind)
- `shared/stations.js:6` `at(id) = PROPS.find((p) => p.station === id)`. This finds the **first** prop for each station kind. `spotsOf` (stations.js:10-23) and `stationPos` (24-27) use it.
- Server `#claimSpot` keeps `ch.spots` keyed by station *kind* (server/crafting.js:51-61). `start()` fails with "Walk up to the Forge first." unless you are at the first forge (crafting.js:92-96).
- Client `goCraft` walks you to `spotsOf(r.station)`, which is Hearthvale's station, even when you stand in another town's yard (client/src/game.js:181-197).
- `inYard` (stations.js:31) accepts **any** station prop, so Quick craft (crafting.js:241) already works in a second yard. Hands-on crafting does not.
- Editor: stations cannot be copied or deleted (client/src/editor/editor.js:265, 276).
- **Breaks:** a second town's anvil cannot be used by hand, and the client path-finds back to Hearthvale.

### Shop building / NPC demand (one town-wide pool)
- There is one `action:'shop'` building, "Your Shop" (maps/world.json). Every player's shop sits behind it as a `ShopRoom` keyed by owner (server/rooms.js:9-16, game.js:283-284). `shops` (db.js:112-122) has no town column.
- NPC demand: `npc_demand (item TEXT PRIMARY KEY, …)` (db.js:123). `Shops.demand(item)` (server/shop.js:66-71) and `#visit` (shop.js:263-279) draw from it. The comment says "Town-wide demand" (shared/shop.js:64-66).
- One customer roster: the 10 Hearthvale `CUSTOMERS` (shared/shop.js:46-57).
- UI strings: "Town demand" (client/src/ui/shop-panels.js:37), "Every shop in town" (shop-panels.js:141).

### Town hall
- `town.info` (game.js:1075-1094) returns global data: the richest 10, the top 10 by total skill (it scans every hero and parses their skills JSON), channels, everyone online and invites. Nothing in it is per town. The panel has fixed copy: 'Town Hall' (panels.js:660), "Hearthvale is invite-only" (panels.js:694).

### Bulletin board (one global board)
- Several `proc_job_board` props are allowed. The client walks to the nearest one (game.js:1321-1332, 943). But all of them open the same `jobs.list()`: the `open` query has no place filter (jobs.js:23). The `jobs` table (db.js:193-206) has no town column.

### Spawn point
- The map has a single `spawn` (shared/world.js:63, 176; checked at :90). New heroes are created there (server/heroes.js:43, 63-64). It is also the fallback for an unwalkable saved position (game.js:73) and for leaving a dungeon with no door (game.js:578). Starting new heroes in Hearthvale is correct. A KO has no respawn: you get up where you fell with 30% HP (server/channel.js:262, 597).

### Buildings are styled by id, and ids are unique
- client/src/scene/buildings.js:209, 222 call `RECIPES[b.id]` for `workshop|shop|townhall|market`. The procedural fallback (client/src/scene/town.js:1073, 1075, 1129, 1171, 1187, 1199) also branches on `b.id`.
- `mapProblems` requires unique ids (world.js:101-102). **A second market (`id:'market_frost'`) renders as a plain house.** The fix is to key the style on `b.action` or on a new `b.style` field.
- Editor: only Cottages can be placed (client/src/editor/kinds.js:178). `action` is read-only (kinds.js:82), and non-decorative buildings can't be copied (editor.js:276). **The owner cannot build a second town's functional buildings today.**

### Tutorial and quests
- Steps name Hearthvale places ("Whisperwood (west)", "Wilds Gate (north)", game.js:39-44). The client guide assumes the Wilds lie north of the first gate (`p.z > GATE.z - 1`, hud.js:504). The shop and workshop steps target building ids (hud.js:519).

### Social
- `announce` goes to everyone online (game.js:391-394). Chat goes to the whole channel (game.js:354-362, 918-924), and a channel is a full copy of the whole world (channel.js:24-46). For a group of friends that is a feature, so keep it. Optionally prefix announcements with the town's name.
- In parties, `where` is only `offline|dungeon|shop|town` (server/party.js:37). There is no region and no "travel to my party".

## 2. Giving each town its own market

### Options

| | A. Global book + regional NPC prices | **B. Per-town books, town-scoped access, town merchant** | C. One book + shipping fee |
|---|---|---|---|
| Schema | `npc_demand` gets a town column | `town` on orders, trades, jobs and shops; `town_demand`; `town_storage` | `town` on orders; a distance table |
| Hauling pays? | **No, for player goods.** The global book moves goods instantly. A trader in A buys a fisher's B-listed fish and sells it to A's merchant without carrying anything. Competition pushes the book price up to A's merchant bid, so nobody needs to haul. | **Yes.** Goods change hands in a town, and moving them is the player's job. | Partly. Prices differ by at most the shipping fee, and the shipping fee is a gold sink. |
| Liquidity for ~5-20 friends | Best | Thin books. Fixed by the merchant as a standing bid in every town (below). | Best |
| Complexity | Small | Medium | High: matching on landed price (`ORDER BY price + ship(town)`) and a harder UI |

**Recommend B.** Make access **region-scoped, not building-scoped**: "you trade on the market of the town you're standing in." The test is `townAt(x, z)`, the smallest containing region whose `kind === 'town'`. Hearthvale's region is `r: 96` and covers the whole current island (maps/world.json), so **today's behaviour, including the instant dock buttons, is unchanged inside Hearthvale**. Out in the wilds between towns you can browse but not trade ("Head to a town to trade").

The client already tracks the current region (hud.js:899-905). Region kinds `town`, `wild` and `outlaw` already exist in the banner code (hud.js:908).

### The rules that keep goods from teleporting
1. Placing an order, and cancelling a **sell** order, requires being in that order's town. Gold is global, so cancelling a buy order works anywhere.
2. Goods that change hands while you are not in the town go to **`town_storage`**, a per-town pickup you collect when you are there. This covers a resting buy order that fills while you are away, a sell order you cancel from another town, and a job delivery to an absent poster. Without it, a resting buy order in Frostholm drops cheap fish into your bag in Hearthvale. Storage also seeds a per-town bank later.
3. `npcSell` becomes **the town merchant**. It is the standing bid in every book and gives each town designed price gaps:
   `bid = floor(value × (base + (rate − base) × fill))`
   - `base` is the town's floor. Use 0.6 for Hearthvale, which equals today's flat rate, so nothing regresses.
   - `rate` is that town's appetite for the item's tag, for example 0.9 for imports and 0.45 for local abundance.
   - `fill` is a per-(town, item) pool using the existing `fillNow`/`demandCap` maths (shared/shop.js:66-67). Only the premium above `base` drains it, so the hauling profit is capped and today's 60% floor is untouched.
   - The book panel shows it as "Frostholm merchant buys up to N at P", computed rather than stored as rows. That gives every town's book a buyer even with five players.
4. An optional gold sink: a town **supplier ask** for that town's staple goods at ≥ 1.3× value. It must always sit above the highest merchant bid anywhere, so there is no loop where you buy from one NPC and sell to another.
5. A read-only **"Other towns" price board** in every market (last price, merchant bid, ask per town), so players can plan trade runs. Gaps nobody can see generate no gameplay.

**Worked example (guess-level tuning).** A Birch Log is worth 9. Hearthvale's merchant pays 5 (0.6). Frostholm wants wood at 0.9 and pays 8. `demandCap(9) = 267`, so the premium is capped at about 267 × 3 ≈ 800 gold per 8 h in that town. The waystone fee is `5 + d/25` (world.js:233): 17 gold for 300 m, 29 gold for 600 m.

### Schema (migration 7, in the db.js MIGRATIONS style)
```sql
ALTER TABLE market_orders ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
ALTER TABLE market_trades ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
CREATE INDEX idx_orders_town_book ON market_orders(town, item, side, status, price);
CREATE INDEX idx_trades_town_item ON market_trades(town, item, ts);
CREATE TABLE town_demand (town TEXT NOT NULL, item TEXT NOT NULL, fill REAL NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (town, item));
INSERT INTO town_demand SELECT 'hearthvale', item, fill, at FROM npc_demand;
CREATE TABLE town_storage (account_id INTEGER NOT NULL REFERENCES accounts(id), town TEXT NOT NULL, item TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0), PRIMARY KEY (account_id, town, item));
ALTER TABLE shops ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
ALTER TABLE jobs  ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
```
`'hearthvale'` is the existing region id (maps/world.json), so every current save upgrades in place.

### Code changes
- **Map / shared**
  - Add `regions[].trade = { base, tags: { wood: 0.9, fish: 0.45, … }, staples: [...] }` (map data, validated in `mapProblems`).
  - Add a `tag` to each base item in shared/items.js:24-96 (wood, ore, gem, herb, fish, monster, bar, plank, food, potion, tool, gear).
  - Put `townAt`, `merchantBid` and the constants in shared/economy.js.
- **server/market.js**
  - Add `AND town = ?` to every statement at :18-37. The `summary` subqueries each need the parameter; rewriting them as `GROUP BY town, item` is cleaner.
  - Change the signatures to `place(accountId, town, …)`, `book(town, item)` (return `npcBid` instead of `value`) and `summary(town)`.
  - `#execute` (:98-104) delivers to the bag only if the buyer is present; otherwise it goes to storage. It needs a "present" callback from `Game`.
- **server/game.js**
  - Add a `#townOf(c)` helper that uses the town body: `c.ent`, or `townPos` in a run.
  - Gate `market.place`, sell-side `market.cancel`, `npcSell` and `jobs.deliver`/`post` on it.
  - Remove `market.place`/`market.cancel` from `RUN_RPC_OK`, but keep browsing (game.js:946-948).
  - Add `storage.collect`, run automatically when the market panel opens.
- **server/shop.js**
  - Change to `demand(town, item)`. `#visit` uses the shop's `town`. `CUSTOMERS` becomes per-town rosters (shared/shop.js:46).
  - Add a move-home-town action, done at that town's shop building for a fee, which is also a sink.
- **server/jobs.js**
  - Add a `town` column. `list(town)` shows local jobs first plus an "elsewhere" tab. Delivery is only allowed in the job's town. Goods go to the poster's bag or to their storage.
- **Client**
  - The dock opens the *current* town's panels.
  - The title becomes `${town.name} Market`.
  - The market panel gets Here / Other towns tabs, and Buy and Sell are disabled outside a town.
  - Building style is keyed by action, at town.js and buildings.js:222.
  - The editor can place functional buildings, a set of stations and a job board per town.
- **Crafting**: look stations up by prop id. Use the nearest station of that kind (`spotsOf`, `goCraft`, `#claimSpot` keyed by prop id).
- **Tests** (server/tests/economy, shop and jobs tests):
  - books are isolated per town
  - the region gate is enforced
  - gold and items are conserved through storage
  - the merchant premium pool is capped
  - an old v6 save upgrades in place (the `shop.test.js:115` pattern)

**Open question for the owner.** Player shops: buying in a shop remotely moves goods to the buyer instantly, like the global book does. Recommendation: keep remote visiting (it's the social feature in README.md:53) but give each shop a home town for NPC customers. Accept the leak, because shop purchases are manual and capped at 8 × 999. The alternative is to allow buying only resources and materials from within the shop's town.

## 3. NPC demand and the shop simulation: ready for several towns?

**Mostly not, but the shape is right.**
- **Not ready:** `npc_demand` has `item` as its only key (db.js:123). `demand()` and `demandMap()` (shop.js:66-74) are town-less. `state()` returns the demand for every item to the owner (shop.js:83). `estimate()` (shared/shop.js:114-133) assumes one `fillOf`. There is a single roster and no town on shops.
- **Ready:**
  - The pool model of drain plus 8 h refill (shared/shop.js:25-28, 64-67) carries over to (town, item) unchanged.
  - The simulation clock (`meta.shop_sim_at`, shop.js:231-252) is global and correct as it is.
  - Footfall is per shop (shop.js:254-261), and presence (game.js:234-239) does not depend on town.
- **Faucet warning:** five towns each with a full `DEMAND_POOL_GOLD = 2400` pool per item multiplies the NPC-shop ceiling by five. Give each town a weight so the total is about 1.5-2× today's. Today's upper bound is about 90 items × 2400 × 3 refills ≈ 650k gold/day across all shops (a guess). It only binds if every item is stocked.

## 4. The tutorial and how it could grow into quests

**Today:**
- Steps live in `TUTORIAL` (game.js:39-44) as `{id, text, reward}`. The client keeps its own copy of the text in `TUTORIAL_TEXT` (hud.js:21-26), with `hint` and `target` fields. The two copies must be kept in sync by hand, and the server's `text` field is unused.
- Progress is one integer, `heroes.tutorial` (db.js:50).
- `advanceTutorial(stepId)` (game.js:114-122) moves on only when the current step's id matches. It pays gold and nothing else, then sends `{t:'tutorial', step, reward}` (handled at hud.js:146-151).
- The hooks are scattered call sites:
  - `'chop'`: any tree, game.js:746
  - `'craft'`: oak_plank, crafting.js:221 and :252
  - `'fight'`: **any** victory, not just a slime, channel.js:601
  - `'stock'`: game.js:1018
- `tutorialSkip` (game.js:1152-1154) has no reward. The guide beacon `#questTarget` (hud.js:487-522) is special-cased code for each target.

**Growing it into a general quest and goal system:**
1. **Data in one place:** add `shared/quests.js`. Each quest is `QUESTS[id] = { town, giver, requires: [ids], repeat: null|'daily'|'weekly', steps: [{ ev, match: {item?, monster?, tag?, region?, station?, minGrade?}, n, text, hint, target: {kind:'building', action}|{kind:'node', type}|{kind:'monster', type}|{kind:'stone', id} }], reward: {gold, items, xp} }`. The client reads the same file, so the duplicate list goes away and `#questTarget` becomes driven by data.
2. **One event call on the server:** `game.progress(c, ev, data)` replaces `advanceTutorial` at the existing hooks and new ones:
   - `gather` (`grantGather`, game.js:727)
   - `kill`, once per monster type (`#reward`, channel.js:423)
   - `craft` with grade, `stock`, `sell` with town, `trade`, `deliver`
   - `travel` / `attune` (game.js:124-129, 299)
   - `dungeon` with kind and tier (dungeons.js:222)
3. **Schema:** add `quest_progress (account_id, quest, period, step, n, state, started_at, done_at, PRIMARY KEY (account_id, quest, period))`, where `period` is the day or week index for repeatable quests. Migrate `heroes.tutorial` into quest `tutorial` at the same step, and keep the column for now.
4. **Content that serves the world goals:**
   - Each town gets an intro chain: attune its stone, sell to its merchant, craft at its station, beat its local boss.
   - **Daily "town orders"** on each town's board are NPC jobs: "Frostholm needs 20 Oak Planks, pays 1.4× value." This *is* the hauling loop, packaged so there is always something to do, and paid from pools so the gold is bounded. Use a separate `town_orders` table, because `jobs.poster` is `NOT NULL REFERENCES accounts(id)` (db.js:195).
   - Weekly goals.
   - Rewards stay server-side, which meets the hard constraint.

## 5. Gold sources and sinks

**Sources (verified):**
- 100 starting gold (shared/items.js:131).
- Tutorial: 160 in total (game.js:40-43).
- Overworld kills. **Every fighter in the battle gets a full roll** (channel.js:425-431). Gold per kill ranges from 4-9 for a slime to 50-90 for the golem. Monsters respawn after 25 s, bosses after 90 s (channel.js:269).
- Dungeons:
  - Kills and chests are multiplied by `reward = 1 + 0.25(n−1)` **per hero** (shared/dungeon.js:93), by tier loot 1, 1.6 or 2.5 (dungeon.js:33-35), and by the day's modifier.
  - Boss chest: 120-200 gold. First clear of the day adds 150 × loot (dungeon.js:158, 168-171), counted per (hero, kind, tier) (db.js:226-232).
  - Example: a T3 party of four gets about 525-875 gold per hero from the boss chest, plus 375 for the first clear.
- **`npcSell` at 60% with no cap** (game.js:31, 832).
- NPC shop customers, capped by the pool.

**Sinks (verified):**
- Market tax 4% (market.js:100)
- Player-to-player shop fee 4% and NPC guild levy 8% (shared/economy.js:2-4, shared/shop.js:31-32)
- Jobs tax 4% (jobs.js:86)
- Quick craft fee 4% of output value (crafting.js:11, 244)
- Waystone fee `5 + d/25` (world.js:233, game.js:317)
- Fees carry fractional remainders, so tiny trades can't dodge them (heroes.js:102-107).

**Nothing else.** There is no NPC vendor, no repair, no rent, no cosmetics, and no penalty for being knocked out. Gold can only buy player goods, so prices will inflate.

**Risks a bigger world adds:**
1. Higher-tier items with higher `value` feed the **uncapped** 60% `npcSell` faucet linearly. Option B's premium pool caps only the part above 60%. Consider giving each town's floor its own pool too.
2. More camps and bosses, with full rolls per fighter, mean more gold from kills.
3. **Daily first-clear bonuses multiply per dungeon kind.** With 5 dungeons × 3 tiers that is 150 × (1 + 1.6 + 2.5) × 5 ≈ 3,800 gold per hero per day (guess at that content size). Consider one bonus per tier band per day.
4. Per-town NPC pools multiply the ceilings (section 3).
5. NPC-to-NPC trade loops if supplier asks are ever priced below a merchant bid somewhere.
6. Hauling has no friction except travel time. There is no inventory cap and no weight (verified: no bank, stash or weight in server/ or shared/). At 6.2 m/s (world.js:4) a 600 m trip takes about 100 s.

**Mitigations:**
- **Telemetry first.** Add `gold_flow (day, kind, amount, PRIMARY KEY(day, kind))`, fed by a `reason` argument on `Heroes.addGold` (heroes.js:71), plus an owner tab in the Town Hall. Today nobody can see inflation.
- **Sinks that are also gameplay:**
  - a cargo toll on waystones for resources and materials, with a free allowance (fair once `town_storage` exists)
  - station fees at higher towns' special stations
  - a fee to move your shop to another town
  - NPC cosmetics and shop decor
  - **town projects**: friends donate gold and materials to upgrade a town (social, a sink, and always something to do)
- Budget each new town's merchant premium and order rewards against a target of gold per active hour.
