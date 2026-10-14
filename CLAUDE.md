# Read me first

## Two projects live in this repo, on different branches

- **Hearthvale** (the game) is in `game/` on branch **`claude/intelligent-brahmagupta-dqjx6n`**. Unless the owner says otherwise, this is what we're working on.
- **The Tesla Model 3 steering-wheel volume chip** (ESP32 firmware) lives in the root `README.md`, `docs/` and `firmware/`. Its own branch is `claude/tesla-wheel-volume-chip-hsou3r`. It's a separate project: don't touch it unless asked.

If you can't see a `game/` folder, you're on the wrong branch. Run `git fetch origin claude/intelligent-brahmagupta-dqjx6n && git checkout claude/intelligent-brahmagupta-dqjx6n`.

## What we're building

Hearthvale is a multiplayer browser game for a group of friends, played mostly on **phones** and also on PCs. It's a cosy MMO-lite where you gather, craft, trade, run a shop and fight together, in a 3D toon-shaded world.

The owner's goals, the test for every change (full wording in `game/docs/world/GOALS.md`):
1. **A big world worth exploring.** It should be expansive and good-looking, big enough that nobody gets bored, with each place feeling different. The owner has said: "I'd like this game to be pretty expansive", so be generous with content.
2. **Runs well on a mid-range phone.** Anything that costs frames there gets a cheaper version.
3. **Always something to do.** There should always be a clear next thing, an obvious "button to press". Never "now what?".
4. **Content that lasts.** Enough places, monsters, gear, recipes, rare finds and long goals to keep people playing for months.

## The feel we're going for

**Bright, cosy and easy.** Think of a cheerful mobile life-sim, not dark fantasy. The owner found the old dark-brown, gold-serif look "aged and depressing". It was replaced in October 2026, and new screens must match the new look.

- **Look.** Light rounded cards and panels (cream `--paper`, cards one tone darker `--cream`) floating over the 3D world, and a sky-blue and green-hills login.
  - Surfaces are told apart by a **step in tone, not by lines**. No brown outlines, no gradients on buttons, and no dark panels.
- **Type.** Fredoka for headings and big numbers (`--font-display`), Nunito for everything else. Sentence case, with no tiny letter-spaced capitals. Text is at least 13px on phones.
- **Colour has meaning.** Each colour does one job:
  - green (`--green`): go or do;
  - gold (`--gold`): money and rewards (gold text uses `--gold-ink`);
  - coral (`--red`): danger, damage and cancel;
  - sky blue (`--blue`): info and travel;
  - purple: magic and rarity.

  Each bottom-bar button has its own colour (by `data-k`).
- **Buttons.** Flat colour, fully rounded, with a darker lip underneath that presses down (`.btn`, `.btn.green/.blue/.red/.plain`). Make them thumb-sized: about 44px or more. Long button text wraps (`.btn.block`).
- **Phones first.** Panels are bottom sheets with a grab handle. Many tabs make one row you swipe sideways. Nothing may cover the chat box or the round action button.
- **Hands-on, physical feel.** Actions should feel like doing the thing, with sound, a little buzz and bits flying. Crafting is the model: you tap the hot spot to hammer, saw back and forth, carve along the line and stir the pot (see below).
- **All colours are tokens** in `game/client/src/style.css` `:root`. Use them; don't hard-code new colours in JS.
- **Design skills** are installed in `.claude/skills/`:
  - `redesign-skill`: upgrades an existing app; use its audit checklist;
  - `taste-skill`: built for websites, not app screens, so take only its general type, colour and critique advice.
- **Check UI work by looking at it.** `game/scripts/ui-tour.cjs` screenshots every screen at phone size. Combine the shots three to an image with `montage` to save tokens.

## What exists today

The game is playable. See `game/README.md` for the full list. It has:
- invite-only accounts (players make invite codes in **Town → Invites**) and a character creator;
- a 3D island town (Hearthvale) with tap-to-move, and since Phase 3 a second town, **Amberfold** (autumn), down the Westmarch road from Hearthvale's West Gate;
- gathering with rhythm swings, and fishing with a reel fight;
- **hands-on crafting by real motions** (`shared/crafting.js`, `client/src/ui/craftgame.js`):
  - each step is a tap on a glowing spot, a hold-and-release, a saw, a carve along a line, or a stir;
  - crafts take 2 to 10 strokes;
  - the client records the finger inputs, and the server replays them to grade S to D. This uses only plain arithmetic and `Math.sqrt` so every browser agrees;
- a player market with an order book;
- player shops with NPC customers;
- a bulletin board for paid jobs;
- co-op turn-based battles;
- procedural dungeons (the Hollow Crypt) with parties and ready checks;
- waystones and a world map;
- a world editor for the server owner;
- the guidance spine from Phase 2:
  - the goal card (Compass) and the round context button;
  - quests (the 10-step `hv_intro` plus eight side chains);
  - the Book (Quests, Today, Journal), dailies and the weekly Grand Errand;
  - town orders and the Big Order, reputation;
  - the journal with fog and landmarks;
  - the welcome-back digest and Hearth Rest;
  - level-up unlocks;
  - the owner's Economy and Engagement tabs.

## Going online (multiplayer for the friends)

`game/Dockerfile` builds and runs everything: client, API and WebSocket on `$PORT`, with saves in `/data`. It has no `VOLUME` line, because Railway refuses one.

The README has Railway steps:
1. Deploy from GitHub, with Root Directory `game` and the game branch.
2. Set the variable `FOUNDER_INVITE`.
3. Attach a Volume at `/data`.
4. Generate a domain.

