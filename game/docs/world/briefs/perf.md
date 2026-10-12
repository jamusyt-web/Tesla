# Brief: mobile performance baseline and budgets (wider world, step 4)

Measured 2026-10-12 on commit `cf4a013`, production build (`npx vite build`), my own server on :8795 with a fresh data dir. Headless Chromium + SwiftShader, phone context 390x844, DPR 3, `isMobile`, `hasTouch`. `game.low === true` (coarse pointer), pixel ratio 1.5, drawing buffer 585x1266, shadow map 1024.
SwiftShader FPS (~4 fps) is GPU-emulation bound and means nothing. The numbers that matter are draw calls, triangles, textures, programs and main-thread ms.
Scripts and raw JSON: `world/tools/perf.cjs`, `perf2.cjs` (what-if tests), `perf3.cjs` (chunk build and hitches), `perf4.cjs` (camera framings), `perf5.cjs` (census), `prof.cjs` (CPU profile on an unminified build). Output is in `world/perf-out/`.

## 1. Baseline numbers

### Per-frame render cost (phone, low mode, one hero)

| Place / view | Draw calls | of which shadow | Triangles | Render JS ms* | update() ms |
|---|---|---|---|---|---|
| Town square (spawn), default cam | 817–919 (by yaw) | 514 | 229k–263k | 15.4 (p95 23) | 2.0 (p95 4.3) |
| Spawn, zoomed out (dist 34, pitch 0.45) | 971–1263 | 514 | 310k | – | – |
| Whisperwood, zoomed out | **805–1459** | 426 | 345k | – | – |
| Quarry, zoomed out | 743–1446 | 400 | 336k | – | – |
| Wilds (0,-58), default | 587–691 | 334 | 206k | 13.9 | 2.0 |
| Hollow Crypt tier 1 | 193 | 31 | 45k | 8.2 | 0.57 |
| Desktop (high mode, 1280x720) spawn | 968–1041 | – | 368k–377k | 15.6 p50 | 1.9 |

*JS time inside the frame's three `renderer.render()` calls, on a 2.1 GHz Xeon core. With Chrome's CPU throttle at 4x (a rough stand-in for a mid-range phone, my estimate), spawn costs **77 ms render + 10.6 ms update per frame**, which is about 11 fps from the CPU side alone. That works out to about 15 µs of main-thread time per draw call unthrottled and about 87 µs at 4x.

### Breakdown at spawn (one frame, 830 draws)
- **Shadow pass: 514 draws / 80k tris.** Chunk props 221 (491 instances), town-static 159, nodes 98, folk 36. In the Wilds, mobs alone add 205 shadow draws (37 mobs at about 5.5 casting meshes each).
- **Main pass: 199 draws / 139k tris.** Ground 6 draws / 44.6k tris (7,442 tris per chunk tile on low), grass 4 draws / 25.9k tris (3,243 instances), chunk props 98 solid + 31 outline, town-static 28 + 5 outline, folk 4 + 8 outline, mobs 8 outline.
- **Silhouette pass: 59 draws. Hero pass: 59 draws.** One hero is **60 meshes**: 36 solids, 23 outline hulls and the blob. That is about 118 draws per visible hero.
- **Crowd test:** adding 8 client-side fake heroes took draws from 825 to **1,684** (+107 per hero), tris from 233k to 344k, and render JS from 14.1 to 20.4 ms.

### What-if savings (measured, with 9 heroes on screen)
| Change | Draws | Render JS ms |
|---|---|---|
| Crowd baseline | 1684 | 20.4 |
| Shadow map frozen (not re-rendered) | 1170 (−514) | 15.7 |
| + no silhouette pass | 687 (−483) | 11.2 |
| + no outline hulls anywhere | 445 (−242) | 9.9 |
| Shadow box ±20 m instead of ±34 (separate run, 1 hero) | 651 (−234 of 885) | 12.5 (−0.9) |

### CPU profile (spawn, unminified build, 15 s, share of non-idle main-thread time)
- `WebGLRenderer.render` 87.8%, made up of `updateMatrixWorld` **28.0%**, `WebGLShadowMap.render` 24.2%, `projectObject` 17.0% and main `renderObjects` 16.9%.
- `setProgram` 12.4%.
- Game `update()` 8.5%, of which static labels 1.9% and `hud.frame` 1.7%.
- `ws.onmessage` 2.6%.

`updateMatrixWorld` and `projectObject` run once per `render()` call, so the whole graph (4,039 objects at spawn) is walked 3 times per frame for matrices and 3 times for projection.

