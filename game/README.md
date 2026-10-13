# 🏰 Hearthvale

A cozy multiplayer economy adventure game for phone and PC. You gather, craft, and run a shop, trade on a player-driven market, and fight monsters with friends, all in one shared, living 3D town.

> Inspired by Hypixel Skyblock (gathering skills), Albion Online (player-driven order-book market), Unison League (social lobby + co-op turn-based fights) and Shop Titans (cozy look, running your own shop).

## Why this needs a real game server

"Multiplayer" built on a database (writing your position every 1.5 s and polling) can't make other players feel present. Hearthvale runs an **authoritative game server**, which is how real MMOs work:

| Piece | How it works |
|---|---|
| **Live lobby** | Every player holds a WebSocket to the server. You see everyone in your town **walk, swing axes, fish, fight, emote and chat in real time** (speech bubbles over heads). |
| **Server simulation** | 20 ticks/sec. The server runs pathfinding and movement and owns every rule (tool tiers, skill levels, distances, swing speed). The client never decides outcomes, so cheating a client gets you nothing. |
| **Snapshots** | 10 per second, delta-compressed (only what changed, with a full refresh every 3 s). |
| **Smooth movement** | Your hero moves instantly (**client-side prediction**) and corrects to the server if needed. Other players are **interpolated** ~130 ms behind real time, so they glide rather than teleport. |
| **Channels** | Each channel is a live copy of town (40 heroes max). New players join the **busiest channel that has room**, so friends land together. Click someone in the Town Hall to join their channel. |
| **Economy safety** | SQLite transactions with escrow on every trade. Tests prove gold and items are conserved: nothing duplicates or vanishes. |

## What's in this build

- **Accounts & invites**: invite-only signup, and every player can create 5 invites (no admins). On first boot the server prints a founder invite code; `npm run invite` prints a fresh one any time.
- **Character creator**: a full-body, stylised 3D hero with skin, 7 hairstyles, hair and eye colors, eye styles, 5 outfits, pants, 7 hats, and back items (cape, backpack, wings). Costumes are data in `shared/avatar.js`, so adding one is a single entry. You can re-customize any time from Bag → Hero.
- **3D town, full-screen**: tap or click to move with A* pathfinding. WASD also works on PC. Drag to rotate, pinch or scroll to zoom. The camera follows you, buildings fade when they block your view, and you see an x-ray silhouette when you're behind trees. The town has a minimap, a fountain, a lake with a dock, a forest, a quarry, a herb garden, the Wilds, and butterflies.
- **Getting around**:
  - **Instant menus**: the Craft, Market and Town buttons open their menus straight away, wherever you are. Each one has a **Walk there** button if you'd rather go in person (tapping the building itself still walks you over).
  - **World map**: press **M**, or tap the minimap or the map button. It shows every land, town, path and monster camp, where you and the other heroes are, and every waystone. Drag to pan, scroll or pinch to zoom. Tap a spot to **walk there**, or a waystone to travel.
  - **Waystones (fast travel)**: glowing stones around the world. Walk up to one to **attune** to it. Then, standing at any waystone, open the map and travel to any other one you've attuned to, for a small gold fee that grows with distance. Hearthvale has two: Hearthvale Square and Wildwatch, just past the Wilds Gate.
  - **Region names**: walking into a region shows its name and difficulty tier across the screen (for example *Hearthvale, Tier 1 · Starter · Town*); named areas inside it, like Whisperwood or the Wilds, get a smaller title.
- **Gathering (Skyblock-style)**:
  - **Trees and rocks**: tap to walk over, then **tap to swing**. A shrinking timing ring shows the rhythm, and a swing right on the beat is a **PERFECT** hit for double damage. The server checks the timing, so it can't be faked.
  - **Node feedback**: each node shows an HP bar, wood chips, falling leaves, sparks and camera shake. Trees topple away from you with a thud, rocks shatter, and both regrow later.
  - **Shared nodes**: chop a tree together and everyone who helped gets the loot.
  - **Herbs**: a single pick.
  - **Fishing**: cast, wait for the bite, tap to hook, then win a **reel fight**. Hold to lift a green catch bar and keep the darting fish inside it until the meter fills. Big fish (pike, golden koi, and Old Whiskers, the legendary lake king that only bites in deep water) are faster and more erratic. Better rods give a bigger bar and faster reeling, so the biggest catches need upgraded gear. The server replays your exact button presses through the same deterministic simulation to confirm every catch, so it can't be faked.
  - **Skills and rare drops**: Foraging, Mining, Herbalism and Fishing level up and increase your double-drop chance. Rare drops (Golden Acorn, Sapphire, Golden Koi) are announced to the whole server.
  - **Tools change in your hand**: the axe, pickaxe, rod or sword shows in your hero's hand depending on what you're doing. Each tier has its own 3D model (wood → copper → iron → gold, with gold glowing). New skins are just data in `shared/items.js`.
