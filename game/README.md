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
- **Co-op battles in the world**: monsters roam the Wilds (slimes, wolves, goblins, and a Ruinwarden Golem boss). Tap one to start a turn-based fight right where it stands. **Anyone nearby can tap the same monster to join** (up to 4). Each round has a 12 s timer and the actions are Attack, Special (charges up), Defend, Item (potions) and Flee. Other players can watch the fight happen.
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
          monsters, avatar options, world rules + the map loader, A* navigation)
server/   game.js   channels, 20Hz tick, movement, gathering, fishing, battles, chat
          market.js order book + matching + escrow
          shop.js   player shops: displays, till, NPC customer simulation
          rooms.js  shop interiors (who's inside, movement)
          heroes.js inventory/gold/xp persistence      auth.js  invites + sessions
          map.js    loads the world map, serves it at /api/map
          app.js    HTTP API + WebSocket upgrade        index.js entry point
client/   src/game.js       renderer, camera, input, prediction, interpolation
          src/scene/        town, avatar, tools, monsters, particles (three.js, toon-shaded)
          src/ui/           HUD, menus (bag, workshop, market, shop, town hall), creator
scripts/  bots.js (populate the lobby), dev.js
```

## The world map

Everything placed in the world lives in **`maps/world.json`**: buildings, the gate, plazas, fountains, lakes and docks, zones, dirt paths, gatherable nodes, monster camps (`spawns`), and every prop, tree and flower. The server loads it on start and sends it to each player's browser (`/api/map`), so both sides always build the same world. Small scatter (grass tufts, stepping stones, reeds, lily pads) is generated from it automatically.

- **Format:** one entity per line, each with a unique `id`. The fields are documented at the top of `shared/world.js`. A prop's `slot` is a model from `client/src/scene/manifest.js` or a code-drawn kind from `client/src/scene/procprops.js` (`proc_…`).
- **Regions and tiers:** `regions` lists the towns and areas with a difficulty `tier` (Hearthvale is tier 1, the starter town).
- **Checks:** a broken map stops the server with a list of exactly what's wrong (duplicate ids, unknown node types or monsters, missing coordinates).
- **Your own copy:** a map saved to `data/maps/world.json` (next to your saves) is used instead, unless the game ships a map with a higher `rev`.

## Roadmap (next phases)

The big plan, one step at a time:

1. **Map as data** (done): the world lives in `maps/world.json` instead of code.
2. **In-game map editor**, for the server owner: fly around, place, move and delete buildings, props, trees, nodes and monster camps, paint paths, save.
3. **A much bigger world**: load and draw only what's near you, split the world into regions, travel between them.
4. **Four or five major towns**, from the starter town up through harder ones, each with its own biome, resources, monsters and market (prices differ between towns, so hauling goods pays).
5. **Personal land and building** (Skyblock-style): your own plot with buildings that make money over time, using the editor's placement tools.
6. **An outlaw zone**: opt-in full-loot PvP for what you carry, bandit NPCs, and the best rewards in the game.

Also planned:

- **Group dungeons**: instanced multi-room co-op runs with bosses and better loot.
- **PvP duels**, using the same turn-based battle engine.
- **Auctions** for rare items (bid and buyout), alongside the order book.
- **Cosmetics and costumes**: the avatar and tool-skin systems are already data-driven.
- **Shop decoration** and upgrades (more displays, bigger rooms).
