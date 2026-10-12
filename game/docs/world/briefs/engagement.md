# Brief: "always something to do", an engagement audit (researcher 6 of 6)

Scope: what a player can do, and how the game points them at it. Verified against `/home/user/Tesla/game` on branch `claude/intelligent-brahmagupta-dqjx6n`. The progression curve and the quest-system schema are covered in `brief_content.md` §2 and `brief_economy.md` §4. This brief builds on them and does not repeat them.

## 0. Headline

The game's **moment-to-moment verbs are strong**: rhythm swings, reel fights, crafting minigames, 12-second battle rounds and dungeon runs. Its **guidance stops after the 4-step tutorial**. When `hero.tutorial >= 4`, the quest card and the guide arrow are hidden for good (`client/src/ui/hud.js:469-472`). After that, the game never again offers a "next thing". The only later pointer is one toast at Combat 5 (`hud.js:235`). The daily and weekly hooks that do exist (dungeon first clear, day twist, weekly crypt) are only visible once you open the crypt door's panel (`client/src/ui/dungeon-panels.js:57-64`). The contextual "best thing to do here" button exists, but only underground (`hud.js:332-342`; `contextAction` at `client/src/game.js:1882`).

The cheapest big win is to make the existing guide (beacon, trail, arrow, "Take me there") and the round context button **permanent and data-driven** in the overworld.

## 1. Loops at each time scale, and where each runs dry

| Scale | What exists (verified) | Where it runs dry |
|---|---|---|
| **Next 30 s** | Tap a node: walk, then the swing loop with a PERFECT ×2 (`server/game.js:696-704`). Shared nodes: everyone who hit gets loot (`:716-719`). Fishing: bite, hook, reel fight (`:769-823`). Battle rounds with a 12 s timer. Crafting beats, with **Again** and **Equip** after the result (`client/src/game.js:251-254`). Floating loot text, XP toasts, rare-drop sound. | When a node breaks, nothing points at the next one: the rhythm UI closes and you must find and tap another. Respawns take 14–45 s (`shared/world.js:290-300`), and 94 nodes are shared by up to 40 players per channel. The "work the nearest node" action exists only on the keyboard (E/F/Space, `game.js:869-872, 958-974`), so phones don't have it. A won fight opens a panel whose only button is **Continue** (`panels.js:750-760`). |
| **10-min session** | Tutorial: chop, craft, fight, stock, paying 20/30/50/60 gold (`server/game.js:39-44`). The craft panel shows have/need counts and "Requires Crafting N" (`panels.js:262-269`), an implicit shopping list. A dungeon run takes 10–20 min with tiers (`shared/dungeon.js:32-36`). The shop forecast shows town demand (`shop-panels.js:23-38`). | After the tutorial nothing proposes a session goal. The bulletin board only has player-posted jobs (`server/jobs.js`). With 5–10 friends it usually shows "No jobs posted right now" (`panels.js:580`). |
| **A day** | Day twist (4-day cycle: still, restless, bloodmoon, brittle, `dungeon.js:38-47`). First crypt clear of each tier per day doubles the boss rolls and adds 150×loot gold (`dungeon.js:158-171`, table `dungeon_daily`). NPC demand refills over 8 h (`shared/shop.js:28`), so collecting the till is a natural 2–3 visits a day. | All of this is invisible unless you walk to the crypt door. There are no daily goals, no daily login reward, and nothing tells you "today's twist is Blood Moon". |
| **A week** | Weekly crypt seed with a top-5 board per tier (`server/game.js:619`). Jobs last 3 days (`jobs.js:108`). | The leaderboard is all there is, and it only matters to dungeon racers. |
| **Months** | Skills cap at 50 (`shared/skills.js:11`). Masterwork rolls. Rare finds: Golden Acorn p=0.006–0.03, Sapphire, Old Whiskers (deep water, rod tier 2 or better, `shared/fishing.js:38`). Leaderboards: Richest and Most XP (`server/game.js:1076`). | Unlocks stop at about skill 10 / hero 12 (`brief_content.md` §2). Estimated 8–15 h to "finish" the island. Levels 13–50 give only the double-drop chance (capped 50% at level 26, `skills.js:44`) and +2 ATK per combat level. Nothing to collect, no titles, no cosmetics to earn. Fish weights are rolled (`fishing.js:56`) but nobody keeps records of them. |

## 2. "Now what?" walkthroughs