- **Hands-on crafting**: you make things yourself at five stations in the Workshop yard: **Forge** (smelt bars), **Anvil** (hammer tools, blades and plate), **Workbench** (saw planks, stitch leather, assemble rods), **Grindstone** and **Cookpot** (food and potions).
  - **The minigame**: each step is a timing beat with one button. Tap as a ring closes (hammer, saw), tap as a marker crosses the mark (pour, quench), or hold and let go in the band (heat, bellows, simmer). A good heat makes the hammering that follows more forgiving.
  - **Results are graded S to D**: never worse than the plain recipe. Refining and food get up to +20% bonus yield. Tools and gear can come out **Fine** (+15% stats) or, rarely, **Masterwork** (+30%, announced to the town).
  - **Anti-cheat**: the server replays your recorded timing, the same way it checks fishing.
  - **Quick craft**: once you've made a refining or cooking recipe well 3 times, you can batch it without the minigame for a small fee and half XP.
- **Player-driven market (Albion-style order book)**:
  - **Orders**: place buy or sell orders, or **buy/sell instantly** against the book.
  - **Matching**: price-time priority with partial fills. Your goods or gold are held in escrow, and cancelling refunds exactly what's left.
  - **Tax**: a 4% sales tax acts as the gold sink.
  - **Market data**: price-history chart, order-book depth, and 24h volume and average.
  - **Room to trade**: scalping and flipping are possible on purpose.