### Scene, memory, programs
- **Scene census at spawn:** 4,039 Object3D, 2,387 meshes (716 InstancedMesh holding 5,258 instances), 878 outline-hull meshes, 1,327 shadow casters, 667 materials, 519 distinct toon materials.
- **Per-feature mesh counts:** the 94 nodes account for 683 meshes (7.3 each, none instanced, 421 casters). Town static is 82 loose meshes plus 27 groups (252 meshes). The four central chunks hold 129–170 InstancedMeshes each, while outer chunks hold 10–18. 18 mobs are 194 meshes and townsfolk are 92.
- **Chunks:** 14 chunks are resident everywhere on the island. `viewRadius` 120 m (low) around a 96 m island means the **whole island is always loaded**, which is also the steady-state chunk count for a larger world at this radius (12–16).
- **GPU textures (`renderer.info.memory.textures`):** 44 at spawn, 81 after the Wilds, 107 in the crypt, and **116 after leaving**. They are almost all 512x512 RGBA, no mips, about 1 MiB each, so **about 44 → 116 MiB**.
- **Duplicate textures:** 185 GLBs reference only **15 distinct `colormap.png` files**, but every GLB gets its own Texture. At spawn there were 69 separate "colormap 512x512" textures and 89 texture sources.
- **Shader programs:** 64 at spawn, 80 in the Wilds, 97–99 after the crypt. There are **40 outline-thickness variants**, and each one is its own program (`toon.js:32` keys the program on thickness; `assets.js:167` derives thickness from model scale).
- **JS heap:** 60–66 MB (`performance.memory`, precise), or 30–32 MB according to CDP `JSHeapUsedSize`. Geometry in the scene is about 12 MB.
- **Leaks:** rebuilding all chunks 4 times kept geometries at 599 and heap at about 61 MB, so no chunk leak.

### Hitches
- **Chunk build** (`town.js` `buildChunk`, one per call): dense town chunks take **8–19 ms**, outer chunks 2.5–4 ms. The stream budget is 6 ms but always builds at least one chunk, so every new dense chunk is a long frame (my estimate: 30–60 ms on a phone).
- **First-time shader compiles while walking:** frames of 322 ms (+1 program) and 768 ms (+2 programs) under SwiftShader. Entering the crypt gave one 643 ms frame (level build), and re-entering a 480 ms frame. `#warm()` (`game.js:714-719`) only precompiles what is already in the scene.

### Load
- **Download:** 255 GLB requests (8.3 MB), 193 PNG requests (2.06 MB, but only 28 PNG files on disk) and 0.97 MB JS. That is about 11.4 MB in about 470 requests, all **uncompressed**: `serveStatic` (`server/app.js:108-127`) never gzips, and only `/api/map` is gzipped.
  - gzip would cut the GLBs from 8.6 to **1.5 MB** and the JS from 1.03 MB to 0.31 MB.
- **What loads up front:** `loadAssets` (`assets.js:176-208`) downloads and parses **every model in the manifest** before the first frame. `buildTown` then builds all chunks synchronously (`town.js:972`, budget `Infinity`).
- **Times on localhost:** creator click → first frame 9.2 s; cold reload 7.1 s.
- **Times on a simulated 10 Mbps / 60 ms link:** cold reload **16.4 s** (phone run) and 18.9 s (desktop run).
- **Sizes:** `du` gives dist/ 11 MB and client/public/models 9.2 MB. The 260 GLBs average about 33 KB; character GLBs are about 240 KB (115 KB mesh + 34 KB animation for under 800 tris).

## 2. Where the cost comes from (code)

1. **Shadows are re-rendered every frame.** `game.js:1958` sets `r.shadowMap.needsUpdate = true` on every loop, even though `autoUpdate` is false (`:151`).
   - The shadow box is ±34 m around the player (`:137`). In portrait the camera's horizontal FOV is only about 27°, so the box covers mostly off-screen area.
   - Each InstancedMesh's bounding sphere spans its chunk, so shadow culling is per chunk group. In practice every prop group in every nearby chunk is drawn into the shadow map.
   - On low the filter is still `PCFSoftShadowMap` (`:113`), which is the expensive fragment path on phone GPUs.
   - Heroes cast no shadow at all, for a side reason: `WebGLShadowMap.renderObject` (three r169 `WebGLShadowMap.js:334`) tests the *main* camera's layers, which are 0 during pass 1. Heroes rely on the blob.