**Brand-new player (minute 0–15).** The welcome chat line, then quest card 1/4 with **Take me there**, a light pillar, a path of dots and an orbiting arrow (`hud.js:466-569`). This works well. Problems:
- The "fight" step is completed by *any* victory (`channel.js:601`).
- The rewards are gold only.
- Step 4 (stock the shop) ends with "Quest complete! +60" and then the card **vanishes**. The player has 100 + 160 gold, wooden tools and some oak planks.

The natural next goal is copper tools: Crafting 3, 3 copper bars (6 copper ore at Mining 2, plus 3 oak logs) and 2 planks (`recipes.js:194-195`). Nothing says so. **First "now what?" arrives at about 12 minutes.**

**Level-5 player (about 1 h, total skill XP about 1,520).**
- If Combat hit 5, a single toast says "Strong enough for the Hollow Crypt now. Look for the skull on your map!" (`hud.js:235`). If they levelled through gathering instead, they never see it.
- Level-ups print only the perk text ("Crafting 4! Unlocks recipes", `hud.js:236`), never *what* was unlocked (Birch at Foraging 4, Iron Vein at Mining 5, iron bars at Crafting 5).
- Gated nodes explain themselves only after you tap them (`game.js:1024-1036`).
- The world map does label camps "Timber Wolf · Lv 4" (`mapdraw.js:127-130`), which is the best "where to go" aid the game has.

There are many options here and nothing ranks them. Choice paralysis.

**Level-12 player (about 8–12 h).**
- Has gold tools or the Sunforged Blade, has cleared or can clear crypt tier 3.
- Every island camp is level 11 or below (`world.json` spawns), with no new places.
- What's left is self-directed: the weekly leaderboard, Masterwork rolls, hunting Old Whiskers, flipping the market, running the shop.

This is the **severe** dry point, and it is exactly what step 4 (new towns) has to fix. It also needs goals that are not "new zone", or the same wall comes back at the last town.

**Returning player after a week.**
- `awaySales` opens "While you were away" only if there are unseen shop sales (`server/game.js:421`, `shop-panels.js:195-206`). NPC shoppers stopped after 12 h without input (`SHOP.AWAY_MS`, `shared/shop.js:18`), so the panel says so.
- Their jobs expired after 3 days and were refunded silently. The expiry toast goes only to posters who are online (`server/game.js:168-176`).
- Market fills while offline produce no message (`server/game.js:993-998`), and deliveries to their jobs while offline produce none either.
- The quest card stays hidden.

They land in town with a till badge and nothing else: no "what changed", no "here's today's twist", no catch-up. `heroes.last_active` (`db.js:124`, `heroes.js:31`) already tells us how long they were away, so detecting this is free.

## 3. Mobile affordances for "the next thing"

**Exists:**
- Tap to move or interact (`game.js:918-956`). Tap anywhere within 110 px of the ring to swing (`:930-933`).
- Five-button dock that opens panels instantly, with **Walk there** inside (`hud.js:92-103`).
- Till badge on the Shop button (`hud.js:279-283`).
- The guide's beacon, trail and edge arrow, plus **Take me there**.
- Region and zone banners (`hud.js:894-924`).
- Toasts: up to 4, each for 2.6 s (`hud.js:413-423`).
- Timed prompts with vibration for party invites and ready checks (`hud.js:384-411`).
- World map: tap to walk, tap a waystone to travel.
- Tap a party member to join their fight (`hud.js:377-381`).
- Craft **Again** and **Equip**. Quick-craft batches.
- Jobs board: a **Deliver** button when you hold the item (`panels.js:583-590`).
- Dungeon-only `ctxBtn` with labels like "Rest (Last Light)", "Open the Vault", "Join Ana's fight".

**Missing:**
1. **An overworld context button.** `ctxBtn` is hidden outside dungeons (`setMode`, `hud.js:295-298`), and E/Space has no touch equivalent.
2. **A goal card after the tutorial.**
3. **Next-step buttons on result screens.** Victory (only Continue), a broken node, and a caught fish have none: no "Fight another wolf", "Next oak (12 m)", "Cast again" or "Sell 14 logs".
4. **"Ready" signals**:
   - a badge on Town when you hold items an open job wants
   - a dot on the map when a crypt first-clear is available
   - "undiscovered waystone nearby"
   - "your sell order filled"
5. **Level-ups that name what was unlocked**, with a **Show me** button that uses the guide.
6. **Announcements that are seen.** Rare finds, boss kills and Masterworks go to the chat log as system lines (`server/game.js:391-394`), so on a phone they are easy to miss.
7. **No push notifications.** There is no service worker or web manifest. This is a later item.
8. **A misleading NPC line.** Merchant Ola says "Haggle with customers for a bonus" (`client/src/scene/townsfolk.js:14`), but no haggle feature exists. Remove the line or build the feature.