- **Your shop: walk in, set prices, leave**:
  - **A real interior**: tap Shop (or walk through Your Shop's door) and you're inside your own merchant hall, with 8 displays (shelves, tables, a weapon rack, a bin and a pedestal) showing the actual goods.
  - **Passive selling**: put items on displays with a price and go adventuring. NPC townsfolk come in and buy over time, even while you're offline. Each display shows a live forecast: buy chance, sales per hour, when it sells out. The gold goes into your **till**; collect it from the counter or the Ledger.
  - **Town demand**: each item has a town-wide pool of NPC demand that refills over 8 hours, so flooding the town with one item lowers what townsfolk will pay. Fair prices sell, greedy ones don't (never above 1.5× value).
  - **Friends shop in person**: visit any shop from Town Hall → Shops or a player's profile, walk around with whoever's inside, and buy at the shown price (4% fee, same as the market; 8% guild levy on NPC sales).
  - **While you were away**: a summary of what sold, who bought, and your till.
- **Bulletin board (paid jobs)**: the board in the town square (or Town Hall → Jobs) lists jobs players have posted, like "bring me 20 Oak Logs at 5 🪙 each". Use it to get others to gather or craft for you.
  - **Posting**: pick the item, how many and the pay per item. The full reward is held when you post, so every job pays. You can have 5 jobs up at once, each for 3 days.
  - **Delivering**: hand in some or all of what's wanted and get paid on the spot, less the usual 4% tax. The goods go straight into the poster's bag, even while they're offline.
  - **Refunds**: cancel a job, or let it run out, and you get back the gold for whatever wasn't delivered.
- **Co-op battles in the world**: monsters roam the Wilds (slimes, wolves, goblins, and a Ruinwarden Golem boss). Tap one to start a turn-based fight right where it stands. **Anyone nearby can tap the same monster to join** (up to 4). Each round has a 12 s timer and the actions are Attack, Special (charges up), Defend, Item (potions) and Flee. Other players can watch the fight happen.
- **Dungeons: the Hollow Crypt**: a crypt door in the Wilds (marked with a tombstone on the map) leads to a new crypt every run, built from scratch by the server. Go in alone or with your party.
  - **The crypt**: an Entry Hall, a chain of halls to the Pale Count's chamber, side halls, a Shrine and a locked Vault. Each room's monsters fight you as one pack, one after another, and its gates open when the room is clear. Rooms appear as you explore them. Spike traps guard the way to the Shrine and the Vault.
  - **No health comes back on its own** down there. The brazier in the Entry Hall gives each hero one full heal (Last Light), praying at the Shrine heals the whole party once, and clearing a room gives back a little. Potions work outside fights too.
  - **The elite** (a bigger monster with one or two powers: Armored, Frenzied, Vampiric, Thorny) carries the **Bone Key** to the Vault. **The Pale Count** gathers a Blood Mist that hits everyone the round after he warns you, so Defend.
  - **Losing**: if everyone in a fight is knocked out, you all wake in the Entry Hall at half health and the monsters you'd already beaten stay down. The fourth wipe ends the run (you keep what you found).
  - **Loot**: monsters drop gold and Grave Dust as you beat them. The Vault and the boss chest give every hero their own share: gold, potions, ore, gems and a chance at crypt gear (Wraithsteel Blade, Barrow Plate, Ghostlight Amulet), which can also be forged from Grave Dust. Your first clear of each tier each day gives double treasure.
  - **Tiers, records and the day's twist**: clearing Tier 1 opens Tier 2, then Tier 3 (tougher monsters, better loot). Every day has a twist (Blood Moon: harder hits and more treasure; Restless Dead; Brittle Bones). Best times are kept per party size, and **This week's crypt** is the same layout for everyone, with a leaderboard.
  - **Groups are harder, and pay more**: monsters have more health and act once for every hero standing, groups of three or four get more halls and nastier elites, and every hero earns more gold and treasure. Tuned with a simulator (`node scripts/dungeon-balance.js`): equal heroes clear about 90% of runs alone, 75% as two, 60% as three or four.
  - **Underground controls**: the camera turns in quarter turns (drag sideways, or Q / R) and the near walls drop away so you can always see in. Tap things to use them, or use the round button (Rest, Pray, Open, Join your friend's fight, Leave). The Map button shows the crypt so far.
- **Parties**: invite up to three friends from the Town Hall's Online list or their profile. Your party shows at the side of the screen with everyone's health. The leader starts a **ready check** at the crypt door and everyone who says yes goes in together; anyone who missed it can still join from the Party panel until the boss falls. Fights inside pull in everyone standing in the same room. A dropped connection keeps your place in the run for 3 minutes.
- **Social**: channel chat with speech bubbles, emotes (wave, dance, cheer, heart, sit), player profiles, online list, leaderboards, and a shop directory.
- **Onboarding quest**: chop → craft → fight → stock your shop, with gold rewards. A light pillar marks the target, glowing dots trace the walking path, an arrow around your hero points the way with the distance, and a **Take me there** button walks you over.

## Run it

Requires **Node 22.5+** (it uses the built-in `node:sqlite`).

```bash
cd game
npm install
npm run dev          # game server on :8787 + Vite client on :5173 (hot reload)
```

Open http://localhost:5173. The server log prints a **founder invite code** for the very first account. After that, create invites for friends in the **Town Hall → Invites** tab.

Lost the code, or need one later? In a second terminal in the `game` folder run `npm run invite` (Windows: `npm.cmd run invite`). It prints a code you can sign up with, whether or not the server is running, and lists the accounts already on this save in case you just need to log in.

To play on your phone on the same Wi-Fi, open `http://<your-computer's-IP>:5173`.

**See a busy lobby:** in a second terminal, run `npm run bots` (or `npm run bots -- 12` for 12 bots). Bots are ordinary WebSocket players that wander, chop, chat and wave.

**Tests:** `npm test` runs the economy conservation tests, the fishing simulation and anti-cheat tests, the map reachability checks, and real-WebSocket multiplayer tests.

## Deploy (to play with friends over the internet)

This needs a host that supports **long-running Node processes and WebSockets**, plus a **persistent disk** for the SQLite save file. Render, Railway and Fly.io all work, as does any VPS.

```bash
npm run build && npm start        # serves everything on $PORT (default 8787)
# or
docker build -t hearthvale . && docker run -p 8787:8787 -v hearthvale-data:/data hearthvale
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP + WebSocket port |
| `DATA_DIR` | `./data` | Where `hearthvale.db` lives (put it on a persistent volume) |
| `FOUNDER_INVITE` | random | Set the first invite code yourself |
| `CHANNEL_CAP` | `40` | Max heroes per town channel |
| `OPEN_SIGNUP` | off | `1` = no invite needed (local testing only) |

## Code map

```
maps/     world.json  the world map: everything placed in the world (see below)
shared/   rules & data used by BOTH server and client (items, recipes, skills,
          monsters, avatar options, the world map loader)
          nodes.js  gathering node types      nav.js  colliders, walkability, A* navigation
          roads.js  the road network (long walks go by road)
          places.js which region / town / biome a point is in (world.js indexes them)
          content/  content packs (a town's items, nodes, monsters, recipes…) merged into the tables
server/   game.js   the hub: connections, the 20 Hz tick, channels, shops, dungeons, chat
          rpc.js    the RPC table (each module registers its own)
          events.js the event bus (gather, craft, kill, …): tutorial.js listens to it
          gather.js gathering + fishing   move.js walking   travel.js waystones
          trade.js  market, merchant, bulletin board RPCs   gear.js equip, potions, profiles
          channel.js a channel (one live copy of town)      battle.js turn-based battles
          dungeons.js dungeon runs (a run is a private channel)   party.js parties
          market.js order book + matching + escrow     jobs.js bulletin board
          shop.js   player shops: displays, till, NPC customer simulation
          rooms.js  shop interiors (who's inside, movement)
          heroes.js inventory/gold/xp persistence      auth.js  invites + sessions
          db.js     the database (migrations 1–6); migrations/ holds 007 on
          map.js    loads the world map, serves it at /api/map, saves edits
          app.js    HTTP API + WebSocket upgrade        index.js entry point
client/   src/game.js       the game client: entities, input, prediction, interpolation
          src/scene/        render.js (frame passes, camera, shadow pass), mood.js (fog and light),
                            town.js (the world, streamed in 96 m chunks), chunkmerge.js (a chunk's
                            scenery merged by material), scatter.js (ground cover), skyline.js,
                            weather.js, dungeon, avatar, tools, monsters, particles (three.js,
                            toon-shaded), manifest/ (the model slots, in groups)
          src/world/        services.js: walking to buildings, stations, waystones, the crypt
          src/editor/       the world editor (owners only): editor.js, kinds.js
          src/ui/           HUD (hud.js + goalcard, dock, banners, context, labels), panels
                            (bag, workshop, market, board, shop, town hall), world map, creator
scripts/  bots.js (populate the lobby), dev.js, invite.js, admin.js (server owners),
          dungeon-balance.js (simulates dungeon runs with the real numbers)
```

## Performance (phones first)

The game is built to run on a mid-range phone. The budgets (draw calls, triangles, textures, shaders, load size) are in `shared/budget.js`.

- **`npm run perf:census`** plays the game in a headless browser at phone size and measures it at fixed spots (default camera, zoomed out, a crowd of 9), then fails if any budget is missed. Add `-- --map stress` to measure the five-town stress map instead (`maps/fixtures/stress.json`, made by `npm run gen:stress`). It needs Playwright installed (`npm i -g playwright`, then run with `NODE_PATH=$(npm root -g)`).
- **The estimator** (`estimateChunk` in `shared/budget.js`) predicts what a chunk of the map will cost from the map alone, using `shared/slot-stats.js` (made by `node scripts/perf/slot-stats.mjs` from the model files). `server/tests/budget.test.js` keeps it within 15% of the census.
- **Players' phones** report how the game runs every minute; the server owner sees the summary in the Town Hall's Performance tab.

## The world map

Everything placed in the world lives in **`maps/world.json`**: the land itself (`lands`: circles that overlap into any coastline, so you can grow the island, join islands with land bridges, or start a new island far out at sea), buildings, the gate, plazas, fountains, lakes and docks, zones, dirt paths, gatherable nodes, monster camps (`spawns`), and every prop, tree and flower. The server loads it on start and sends it to each player's browser (`/api/map`), so both sides always build the same world. Small scatter (grass tufts, stepping stones, reeds, lily pads) is generated from it automatically.

- **Format:** one entity per line, each with a unique `id`. The fields are documented at the top of `shared/world.js`. A prop's `slot` is a model from `client/src/scene/manifest/core.js` or a code-drawn kind from `client/src/scene/procprops.js` (`proc_…`).
- **Regions and tiers:** `regions` lists the towns and areas with a difficulty `tier` (Hearthvale is tier 1, the starter town). Their names appear on the world map and across the screen as you walk in.
- **Dungeon entrances:** `entrances` lists the crypt doors (`kind`, position, and `rot`, the way the door faces). The dungeons themselves aren't in the map: the server builds a new one for every run (`shared/dungeon.js`).
- **Waystones:** `stones` lists the fast-travel stones (`name`, position, and `rot`, the way it faces: travellers arrive in front of it). Maps made before waystones existed get Hearthvale's two automatically.
- **Checks:** a broken map stops the server with a list of exactly what's wrong (duplicate ids, unknown node types or monsters, missing coordinates).
- **Your own copy:** a map saved to `data/maps/world.json` (next to your saves) is used instead, unless the game ships a map with a higher `rev`.

## The world editor (server owners)

The first account made on a server is its **owner**. Owners get an **Edit the world** button in the Town Hall, which opens the editor: the real world seen from above, where you can change anything.

- **Look around:** drag empty ground to pan, right-drag to turn the view, scroll (or pinch) to zoom. WASD and the arrow keys also pan.
- **Jump anywhere:** **Map** (or M) shows the whole world from above, the same map players see; click anywhere to jump there. The **World** tab also lists every region, waystone and main building: click one to go to it.
- **Owner teleport in the game:** owners get a **Teleport (owner)** button on the world map (tap any spot on land, or a waystone), free, to check their building work up close.
- **Select and move:** click something to select it; its details appear in the panel on the right, where you can type exact values. Drag it to move it. Big areas (zones, monster camps, regions, lakes) need a click first, so you can still pan across them. Clicking the same spot again picks the next thing underneath.
- **Place:** open **Place**, pick something (plants, town props, resource nodes, monster camps, cottages, waystones, dungeon entrances, docks, fountains, plazas, lakes, zones, regions), then click the world. Plants and nodes keep placing until you press Esc. *Natural variety* gives plants a random turn and size.
- **Paths:** **Path**, click points, then double-click the last point (or press Enter). Select a path to drag its points, add more, or change its width.
- **Keys:** Q / E turn the selection, Delete removes it, Ctrl+D copies it, Ctrl+Z / Ctrl+Y undo and redo, G turns grid snapping on and off, Ctrl+S saves.
- **Saving:** **Save** checks the map, then checks that every resource node, door, monster camp and waystone can still be walked to from the spawn point, and tells you if something is cut off. Saving makes the change live straight away: anyone playing sees "The world was updated" and rejoins the new version a second later. The previous version is kept in `data/maps/backups/` (the last 30 saves).
- **Drafts:** unsaved edits are kept in your browser; if you close the editor without saving, it offers them back next time.
- **Export / Import:** **Export** downloads the map as a file, to keep a copy or send it over. **Import** loads one back in (then Save to make it live).
- **More owners:** `npm run admin -- <username>` (Windows: `npm.cmd run admin -- <username>`) makes someone an owner, `npm run admin -- <username> off` removes them, and `npm run admin` lists the owners.

The Workshop's five crafting stations and the four main buildings (Workshop, Market, Your Shop, Town Hall) can be moved but not deleted, because the game needs them.

## Roadmap (next phases)

**What we're aiming for** (the test for every step):

- **A big world worth exploring**: expansive and good-looking, big enough that there's always somewhere new to go, with each place feeling different.
- **Runs well on phones**: smooth on a mid-range phone, not just a PC. Anything that costs frames on mobile gets a cheaper version there.
- **Always something to do**: whenever you open the game there's a clear next thing worth doing, whether that's a goal, a job, a fight, a craft, a trade or a place to explore. Never "now what?".
- **Content that lasts**: enough places, monsters, gear, recipes, rare finds, collections and long goals that people want to keep playing for a long time.

The big plan, one step at a time:

1. **Map as data** (done): the world lives in `maps/world.json` instead of code.
2. **In-game map editor** (done): owners place, move and delete anything, draw paths, set monster camps, and save it live.
3. **A much bigger world**, in three parts:
   - **3a, the engine** (done): land of any shape, collision checks that only look nearby, pathfinding that works out the map a tile at a time, the world drawn in 96 m tiles that load around the camera and drop behind, and monsters only sent to players within about 100 m.
   - **3b, travel** (done): waystones you attune to by visiting, then fast-travel between for a gold fee; a full world map (M); region names as you enter. The Craft, Market and Town buttons also open their menus instantly now.
   - **3c, editor extras** (done): a whole-world map in the editor (click to jump there), go-to lists for regions, waystones and buildings, and owner teleport in the game.
4. **The wider world** (in progress): four or five major towns, from the starter town up through harder ones. Each has its own biome and look, resources, monsters, recipes, dungeon and market (prices differ between towns, so hauling goods pays). The land between them is worth crossing, and there's a steady stream of things to do at every level.
5. **Personal land and building** (Skyblock-style): your own plot with buildings that make money over time, using the editor's placement tools.
6. **An outlaw zone**: opt-in full-loot PvP for what you carry, bandit NPCs, and the best rewards in the game.
7. **Procedurally generated dungeons** (done): the Hollow Crypt, a fresh layout every run, solo or with a party (parties, ready checks), harder and better-paying for groups, with tiers, daily twists and a weekly leaderboard. More dungeons can be added as data in `shared/dungeon.js`.
8. **A bulletin board** for paid jobs (done): post a task you'd rather not do ("collect 50 iron ore", "craft 10 health potions") with a gold reward. The gold is held when you post and paid to whoever hands in the goods.

Also planned:

- **PvP duels**, using the same turn-based battle engine.
- **Auctions** for rare items (bid and buyout), alongside the order book.
- **Cosmetics and costumes**: the avatar and tool-skin systems are already data-driven.
- **Shop decoration** and upgrades (more displays, bigger rooms).