2. **Three render passes per frame** (`game.js:1960-1967`). Passes 2 and 3 render only layer 1 (heroes) but still walk and update the whole scene. The silhouette pass (`silMat`, `:149`) also draws every outline hull.
3. **Avatars are built from primitives** (`avatar.js:58` `M()` adds an outline to each part), giving about 60 meshes per hero.
4. **Outlines double the draws** of every outlined sub-mesh. `assets.instanced` (`assets.js:302-336`) creates one InstancedMesh per sub-mesh plus one hull per sub-mesh. Only flowers, grass, lily pads and mushrooms skip outlines (`town.js:16-17`).
5. **Nodes, buildings, labels and the sea are not chunked** (`town.js:360-363`, `:786-793`).
   - Every frame `town.update` runs `n.update` for all nodes (`:993`).
   - `#updateLabels` projects every static label and writes `style.display` (`game.js:2247-2252`).
   - The hidden town stays in the graph during dungeon runs, so it is still matrix-updated three times per frame.
   - In a world 5x bigger, all of these scale 5x even though the chunk system keeps ground and props flat.
6. **Camera far plane is 900 m but fog ends at 100 m** (town) / 70 m (Wilds) (`game.js:124-126`, `:2212-2213`). Zoomed-out, low-pitch views draw fully-fogged chunks, which is why 1,450 draws appear against 700–900 at the default view.
7. **Things that grow with the number of land circles:**
   - The sea shader loops over up to 64 land circles per pixel (`water.js:102-105`).
   - `landDistance` (`shared/world.js:255-258`) loops all lands, and `buildChunk` calls it about 5 times per ground vertex through `heightAt`.
   - Both get slower in a multi-island world (my inference; not measured).

## 3. Recommended budgets (mid-range phone, low mode; desktop gets about 2x)

Target 30 fps steady with headroom, and 60 fps on better phones. Derivation: at about 30–45 µs of main-thread time per draw on a mid-range phone (my estimate: 2–3x this Xeon core), 250 draws is about 8–11 ms. Adding about 4–6 ms of update leaves room for GC and the GPU.

| Item | Budget (low) | Today |
|---|---|---|
| Draw calls, default camera | **≤ 250** (main ≤ 150, shadow ≤ 60, heroes + silhouette ≤ 40) | 700–920 |
| Draw calls, worst framing (zoomed out, crowd) | **≤ 400** | 1,460 (1,684 with 9 heroes) |
| Triangles per frame | **≤ 150k** (main ≤ 110k, shadow ≤ 30k); worst ≤ 220k | 206k–345k |
| Per hero | **≤ 8 draws**; silhouette only for own hero and party | 118 |
| Per mob | ≤ 4 draws, no shadow map on low (blob) | about 11 meshes, about 5.5 casting |
| Per chunk, near (≤ 48 m) | ≤ 25 main draws incl. outlines, ≤ 8 shadow | central chunks about 150 InstancedMeshes |
| Per chunk, far (> 48 m) | ≤ 4 draws (merged, no outline, no shadow) | same as near |
| GPU textures | **≤ 24 MiB** (dedupe → 15 colormaps + few) | 44 → 116 MiB |
| Shader programs | **≤ 40**, all compiled before play | 64 → 99, compiled mid-game |
| Main-thread JS per frame (this Xeon) | render ≤ 5 ms, update ≤ 2.5 ms | 14–15 ms, 2.0 ms |
| Chunk build step | **≤ 4 ms** per frame on this Xeon (time-sliced) | 8–19 ms in town |
| Chunk view radius | **fog.far + 10 m** (about 80–90 m on low) → ≤ 9–12 chunks | 120 m |
| Fog / camera far | low: fog 18–75 m, wilds 14–60 m; **camera.far = fog.far + 10** (sky dome scaled inside it) | fog 100, far 900 |
| Shadow map | 1024 on low, PCF (not soft), box fitted to the view (±20 m shifted toward the look point), re-rendered only when its texel-snapped centre moves about 2–4 m or a static caster changes | every frame, ±34 m, PCFSoft |
| Shadow casters on low | buildings, trees, big rocks only (height > 1.5 m); mobs, folk, herbs, fences, small props → blob or none | 1,327 casters |
| Outline policy | heroes, mobs, NPCs, interactable nodes, buildings; scenery outlines only within 40 m; none on far chunks; one shared outline program | everything except 4 deco slots |
| Labels / nodes / mobs | chunk-stream nodes and buildings like props; cull labels by distance before projecting; mob interest on low ≈ 50 m / ≤ 20 visible | all built once |
| First load | ≤ 3 MB compressed before the first frame; per-region packs ≤ 1.5 MB, loaded lazily | 11.4 MB uncompressed, 470 requests |