## 4. Menu of retention mechanics that fit Hearthvale

Cost: **S** about a day, **M** 2–4 days, **L** a week or more, judged against this codebase. "World use" says how each one pushes people across the new map.

| Mechanic | Value | Cost here | Risks | World use |
|---|---|---|---|---|
| **Goal card + guide, always on** (tutorial becomes data-driven quests) | Directly answers "never now what". Reuses the `#questTarget` shape `{x,z,y,label,go}` | **M**: `shared/quests.js` + a `quest_progress` table (see `brief_economy.md` §4) | Text bloat. Keep it to 1 pinned goal | Each town gets an intro chain: attune its stone, meet the merchant, craft at its station, beat its boss |
| **Town notice boards: NPC orders/bounties** | Fills the empty job board; makes the hauling economy concrete | **M**: a `town_orders` table, a daily seed per town, delivery reuses the `jobs.deliver` shape | Gold inflation. Pay from bounded per-town pools and part in items or reputation | Orders ask for *other towns'* goods ("Frostmere wants 20 Birch Planks") and local hunts |
| **Overworld context button** | The owner's "always a button to press", literally | **S**: extend `contextAction()` and stop `setMode` hiding `ctxBtn` | Too many label changes = flicker. Use priorities and hysteresis | Labels say "Attune Wildwatch", "Enter the Hollow Crypt", "Fish here (deep water)" |
| **Daily goals (3) + weekly goal (1)** | Gives a reason to open the game each day | **S–M** on top of quests (`period` = `dayIndex`/`weekIndex`, already in `shared/dungeon.js:45-46`) | The chore spiral. No streak loss, rerolls allowed, unfinished dailies roll over and bank up to 3 days | Dailies rotate between towns; the weekly is a "visit and help X" |
| **Field Journal / collections** (items, fish with record kg, monsters, recipes, regions) | Long-tail goals that new content feeds automatically | **M**: a `journal` table (account, kind, id, first_at, best); hooks at `grantGather`, `land`, `#reward`, the craft result | Pure checklists feel dry. Pay out page rewards: titles, cosmetics, small perks | One page per town or biome, with "3/14 Frostmere fish" |
| **Region discovery %** (landmarks, waystones, viewpoints, hidden spots) | Rewards exploring, which is the owner's #1 goal | **S–M**: a new `landmarks` list in `world.json`, an editor kind, attune-style proximity check (`attuneNearby`, `server/game.js:124-129`) | Map clutter. Hide undiscovered points | This *is* the world: every town region shows "Discovered 7/12" |
| **Treasure chests & hidden spots** | Surprise, plus a reason to leave the roads | **S**: a map entity with a per-hero once-or-weekly flag and a loot roll like `rollChest` | Spoilers spread among friends. Fine for co-op | Placed with the editor off the paths, behind cliffs and on islets |
| **Skill milestones that unlock things** (and say so on level-up) | Fixes the dead skill levels 12–50 | **S** for "what unlocked" text (computed from NODE_TYPES/RECIPES); **M** for new perks at 15/20/25/30… | Power creep. Make most perks side-grades (fishing 20: see fish shadows; foraging 15: seeds drop) | Higher-tier nodes live in harder towns, so the milestone points you to a place |
| **Achievements → titles** | Cheap status in a friend group; shown on profile and nameplate | **S–M**: counters from `craft_log`, `dungeon_runs`, kills | Grind achievements ("kill 10,000") feel like chores. Prefer feats and firsts | "Walked every town", "Caught Old Whiskers", "Cleared all crypts" |
| **Rare roaming elites** | Water-cooler moments and a "drop everything" call to the party | **M**: an elite flag on a spawn (dungeon affixes already exist: `AFFIXES`, `dungeon.js:75`), a timed spawn, an announce plus a map ping | Camping, and offline friends miss out. Long windows, everyone who joins gets loot (co-op rule already used for nodes) | Each biome has its own elite with a signature drop for a gear set |
| **World events** (meteor shower, festival market, monster surge at a town) | Shared moments for a small server | **M–L**: a scheduler, event state in the channel snapshot, a banner | With 2–6 online they feel empty. Size them to the people online, keep them short and scheduled | Rotate the host town, so people travel |
| **Reputation per town** | Gives each town an identity; unlocks a vendor, recipe or cosmetic per town | **M**: `town_rep(account, town, points)`, earned through orders | Another number to grind. Few tiers (3–5) that are reached naturally | Strongly tied to towns |
| **Town projects (community goals)** | Friends build something together: "Repair the Old Bridge: 2,000/5,000 planks" opens a region or a ferry | **M**: a server-wide counter and a map flag on a gate or land | If it stalls the server feels stuck. Size it to the population, or let the owner set targets | This literally grows the world |
| **Seasonal festivals** | Months-scale returns | **L**: content each time | Content treadmill for a hobby project | Decorate one town per season |
| **Gear sets** | Gives a reason to farm a town's dungeon or elite | **M** (content brief) | Balance | One set per town |
| **Rested bonus / catch-up** | Makes coming back feel good, not behind | **S**: from `last_active`, bank +50% XP for N actions | None to speak of | — |
| **Fishing log & tournaments** | Fish already have weights; records are free to keep | **S** for records; **M** for timed tournaments | — | Each town's lake has its own species |