Every push to the game branch then redeploys, which takes 1 to 2 minutes. Players reconnect by themselves and keep their progress, but anyone mid-craft gets their materials back.

We don't know yet whether the owner has finished setting this up; ask. If restarts mid-play become annoying, offer to deploy from a separate `live` branch that the owner updates on purpose.

## What we're building now: roadmap step 4, "The Hearthlands"

This step grows the world from one island to five towns, each with its own biome, monsters, resources, market and dungeon:

| Town | Tier | Biome |
|---|---|---|
| Hearthvale | 1 | meadow |
| Amberfold | 2 | autumn |
| Rimeholt | 3 | snow |
| Sandmere | 4 | desert |
| Starfall | 5 | crystal |

- **The plan:** `game/docs/world/SPEC.md`, with the phases in §10. It's large, so read only the sections you need. Phase 3 is the "Phase 3: The vertical slice" heading in §10.
- **How to pick up the work:** `game/docs/world/HANDOFF.md`.
- **Background research:** `game/docs/world/briefs/`.
- **Progress:**
  - **Phase 0** (seams) is done.
  - **Phase 1** (phone performance and multi-town plumbing: P1–P8, M1–M6, I1) is done. Gate G1 passes in the census on today's map and the stress map; spawn is about 75–80 draws, 36 shader programs, and no long tasks.
  - **Phase 2** (the guidance spine: E1–E7, I2) is done. Gate G2: two Compass bots reached level 6 in 40 minutes with the goal card never empty and no dead air. The context button was never blank in a 10-minute phone smoke run.
  - **Between phases, at the owner's request:**
    - crafting was rebuilt around real motions;
    - the whole UI was restyled bright and cosy, then checked screen by screen at phone size;
    - the design skills were installed.
  - **Still owed by the owner:**
    - a real-phone fps report (the gates' "owner's phone" line);
    - how crafting and the new UI feel under a real thumb;
    - whether the Railway server is up.
  - **Phase 3** (Amberfold and the Westmarch: W1c, W1a, W1b, I3) is built (October 2026):
    - W1c: the West Gate (`maps/patches/015_hearthvale_gates.json`), letters that the town hall takes, and `hv_intro` step 10;
    - W1a: the content pack `shared/content/amberfold/` (36 items, 3 nodes, 9 monsters, 18 recipes, the Thornroot Warren, 9 quests, 19 orders, trade and customers);
    - W1b: the map patch `020_amberfold` (from `scripts/world/amberfold.mjs`), the autumn biome, Kenney fall trees, pumpkins, windmill and cave kit, lazy model groups (`biome:autumn`, `mobs:amberfold`, `kit:cave`);
    - I3: `server/tests/world-content.test.js` (density rules, sources and uses, quest targets, the fight curve), `scripts/sim/fight.mjs`, `gold.mjs`, `pace.mjs`, the census at Amberfold's six spots.
  - **Gate G3, still owed:** the owner's phone fps in Amberfold square, and the 2-hour playtest with friends (`af_intro`, orders and the Warren).
  - **Next: Phase 4**, the rest of the world (Rimeholt, Sandmere, Starfall, Fourways and the Hollowmere Causeway). Copy Amberfold's pattern: a content pack folder, a world script writing a patch, a biome file, lazy model groups.
  - When you finish a package, update this list.

## How to work here

- **Branch:** commit and push to `claude/intelligent-brahmagupta-dqjx6n`. Don't open pull requests unless the owner asks. Commit after each finished piece of work so nothing is lost; the cloud container is temporary.
- **Commit messages:** end each one with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus your session's `Claude-Session:` link. Never put model names anywhere else in a commit.
- **Tests:** `cd game && npm test` must stay green (201 tests today). One fishing test occasionally fails on random rolls when the whole suite runs at once; rerun it before assuming a real failure.
- **Play-testing:**
  - Build with `cd game && npx vite build`.
  - Start a server with `OPEN_SIGNUP=1 PORT=8790 DATA_DIR=<a temp dir> node --no-warnings server/index.js`.
  - Drive it with Playwright headless Chromium, launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, at phone size (390×844). Use `NODE_PATH=$(npm root -g)`.
  - The first account on a fresh data dir is the server owner and can teleport.
  - To give a test hero items or skill, stop the server, write to the `inventory` table and the `heroes.skills` JSON with `openDb()` from `server/db.js`, then restart.
  - Useful scripts:
    - `scripts/ui-tour.cjs`: every screen;
    - `scripts/smoke-mobile.cjs`: a 10-minute phone play;
    - `BOT_COMPASS=1 BOT_SECONDS=1800 npm run bots -- 2`: bots that follow the goal card;
    - `npm run perf:census`: phone budgets.
  - Stop the server with `pkill -f "^node --no-warnings server/index.js"`. Never use a pattern that could match your own shell.
  - In shell scripts, quote removals as `rm -f "${DIR:?}"/x`. A bare `$VAR/*` is blocked by a safety check.
- **Code style:** plain JS modules, data-driven content, small functions, and comments in plain English. The server is authoritative: the client never decides rewards.
- **Save tokens; the owner pays for usage:**
  - Build directly instead of spawning lots of agents; each new agent has to re-learn the codebase.
  - Use at most one review agent per phase.
  - Keep reports short and take few screenshots.
  - No multi-agent "panels" unless the owner asks.
- **Talking to the owner:**
  - They're not a programmer. Explain what changed and how to try it in plain words.
  - They like to be asked about subjective choices (look, feel) with two or three concrete options, then have the work done thoroughly and checked.
