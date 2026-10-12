# Hearthvale: the wider world (roadmap step 4)

## The owner's words (verbatim)
"I want a kind of expansive world that looks pretty good and is a decent size so people don't get bored.
that being said It also needs to run good on mobile, always have something to do, always a button to press
if you know what I mean not literally but basically. just always something to do.
It needs to have enough media to keep people wanting to play forever."

Earlier roadmap text for this step: "Four or five major towns, from the starter town up through harder ones,
each with its own biome, resources, monsters and market (prices differ between towns, so hauling goods pays)."
Earlier, the owner also said dungeon entrances could go in each new town ("harder dungeons in harder towns").

## The game today (short)
- Repo: /home/user/Tesla/game. Multiplayer browser economy-adventure game for a group of friends, played on phones and PCs.
- Authoritative Node WebSocket server (20 Hz), node:sqlite, three.js r169 client (toon-shaded, Kenney CC0 models), Vite.
- One island today: Hearthvale (starter town, tier 1, radius ~96 m) with Whisperwood forest, Copperstone Quarry,
  Herb Garden, Mirror Lake, the Wilds (monsters lvl 1–11 incl. a golem boss) and the Hollow Crypt dungeon.
- Systems: gathering (rhythm swings, shared nodes), fishing (reel-fight minigame), hands-on crafting (5 stations,
  timing minigames, graded S–D), order-book market (4% tax), player shops with NPC customers & town demand,
  bulletin board jobs, turn-based co-op battles in the world, dungeons (procedural runs, tiers, parties, ready checks),
  waystones + world map + region banners, world editor for the owner, onboarding quest (4 steps).
- World = data: maps/world.json (lands, regions w/ tiers, buildings, zones, paths, nodes, spawns, stones, entrances, props).
  Big-world engine: land of any shape (overlapping circles), chunk streaming (96 m tiles), lazy nav tiles,
  interest management for monsters (~100 m).
- Git: work happens on branch claude/intelligent-brahmagupta-dqjx6n. Subagents must NOT commit, push or create PRs.

## Hard constraints
- Must run well on a mid-range phone (the main platform). Budget draw calls/triangles; cheap fallbacks on `low`.
- Art: Kenney CC0 packs (many already downloaded under /tmp/claude-0/kenney/ and client/public/models/), plus
  procedural three.js geometry. Everything gets the game's toon shading, ink outlines and colour grade.
- Keep the code style: plain JS modules, data-driven content, comments in plain English, small focused functions.
- Server is authoritative; the client never decides rewards.
