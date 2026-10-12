# Brief: the world engine, map format, and how towns and biomes get built and drawn

Scope: shared/world.js, maps/world.json, server/map.js, server/static.js, server/channel.js (interest), client/src/scene/{town,buildings,procprops,assets,water,grade}.js, client/src/game.js (lighting/mood), client/src/editor/{kinds,editor}.js, plus the HUD and townsfolk code that reads world data. Unless marked *guess*, every number below was checked in the code or measured with the read-only scripts in `scratchpad/world/tools/` (`drawcalls.mjs`, `nodedraws.mjs`, `matcount.mjs`).

## 0. What exists today (facts)

**maps/world.json** is format 2, `name: "Hearthvale"`, `rev: 1`. It is 92,261 bytes on disk, 87 KB minified and 19.4 KB gzipped. Props account for 76 KB of that. Contents:
- 1 land `{island, 0,0, r 96}`, spawn `(0, 8)`, 1 region `{hearthvale, tier 1, kind town, r 96}`.
- 9 buildings: workshop, market, shop, townhall, cottage1–5 (`deco: true`).
- 1 gate (`gate`, Wilds Gate at z -34, scale 4.5).
- 1 plaza (r 11.2), 1 fountain (r 3.2), 1 lake (`mirror_lake`, r 14, deep 6.5), 1 dock.
- 5 zones: forest, quarry, garden, lake, wilds. Each has a `ground` hex.
- 15 paths, each with 2 points.
- 94 nodes: oak 16, birch 12, pine 8, stone 12, copper 9, iron 6, gold 4, mint 10, sun 7, moon 4, fish 6.
- 10 monster camps, 2 waystones, 1 entrance (`crypt_hollow` at (0, -74)).
- 861 props. 141 have `r > 0` (they block), 5 are stations, 3 bob. The rest is mostly ground cover: deco_flower 245, deco_grass 140, deco_bush 98, deco_rock_small 68, deco_tree_round 66, deco_tree_pine 50, deco_mushroom 48.

**Load path.** `server/map.js` reads the shipped map and `<DATA_DIR>/maps/world.json`, and uses whichever has the higher `rev` (`loadMap`, lines 87-93). `useMap` (44-52) validates the map, calls `setWorld`, and caches the body, its gzip and an ETag for `GET /api/map`. `saveMap` (58-85) does an ETag conflict check, bumps `rev`, keeps 30 backups and writes the file atomically. `server/static.js` builds `{nodes, col: buildColliders(), nav: new NavGrid(col)}` and rebuilds it on save. The client fetches the whole map, calls `setWorld`, and builds the same colliders and nav at module load (`game.js:36-39`).

**shared/world.js.** The format is documented at lines 39-58. `LISTS` (82) names 15 lists. `mapProblems` (85-117) requires every entry to have a unique id across all lists, and numeric x/z on everything except paths. `upgradeMap` (129-159) handles format 1, then injects Hearthvale's 2 waystones and the crypt into maps that predate those features. `setWorld` (163-195) fills the live bindings:
- `EXTENT` is the land bounding box ±2 m.
- `WORLD_RADIUS` is the farthest land from the origin.
- `GATE = GATES[0]`, `LAKE = LAKES[0]`, `DOCK = DOCKS[0]`.
- Defaults: gate `scale 4.5, width 7`; lake `deep 6.5`; prop `rot 0, r 0`.

Other pieces of world.js:
- `placeAt(x, z)` (218-225) returns the smallest zone and the smallest region containing the point. It is a linear scan.
- Colliders (313-325) are building rects, gate rects, crypt rects, fountain circles, node circles (`t.r*s`), prop circles with `r > 0`, and stone circles. They are indexed in 8 m buckets (`BUCKET`, 328).
- `isWalkable` (349-357) runs `landDistance` (a loop over **all** lands), then `LAKES.some` and `DOCKS.some` (also all of them), then the bucketed colliders. A dock only makes a *lake* walkable: line 350 returns false at sea before the dock test, so a dock or bridge over the sea is impossible today.
- `NavGrid` (368-537) uses 1 m cells over all of EXTENT. It allocates a `Uint8Array(nx*nz)` and fills 32×32 tiles lazily; each cell costs 5 `isWalkable` calls. A* searches a window padded by 48 cells, then by 160, with an expansion cap of `max(30000, min(W*H, 120000))`.

