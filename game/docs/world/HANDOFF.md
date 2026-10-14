# Handoff: building the wider world (roadmap step 4)

Start here in a fresh session, after the root `CLAUDE.md` (which has the current progress, the look and feel, and how to test). Everything needed is in this folder; there is no need to re-survey the code.

## What the owner wants

Read `GOALS.md` (their words, verbatim). In short:
- an expansive, good-looking world big enough not to get boring;
- smooth on a mid-range phone, which is the main platform;
- always something to do next;
- enough content to keep playing for a long time.

They care about **usage costs**, so work efficiently:
- Build directly rather than spawning many agents. Each new agent has to re-learn the codebase.
- Use at most one focused review agent per phase. Give routine checks (tests, measurements) to a smaller model.
- Keep agent reports short (2–3k words) and take few screenshots.
- Don't use multi-agent "panels" or ultracode unless the owner asks.

## Where things are

- `SPEC.md` is the final, buildable spec (about 150 KB). Read only the sections you need:
  - §0 decisions; §1 world geometry; §2 biomes; §3 towns; §4 content tables; §5 engagement systems;
  - §6 economy; §7 migrations and RPCs; §8 client and editor; §9 performance; §10 the phased plan; §11 save and map compatibility; §12 cuts.
- `briefs/` holds the six research briefs the spec was built from:
  - `engine`: the world engine and map format;
  - `content`: progression tables;
  - `economy`: the single-town assumptions and per-town markets;
  - `assets`: the Kenney model library per biome, including packs downloaded to scratch that are not in the repo;
  - `engagement`: the "now what?" audit;
  - `perf`: phone-size draw calls, triangles and texture memory, measured.
- `tools/` holds the checking scripts:
  - `world.mjs`: map layout and the 100 m rule;
  - `fight.mjs`, `mobs.mjs`, `pace.mjs`: monster stats and pacing against the real formulas;
  - `anchors.mjs`: elite and boss positions;
  - `perf*.cjs`, `prof.cjs`: headless Chromium phone measurements;
  - `drawcalls.mjs`, `matcount.mjs`, `nodedraws.mjs`.

  Some scripts still contain paths from the old scratch folder (`/tmp/claude-0/.../scratchpad/world`), so point them at a new scratch folder before running them.

## The plan (SPEC.md §10)

0. **Seams.** One package, S0. It changes no behaviour: an RPC registry, an event bus, a migration loader, a content registry, file splits and stubs.
1. **Phone performance and multi-town plumbing.** Gate G1 must pass before any content:
   - budgets: ≤250 draws, ≤150k triangles, ≤24 MiB textures, ≤40 shaders, ≤3 MB first load;
   - a stress map at the final world size;
   - fps p50 ≥30 on the owner's phone.
2. **Guidance on today's island.** The suggest() engine, goal card, context button, quests, orders, journal and digest. Gate G2: dead air under 5%.
3. **Vertical slice.** Amberfold (tier 2, autumn) and the Westmarch, with a playtest gate.
4. **The rest of the world.** Rimeholt (snow), Sandmere (desert), Starfall (crystal), the Fourways hub and the Hollowmere Causeway.
5. **The living world.** Elites, town projects, feats and the saga; cargo is optional.

Within each phase, packages own disjoint files (the spec lists them), so independent ones can run in parallel. When working mostly alone, do them in order.

## Rules that don't change

- Work on branch `claude/intelligent-brahmagupta-dqjx6n` and push there. No pull requests unless the owner asks.
- End every commit with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <this session's link>
  ``` Never put model names in commits.
- `npm test` must stay green, at 201 tests today (`cd game && npm test`). A fishing test occasionally fails on random rolls when everything runs at once.
- To play-test, run `cd game && npx vite build`, then `OPEN_SIGNUP=1 PORT=8790 DATA_DIR=<tmp> node --no-warnings server/index.js`, then drive headless Chromium with the launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - The first account on a fresh data dir is the server owner and can use `owner.teleport`.
  - Stop the server with `pkill -f "^node --no-warnings server/index.js"`. Never use a pattern that matches your own shell.
- Keep the code style: plain JS modules, data-driven content, comments in plain English.

## Where we are

- **Phases 0, 1, 2 and 3 are done**, with gates G1 and G2 passed in tests, bots and the census, and G3 passed except the owner's phone fps and the friends' playtest. The owner's real-phone fps report is still to come.
- **Since Phase 2, at the owner's request:**
  - crafting is played by real finger motions (tap, hold, saw, carve, stir); see `shared/crafting.js`;
  - the UI was restyled bright and cosy. The rules are in the root `CLAUDE.md` under "The feel we're going for". New Amberfold screens must use the same tokens and components.
- **Content must fit the guidance spine from Phase 2.** Every new place needs:
  - quests (`shared/content/<town>/quests.js`);
  - orders (`orders.js`);
  - landmarks (a map patch);
  - journal entries.

  This keeps the goal card full in Amberfold too.

## Phase 3 is built (October 2026)

Amberfold and the Westmarch are in the game. How they were made is the pattern for Phase 4:
- **Content** is a folder, `shared/content/amberfold/` (one file per kind, `index.js` gathers them), listed in `PACKS` in `shared/content/index.js`. Quests and orders come in through the pack too.
- **The map** is written by `scripts/world/amberfold.mjs` into `maps/patches/020_amberfold.json` (the town kit stamp, then lands, roads, lakes, nodes scattered with rejection rules, camps, landmarks, skyline). Run it again after changing it; `check()` throws on map problems and prints lints.
- **The look** is `shared/biomes/autumn.js` (colours, fog, weather, cover rules) plus model groups in `client/src/scene/manifest/` (`autumn.js`, `mobs-amberfold.js`, `kit-cave.js`) registered in `manifest/index.js` with `BIOME_GROUPS`, so they load only near the biome. Code-drawn pieces (the Smokehouse, the Warren's door) are in `client/src/scene/proc/amberfold.js`.
- **Checks:** `server/tests/content-amberfold.test.js` and `world-content.test.js`; `node scripts/sim/fight.mjs` prints the fight curve against the real tables.
- **Gate G3** still needs the owner's phone fps in Amberfold square and the 2-hour playtest with friends.

A lesson from Phase 3: the spec's first-draft autumn fog (22–80 m, the colour of the ground) hid everything past 25 m on a phone. Keep each biome's fog light and different from its ground, and look at it at phone size.

## Next step

**Phase 4, the rest of the world** (SPEC §10). The Phase 3 notes below stay for reference.

**Phase 3, the vertical slice: Amberfold and the Westmarch** (the "Phase 3: The vertical slice" heading in SPEC.md §10). Do the packages in this order:
1. **W1c**: the Hearthvale west gate and letters, and `hv_intro` step 10 leading on to `af_intro`.
2. **W1a**: Amberfold content (items, nodes, monsters, recipes, fish, dungeon, quests, orders, trade, customers).
3. **W1b**: the world and art (the patch `020_amberfold`, the autumn biome, Kenney autumn and cave models; `briefs/assets` lists the packs).
4. **I3**: integration and balance (sims, invariants, credits).

Gate G3:
- the census passes in the new places;
- first load is still ≤ 3 MB, with Amberfold loading lazily;
- a bot walks Hearthvale → Amberfold with no long task;
- the owner's phone reports fps p50 ≥ 30;
- a 2-hour playtest with friends.
