# Read me first

## Two projects live in this repo, on different branches

- **Hearthvale** (the game) is in `game/` on branch **`claude/intelligent-brahmagupta-dqjx6n`**. Unless the owner says otherwise, this is what we're working on.
- **The Tesla Model 3 steering-wheel volume chip** (ESP32 firmware) lives in the root `README.md`, `docs/` and `firmware/`. Its own branch is `claude/tesla-wheel-volume-chip-hsou3r`. It's a separate project: don't touch it unless asked.

If you can't see a `game/` folder, you're on the wrong branch. Run `git fetch origin claude/intelligent-brahmagupta-dqjx6n && git checkout claude/intelligent-brahmagupta-dqjx6n`.

## What we're building

Hearthvale is a multiplayer browser game for a group of friends, played mostly on **phones** and also on PCs. It's a cosy MMO-lite where you gather, craft, trade, run a shop and fight together, in a 3D toon-shaded world.

The owner's goals, the test for every change (full wording in `game/docs/world/GOALS.md`):
1. **A big world worth exploring.** It should be expansive and good-looking, big enough that nobody gets bored, with each place feeling different.
2. **Runs well on a mid-range phone.** Anything that costs frames there gets a cheaper version.
3. **Always something to do.** There should always be a clear next thing, an obvious "button to press". Never "now what?".
4. **Content that lasts.** Enough places, monsters, gear, recipes, rare finds and long goals to keep people playing for months.

## What exists today

The game is playable. See `game/README.md` for the full list. It has:
- invite-only accounts and a character creator;
- a 3D island town (Hearthvale) with tap-to-move;
- gathering with rhythm swings, and fishing with a reel fight;
- hands-on crafting minigames;
- a player market with an order book;
- player shops with NPC customers;
- a bulletin board for paid jobs;
- co-op turn-based battles;
- procedural dungeons (the Hollow Crypt) with parties and ready checks;
- waystones and a world map;
- a world editor for the server owner.

## What we're building now: roadmap step 4, "The Hearthlands"

This step grows the world from one island to five towns, each with its own biome, monsters, resources, market and dungeon:

| Town | Tier | Biome |
|---|---|---|
| Hearthvale | 1 | meadow |
| Amberfold | 2 | autumn |
| Rimeholt | 3 | snow |
| Sandmere | 4 | desert |
| Starfall | 5 | crystal |

Alongside the towns come guidance systems so there's always a next thing to do (goal card, context button, quests, orders, journal), and phone-performance work done first.

- **The plan:** `game/docs/world/SPEC.md`, with the phases in §10. It's large, so read only the sections you need.
- **How to pick up the work:** `game/docs/world/HANDOFF.md`.
- **Background research:** `game/docs/world/briefs/`, covering the engine, content, economy, 3D assets, engagement and phone performance.
- **Progress:** check `git log` on the game branch. Phase 0 (seams) is done. In Phase 1, P1 (compressed downloads), P2 (render loop, about 850 → 310 draw calls at spawn) P3 (assets: textures 87 → 7 MB, shaders under 40, all compiled up front, lazy model groups) P6 (characters merged: a hero ~7 draws, a monster ~3) and P4 (the world streamed and merged in 96 m chunks: spawn ~85 draws, worst camera angle ~125, shadow pass ~16; shadow pass ~16) P5 (water: the coast baked into a distance texture, so any number of land circles works; sea and lake colours settable per biome; ice lakes) P7 (server scale: spatial index, walking grid per tile, road routes, sleeping areas; tick 0.8 ms p95 on a five-town-sized test world) and P8 (perf gate: `npm run perf:census`, the stress map, the budget estimator, economy telemetry, phone performance reports; today's map and the stress map are within every budget, spawn ~75 draws) are done. Next: M1–M6 and I1, then Gate G1. When you finish a package, update this line.

## How to work here

- **Branch:** commit and push to `claude/intelligent-brahmagupta-dqjx6n`. Don't open pull requests unless the owner asks. Commit after each finished piece of work so nothing is lost; the cloud container is temporary.
- **Commit messages:** end each one with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus your session's `Claude-Session:` link. Never put model names anywhere else in a commit.
- **Tests:** `cd game && npm test` must stay green. One fishing test occasionally fails on random rolls when the whole suite runs at once; rerun it before assuming a real failure.
- **Play-testing:**
  - Build with `cd game && npx vite build`.
  - Start a server with `OPEN_SIGNUP=1 PORT=8790 DATA_DIR=<a temp dir> node --no-warnings server/index.js`.
  - Drive it with Playwright headless Chromium, launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, at phone size (390×844).
  - The first account on a fresh data dir is the server owner and can teleport.
  - Stop the server with `pkill -f "^node --no-warnings server/index.js"`.
- **Code style:** plain JS modules, data-driven content, small functions, and comments in plain English. The server is authoritative: the client never decides rewards.
- **Save tokens; the owner pays for usage:**
  - Build directly instead of spawning lots of agents; each new agent has to re-learn the codebase.
  - Use at most one review agent per phase.
  - Keep reports short and take few screenshots.
  - No multi-agent "panels" unless the owner asks.
- **Talking to the owner:** they're not a programmer. Explain what changed and how to try it in plain words.