## 1. Pure data vs hard-coded to Hearthvale

**Pure data in the map:** coastline, spawn, region names/tiers/kinds, building placement/size/colours/label/action, gates, plazas, fountains, lakes, docks, zone labels/ground tint, paths, node placement, camp placement, waystones, entrances, and every prop including stations and the job board. **Code tables that the map refers to by id:** `NODE_TYPES` (world.js:289, 10 types), `MONSTERS`, `DUNGEONS`, the `MODELS` manifest (152 slots), `PROC_BUILDERS` (procprops.js:19), `STATIONS` (crafting.js:27).

**Hard-coded (would break or look wrong with a second town):**
- **Building looks depend on the id.** `RECIPES = {workshop, shop, townhall, market}` is looked up with `RECIPES[b.id]` (buildings.js:209, 222). The procedural fallback also tests `b.id === 'market'/'townhall'/'shop'/'workshop'` (town.js:1073-1219). Ids must be unique across the whole map, so a second market (`market_frost`) gets no recipe and falls back to a plain box house. Cottages cycle 5 textures by index (`COTTAGE_TEX`, buildings.js:210).
- **HUD and tutorial.** The dock buttons call `openPlace('workshop'|'market'|'townhall')` (hud.js:88-91). The tutorial (hud.js:21-26) targets `tree_oak`, the `workshop` building, `slime` and `shop`, and its text mentions "Whisperwood" and "Wilds Gate, to the north". The gate guide assumes the gate is north of the player (`p.z > GATE.z - 1`, hud.js:504), and `GATE = GATES[0]`.
- **One station of each kind in the world.** `stationPos`/`spotsOf` take the first prop with that station (`PROPS.find(p => p.station === id)`, stations.js:6). `inYard` counts any station.
- **One spawn.** `SPAWN` is used for new heroes and as the fallback for invalid positions (heroes.js:43, 63; server/game.js:73, 578).
- **Sky:** colours `#5fb8f0 / #a9dcf7 / #fde7c4` at town.js:384. **Sea:** `#58a8bc / #1b4f74` (397). **Lake water:** `#5fb3c4 / #1f5f86` (702).
- **Ground palette** (town.js:411-416): grass `#74a04c`, grass2 `#628c42`, path `#b89b6e`, plaza `#a89a82`, sand `#d6bd8a`, cliff `#7a5b40`. The default zone tint is `#74a04c` (417). Grass-tuft colours (864) come in two sets, normal vs. "wild"; a tuft counts as wild within `r+6` of any zone of kind `wilds` (798, 857). Stepping stones (883), plaza rings (468, 478), reeds (725-727) and dock wood (739, 745) are all fixed colours.
- **Mood.** `MOOD` (game.js:41) is fog `#b8c4c8`→`#9faea6` and sun `#ffe4bc`→`#ffd0a0`. It blends **only** on distance to `wilds` zones (game.js:2205-2216): fog near 20→14, far 100→70, hemi 1.3→1.05. Initial fog and lights are set at game.js:124-131. The crypt saves and restores this "town light" (1681-1712).
- **Grade:** the global tone curve (grade.js) and the per-material `GRADE` "toward Hearthvale's warm palette" (assets.js:28-49) are both compile-time constants.
- **Zone kinds** in the editor are fixed to `meadow, forest, quarry, garden, lake, wilds, town` (kinds.js:130). Only three of them change behaviour: `garden` (butterflies, town.js:759; villager stops, townsfolk.js:104), `wilds` (tufts and fog), and `forest` (deer, townsfolk.js:149). Region kinds are `town, wild, outlaw` with tier 1-5 (kinds.js:143). **Region tier is display-only:** the server never reads `REGIONS`.
- **Townsfolk:** 4 villagers on low quality, 6 on high, for the *whole world*. Each picks 4 random stops among **all** buildings and plazas (townsfolk.js:99-123), so with several towns the routes would cross the world or fail. Each lake's beaver is anchored at a fixed offset `(l.x-14, l.z-6)` (151).
- **Crypt look:** every entrance gets the same crypt, braziers and graves whatever its `kind` (town.js:637-698). The gate always uses castle-kit `grey_red` (buildings.js:250).
- **Terrain is flat.** `heightAt` (town.js:418-430) is ±0.12 m of undulation, lakes go down to -0.75, and the coast falls away to -5. Nothing else samples height: avatars, mobs, nodes and props all sit at y=0. Hills or dunes would need a shared `heightAt` in world.js that every placement uses.

