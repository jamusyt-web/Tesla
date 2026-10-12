# Brief: the 3D model library for new biomes, towns and monsters

All numbers below come from parsing the GLB files. "t" means triangles (index count / 3, summed over nodes) and KB is the raw file size. I wrote the tools and dumps to `scratchpad/world/assets/`:
- `glbstat.py`: size, triangles, skin, clip names, materials.
- `bands.py`: which atlas colours a model samples, sorted into the remap bands from `assets.js`.
- `budget.py`: payload per biome set.
- `payload.mjs`: what loads today.
- `<pack>.txt`: full stat dumps for every pack.

I changed nothing in the repo. Anything marked *(guess)* is not verified.

## 1. What exists, and what it costs

**What ships today.** `client/public/models/` holds 17 pack folders. The manifest (`client/src/scene/manifest.js`) references **255 GLBs, 8,249 KB raw**, plus 165 KB of pack atlases and 81 KB of swapped textures. Every one of them is fetched before the game starts:
- `loadAssets` (`assets.js:176`) runs one `Promise.all` over every `MODELS` url. There is no lazy or per-region API.
- `serveStatic` (`server/app.js:108-127`) pipes GLBs **uncompressed**. Only the map JSON is gzipped (`:60-62`).
- Measured with gzip -9: `character-male-a` 247→34 KB, `character-zombie` 246→44 KB, `animal-fox` 142→20 KB, `tree_oak` 14.6→4.8 KB.

**The asset-side risk for phones is the download, not the triangles.** Before adding about 120 biome models, precompress GLBs and load biome groups lazily when a region streams in.

**Full packs on disk** (`/tmp/claude-0/kenney/<pack>/Models/GLB format/`, GLB counts):

| Pack | GLBs | Pack | GLBs |
|---|---|---|---|
| castle-kit | 76 | mini-market | 20 |
| cube-pets | 24 | nature-kit | 329 (folder is "GLTF format", files are .glb) |
| fantasy-town-kit | 167 | pirate-kit | 72 |
| food-kit | 200 | platformer-kit | 153 |
| furniture-kit | GLTF folder | retro-fantasy-kit | 105 |
| graveyard-kit | 91 | survival-kit | 80 |
| holiday-kit | 99 | watercraft-kit | 46 |
| mini-characters | 26 | | |
| mini-dungeon | 30 | | |
| mini-forest | 22 | | |

`scratchpad/dl/` has graveyard-kit 5.0, mini-dungeon 2.0 and modular-dungeon-kit (39 GLBs, shipped as `modular-dungeon`).

**New downloads this session** (CC0 confirmed in each `License.txt`), in `scratchpad/world/assets/dl/<pack>/x/`. The zip URLs come from the `kenney.nl/assets/<slug>` pages.

| Pack | GLBs | Why it's here |
|---|---|---|
| modular-cave-kit | 40 | Cave walls |
| space-kit | 153 | Crystals and craters; folder "GLTF format" |
| tower-defense-kit | 160 | Crystal and snow details |
| mini-arena | 22 | Armoured soldier |
| hexagon-kit | 72 | Hex tiles; little use |
| blocky-characters | 18 | Off-style |

The catalogue (`kenney.nl/assets/category:3D`, pages 1-4) also lists packs I did not download: animated-characters-protagonists/-retro/-survivors, modular-buildings, building-kit, train-kit, brick-kit and the city, car and space kits (mostly off-theme).

**How to import.** Put a pack folder in the packs root and run `node scripts/import-models.mjs <packs-root>`. It finds files by name recursively and rewrites `CREDITS.md`. `scripts/asset-sheet.mjs` renders toon contact sheets for checking remaps.

**Typical costs**

| Kind | Triangles | KB | Notes |
|---|---|---|---|
| nature-kit scatter | 12-460 | 2-32 | **1-3 named materials** (e.g. `rock_tallA`: dirt, grass, _defaultMat) |
| Atlas props (holiday, pirate, graveyard, survival, castle, FTK) | 20-700 | 3-70 | 1 material (`colormap`) |
| cube-pets | 422-951 | 89-171 | Rigid node animation, 8 clips |
| Humanoids | 374-1,141 | 175-267 | 25-32 clips |
| Landmarks | 1,370-2,282 | 114-218 | Pirate ships (`ship-wreck` 2,282t / 218 KB); castle `siege-tower` 1,598t / 141 KB; FTK `fountain-round` 1,002t |

