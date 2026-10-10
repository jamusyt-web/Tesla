# 🏰 Hearthvale

A cozy multiplayer economy adventure game for phone and PC. You gather, craft, and run a shop, trade on a player-driven market, and fight monsters with friends, all in one shared, living 3D town.

> Inspired by Hypixel Skyblock (gathering skills), Albion Online (player-driven order-book market), Unison League (social lobby + co-op turn-based fights) and Shop Titans (cozy look, serving customers in your shop).

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

- **Accounts & invites**: invite-only signup, and every player can create 5 invites (no admins). On first boot the server prints a founder invite code.
- **Character creator**: full-body 3D chibi with skin, 7 hairstyles, hair and eye colors, eye styles, 5 outfits, pants, 7 hats, and back items (cape, backpack, wings). Costumes are data in `shared/avatar.js`, so adding one is a single entry. You can re-customize any time from Bag → Hero.
- **3D town, full-screen**: tap or click to move with A* pathfinding. WASD also works on PC. Drag to rotate, pinch or scroll to zoom. The camera follows you, buildings fade when they block your view, and you see an x-ray silhouette when you're behind trees. The town has a minimap, a fountain, a lake with a dock, a forest, a quarry, a herb garden, the Wilds, and drifting clouds and butterflies.
- **Gathering (Skyblock-style)**:
  - **Trees and rocks**: tap to walk over, then **tap to swing**. A shrinking timing ring shows the rhythm, and a swing right on the beat is a **PERFECT** hit for double damage. The server checks the timing, so it can't be faked.
  - **Node feedback**: each node shows an HP bar, wood chips, falling leaves, sparks and camera shake. Trees topple away from you with a thud, rocks shatter, and both regrow later.
  - **Shared nodes**: chop a tree together and everyone who helped gets the loot.
  - **Herbs and fishing**: herbs are a single pick. Fishing means casting, waiting for a bite, then tapping REEL in time.
  - **Skills and rare drops**: Foraging, Mining, Herbalism and Fishing level up and increase your double-drop chance. Rare drops (Golden Acorn, Sapphire, Golden Koi) are announced to the whole server.
  - **Tools change in your hand**: the axe, pickaxe, rod or sword shows in your hero's hand depending on what you're doing. Each tier has its own 3D model (wood → copper → iron → gold, with gold glowing). New skins are just data in `shared/items.js`.
- **Crafting**: 23 recipes at the Workshop: refined materials, potions and food, tool upgrades, weapons, armor and a trinket. Crafted goods are worth much more than raw resources.
- **Player-driven market (Albion-style order book)**:
  - **Orders**: place buy or sell orders, or **buy/sell instantly** against the book.
  - **Matching**: price-time priority with partial fills. Your goods or gold are held in escrow, and cancelling refunds exactly what's left.
  - **Tax**: a 4% sales tax acts as the gold sink.
  - **Market data**: price-history chart, order-book depth, and 24h volume and average.
  - **Room to trade**: scalping and flipping are possible on purpose.
- **Your shop (Shop Titans-style)**:
  - **Shelves**: stock 8 shelves and set your own prices.
  - **Live customers**: while you're in your shop, NPC customers walk in. **Sell**, **Haggle** (a gamble on +25%) or decline each one before their patience runs out.
  - **Selling while away**: NPC shoppers keep buying when you're offline, and you get a "while you were away" summary. They buy at fair prices and avoid greedy ones.
  - **Other players**: they can browse your shop from the Town Hall or your profile and buy from it.
- **Co-op battles in the world**: monsters roam the Wilds (slimes, wolves, goblins, and a Mossy Golem boss). Tap one to start a turn-based fight right where it stands. **Anyone nearby can tap the same monster to join** (up to 4). Each round has a 12 s timer and the actions are Attack, Special (charges up), Defend, Item (potions) and Flee. Other players can watch the fight happen.
- **Social**: channel chat with speech bubbles, emotes (wave, dance, cheer, heart, sit), player profiles, online list, leaderboards, and a shop directory.
- **Onboarding quest**: chop → craft → fight → stock your shop, with an on-screen guide arrow and gold rewards.

## Run it

Requires **Node 22.5+** (it uses the built-in `node:sqlite`).

```bash
cd game
npm install
npm run dev          # game server on :8787 + Vite client on :5173 (hot reload)
```

Open http://localhost:5173. The server log prints a **founder invite code** for the very first account. After that, create invites for friends in the **Town Hall → Invites** tab.

To play on your phone on the same Wi-Fi, open `http://<your-computer's-IP>:5173`.

**See a busy lobby:** in a second terminal, run `npm run bots` (or `npm run bots -- 12` for 12 bots). Bots are ordinary WebSocket players that wander, chop, chat and wave.

**Tests:** `npm test` runs economy conservation tests and real-WebSocket multiplayer tests.

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
shared/   rules & data used by BOTH server and client (items, recipes, skills,
          monsters, avatar options, the world map + A* navigation)
server/   game.js   channels, 20Hz tick, movement, gathering, fishing, battles, chat
          market.js order book + matching + escrow
          shop.js   personal shops, NPC customers
          heroes.js inventory/gold/xp persistence      auth.js  invites + sessions
          app.js    HTTP API + WebSocket upgrade        index.js entry point
client/   src/game.js       renderer, camera, input, prediction, interpolation
          src/scene/        town, avatar, tools, monsters, particles (three.js, toon-shaded)
          src/ui/           HUD, menus (bag, workshop, market, shop, town hall), creator
scripts/  bots.js (populate the lobby), dev.js
```

## Roadmap (next phases)

- **Towns & rivalry**: multiple biome towns, each with its own market and resources (the server already runs separate channels, so this extends naturally), plus town membership and growth projects.
- **Group dungeons**: instanced multi-room co-op runs with bosses and better loot.
- **PvP duels**, using the same turn-based battle engine.
- **Auctions** for rare items (bid and buyout), alongside the order book.
- **Your own island** (stashed idea): a personal, fully customizable plot you build on to earn money, Skyblock-style.
- **Cosmetics and costumes**: the avatar and tool-skin systems are already data-driven.
- **Shop decoration** and a 3D shop interior.