## 4. Top optimisations, ranked by payoff/cost

1. **gzip/brotli static files.** Precompress `.glb/.js/.css` at build and serve with `content-encoding`.
   - Change: `serveStatic`, `server/app.js:121-126`.
   - Payoff: download 11.4 MB → about 2.2 MB, 4G load about 16 s → about 5 s (estimate).
   - Cost: under an hour.
2. **Stop re-rendering shadows every frame and cut casters.**
   - Remove `game.js:1958`. Re-render only when the snapped shadow centre moves or a node changes.
   - Mobs, folk and small props get blobs on low. Fit the box to the view.
   - Payoff: about 500 draws per frame (measured −514) and −4.7 ms render JS.
   - Cost: small to medium.
3. **Silhouette pass for own hero (and party) only, without outline hulls.**
   - Put heroes in their own small `THREE.Scene` (or a group rendered alone) so passes 2 and 3 do not walk 4,000 objects.
   - Payoff: −59 draws per hero (measured −483 with 9 heroes, −4.5 ms).
   - Cost: small.
4. **One matrix update per frame.**
   - Call `scene.updateMatrixWorld()` once, set `scene.matrixWorldAutoUpdate = false`, and set `matrixAutoUpdate = false` on static chunk, building and node objects.
   - Payoff: up to about 20–25% of render JS (updateMatrixWorld is 28%, run 3x).
   - Cost: small.
5. **Deduplicate textures and materials at load.**
   - Map each GLB material's `map` to one Texture per image URI in `loadAssets`/`toToon`.
   - Payoff: GPU textures about 116 → about 20 MiB, about 520 → about 60 toon materials; this also makes static merging possible.
   - Cost: small.
6. **One outline program.**
   - Bake the thickness into the hull geometry, or share `customProgramCacheKey` and use a uniform, instead of 40 programs.
   - Then precompile the shaders of every prepared model at load with `compileAsync` over a hidden warm-up group.
   - Payoff: removes most mid-game compile hitches (322–768 ms frames seen here) and shortens first-frame time.
   - Cost: small.
7. **Merged heroes.**
   - Merge each rigid part group of `avatar.js` (legs, torso, head, arms) into one vertex-coloured mesh, with one hull per group, giving about 6–8 draws.
   - Distance LOD: no outline past 25 m, and hide or impostor past 60 m.
   - Payoff: about 100 draws per visible friend.
   - Cost: medium (equipment swaps must re-merge).
8. **Fog-bound view.**
   - `camera.far = fog.far + 10`, `viewRadius ≈ fog.far + 10`, and shrink the sky dome to fit.
   - Payoff: the worst framings (1,450 draws) drop toward default-view cost.
   - Cost: small.
9. **Static batching and LOD per chunk.**
   - Far chunks (> 48 m): merge all non-interactive props into 1–3 vertex-coloured meshes, no hull, no shadow, ground at SEG/2. Near chunks keep instancing and outlines.
   - For distant forests, merged low-poly trees are enough; billboard impostors are only needed past about 80 m, which is fog.
   - Cost: medium. This is the main lever that keeps "more towns" inside the budget.
10. **Time-slice `buildChunk`.**
    - Split it into steps (ground, grass, props, nodes) of ≤ 4 ms. Pre-filter `LANDS` per chunk in `nearRect`, and move height/colour sampling to a worker later.
    - Cost: medium.
11. **Stream nodes, buildings and labels with chunks.**
    - Cull labels by distance before `project()` and write styles only when they change. Remove the hidden town from the graph during dungeon runs.
    - Cost: medium. Required before the world gets 4–5 towns.
12. **Lazy asset packs per region,** plus `gltf-transform` quantize/meshopt.
    - Today every model loads before the first frame, so each new biome pack would add directly to load time.
    - Cost: medium.
13. **Sea coastline as a baked distance texture** instead of a 64-iteration loop per pixel.
    - Do this before adding many land circles.
    - Cost: small. The GPU benefit is unmeasured here.

Applying items 2, 3, 4, 6 and 8 alone should bring the town view from about 850 draws to about 300 and render JS from about 14 to about 6 ms here. That estimate comes from summing the measured deltas; they overlap a little.