**Guardrails**, given this is a cozy game for friends:
- Nothing should *expire into loss*. Missing a day costs nothing; rewards bank.
- Daily work should fit in about 10 minutes.
- Group progress must count for everyone in the party.
- Every reward is decided on the server (hard constraint).
- Gold from new sources has to come from bounded pools, or `brief_economy.md` §5's inflation risk gets worse.

## 5. Top 8 recommendations (ranked)

1. **A goal card that is always on, driven by data.**
   - Keep the quest card visible forever, showing one pinned goal plus **Take me there**.
   - Source order: active quest step, then a town order, then a daily goal, then an *auto-suggested next upgrade*. Compute the upgrade from `RECIPES` and the hero's level and bag, e.g. "Craft a Copper Pickaxe: need 2 more Copper Bars → Copper Vein, 9 m".
   - Build it on `brief_economy.md`'s `shared/quests.js` and `game.progress(c, ev, data)`. `#questTarget` becomes generic over `{kind: node|monster|building|stone|entrance|town, …}`.
   - This alone removes the 12-minute and level-5 "now what?".
2. **An overworld context button** (`ctxBtn` outside dungeons), plus next-step buttons on result screens.
   - Context button priorities: Join a nearby fight, Deliver to a job, Attune, Enter crypt, Collect till (near the shop), Next node of the type you just worked (nearest alive one, within about 25 m), Cast again.
   - Victory panel: **Fight another {monster}** (nearest alive one of that type) and **Done**.
   - A phone-first fix for "always a button to press". Size **S**.
3. **NPC town orders on every town's notice board**: 3–5 a day per town, seeded by `dayIndex`.
   - Order types: local gather, craft at a grade, hunt, and **import from another town**.
   - Pay from a per-town pool, plus reputation.
   - This makes "prices differ, hauling pays" a visible task, and it keeps the board non-empty for small groups.
4. **Dailies and a weekly, with no chore pressure**:
   - 3 daily goals, rerollable once, banking up to 3 days.
   - 1 weekly goal, ideally a **town project** that friends fill together.
   - Show the existing day twist and first-clear bonus on the same card ("Blood Moon tonight: crypt chests +1 roll"). They already exist and nobody sees them.
5. **Field Journal and region discovery %.**
   - Journal pages per town for gatherables, fish (with record kg), monsters, recipes (seeded from `craft_mastery`), plus landmarks and hidden chests placed with the editor.
   - Rewards at 25/50/75/100% of a page: a title, a cosmetic (the avatar and tool-skin systems are already data-driven, `shared/items.js:64-66`), and a small perk.
   - New content feeds it automatically, which makes it the strongest months-scale retainer for the cost.
6. **Skill milestones that are announced and that point somewhere.**
   - On level-up, list what unlocked and give a **Show me** that places the guide on the nearest such node, recipe or camp.
   - Add side-grade perks every 5 levels to 50, so levels 13–50 mean something. Each new town's resources should start at about skill 12, 18, 25 and 32.
7. **Returning-player digest, with a rested bonus.**
   - On connect, when `now - last_active > 12 h`, show one panel with: shop sales, jobs delivered or expired, market fills, your friends' big moments (rare finds, records, new towns discovered), today's twist, and one suggested goal.
   - Bank a rested XP bonus.
   - Also queue offline notices for job delivery, job expiry and order fills, which are lost today.
8. **Roaming elites and small world events, one per biome**, announced with a **banner, a map ping, and the context button "Join the hunt"**, not only a chat line.
   - Use the co-op rule that everyone who joins gets loot.
   - Each drop is a gear-set piece, which gives each town its "reason to come back".
   - Schedule them visibly ("next sighting in ~40 min").
   - Size to the people online.

**Not ranked but cheap:**
- Remove or implement the "haggle" line.
- Make the tutorial's fight step require a slime (also flagged by the economy brief).
- Show the Combat-5 crypt hint at *hero* level 5 too, not only combat.