**Warnings:**
- cave-kit `room-large`: 8,080t / 786 KB.
- cave-kit `room-wide-variation`: 6,704t / 651 KB.
- cave-kit `room-small`: 3,356t.
- cave-kit `stairs`: 2,386t / 223 KB.
- The dungeon `stairs` already shipped: 3,074t / 265 KB.

**Draw calls.** `instanced()` (`assets.js:302`) makes one InstancedMesh plus one hull per sub-mesh. A nature-kit model with 3 materials therefore costs about 3× the draws of an atlas model. **Use atlas-pack models for dense scatter**, and keep nature-kit for hero trees.

## 2. What the recolour system can and cannot do (verified)

- **`recolor`** (by material name) works on flat-colour packs. nature-kit needs `PALETTES` (`manifest.js:44-66`) because it stores sRGB values in linear slots. **space-kit has the same problem**: `rock` is [0.91, 0.52, 0.39] and `crystal` is [0.19, 0.88, 0.59]. It needs a `PALETTES['space-kit']` entry.
- **`remap` bands** (`assets.js:57-66`). `bands.py` shows:
  1. **Snow shading falls in `metal`.** Holiday-kit snow (#c6e3f7, #e1f1fb; hue about 205, saturation 0.1-0.2) shares the band with its rock (#5b6078). A `metal` remap on `rocks-large`, `tree-snow-*` or `cabin-roof-snow` repaints the snow too. Fix: cap `metal` at value < 0.7, or add an `ice` band.
  2. **There is no band for saturated blue** (parrot #6c58bd), **purple/pink** (TD crystals #ab78e8–#dc78ee, cave variation-b mauve #817384) or **near-black**. Crystal and volcanic looks need new `blue`, `purple` and `dark` bands.
  3. **Cube-pet eyes and noses are dark `metal` greys** (#3d3f4b). Koala (96% metal), elephant (92%), panda (88%), bee (77%) and penguin (71%) are mostly that band, so a body remap also recolours the eyes. Keep `ref` ≤ 0.3 so dark stays dark.
- **Texture swaps are free and already on disk:**
  - castle-kit's default colormap and `variation-a…d` are **sandstone** (walls #cc875f with red/yellow/… roofs). `variation-e…g` are **slate** (#5a6078). They live in `/tmp/claude-0/kenney/castle-kit/Models/Textures/`; only `variation-e` ships.
  - Cave kit: default **red-brown** (#7e523f–#996652), `variation-a` **slate** (`metal` band), `variation-b` **mauve**.
- **`GRADE`** (`assets.js:28-41`) applies to every toon material:
  - Pale blues (blue the max channel, saturation < 0.35) are pulled 55% toward warm grey. By hand: ice #d0e4f8 → about #e4e2da *(approximate: the shader works in linear space)*.
  - Jade greens are pulled toward leaf green.
  - So icy and teal biomes need a per-slot **`grade: false`** (a second `customProgramCacheKey`).
  - `grade.js` also warms highlights (×1.05, 1, 0.92), so snow reads cream unless the biome mood lowers warmth or exposure.
- **`tint.emissive` and `glowBand`** (the `CRYPT_IRON` pattern, `manifest.js:37`) cover lava, crystals and lanterns.

## 3. Per biome: models, gaps, art direction

**Snowy alpine / tundra** (set: 20 models, 731 KB raw)
- **Trees:**
  - holiday `tree-snow-a` (378t / 34 KB, green pine with snow caps), `tree-snow-b` (374t) and `tree-snow-c` (234t, all white).
  - platformer `tree-pine-snow` (204t / 22 KB) and `tree-snow` (408t).
  - (Correction to the engine brief: holiday-kit has no `tree-pine-snow`; that file is in platformer-kit.)
- **Rocks and cover:**
  - holiday `rocks-large` (696t, 3.1 m, snow-capped), `rocks-medium` and `rocks-small` (330t).
  - holiday `snow-pile` (132t), `snow-flat` and `snow-flat-large` (168/108t, drift decals), `snow-bunker` (264t).
  - TD `snow-detail-rocks(-large)` (184/232t).
  - platformer `block-snow*` (92t, 1-2 m blocks) for ledges.
- **Buildings:** the holiday **cabin kit** is on a 1 m grid like FTK walls:
  - `cabin-wall` (84t), `cabin-corner-logs` (168t), `cabin-window-a/b/c` (194-300t).
  - `cabin-door-rotate` (animated `open`/`close`).
  - `cabin-roof-snow`, `-corner`, `-point`, `-chimney`, `-dormer` (116-197t).
  - It needs a new recipe in `buildings.js`, which only knows FTK piece names (`:100-209`).
- **Avoid** the festive items: snowman, gingerbread, presents, lights, candy canes.
- **Gaps (procedural):** a frozen lake (`water.js` with ice colours), ice shards and frozen falls (octahedron clusters like the ore crystals at `town.js:87-92`), snowfall.
- **Art direction:** blue-white with deep pine. Keep the holiday atlas un-remapped and set `grade: false` on snow slots so the blue shadows survive. Recolour nature pines (`leafsDark` → '#2f5b4a').

**Desert / badlands / mesa** (20 models, 915 KB)
- **Mesas:** pirate `rocks-sand-a/b/c` (448-552t, 3.7-5.1 m wide, 2.6-3.7 m tall orange stacks); survival `rock-sand-a/b/c` (92-180t).
- **Canyon walls:** cave-kit default `template-wall` (440t, 4×4 m), `-detail-a`, `-corner`.
- **Flora:** nature `cactus_tall/short` (122/116t; native 0.75 m, so scale ×3), pirate `palm-straight/bend` (338t) for oases.
- **Cover:** pirate `patch-sand` (108t, 7.7×6 m), space `bones` (168t), `craterLarge` (60t).
- **Ruins:** nature `statue_head` (196t), `statue_obelisk` (38t), `statue_columnDamaged` (108t).
- **Buildings:** castle-kit on its default sandstone atlas (no remap needed). FTK `wall-block` with `roof-flat`/`roof-high-flat` (20t) gives adobe flat roofs, with a new sand-plaster atlas PNG (`cot_a`-style variants are about 6 KB each).
- **Landmarks:** castle `siege-*-demolished` (618-1,390t), a half-buried `ship-wreck`, `statue_head` at ×8.
- **Gaps:** dune terrain, tumbleweed, sandstorm, scorpions.
- **Art direction:** ochre and terracotta. Remap `orange` on the mesas to '#b5603c' for red rock. Recolour cacti `leafsGreen` → '#5f8f4a'.

**Tropical coast & islands** (19 models, 1,228 KB, the heaviest because of the wreck)
- **Palms:**
  - pirate `palm-*` (338t / 36 KB, 4.2 m) and `palm-detailed-*` (482t).
  - nature `tree_palm*` (6 files, 186-336t, 2 materials each).
  - nature `crops_bambooStageA/B` (276/564t) for thickets.
- **Cover:** pirate `patch-sand-foliage` (636t, 7.7 m), `patch-grass-foliage` (300t), `grass-plant`; `rocks-a/b/c` (232-300t) as shore boulders.
- **Shore:** pirate `structure-platform-dock(-small)` (312-324t), `platform-planks`; watercraft `boat-fishing-small` (237t), `boat-sail-a/b` (386-426t).
- **Buildings:**
  - Stilt huts: pirate `structure` (276t, 2.5 m frame) with `structure-roof` (348t) and `structure-fence(-sides)`.
  - Tree houses: mini-forest `building-platform` (508t), `building-structure` (144t), `building-roof` (324t), `ladder`.
  - Fort and lighthouse: pirate `castle-gate/wall` and `tower-*`.
- **Landmarks:** `ship-wreck` (2,282t), a moored `ship-pirate-large` (1,938t / 173 KB), `cannon`, `flag-high`.
- **Gaps:** coral, giant leaves (scaled nature `plant_bushLarge`), waterfall.
- **Art direction:** saturated greens and sand. Turquoise accents need `grade: false`.

**Swamp / marsh / bog** (16 models, 833 KB)
- **Trees:**
  - graveyard `pine-crooked` (336t, 77% `green` band, so remap green → olive '#55623a').
  - graveyard `trunk-long`/`trunk` (312/274t, dead snags).
  - nature `tree_thin_dark` (456t), with `hanging_moss` (52t) on branches.
- **Cover:** `lily_*`, mushrooms (shipped), `log_large`, `stump_old`. Reeds: nature `crops_cornStageB/C` (116-148t) recoloured brown-green *(guess: may read as corn)*.
- **Buildings:** mini-forest platforms and `ladder` on stilts; survival `structure`, `structure-floor`, `structure-roof` (80-188t, 0.5 m grid); graveyard `hay-bale` for thatch, `fence-damaged`, `lightpost-single` (352t), `crypt-small` (414t) as a sunken shrine.
- **Gaps:** bog water colour, ground fog, fireflies, frogs and crocodiles.
- **Art direction:** olive, brown and sickly yellow-green. Lanterns use `glowBand` with '#9cff6a' for will-o-wisps.

**Volcanic / ashlands** (14 models, 749 KB)
- **Rocks:**
  - pirate `rocks-a/b/c` are 100% `metal`: remap to '#3b3533' (ref 0.45) for basalt.
  - space `meteor`/`meteor_detailed` (68/196t), `crater`/`craterLarge` (60t), `rocks_smallA/B` (48-60t), recoloured charcoal.
  - cave-kit `variation-a` (slate) for lava tubes.
- **Dead flora:** graveyard `trunk*` with `orange` → '#2e2622' (charred).
- **Wreckage and shrines:** castle `siege-catapult-demolished` (842t) and `siege-tower-demolished` (1,390t); graveyard `fire-basket` (`CRYPT_IRON`), `column-large`, `debris`.
- **Gaps (the most of any biome):** lava pools and rivers (a `water.js` variant with emissive orange and scrolling), glowing cracks (emissive decals), smoke and ember particles, obsidian spires (flat-shaded cones).
- **Art direction:** near-black ground with emissive orange. Needs the `dark` band.

**Autumn / old forest** (16 models, 876 KB): **the cheapest biome.**
- **Trees:**
  - nature `*_fall` variants, eleven in all: `tree_oak_fall` (196t), `_default_`, `_detailed_`, `_fat_`, `_plateau_`, `_simple_`, `_small_`, `_tall_`, `_thin_`, `_cone_`, `_blocks_fall`. Mix them with per-slot `recolor: { leafsFall: '#c9472f' / '#e0a33a' }`.
  - graveyard `pine-fall` and `pine-fall-crooked` (336t).
  - survival `tree-autumn(-tall)` (198t).
  - Giant elders: `tree_oak_dark` at ×2.5 scale.
- **Cover:** graveyard `pumpkin*` (348t), `hay-bale(-bundled)`; nature `crop_pumpkin` (120t), `log_stackLarge` (310t).
- **Buildings:** FTK as it is, with `roof_orange`/`roof_yellow`, plus FTK `windmill` (732t) and `watermill` (600t), which are not shipped yet.
- **Landmarks:** nature `statue_ring`, graveyard `altar-stone`.
- **Art direction:** warm amber, all done with the existing recolour.

**Highland / mountain** (18 models, 477 KB)
- **Cliffs:** nature `cliff_*`, 28 shapes in rock and stone (56 files) (12-219t, 1 m tiles, flat `grass`/`dirt` materials, so easy to recolour). Also `rock_tallA–J` and `stone_tallA–J` (37-172t), pirate `rocks-b` (3.65 m), mini-forest `rocks-high` (342t), FTK `rock-wide`/`rock-large` (156-200t).
- **Trees:** nature `tree_pineTallA–D` (78-98t, the cheapest trees anywhere).
- **Buildings:** the full castle-kit (`tower-hexagon-*`, walls, gate, `bridge-straight(-pillar)` 156-192t, `stairs-stone`) on slate `variation-e/g`. Nature `bridge_wood/stone` (220-252t) and mini-forest `bridge` (372t) for gorges.
- **Gaps:** real mountains (a terrain heightfield), waterfalls (`cliff_waterfall` is only a 1 m tile), goats and eagles.
- **Art direction:** cool slate, heather and dark pine.

**Crystal caverns** (12 models, 290 KB)
- **Walls:** cave-kit `template-wall`, `-detail-a`, `-corner`, `-floor-detail`, `gate-rock` in **variation-b mauve**.
  - **These are a drop-in for the dungeon kit.** The names match, and so do the bounds: `template-wall-corner` and `gate-metal-bars` are identical, and the walls are 4.0×4.05×2.16 vs 4.0×4.15×1.99.
  - `client/src/scene/dungeon.js` hard-codes `'modular-dungeon:'` at lines 138, 149, 155, 158, 161, 174 and 196. Making that prefix a kit parameter gives a cave dungeon kind.
- **Crystals:**
  - space `rock_crystals`, `rock_crystalsLargeA/B` (364-384t). The separate `crystal` material can be recoloured and made emissive.
  - TD `detail-crystal` (68t) and `detail-crystal-large` (436t, purple on green rock).
  - platformer `jewel` (12t) for scattered gems.
- **Glow mushrooms:** nature `mushroom_*` with `tint.emissive`.
- **Gaps:** big crystal spires (procedural octahedron clusters), ceilings and darkness (engine).
- **Art direction:** dark mauve rock with cyan and magenta emission. Needs the `purple`/`blue` bands and `grade: false`.

## 4. Creatures

**Already used:**
- cube-pets: fox (wolf), caterpillar, crab, hog (boar), polar (bear) as monsters; cat, dog, chick, bunny, pig, deer, beaver as ambient NPCs.
- graveyard-kit: ghost, skeleton, zombie, vampire as monsters; keeper as a villager.
- mini-dungeon orc (goblin).
- mini-characters female-b/c/f and male-a/b/f, and mini-forest archer, as villagers.

**Clip sets:**
- **cube-pets:** `static idle walk run eat dance gesture-positive gesture-negative`. There is no attack or death clip; `Mob` animates the lunge and death in code.
- **Humanoids** (mini-characters, mini-dungeon, graveyard, archer, employee): 32 clips, including `idle walk sprint die attack-melee-right/left attack-kick-right/left holding-right(-shoot) interact-right pick-up emote-yes/no`.
- **mini-arena soldier and the platformer characters:** 25 clips (the same minus `wheelchair-*`).
- `Mob` uses only `idle`, `walk`, `attack-melee-right` and `die` (`client/src/scene/mobs.js:58`).
- **Rigs:** graveyard characters are rigid (no skin), so they are cheaper. mini-characters, mini-dungeon, mini-arena and the archer are skinned.
- **Fallback:** a type with no model falls back to `slime()` (`mobs.js:38-40`), so new monsters can ship before their art.

**Unused but usable:**
- cube-pets: bee (742t), cow (578t), elephant (676t), fish (422t), giraffe (598t), koala (594t), lion (889t), monkey (918t), panda (734t), parrot (530t), penguin (558t), tiger (951t).
- mini-dungeon `character-human` (465t / 213 KB).
- mini-arena `character-soldier` (513t / 174 KB, helmet and plume).
- Weapon props for kitting out humanoids: mini-dungeon `weapon-spear`, `weapon-sword`, `shield-rectangle`, `shield-round`; mini-forest `weapon-bow`. Attaching them to the hand bone with `holding-right` is *(guess: the bone name is not checked)*.

**Off-style:**
- mini-characters a/d/e and male c/d/e (modern clothes; townsfolk at most).
- platformer `oobi`…`oozi` (astronaut suits).
- blocky-characters (72t, one texture per character, Minecraft-like).
- TD `enemy-ufo-*`, space `alien`/`astronaut*` (static).

**Proposed roster** (remaps use the band shares from `bands.py`):

| Biome | Monsters (model → recipe) |
|---|---|
| Snow | **Frostbeak** penguin (`metal`→'#2c4a6e', ref 0.3); **Snow Fox** fox (`warm`→'#e8eef2'); boss **Woolly Mammoth**: elephant at 3.4 m (`metal`→'#6b4a35', ref 0.3) |
| Desert | **Sun Lion** lion; **Dune Wasp** bee (`yellow`→'#c46a2a'); **Sand Legionnaire** soldier (`red`→'#c9a25a'); **Dust Skeleton** skeleton (`warm` 82% → '#d8c39a'); crab (`red`→'#b98b4e') as a scorpion stand-in |
| Tropical | **Thief Monkey** monkey; **Razorbeak** parrot; **Jungle Tiger** tiger; **Drowned Sailor** zombie (`green`→'#4a8a8a') |
| Swamp | **Mire Thrall** zombie; **Bog Hog** hog (`warm`→'#4f5a3a'); **Bog Hag** keeper or vampire (`red`→'#5f7a3a'); **Stinger** bee (`yellow`→'#8aa040'); the existing Bog Slime |
| Volcanic | **Magma Boar** hog + `tint.emissive` '#ff5a1f'; **Ember Imp** orc (`green`→'#c2452d') + glow; **Ash Skeleton**; **Cinder Wisp** ghost tinted orange (the `mob_crypt_wisp` pattern, `manifest.js:195`); boss **Magma Golem**: procedural `golem()` with emission |
| Autumn | **Bandit Archer** archer (`green`→'#7a4a2a'); **Brown Bear** polar (`white`→'#7a5236', 53% white + 23% metal/white); boss **Elder Stag**: deer at 2.4 m |
| Highland | **Highland Ox** cow (`warm`→'#8a5a3a'); **Crag Gremlin** koala (`metal`→'#6d6a5c'); **Orc Raider** orc + spear and shield; **Highland Knight** soldier |
| Crystal | **Shard Wisp** ghost tinted cyan; **Gem Grub** caterpillar + emission; boss **Crystal Golem** (procedural golem with an octahedron crust) or **Lich** vampire (`red`→'#7a4fd0') |

**No model in any pack** (procedural, or a stand-in): dragon or wyvern, scorpion, frog, crocodile, eagle or griffon, goat, yeti, treant, spider.

## 5. Recommendations

1. **Transport before content.** Precompress GLBs and serve them gzipped (about 6-7× smaller for characters). Split `MODELS` into a core group plus one group per biome, loaded when a region's chunk streams in. Today `loadAssets` is all-or-nothing.
2. **Small engine changes to `assets.js`:**
   - Add `blue`, `purple` and `dark` bands.
   - Cap `metal` at value < 0.7 (or add `ice`).
   - Add a per-slot `grade: false`.
   - Add `PALETTES['space-kit']`.
   - Then every look above can be written as manifest data.
3. **Budget per biome:** about 12-20 new models and 0.3-1.2 MB raw (from `budget.py`):

| Biome | KB raw |
|---|---|
| Highland | 477 |
| Crystal | 290 |
| Snow | 731 |
| Volcanic | 749 |
| Swamp | 833 |
| Autumn | 876 |
| Desert | 915 |
| Tropical | 1,228 |

   Use 2-3 variants per scatter slot and prefer atlas packs for scatter. Use ships and wrecks as one-off landmarks, never as scatter.
4. **Order of ease** (fewest gaps first): autumn, highland, snow, desert, tropical, swamp, crystal caverns, volcanic. Volcanic needs procedural lava and new bands.
5. **Second dungeon kind for free:** the cave kit's `template-*` pieces in red-brown (desert), slate (volcanic) or mauve (crystal) variations, through a kit parameter in `dungeon.js`. **Avoid** its `room-*` and `corridor-wide*` prefabs (1.5k-8k triangles, 150-786 KB).
6. **Leave out** retro-fantasy-kit (tiled textures, a different style), blocky-characters, platformer astronauts, the festive holiday items, space-kit sci-fi, and the hexagon-kit dioramas.
