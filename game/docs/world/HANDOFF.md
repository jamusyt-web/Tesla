# Handoff: building the wider world (roadmap step 4)

Start here in a fresh session. Everything needed is in this folder; there is no need to re-survey the code.

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
  Claude-Session: https://claude.ai/code/session_017wAuy8nYgiipRde75V188x
  ```
  (or the new session's link). Never put model names in commits.
- `npm test` must stay green, at 58 tests today (`cd game && npm test`). A fishing test occasionally fails on random rolls when everything runs at once.
- To play-test, run `cd game && npx vite build`, then `OPEN_SIGNUP=1 PORT=8790 DATA_DIR=<tmp> node --no-warnings server/index.js`, then drive headless Chromium with the launch args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
  - The first account on a fresh data dir is the server owner and can use `owner.teleport`.
  - Stop the server with `pkill -f "^node --no-warnings server/index.js"`. Never use a pattern that matches your own shell.
- Keep the code style: plain JS modules, data-driven content, comments in plain English.

## Next step

Phase 0, package S0 (SPEC.md §10, "Phase 0: Seams"). Then Phase 1, performance first.