## 2. What must change to support several towns or islands with different biomes

1. **Ground palette.** Replace the constants at town.js:411-416 and the tuft colours at 864 with a per-point biome palette. `nearRect` (454-463) already collects nearby zones, lakes, plazas, segments and buildings per chunk; add `regions` and `lands`. In `colourAt`, blend biome palettes by distance to the region edge, using the same `smooth(r-4, r+3)` the zones use.
2. **Trees and cover.** These are already data: deco props in the map. Biomes need new manifest slots. The packs on disk have them: nature-kit `tree_palm*` and `cactus_*`; holiday-kit `tree-snow-*`, `tree-pine-snow`, `snow-pile`; pirate-kit `palm-*`. New resource nodes are code: add `NODE_TYPES` entries plus models.
3. **Water.** Lake colours (702) and sea colours (397) should come from the biome. The sea is one plane with one material, so its colours can be lerped as uniforms by the camera's biome, which costs nothing.
4. **Sky, fog and light.** Generalise game.js:2205-2216. The target should be the biome at the camera target (zone override, then region, then map default). Lerp fog colour/near/far, hemi colour/intensity, sun colour/intensity, `toneMappingExposure` and the sky uniforms over about 1.5 s. All of these are uniforms, so there are no shader recompiles. The grade curve can stay global.
5. **Weather and particles.** Nothing exists yet. `fx.puff` (300 slots) and `fx` (900) are CPU-updated pools with `p.shift()` eviction, so they are wrong for weather. Add one GPU-animated instanced mesh or Points cloud that follows the camera, driven by a time uniform: one draw call, count halved on `low`.
6. **Per-town buildings and services.** Look up recipes by a new `style` field instead of the id. Stations should resolve to the nearest instance. Make the dock buttons and tutorial targets per-town: nearest `action:'craft'` building, and so on. Give townsfolk per-region stop lists. Spawn or respawn should be per town (for example the region's home waystone).
7. **Islands.** The sea is never walkable (world.js:350), and the editor's `reachability()` (editor.js:325-353) checks paths from `spawn` to every node, door, camp, stone and entrance. Islands that are not connected by land would therefore fail that check and be unreachable for players. Waystones need you to walk up to them before you can use them. Options:
   - Join islands with overlapping land circles.
   - Let docks or bridges count over the sea: move the dock test before the land test.
   - Add ferries, e.g. `docks[].ferry = '<dock id>'` as a paid teleport like `travelFee`.

## 3. Limits and what scales badly

**Constants:**

| Setting | Value | Where |
|---|---|---|
| CHUNK | 96 m | town.js:364 |
| Ground segments per chunk side | 61 low (7,442 tris) / 86 high (14,792 tris) | 812 |
| Grass tries per chunk | 387 low / 977 high, ×3 cones of 8 tris: up to 9.3k / 23.4k tris | 843 |
| viewRadius | 120 low / 150 high; chunks dropped beyond R+70 | 944, 951 |
| Chunks built around the focus (measured) | 9-14 low / 13-16 high; up to 23 / 32 stay resident because of the drop margin | |
| Fog far | 100 (70 in the Wilds), so 20-50 m of loaded ground is fully fogged | |
| Camera | far 900; sky sphere r 400 follows the camera | game.js:126 |
| Shadow camera | ±34 m box, far 140; map 1024 low / 2048 high; re-rendered every frame | game.js:135-140, 1958 |
| `low` | every touch device or screen < 700 px; pixel ratio ≤ 1.5 | game.js:108 |
| Sea shader | at most 64 land circles (more are ignored), looped per sea pixel | water.js:66-104 |
| Server interest radius | 100 m, forgotten past 125 m | channel.js:17-18 |
| CHANNEL_CAP | 40 | |
| Nav cell / tile | 1 m / 32 m. Memory is 1 byte/m² of EXTENT: 1 MB at 1 km², 4 MB at 2×2 km, per grid | |
| A* expansion cap | 120k | |
| Collider bucket | 8 m | |
| Dungeon runs | built at `ORIGIN (5000, 5000)` (dungeon.js:15); keep land well clear | |

**Client costs that grow with the whole world, not with the view:**
- These are all built at load and stay resident, outside the chunks: `NodeView`s, buildings, gates, lakes, docks, plazas, fountains, stones, crypts and butterflies. Today that is about 730 potential draws: nodes 450 (colour) / 273 (shadow), measured.
  - Each ore rock adds 6 separate octahedron meshes, each with its own geometry (town.js:91-97), so 19 ore rocks cost 114 draws.
  - A dock is about 50 draws (planks and posts with outlines). The lake's 26 reeds are 52 meshes. A plaza is 20 meshes.
  - Everything is frustum-culled, but the scene graph is walked by the shadow pass plus 3 render passes every frame.
- The `animated` emitters for every fountain, chimney, brazier, waystone, forge and cookpot run every frame anywhere in the world, all sharing the 300-slot `fx.puff`. *Estimate:* about 85 live puffs per town, so 4-5 towns would push nearby smoke out of the pool.
- These loops run every frame over the whole world:
  - static DOM labels: `game.js:2247`
  - fade ray-box tests per building: `2108`
  - `n.update` for every node: `town.js:993`
- The `landDistance` / `LAKES.some` / `placeAt` loops are linear in the number of lands and lakes. A high-quality chunk build does about 7,569 vertices × 6 `landDistance` calls plus about 977 tuft tests. All of that is cheap with 1 land and grows with every circle added. `heightAt`/`colourAt` should take `near.lands` instead.
- **Editor:** every edit runs `disposeTown` and then a full `buildTown` (editor.js:170-180). Each change does 2-3 `JSON.stringify(map)` calls. The undo stack keeps up to 120 full JSON copies (136), and the whole map goes to localStorage on every change (143). *Guess:* the 5 MB localStorage quota would make draft saving fail silently once the map passes about 2.5 MB.

**Server costs that grow with the world:**
- Every `Channel` copies all nodes and creates every camp's mobs (channel.js:33-46).
- `tick` walks all nodes and all mobs at 20 Hz whether or not anyone is near (191-219).
- `snapshot` at 10 Hz is O(players × mobs) with a `row.join` **per pair** (241-256).
- Every move tap runs server A* (`server/game.js:866-879`, rate-limited to one per 80 ms). Long trips across towns can hit the 120k cap and return null, and they block the tick while they run.

## 4. Props per chunk, and draw calls

Props are bucketed once per build (town.js:487-491: `propsIn` keyed `"i,j"`), and stepping stones likewise (493-506). `buildChunk` (799-934) then makes:
- 1 ground mesh
- 1 grass `InstancedMesh`
- 1 stepping-stone `InstancedMesh`
- per `slot|variant` group, `assets.instanced` (assets.js:302-338), which creates **one InstancedMesh per glTF sub-mesh plus one outline hull per sub-mesh**. The hull uses the first placement's scale for everyone.
- `proc_*` props are built individually. Bobbing props each get a full `assets.make` copy.

Measured on the shipped map (`drawcalls.mjs`):

| chunk | props | slot·variant groups | colour draws | shadow draws | prop tris (incl. hulls) |
|---|---|---|---|---|---|
| -1,-1 | 236 | 62 | 168 | 85 | 33.1k |
| -1,0 | 242 | 57 | 150 | 76 | 34.3k |
| 0,-1 | 200 | 58 | 143 | 67 | 32.2k |
| 0,0 | 156 | 51 | 127 | 59 | 22.9k |
| 8 edge chunks | 2-4 each | | 10-18 each | | |

The total is 700 prop draws and 343 shadow draws. A typical dense chunk therefore costs about **130-170 colour-pass draws plus 60-85 shadow draws plus 3** (ground, grass, stones), plus 3-6 proc props at roughly 4-22 draws each (the job board is about 22). The driver is **variant count, not prop count**: `deco_tree_round` has 10 variants, `deco_tree_pine` 9, `deco_mushroom` 6, and most variants have 2-3 sub-meshes, all doubled by outlines. A dense chunk uses only **25-28 distinct materials** (`matcount.mjs`). Merging a chunk's static props by material (indexed geometry or `BatchedMesh`, with one merged hull, as `assemble` already does for buildings) would bring a dense chunk down to about 30 draws, roughly 5× fewer. A cheaper alternative is capping each biome at 2-3 variants per slot.

## 5. Recommended data model (it fits format 2 and keeps the editor working)

**Biome definitions live in code**, in a new `shared/biomes.js`, like `NODE_TYPES`/`MONSTERS`. They bundle model slots and weather kinds that need code, and `mapProblems` requires x/z on every list entry, so a `biomes` list in the map would not validate. Two entries reproduce today's look exactly: `meadow` (today's town values) and `wilds` (today's `MOOD` wild values and wild tuft colours).

```js
BIOMES[id] = {
  name,
  ground: { grass, grass2, path, plaza, sand, cliff },        // town.js:411-416
  tufts: { colors: [a, b, c], density },                      // town.js:843, 864
  water: { shallow, deep }, sea: { shallow, deep },           // town.js:702, 397
  sky: { top, mid, bot },                                     // town.js:384
  light: { fog, fogNear, fogFar, hemiSky, hemiGround, hemi, sun, sunI, exposure }, // game.js:41, 124-131
  weather: null | { kind: 'snow'|'rain'|'dust'|'leaves'|'fireflies'|'ash', rate },
  critters: ['butterfly', ...],                               // replaces the garden-only butterflies
  cover: [{ slot, per100m2, s: [min, max] }],                 // optional auto ground cover, non-blocking only
}
```

**Additions to the map** (all optional, so maps/world.json loads unchanged and `upgradeMap` needs nothing):
- Top-level `biome: 'meadow'`: the default for sea and unclaimed land.
- `regions[].biome`: the main switch. A town is `kind:'town'` plus `biome`. Optional `regions[].stone` names the town's home waystone (used for respawn and "return to town"); the economy brief can add `regions[].market`.
- `zones[].biome`: an optional override. For backward compatibility, `kind === 'wilds'` implies `'wilds'`.
- `buildings[].style`: `'workshop'|'market'|'shop'|'townhall'|'cottage'`, defaulting to `deco ? 'cottage' : id`. Plus `buildings[].tex`, a `TEXTURES` key. `buildModular` then looks up `RECIPES[b.style]`.
- `docks[].ferry`: a dock id, for island links.
- Station props already carry `station`. `spotsOf` and `stationPos` should take a position and pick the nearest.
- Add `biomeAt(x, z)` to world.js: `zone?.biome ?? region?.biome ?? MAP.biome ?? 'meadow'`. Have `setWorld` cache per-region data so callers do not rescan.

**Editor changes:**
- `KINDS.regions.fields`: add a `biome` select (same pattern as the entrances `kind` select, kinds.js:107).
- `zones`: add an optional `biome` select with "(inherit)".
- `buildings`: add `style` and texture selects, and turn `action` from readonly into a select.
- `PALETTE` "Buildings & areas": add Workshop, Market, Shop and Town hall entries.
- Add a **"Paint nature" brush** that uses `BIOMES[biomeAt].cover` to write ordinary props. The format is unchanged and the server is unaffected; without it, dressing 4 towns by hand at Hearthvale density (~860 props each) is impractical.
- About 720 of 861 props today are non-blocking ground cover. Optionally generate that layer per chunk on the client from `cover` (deterministic from the chunk seed, like the tufts) and keep only blocking props in the map. That keeps the map small and the server unaffected.
- Make rebuilds incremental (rebuild the touched chunk(s) and the changed entity) before the world gets 5× bigger.

**Engine work to do alongside, in priority order:**
1. Chunk or distance-gate the per-world content: nodes, buildings, lakes, docks, plazas, stones, crypts, labels and emitters.
2. Merge chunk props by material.
3. Index lands and lakes spatially. Pass `near.lands` to `heightAt`/`colourAt`.
4. Bake the coast distance into a texture once at load; this removes the 64-land cap and the per-pixel loop.
5. Tie `viewRadius` to fog far, and limit grass to a ring around the focus on `low`.
6. On the server, sleep mobs and node checks in regions with no players, and compute each mob's snapshot key once per snapshot.
7. Add a road graph built from `paths` for long A* trips.
