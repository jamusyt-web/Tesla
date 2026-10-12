# Hearthvale step 4: The Hearthlands (final spec)

This is the build spec for roadmap step 4, the wider world. It starts from the **engagement design** (the base all three judges picked) and grafts in the best of the other three:
- explorer's discovery mechanics,
- progression's economy core and curve,
- feasibility's performance discipline and cheap endgame.

Every conflict the judges raised is settled in §0.2.

Checks behind the numbers are in `scratchpad/world/spec/`:
- `world.mjs`: land circles, regions, road gaps, stone coverage, extent.
- `fight.mjs`: the monster curve against the real `heroStats`/`damage`.
- `mobs.mjs`: the stat tables below.
- `pace.mjs`: xp pacing, using the real `xpForLevel`.

Measured baselines are quoted from the six briefs.

Conventions:
- Metres; x is east and **north is −z** (as today).
- "Combat N" means combat skill level. "Hero N" means `heroLevel()`.
- ids are snake_case.
- Phases and packages are in §10.

---

## 0. Decisions

### 0.1 The design in brief
1. **Performance and multi-town plumbing come first** (Phase 1). No content merges until the phone budgets hold on today's island and on a stress map at the final coordinates.
2. **Five towns plus a hub:**
   - Hearthvale (T1, meadow)
   - Amberfold (T2, autumn)
   - Rimeholt (T3, alpine)
   - Sandmere (T4, desert)
   - Starfall (T5, crystal)
   - Fourways (outpost hub)

   The land is 0.49 km², about 17× today's island. Every road end to end is 2.8 km, about 7.5 minutes of walking.
3. **A ring with one friend-built shortcut.** The Hollowmere Causeway's broken bridge is a dock over a lake, mended by a town project. There is no ferry.
4. **One suggestion engine** (`shared/goals.js`) feeds the goal card, the context button, level-ups and the digest. It is never empty.
5. **Discovery:**
   - skyline beacons under short fog;
   - a fog-of-war map uncovered by walking;
   - vistas that pin landmarks;
   - 5 passages opened by a skill level or a crafted kit.
6. **Region-scoped markets** with town storage. Every NPC faucet is a refilling pool, including the merchant floor. Hauling pays through appetites, import orders, cross-town recipes and (optionally) crates.
7. **One monster curve** (`mobStats`). A monster's `lvl` is its recommended combat level.
8. **Flat power at the top.** Sets and charms are side-grades. Rich and ancient nodes, Deep tiers and a weekly Nightmare carry 40→50.
9. **Nothing expires into loss.** There are no streaks, and the owner holds every economy knob; there is no automatic governor.

### 0.2 Conflicts and how they are resolved
| Conflict | Resolution | Why |
|---|---|---|
| T5 biome: crystal (engagement) vs volcanic (others) | **Crystal Starfall** | Volcanic is last in the asset brief's ease order (procedural lava, new bands). The crystal set is 290 KB raw. |
| World size: 0.25 / 0.45 / 0.61 / 0.95 km² | **0.49 km²**: engagement's ring plus the Hollowmere Causeway | "Decent size" without progression's dressing load |
| Ferry vs project bridge | **Bridge over a lake** (a dock, today's engine). Ferry cut | No sea-dock engine change; friends physically grow the map |
| Profession trinkets that auto-swap vs a charm slot | **A dedicated `charm` slot** (judges 2 and 3) | No hidden equip swaps; `STARTER_EQUIP` merges at `heroes.js:60` |
| Level-40 choice: now or later | **Now** (judges 1 and 3), as a small modifier table | A build identity and a respec gold sink |
| Order banking of 12 per town | **At most 4 open per hero per town**, each lasting 3 days | The board never becomes an inbox |
| Merchant floor cap: per hero vs per (town, item) | **Per (town, item) pool**, shared, refilling over 8 h | Caps the 60% faucet and signals "sell elsewhere" |
| Hearthvale appetites below 0.6 (engagement) | **Hearthvale ≥ 0.60 on every tag** | No regression for new players |
| Automatic governor | **Cut.** Owner overrides plus alarms | Noise with 5–20 players |
| Vista fog lift (140–200 m) | **Cut.** A camera pan, map reveal and journal credit only | It breaks the fog-bound view budget |
| Map update: `gen` merge vs patches | **Id-keyed patches applied once**, recorded in `map.patches` | The `gen` merge brings back entries the owner deleted |
| Elder variants vs rich/ancient states | **Rich/ancient states only** | One system, no models |
| Prism Deep T4 vs Deep tier per kind plus Nightmare | **Deep tier for every kind, plus a weekly Nightmare** | Rotates all dungeon art |
| Kill gold `[3L,5L]` vs `[7,11]·L^0.6` | **`[7,11]·L^0.6`** for new monsters; Hearthvale's are unchanged | Gold per hour grows ×1.3 per tier while prices grow ×1.8 |
| Skill pacing: 65 h (engagement) vs 240 h (progression) | **About 54 h focused to hero 50 and about 102 h to all six skills at 50** (`pace.mjs`) | Months for a casual group without a wall |
| Cargo crates now vs Phase 4 | **Phase 5, small and optional**: 3 carried, 6 delivered a day | The roads are the content; not a chore |
| Integration bottleneck vs 13-way merges | **Phase 0 seams, plus one integration package per phase** that alone owns the hub files | Packages in a phase stay disjoint |

---

## 1. The world

### 1.1 Towns
| id | Name | Tier | Biome | Centre | Core region r | Land circle r | Combat band | Home stone |
|---|---|---|---|---|---|---|---|---|
| `hearthvale` | Hearthvale | 1 | meadow (+ `wilds` zone) | 0, 0 | 96 (unchanged) | 96 (unchanged) | 1–12 | `stone_square` (6.2, 5.2) |
| `amberfold` | Amberfold | 2 | autumn | −540, −60 | 70 | 120 | 12–18 | `stone_amberfold` (−534, −55) |
| `rimeholt` | Rimeholt | 3 | alpine | −520, −660 | 70 | 115 | 18–25 | `stone_rimeholt` (−514, −655) |
| `sandmere` | Sandmere | 4 | desert | 560, −560 | 70 | 120 | 25–32 | `stone_sandmere` (566, −555) |
| `starfall` | Starfall | 5 | crystal | 40, −1140 | 70 | 118 | 32–40, endgame to 50 | `stone_starfall` (46, −1135) |
| `fourways` | Fourways (outpost hub) | 3 | heath | 0, −640 | 34 | 70 | — | `stone_fourways` (6, −635) |

**Region nesting.** `placeAt` picks the smallest containing region (`world.js:218-225`).
- Each new town has a 70 m **core** (`kind: 'town'`: trading allowed, no camps) inside a larger **outskirts** region (`kind: 'wild'`) where its camps live.
- Hearthvale keeps its single r 96 town region, so every trade action there works exactly as today.

### 1.2 Regions (`regions[]` entries)
`kind` takes one new value, `outpost`: no market and no camps, but it has a stone, a campfire, a cookpot and a notice post. `biome` is new (§2).

| id | Name | kind | tier | biome | x, z | r | Monster levels |
|---|---|---|---|---|---|---|---|
| hearthvale | Hearthvale | town | 1 | meadow | 0, 0 | 96 | 1–11 (unchanged) |
| westmarch | The Westmarch | wild | 2 | autumn | −285, −20 | 200 | 11–13 |
| amberfold | Amberfold | town | 2 | autumn | −540, −60 | 70 | — |
| amberwood | Amberwood | wild | 2 | autumn | −540, −80 | 150 | 12–17 |
| thornback | Thornback Pass | wild | 3 | alpine | −515, −360 | 230 | 12–16 |
| rimeholt | Rimeholt | town | 3 | alpine | −520, −660 | 70 | — |
| rimefells | Rimeholt Fells | wild | 3 | alpine | −520, −680 | 140 | 16–23 |
| midmarch_w | The Midmarch (west) | wild | 3 | heath | −230, −665 | 215 | 19–22 |
| fourways | Fourways | outpost | 3 | heath | 0, −640 | 34 | — |
| midmarch_e | The Midmarch (east) | wild | 4 | heath | 255, −625 | 230 | 24–26 |
| sandmere | Sandmere | town | 4 | desert | 560, −560 | 70 | — |
| dunesea | The Dunesea | wild | 4 | desert | 590, −580 | 140 | 22–29 |
| skystair | Skystair Rise | wild | 5 | crystal | 20, −890 | 200 | 19, 28–30 |
| starfall | Starfall | town | 5 | crystal | 40, −1140 | 70 | — |
| craterrim | The Crater Rim | wild | 5 | crystal | 40, −1150 | 130 | 29–36 |
| hollowmere | Hollowmere | wild | 2 | heath | 5, −350 | 265 | 11–13 |

**Zones** (`zones[]`; the new optional `biome` field overrides the region's):

| id | kind | label | biome | x, z | r | ground |
|---|---|---|---|---|---|---|
| thornback_low | forest | Redfall Woods | autumn | −505, −260 | 110 | #6f5a35 |
| saltflats | meadow | The Saltflats | desert | 420, −600 | 80 | #d9c7a0 |
| skystair_low | meadow | Heather Steps | heath | 15, −760 | 80 | #7a6a5e |
| crater_glade | garden | Lantern Glade | crystal | 90, −1120 | 25 | #4a4660 |

Each new town also gets the zones `<town>_yard` (kind `town`, r 14 at the workshop yard) and `<town>_lake` (kind `lake`).

### 1.3 Roads
Roads are `paths[]` entries `{ id, pts, w: 3 }`. They feed the road graph (§9.2 item 12). Walking speed is 6.2 m/s.

| id | Points | Length | Walk | Joins |
|---|---|---|---|---|
| westmarch | (−92,−4) (−150,−12) (−230,8) (−310,−16) (−390,−40) (−470,−52) | 389 m | 63 s | Hearthvale `gate_west` → Amberfold |
| thornback | (−540,−130) (−515,−240) (−470,−320) (−540,−400) (−500,−470) (−540,−540) (−522,−590) | 525 m | 85 s | Amberfold → Rimeholt |
| midmarch_w | (−450,−660) (−350,−640) (−260,−690) (−170,−650) (−80,−665) (−34,−642) | 446 m | 72 s | Rimeholt → Fourways |
| midmarch_e | (34,−640) (100,−610) (200,−640) (300,−600) (400,−590) (490,−572) | 477 m | 77 s | Fourways → Sandmere |
| skystair | (0,−674) (35,−730) (−15,−820) (40,−900) (10,−980) (40,−1070) | 446 m | 72 s | Fourways → Starfall |
| causeway | (28,−92) (25,−170) (5,−250) (0,−330) **bridge** (0,−430) (−10,−520) (0,−606) | 518 m | 84 s | Hearthvale `gate_north` → Fourways, once the bridge is mended |

Before the bridge is mended:
- Hearthvale → Fourways is 1.36 km by road (westmarch, thornback, midmarch_w).
- Afterwards it is 518 m.

The south half of the causeway is a level 11–13 excursion from Hearthvale. It fills today's gap between the golem (11) and Amberfold.

### 1.4 Land, lakes, docks and stones (the exact geometry)
**Lands** (79 circles, `lands[]`, written as id x,z r). There are more than 64, so the baked coast texture (§9.2 item 11) is mandatory.

```
island 0,0 r96 (unchanged); land_amberfold -540,-60 r120; land_rimeholt -520,-660 r115; land_sandmere 560,-560 r120;
land_starfall 40,-1140 r118; land_fourways 0,-640 r70;
westmarch r55: -92,-4; -150,-12; -190,-2; -230,8; -270,-4; -310,-16; -350,-28; -390,-40; -430,-46
thornback r55: -527,-185; -515,-240; -492,-280; -470,-320; -505,-360; -540,-400; -520,-435; -500,-470; -520,-505; -540,-540
midmarch_w r55: -400,-650; -350,-640; -305,-665; -260,-690; -215,-670; -170,-650; -125,-657; -80,-665
midmarch_e r55: 67,-625; 100,-610; 150,-625; 200,-640; 250,-620; 300,-600; 350,-595; 400,-590; 445,-581
skystair r55: 35,-730; 10,-775; -15,-820; 13,-860; 40,-900; 25,-940; 10,-980; 25,-1025
causeway r42: 28,-92; 27,-131; 25,-170; 15,-210; 5,-250; 3,-290; 0,-330; 0,-430; -5,-475; -10,-520; -5,-563
land_hollowmere 0,-380 r52 (entirely under the Hollowmere lake; it exists so the bridge docks have land beneath them)
pockets: pk_hollowlog -330,60 r34; pk_tarn -440,-468 r34; pk_moorbrute -150,-735 r34; pk_cairn 105,-700 r32;
pk_saltmarsh 262,-555 r34; pk_saltglass 318,-655 r34; pk_raider 380,-680 r34; pk_firstshard 74,-792 r30;
pk_vista_sky -44,-882 r32; pk_shardwisp 62,-955 r28; pk_meltwater -60,-952 r34; pk_reedbank -22,-178 r30
passage islands (not walk-connected; reached only by passage): isl_smugglers -240,85 r16; isl_frozenfalls -625,-520 r16;
isl_ninefold -215,-760 r15; isl_eyrie 112,-990 r30; isl_starfallen -98,-1018 r28
```

**Totals:**
- Extent: x −660…680, z −1258…101 (1,340 × 1,359 m).
- Land: 0.49 km².
- Nav: 1.83 MB per grid if allocated flat, so it becomes per-tile (§9.2 item 12).
- The exploration bitmap is 84 × 85 cells of 16 m, which is 893 bytes.
- No point on land is more than 276 m from a waystone.
- The dungeon origin (5000, 5000) is more than 6 km away.

**Lakes** (`lakes[]`). `kind` is a new field (`water|ice`, used only for colour). `fish` names a fish table (§4.4).

| id | x, z | r | deep | kind | fish |
|---|---|---|---|---|---|
| mirror_lake | 26, 46 | 14 | 6.5 | water | mirror (unchanged) |
| mill_pond | −575, −95 | 12 | 6 | water | amberfold |
| rimeglass_tarn | −470, −700 | 16 | 7 | ice | rimeholt |
| sandmere_oasis | 525, −605 | 12 | 5 | water | sandmere |
| crater_lake | 40, −1190 | 22 | 10 | water | starfall |
| hollowmere | 0, −380 | 55 | 30 | water | hollowmere |
| saltpools | −205, 38 | 9 | 0 | water | road_west |
| thornback_tarn | −446, −472 | 12 | 5 | ice | road_thornback |
| peat_pool | −125, −706 | 10 | 0 | water | road_midmarch |
| saltmarsh_pool | 262, −552 | 10 | 0 | water | road_saltmarsh |
| meltwater_pool | −62, −958 | 10 | 4 | ice | road_skystair |
| reedbank | −24, −184 | 8 | 0 | water | hollowmere |

Each lake gets 3 `fish_spot` nodes (6 at the town lakes), 2 m inside its edge.

**Docks** (`docks[]` gains an optional `style: 'pier'|'bridge'`):
- `dock_hm_s` (0, −350), w 4, d 44, style bridge.
- `dock_hm_n` (0, −410), w 4, d 44, style bridge.
- Between them is a 16 m gap of open water.
- The project patch `proj_hollowmere_bridge` adds `dock_hm_mid` (0, −380), w 4, d 16. It also removes the props `p_hm_broken_s` (0, −371) and `p_hm_broken_n` (0, −389), which are `proc_broken_span` with r 0, used only for looks.

**Waystones** (12):

| id | Name | x, z | Outpost? |
|---|---|---|---|
| stone_square | Hearthvale Square | 6.2, 5.2 | — |
| stone_wildwatch | Wildwatch | 3, −40.5 | — |
| stone_westmarch | Westmarch Stones | −305, −4 | yes |
| stone_amberfold | Amberfold Green | −534, −55 | — |
| stone_thornpass | Thornpass Lodge | −505, −432 | yes |
| stone_rimeholt | Rimeholt Gate | −514, −655 | — |
| stone_fourways | Fourways | 6, −635 | yes (hub) |
| stone_saltmarsh | Saltmarsh Camp | 250, −612 | yes |
| stone_sandmere | Sandmere Well | 566, −555 | — |
| stone_skystair | Skystair Camp | 14, −860 | yes |
| stone_starfall | Starfall Terrace | 46, −1135 | — |
| stone_bridgehead | Hollowmere Bridgehead | 18, −300 | yes |

Fees stay `5 + d/25`, so neighbouring towns cost 25–30 g.

An **outpost** is a stamp of map entries around the stone:
- campfire `proc_campfire` at (+4, +3): out-of-battle regen ×3 within 8 m;
- cookpot station at (−4, +3);
- notice post `proc_notice` at (0, +6). It shows the top Compass goal, the current elite and this week's glimmer rumour.

There is no market at an outpost, so towns stay worth reaching.

**Gates** (`gates[]`, appended so `GATES[0]` stays the Wilds Gate):
- `gate_west`, "West Gate", at (−92, −4), rot π/2.
- `gate_north`, "North Gate", at (28, −92).

### 1.5 Points of interest and the 100 m rule
**`landmarks[]`** is a new map list:
```js
{ id, kind, name, x, z, r = 8, look?: radians, reset?: 'weekly'|'once', loot?: '<table>', lore?: '<text>', page?: 1..12 }
// kind: vista | ruin | shrine | cache | secret | curio | npc | landmark
```
Waystones, dungeon doors and lakes count as discoveries automatically.

**Road POIs**, checked by `world.mjs` (max gap is the longest empty stretch of road):

| Road | POIs in road order (id x,z; `camp_` is a monster spawn, `grove_` a cluster of nodes, `fish_` a lake) | Max gap |
|---|---|---|
| westmarch | gate_west · vista_causeway −160,14 · fish_saltpools · camp_mossback −250,−30 · ruin_milestone −272,12 · stone_westmarch · cache_hollowlog −330,52 · camp_hedge_bandit −360,−66 · shrine_wayfarer −398,−26 · grove_birch −430,−20 | 75 m |
| thornback | camp_charcoal −528,−190 · camp_stag −470,−236 · grove_maple −520,−270 · vista_redfall −468,−310 · cache_bearden −500,−362 · ruin_watch −585,−380 · stone_thornpass · fish_tarn · grove_frostpine −515,−505 · camp_snowfox −565,−490 · pass_frozenfalls −588,−535 · shrine_hearthfire −522,−548 | 70 m |
| midmarch_w | grove_rimeedge −400,−668 · camp_moor_ox −340,−608 · vista_giantsteps −292,−722 · pass_ninefold −215,−705 · ruin_ninefold −205,−612 · camp_moor_brute −150,−738 · fish_peat · grove_heath −60,−690 | 91 m |
| midmarch_e | npc_pedlar 50,−612 · cache_cairn 108,−702 · grove_scrub 150,−600 · camp_carrion_crow 200,−682 · stone_saltmarsh · fish_saltmarsh · vista_saltglass 318,−652 · grove_dryscrub 345,−575 · camp_saltway_raider 382,−684 · shrine_dunes 430,−548 | 80 m |
| skystair | camp_crag_gremlin_s 62,−720 · ruin_firstshard 74,−790 · grove_heather 10,−775 · camp_moor_ox_s −30,−812 · vista_skystair −44,−880 · stone_skystair · camp_shard_wisp 62,−955 · pass_eyrie 75,−962 · fish_meltwater · pass_meltwater −70,−975 · grove_skyash 0,−1020 | 91 m |
| causeway | gate_north · camp_mossback_n 55,−150 · fish_reedbank · ruin_tollhouse 40,−215 · camp_hedge_bandit_n −30,−260 · stone_bridgehead · vista_hollowmere −25,−320 · bridge (broken) · cache_drowned_cart −30,−470 · camp_hedge_bandit_n2 30,−520 · shrine_heron −30,−560 | 62 m |

**Town landmarks:**
- **Hearthvale:** vista_wildwatch_cliff (−20,−92), secret_whisper_hollow (−70,12), cache_under_pier (34,30), curio_lost_hat (30,60), npc_tinker (30,−14) (gives the Atlas, §5.5).
- **Amberfold:**
  - lm_great_mill (−505,−95) and lm_elder_oak (−610,−30);
  - the door to the Thornroot Warren (−612,−10);
  - vista_millrace (−470,−120);
  - caches: cache_millers_box (−585,−120), cache_beehive (−600,−120);
  - shrine_harvest (−500,−10), curio_lost_scythe (−640,−90).
- **Rimeholt:**
  - lm_rime_beacon (−575,−610) and the door to the Icefall Mine (−600,−720);
  - vista_beacon_crag (−585,−600);
  - caches: cache_trappers (−440,−720), cache_ice_cave (−610,−700);
  - ruin_old_shaft (−620,−680), curio_frozen_lantern (−470,−620).
- **Sandmere:**
  - lm_sunken_colossus (640,−610) and the door to Ashkar's Tomb (650,−595);
  - vista_salt_quay (600,−470);
  - caches: cache_caravan_box (520,−660), cache_colossus_eye (655,−625);
  - ruin_caravanserai (660,−520), curio_brass_compass (480,−620).
- **Starfall:**
  - lm_starfallen (40,−1190): a 20 m crystal standing in the crater lake, discovery r 30;
  - the door to the Shard Vault (−30,−1215);
  - vista_observatory (95,−1150);
  - cache_fallen_star (120,−1180), secret_lens_grotto (−50,−1170), curio_star_chart (60,−1080).
- **Fourways:**
  - lm_waystation_tower (10,−650), cache_waystation_cellar (−20,−660);
  - npc_pell, the pedlar (8,−628).

**Passage islands:**
- cache_smugglers (−240,85) on isl_smugglers;
- cache_frozenfalls (−625,−520) on isl_frozenfalls;
- cache_ninefold (−215,−760) on isl_ninefold;
- cache_eyrie (112,−990) on isl_eyrie;
- secret_starfallen (−98,−1018) on isl_starfallen.

**Density rules.** These are an editor lint and `world-content.test.js`:
- At most 100 m of road between POIs.
- Every region has at least 1 vista, 2 caches, 1 fishing lake, 2 camps and 1 stone.
- Every land point is within 300 m of a stone.
- Caches sit at least 20 m off the road.
- Every town has **filler nodes 1–2 tiers lower**, so a weaker friend always has something to do (§4.3).

### 1.6 Passages (`passages[]`, new list)
Shape: `{ id, x, z, tx, tz, kind, req: { skill, lvl } | null, kit?: '<item>', name }`.
- Within 3 m of either end, the context button offers the hop: a 0.6 s fade to the other end.
- If the hero fails the requirement, the button shows greyed text, e.g. "Foraging 20 or Ice Picks".
- **A kit is an item in the bag and is never used up.**

| id | From → to | kind | Requirement |
|---|---|---|---|
| pass_smugglers | (−232, 52) → (−238, 78) | squeeze | Mining 10, or hooded_lantern |
| pass_ninefold | (−215, −705) → (−215, −752) | squeeze | Mining 15, or hooded_lantern |
| pass_frozenfalls | (−588, −535) → (−622, −520) | climb | Foraging 20, or ice_picks |
| pass_meltwater | (−70, −975) → (−92, −1000) | swim | Fishing 20 |
| pass_eyrie | (75, −962) → (100, −985) | climb | Foraging 25, or climbing_rope |

Each passage leads to a cache, and three of them hold Cartographer pages (§5.5).

**Reachability.** The editor's reachability check and the server's `reachability()` treat a passage as an edge, so the islands count as reachable.

### 1.7 Skyline beacons (`skyline[]`, new list)
Shape: `{ id, kind, x, z, h, card: '<atlas cell>' }`. There are at most 6, drawn in one instanced draw (§9.2 item 9).

| id | Kind | Where | Height |
|---|---|---|---|
| sky_elder_oak | tree | −610, −30 | 28 m |
| sky_great_mill | mill | −505, −95 | 18 m |
| sky_rime_beacon | tower | −575, −610 | 26 m (the fire lights after `proj_rime_beacon`) |
| sky_waystation | tower | 10, −650 | 20 m |
| sky_colossus | statue | 640, −610 | 22 m |
| sky_starfallen | crystal | 40, −1190 | 34 m |

A card fades in beyond the active fog far, and hands over to the real model inside fog far + 20 m.

---
## 2. Biomes, mood, clock and weather

### 2.1 Data shape (`shared/biomes.js`, one file per biome in `shared/biomes/<id>.js`)
Biomes live in code, because they bundle model slots and `mapProblems` needs x/z on every list entry. The lookup is:

`biomeAt(x,z) = zone?.biome ?? region?.biome ?? MAP.biome ?? 'meadow'`, with `kind:'wilds'` zones implying `'wilds'`.

```js
BIOMES[id] = {
  name,
  ground: { grass, grass2, path, plaza, sand, cliff },   // replaces town.js:411-416
  tufts: { colors: [a, b, c], density },                 // density multiplies today's tries (town.js:843)
  water: { shallow, deep }, sea: { shallow, deep },
  sky: { top, mid, bot },
  light: { fog, fogNear, fogFar, hemiSky, hemiGround, hemi, sun, sunI, exposure },  // high quality
  weather: null | { kind: 'leaves'|'snow'|'dust'|'rain'|'sparkle', rate, chance },  // chance per 20-min slot
  critters: ['butterfly'|'deer'],
  cover: [{ slot, per100m2, s: [min, max], nearWater?: true }],  // at most 6 slots × 3 variants
  ambience: '<preset>', pack: 'core' | 'biome:<id>',
}
```

**Low quality** uses `fogNear × 0.9` and `fogFar × 0.75`. `camera.far` and `viewRadius` are always the active fog far + 10 m (§9).

**Transitions.** Moving between biomes lerps fog, light, exposure, sky, sea and lake colours over 1.5 s, toward the biome at the camera target. These are all uniforms, so nothing recompiles.

**Ground blending.** Ground palettes blend across a region's edge with `smooth(r − 4, r + 3)`.

### 2.2 The seven biomes
`meadow` and `wilds` reproduce today's constants exactly; `biomes.test.js` asserts this.

| | meadow | wilds | autumn | alpine | heath | desert | crystal |
|---|---|---|---|---|---|---|---|
| grass / grass2 | #74a04c / #628c42 | same as meadow | #a08a3c / #8a6f32 | #c8d4dc / #a9b9c4 | #7d7a52 / #6a6646 | #d9b77a / #c9a266 | #5a5670 / #4a4660 |
| path / plaza | #b89b6e / #a89a82 | same | #b89062 / #a8907a | #8f8a86 / #9a9a98 | #a08a6a / #9a8e7c | #e0c89a / #d6bd94 | #8a8296 / #7a7488 |
| sand / cliff | #d6bd8a / #7a5b40 | same | #d6b07a / #6f4a32 | #d8dde0 / #5a6078 | #cdbb92 / #5e5048 | #e8d2a0 / #b5603c | #a8a0b8 / #3e3a4c |
| tufts (density) | #6b9a48 #5a8a3d #7caa55 (1) | #4e6e38 #43602f #5b7a42 (1) | #c9872f #a8642a #d9a441 (1) | #e8eef2 #b9c8d2 #6f8a7a (0.6) | #8a6f9e #6f7a48 #9a8a5a (1) | #b9a05a #9a8a4a #c9b06a (0.4) | #7a6fa8 #5fe3ff #4e4870 (0.7) |
| water / sea | #5fb3c4 #1f5f86 / #58a8bc #1b4f74 | same | #6fae9f #2a5f66 / #5aa3b0 #1e4f6e | #bfe0ec #4f86a6 / #6aa0b8 #1c4560 | #5f9fa8 #24546a / meadow's sea | #3fb6b0 #1e6a78 / #4fb0c0 #1b5a7a | #5fe3ff #283c78 / #4a8ab8 #182e5a |
| sky top/mid/bot | #5fb8f0 #a9dcf7 #fde7c4 | same | #f2b36b #f6d6a0 #fde2c0 | #8fb8d8 #cfe0ee #eef4f8 | #8fb4d4 #c9d8e2 #efe6d6 | #7cc0e8 #cfe6ee #fbe8c4 | #6a78c8 #b9b6d6 #f0d8e8 |
| fog, near–far (high) | #b8c4c8, 20–100 | #9faea6, 14–70 | #d9b98a, 22–80 | #cfd9e3, 16–65 | #b9b6a8, 18–75 | #e8cfa0, 22–80 | #b9b6d6, 24–85 |
| hemi sky/ground, intensity | #c8d8ec / #6b5a48, 1.3 | same, 1.05 | #f0d2a8 / #6b4a32, 1.2 | #dfe9ff / #5a6070, 1.15 | #d0d4dc / #5e5048, 1.15 | #fff0d0 / #8a6040, 1.25 | #d8d0ff / #3e3a4c, 1.1 |
| sun colour, intensity | #ffe4bc, 2.7 | #ffd0a0, 2.7 | #ffc98a, 2.6 | #e6eeff, 2.3 | #ffe2c0, 2.5 | #fff0c8, 3.0 | #f4ecff, 2.4 |
| exposure | 1.05 | 1.05 | 1.05 | 1.0 | 1.0 | 1.1 | 1.0 |
| weather | — | — | leaves 0.6, chance 0.5 | snow 0.8, chance 0.4 | rain 0.5, chance 0.15 | dust 0.4, chance 0.2 | sparkle 0.3, night only |
| critters | butterfly (gardens), deer (forests) | — | butterfly, deer | — | — | — | — |
| ambience | today's sfx | today's | lute, D pentatonic, 84 bpm, river | celesta, A minor, 70 bpm, wind | drone, crows | oud, E Phrygian dominant, 92 bpm | glass pad, F Lydian, 66 bpm, chimes |

**Cover rules.** These are generated on the client per chunk and are never stored in the map (§9.3).
- **meadow:** none, so Hearthvale keeps exactly its 720 hand-placed cover props. Any region can also set `autoCover: false`.
- **autumn:**
  - `au_tree_fall` (nature `tree_oak_fall`, `tree_default_fall`, `tree_fat_fall`): 0.6 per 100 m², s 0.9–1.3
  - `au_pine_fall` (graveyard `pine-fall`, `pine-fall-crooked`): 0.3
  - `au_bush` (nature bush, leaves recoloured #c9472f): 0.8
  - `au_pumpkin` (graveyard `pumpkin`): 0.1
  - `deco_mushroom`: 0.5
  - `deco_grass`: 1.5
- **alpine** (`grade:false` on the snow slots):
  - `al_pine_snow` (holiday `tree-snow-a/b`, platformer `tree-pine-snow`): 0.5
  - `al_rock_snow` (holiday `rocks-medium/small`): 0.4
  - `al_snow_pile` (holiday `snow-pile`, `snow-flat`): 0.6
  - `deco_grass` tinted #b9c8d2: 0.6
- **heath:**
  - `hl_heather` (nature small bush recoloured #8a6f9e): 1.2
  - `hl_stone_tall` (nature `stone_tallA–C`): 0.15
  - `hl_pine_tall` (nature `tree_pineTallA/B`): 0.25
  - `deco_grass`: 1.0
- **desert:**
  - `de_cactus` (nature `cactus_tall/short`, ×3 scale): 0.25
  - `de_rock_sand` (pirate `rocks-sand-a/b`, orange remapped to #b5603c): 0.1
  - `de_palm` (pirate `palm-bend/straight`, near water only): 0.1
  - `de_patch` (pirate `patch-sand`): 0.2
  - `deco_rock_small`: 0.4
- **crystal** (`grade:false` on the crystal slots):
  - `cr_crystal` (space `rock_crystals`, TD `detail-crystal`, emissive #5fe3ff / #dc78ee): 0.2
  - `cr_pine` (nature `tree_pineTallA` recoloured #4a4670): 0.3
  - `cr_shroom` (nature mushrooms, emissive tint): 0.4
  - `deco_grass` tinted #7a6fa8: 0.8

**Asset engine changes** these looks need (package P3):
- `blue`, `purple`, `dark` and `ice` remap bands;
- `metal` capped at value < 0.7;
- a per-slot `grade: false`;
- `PALETTES['space-kit']`.

### 2.3 World clock and weather (`shared/clock.js`, pure)
- **The day.** `dayMin(now) = (now / 60000) mod 100`:
  - 0–60 day, 60–70 dusk, 70–90 night, 90–100 dawn;
  - `isNight` is 70–90;
  - `isNoon` is 25–35.
- **Night.** The look is exposure ×0.85, with fog and hemi lerped 35% toward #3a4270. Lanterns use their emissive at full.
  - The client gets the server's clock offset from `pong`.
- **Weather.** `weatherAt(biome, now)` is active when `hash32(biome + ':' + floor(now / 1_200_000)) / 2³² < BIOMES[biome].weather.chance`.
  - It draws as one camera-following GPU `Points` draw: 1,500 points on high, 750 on low.
- **Legendary windows** use clock and weather (§4.4). They are reasons to come back, with no penalty for missing them.

---

## 3. The towns

### 3.1 The standard town kit (offsets from the town centre; Hearthvale already matches it)
| Piece | id | Offset | Fields |
|---|---|---|---|
| Plaza | `<t>_plaza` | 0, 0 | r 11.2 |
| Waystone | `stone_<t>` | +6.2, +5.2 | home stone (`regions[].stone`) |
| Market | `<t>_market` | +18, −6 | w 11, d 8, face w, `action:'market'`, `style:'market'` |
| Workshop | `<t>_workshop` | −17, −6 | w 9, d 7, face e, `action:'craft'`, `style:'workshop'` |
| Stations | `<t>_forge`, `_anvil`, `_workbench`, `_grindstone`, `_cookpot` | (−22.3,−11.8) (−19.5,−11.6) (−16.2,−11.9) (−13.4,−11.5) (−10.7,−12.3) | `station:` kind |
| Signature station | `<t>_sig` | −30, −14 | `station:'smokehouse'|'quench_trough'|'glassworks'|'starforge'` |
| Shop | `<t>_shop` | −15, +16 | w 9, d 7, face n, `action:'shop'` (where NPC customers come from) |
| Town hall | `<t>_townhall` | +16, +17.5 | w 11, d 10, face n, `action:'townhall'` (Quartermaster, projects) |
| Order board | `<t>_board` | −6.2, +5.2 | `slot:'proc_job_board'`, `orders:'<t>'` |
| Supplier stall | `<t>_supplier` | +30, −10 | `slot:'proc_stall'`, `supplier:'<t>'` |

**Building looks** are keyed by `style` and a new `kit` field, not by id:
- `kit` is `ftk` (default), `cabin`, `adobe` or `slate`.
- `buildings.js` gets `RECIPES[kit][style]`. Non-FTK kits ship two recipes each, `cottage` and `hall`.
- Functional buildings in those kits use `hall` plus a function prop: market awning, anvil sign, shop sign or hall banner.

The editor's **Stamp town kit** places all of the above with ids `<t>_*`.

### 3.2 The five towns
| | Hearthvale | Amberfold | Rimeholt | Sandmere | Starfall |
|---|---|---|---|---|---|
| Identity | Starter meadow town (as today) | Harvest and mill town on the Millrace | Snowbound miners' town on a frozen tarn | Oasis caravan town on salt flats | Observatory town on a meteor crater |
| `kit` | ftk | ftk, with orange/yellow roofs | cabin (holiday cabin kit, snow roofs) | adobe (FTK `wall-block` + `roof-flat`, new 6 KB sand-plaster atlas), plus castle-kit sandstone walls | slate (castle-kit `variation-e`, hexagon towers) |
| Landmark | Fountain, Wilds Gate | Great Mill (FTK `windmill` + `watermill`); Elder Oak (`tree_oak_dark` ×2.5) | Rime Beacon (castle `tower-hexagon` on a crag) | Sunken Colossus (`statue_head` ×8) | The Starfallen (procedural crystal, 20 m) |
| Signature station | — | `smokehouse` (patterns grill, stew) | `quench_trough` (forge_tool, forge_blade, forge_plate) | `glassworks` (smelt, facet, assemble) | `starforge` (smelt, forge_tool, forge_blade, forge_plate) |
| Dungeon door | crypt_hollow (0,−74) | door_thornroot (−612,−10) | door_icefall (−600,−720) | door_ashkar (650,−595) | door_shard_vault (−30,−1215) |
| Overworld boss camp | golem (0,−86) | antlered_elder (−600,−130) | old_tusk (−440,−600) | brass_colossus (665,−545) | prism_warden (−40,−1180) |
| NPC shop customers | today's 10 | Miller Hodge, Smith Brann, Widow Fenn, Ranger Oak (likes ore, bars, fish, potions) | Jarl Ingrid, Old Sten, Tinker Moss, Cook Agna (likes wood, food, leather) | Caravaneer Tamsin, Saltwife Ro, Glazier Ves, Scout Ilya (likes wood, fish, herbs) | Astronomer Quill, Warden Sef, Chef Orrin, Glassblower Nim (likes food, potions, planks) |

**NPC demand pool weights per town:** H 1.0, A 0.3, R 0.25, S 0.25, St 0.2. The total NPC shop ceiling is 2.0× today's.

**Town mood** is the biome table in §2.2.

**Night.** Each town's lanterns light at night once its hearth is relit (§5.7, the Five Hearths saga).

---
## 4. Content

### 4.1 Conventions and new fields
**Registry.** Content packs are folders, `shared/content/<town>/`, with one file per kind (`items.js`, `nodes.js`, `monsters.js`, `recipes.js`, `fish.js`, `dungeon.js`, `quests.js`, `orders.js`, `trade.js`, `customers.js`). Each folder's `index.js` exports `{ items, nodes, monsters, recipes, fishTables, dungeons, chests, sets, quests, orders, customers, trade, supplies, projects }`. A test fixture pack may be a single file. Packs register through `shared/content/index.js`, which merges them into `ITEMS`, `NODE_TYPES`, `MONSTERS`, `RECIPES`, `FISH_TABLES`, `DUNGEONS` and so on at import time.
- Load order is fixed: hearthvale, amberfold, rimeholt, sandmere, starfall.
- `QUALITY_BASES` is computed: every `tool`, plus every `gear` with `slot` weapon, armor or trinket, gets Fine and Masterwork versions.
- Kits, charms and set pieces are excluded.

**New item fields:**

| Field | Meaning |
|---|---|
| `tag` | One of `wood plank ore bar herb fish food potion hide monster gem reagent tool gear kit charm trophy letter`. Every item has one; there is a test for this. |
| `req: { combat }` | Checked only in `equip()`. Gear already equipped is grandfathered. |
| `slot: 'charm'` | The new fifth slot. `STARTER_EQUIP` gains `charm: null`; `heroes.js:60` merges it into old saves. |
| `bound: true` | Cannot be listed, sold, posted, stocked or traded (trophies, letters, kits from quests). |
| `nowarp: true` | Waystones refuse to carry you while it is in the bag (letters). |
| `kit: 'rope'\|'picks'\|'lantern'` | A passage kit; never used up. |
| `buff: { slot, fx, uses }` | `slot` is `meal`, `tonic` or `lure`. `uses` is `{ per: 'gather'\|'cast'\|'battle'\|'craft', n }` or, for travel buffs only, `{ ms }`. |
| `set: '<set id>'` | A dungeon set piece (§4.8). |

**Tag groups for merchant appetite** (§6):

| Group | Tags |
|---|---|
| wood | wood, plank |
| ore | ore, bar |
| herb | herb |
| fish | fish |
| food | food, potion |
| hide | hide, monster |
| gem | gem, reagent |
| gear | tool, gear, kit, charm |

Trophies and letters cannot be sold.

**Tags for today's items:**
- wood: oak/birch/pine logs
- gem: golden_acorn, sapphire
- ore: stone, the four ores
- herb: mint_leaf, sunpetal, moonbloom
- fish: every fish, including lake_king and old_boot
- monster: slime_gel, goblin_coin, golem_core
- hide: wolf_pelt, leather
- reagent: grave_dust
- plank: oak_plank, birch_plank
- bar: stone_brick and the three bars
- food: grilled_fish, fish_stew
- potion: health_potion, moon_elixir
- tool and gear as their category

**Perk vocabulary** (`shared/perks.js`, read by `server/battle.js` and `server/gather.js`):
- **Existing:** `quickSpecial`, `mender`.
- **Set:**
  - `thornguard`: reflect 15% of damage taken.
  - `frostbite`: your special cuts the target's atk 20% for 2 rounds.
  - `sunfire`: crit chance 12% → 20%.
  - `starlit`: your party gets +8% atk while you stand.
  - `regenOut`: out-of-combat regen 4 → 6 hp/s.
  - `forestXp`: +10% gathering xp in forest zones.
  - `auraDef`: party +5% def.
  - `critHeal`: a crit heals you 5% of max hp.
  - `fastSpecial`: specials need 1 fewer charge, never below 2.
- **Charm and level-40 effects:** `treePower`, `rockPower`, `doubleLog`, `doubleOre`, `doubleHerb`, `rodZone`, `luck`, `craftXp`, `perfectTick`, `moveSpeed`, `bonusOutput`, `rareWeight`, `kgSkew`, `atkPct`, `defHpPct`, `masterworkPct`.
- **Milestone effects** (§4.8):
  - **Server (M4):** `steadyHands`, `perfectWindow`, `biteWindow`, `salvage`, `sapTap`, `bloom`, `rareHerb`, `sunstoneX2`, `recordSkew`, `secondStance`, `rally`, `nightAngler`, `mentor`, `quickFee`, `batchCap`, `gentleHands`, `auraRegrow`, `fishFry`, `guardian`, `apprentice`, `makersMark`.
  - **Client (Phase 2):** `keenEye`, `nodeSense`, `eliteTimers`, `bountySense`, `stateSight`, `legendLore`.

### 4.2 Monsters
**One curve** (`shared/monsters.js` → `mobStats(L, role)`). `progression.test.js` holds every new monster within ±15% of it. Hearthvale's existing monsters are grandfathered.

```
normal: hp = 22L + 0.25·max(0, L−12)²   atk = 2.6L + 2   def = L   xp = 10L·(1 + max(0, L−12)/40)   gold = [7·L^0.6, 11·L^0.6]
boss  : hp ×1.75  atk ×1.1   def +2  xp ×1.5  gold ×2          (golem check: 424/34/13, 165 xp, 59–93 gold vs real 420/30/12, 160, 50–90)
elite : hp ×2.4·(1 + 0.6·(fighters−1))  atk ×1.15  def +2  xp ×2  gold ×1.5   (a spawn flag that restats a base model to its own L)
dboss : hp ×2  atk ×1.05  def +2  xp ×1.5  gold ×2.5           (dungeon bosses, at the kind's tier-1 recommended level)
```

**What `lvl` means.** It is the recommended **combat** level.
- The client's name colour uses `conColor(lvl − round((heroLvl + 2·combatLvl)/3))`, replacing `game.js:552`.
- Region banners read "Combat 18+ · Skills 18+".

**Fight check** (`fight.mjs`, real `heroStats`/`damage`, middle rolls, hero ×1.25 for crits and specials, mob ×1.2). A pure fighter has hero ≈ 0.75 × combat; a balanced hero has hero ≈ 1.5 × combat, up to 50.

| Situation | Normal mobs | Boss |
|---|---|---|
| Arriving in last town's gear, pure fighter | band-low 3–4 rounds, 19–32% hp; band-top 4–5 rounds, 39–58% hp | solo 127–142% hp, so bring friends; a duo costs 54–71% |
| Leaving in this town's gear, pure fighter | 2–4 rounds, 5–29% hp | solo 60–78% |
| Leaving, balanced hero | — | solo 27–37% |

The pattern is the same in all four towns.

| id | Name (model → recolour) | Where | L | hp | atk | def | xp | gold | Drops |
|---|---|---|---|---|---|---|---|---|---|
| mossback_hog | Mossback Hog (hog, warm→#4f5a3a) | westmarch, hollowmere | 11 | 242 | 31 | 11 | 110 | 30–46 | leather .6, hearthcap .3 |
| hedge_bandit | Hedge Bandit (archer, green→#7a4a2a) | westmarch, hollowmere, thornback (charcoal camp) | 13 | 286 | 36 | 13 | 133 | 33–51 | goblin_coin .5, bandit_map .05 |
| russet_stag | Russet Stag (deer ×1.4) | amberwood, thornback S | 12 | 264 | 33 | 12 | 120 | 31–49 | venison .8, antler .3 |
| bramble_bear | Bramble Bear (polar, white→#7a5236) | amberwood | 15 | 332 | 41 | 15 | 161 | 36–56 | wolf_pelt .9, honeycomb .4 |
| antlered_elder | The Antlered Elder (deer ×2.4, dark) | amberwood | 17 boss | 665 | 51 | 19 | 287 | 77–120 | elder_antler .35, maple_log 2–4 (1.0) |
| snow_fox | Snow Fox (fox, warm→#e8eef2) | thornback N, rimefells | 16 | 356 | 44 | 16 | 176 | 37–58 | snow_fur .8 |
| frostbeak | Frostbeak (penguin, metal→#2c4a6e ref .3) | rimefells | 18 | 405 | 49 | 18 | 207 | 40–62 | ice_char .4, snow_fur .3 |
| rime_wisp | Rime Wisp (ghost, tint #bfe6ff) | rimefells | 19 | 430 | 51 | 19 | 223 | 41–64 | snowbell .5, rime_shard .1 |
| frost_raider | Frost Raider (orc, green→#6a8fb0, spear) | rimefells | 21 | 482 | 57 | 21 | 257 | 43–68 | rimesilver_ore .6, goblin_coin .5 |
| old_tusk | Old Tusk (elephant 3.4 m, metal→#6b4a35) | rimefells | 23 boss | 938 | 68 | 25 | 440 | 92–144 | mammoth_ivory .35, snow_fur 2–3 (1.0) |
| moor_ox | Moor Ox (cow, warm→#8a5a3a) | midmarch_w, skystair S | 19 | 430 | 51 | 19 | 223 | 41–64 | leather .7, coal .3 |
| moor_brute | Moor Brute (orc + spear and shield) | midmarch_w | 22 | 509 | 59 | 22 | 275 | 45–70 | coal .6, goblin_coin .6 |
| carrion_crow | Carrion Crow (parrot→#2b2b33) | midmarch_e | 24 | 564 | 64 | 24 | 312 | 47–74 | black_feather .7 |
| saltway_raider | Saltway Raider (soldier, red→#c9a25a) | midmarch_e | 26 | 621 | 70 | 26 | 351 | 49–78 | salt .8, sunbronze_bar .05 |
| dune_wasp | Dune Wasp (bee, yellow→#c46a2a) | dunesea | 22 | 509 | 59 | 22 | 275 | 45–70 | wasp_honey .6 |
| sun_lion | Sun Lion (lion) | dunesea | 24 | 564 | 64 | 24 | 312 | 47–74 | lion_mane .5, leather .5 |
| dust_skeleton | Dust Skeleton (skeleton, warm→#d8c39a) | dunesea | 25 | 592 | 67 | 25 | 331 | 48–76 | sun_ore .6 |
| glass_scorpion | Glass Scorpion (crab ×1.4, red→#b98b4e) | dunesea | 26 | 621 | 70 | 26 | 351 | 49–78 | glass_shard .7 |
| sand_legionnaire | Sand Legionnaire (mini-arena soldier) | dunesea | 27 | 650 | 72 | 27 | 371 | 51–79 | tomb_resin .1, goblin_coin .7 |
| brass_colossus | The Brass Colossus (procedural golem, brass) | dunesea | 29 boss | 1243 | 85 | 31 | 620 | 106–166 | colossus_gear .35, sun_ore 2–4 (1.0) |
| shard_wisp | Shard Wisp (ghost, tint #ff7ae0) | skystair, craterrim | 28 | 680 | 75 | 28 | 392 | 52–81 | prism_shard .15, starthistle .4 |
| gem_grub | Gem Grub (caterpillar + emissive) | craterrim | 29 | 710 | 77 | 29 | 413 | 53–83 | prism_shard .25 |
| crag_gremlin | Crag Gremlin (koala, metal→#6d6a5c ref .3) | skystair, craterrim | 30 | 741 | 80 | 30 | 435 | 54–85 | star_ore .5 |
| fallen_starguard | Fallen Starguard (soldier→#7a4fd0) | craterrim | 32 | 804 | 85 | 32 | 480 | 56–88 | starmetal_bar .05, star_dust .1 |
| prism_warden | The Prism Warden (procedural golem + octahedron crust) | craterrim | 36 boss | 1638 | 105 | 38 | 864 | 120–189 | warden_core .35, prism_shard 1–2 (1.0) |

**Moves.** Every new monster has 2 moves:
- normals: `[{mult 1}, {mult 1.4}]`;
- bosses: a third, telegraphed move in today's `telegraph` shape (`{ start: 2, every: 3, move }`):
  - Antler Sweep: aoe ×1.6, full
  - Avalanche: aoe ×1.8, full
  - Sandstorm: aoe ×1.5, drain 0.3
  - Prism Beam: ×2.4 on one target, full

**Camps.** Each `spawns[]` entry has 3–5 mobs, and camps sit at least 40 m apart. Every `camp_*` id in §1.5, plus 3–4 camps in each outskirts region, uses the monster named in its id. Bosses come 2 to a camp.

**Elites** (`shared/elites.js`). An elite is `{ id, name, monster (base model, moves and drops), lvl, region, anchor: {x,z}, r: 40, town }`, restatted with `mobStats(lvl, 'elite')`.

| # | id | Name | Base | L | hp (1 fighter) | atk | def | xp | Region, anchor | Trophy |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | mossjaw | Mossjaw | wolf | 13 | 687 | 41 | 15 | 267 | Hearthvale Wilds (0,−60) | hearthvale |
| 1 | old_bristle | Old Bristle | mossback_hog | 14 | 742 | 44 | 16 | 294 | westmarch (−300,30) | amberfold |
| 2 | hollow_stag | The Hollow Stag | russet_stag | 19 | 1033 | 59 | 21 | 447 | amberwood (−600,−150) | amberfold |
| 3 | frostmaw | Frostmaw | snow_fox ×1.6 | 25 | 1421 | 77 | 27 | 663 | thornback (−560,−480) | rimeholt |
| 4 | moor_king | The Moor King | moor_brute | 27 | 1561 | 83 | 29 | 743 | midmarch_w (−150,−740) | rimeholt |
| 5 | captain_vex | Captain Vex | saltway_raider | 30 | 1778 | 92 | 32 | 870 | midmarch_e (380,−690) | sandmere |
| 6 | glasswing | Glasswing | dune_wasp ×1.8 | 31 | 1853 | 95 | 33 | 915 | dunesea (620,−500) | sandmere |
| 7 | starmaw | Starmaw | fallen_starguard ×1.4 | 38 | 2412 | 116 | 40 | 1254 | craterrim (90,−1220) | starfall |

**Schedule.**
- `up(i, now) = ((now/60000 − 20·i) mod 160) < W`, where W is 20 minutes, or 30 on `restless` days.
- So exactly one elite is up at any time, more on restless days. It roams within 40 m of its anchor.
- Its hp is rescaled each time someone joins, keeping its hp %.
- **Everyone who joins gets loot:**
  - the town's `trophy_<town>` (always);
  - a set piece of that town (8%);
  - a cosmetic dye (2%);
  - normal kill gold and xp.

### 4.3 Gathering nodes (`shared/nodes.js`, the same shape as today's `NODE_TYPES`)
`tier` is the minimum tool tier, so gold tools (tier 4) finally gate something.

Node hp ≈ 5 swings with the local tool and about 7 with the previous one. Xp grows about ×1.35 per town.

| type | Name | Where (count) | Skill, level | Tool tier | hp | xp | Respawn | Drops | Rare | Model |
|---|---|---|---|---|---|---|---|---|---|---|
| tree_maple | Amber Maple | amberwood 14, thornback S 6, westmarch 4 | foraging 12 | 4 | 30 | 44 | 45 s | maple_log 2–3 | amber_sap .04 | nature `tree_*_fall` (au pack) |
| rock_coal | Coal Seam | amberwood 10, midmarch_w 4 | mining 12 | 4 | 32 | 50 | 45 s | coal 1–3 | sapphire .02 | ore rock, crystal #2b2b2b |
| herb_hearthcap | Hearthcap | amberwood 10, westmarch 4 | herbalism 12 | 0 | 1 | 30 | 35 s | hearthcap 1–2 | — | mushroom recolour #c9472f |
| tree_frostpine | Frost Pine | rimefells 14, thornback N 6 | foraging 18 | 5 | 35 | 60 | 55 s | frostpine_log 2–3 | golden_acorn .03 | holiday `tree-snow-a` |
| rock_rimesilver | Rimesilver Vein | rimefells 10, midmarch_w 3 | mining 18 | 5 | 38 | 70 | 55 s | rimesilver_ore 1–2 | rime_shard .02 | ore rock, crystal #cfe8ff (`grade:false`) |
| herb_snowbell | Snowbell | rimefells 10 | herbalism 18 | 0 | 1 | 40 | 40 s | snowbell 1–2 | — | herb recolour #e8eef2 (`grade:false`) |
| rock_salt | Salt Crust | midmarch_e 6, dunesea 4 | mining 22 | 4 | 20 | 40 | 30 s | salt 2–4 | — | pirate `patch-sand` mound, #f2efe6 |
| tree_sunpalm | Sunpalm | dunesea 12 | foraging 25 | 6 | 45 | 80 | 65 s | sunpalm_log 2–3, date 0–1 | — | pirate `palm-bend` |
| rock_sunore | Sun Ore Vein | dunesea 10 | mining 25 | 6 | 48 | 95 | 65 s | sun_ore 1–2 | sunstone .02 | ore rock, crystal #ffb347 |
| herb_desertrose | Desert Rose | dunesea 10 | herbalism 25 | 0 | 1 | 55 | 45 s | desert_rose 1–2 | — | herb recolour #e86a8a |
| tree_skyash | Skyash | craterrim 12, skystair 4 | foraging 32 | 7 | 60 | 110 | 75 s | skyash_log 2–3 | — | nature `tree_pineTallC` recoloured #6a5fa0 |
| rock_starmetal | Star Iron | craterrim 10 | mining 32 | 7 | 64 | 128 | 75 s | star_ore 1–2 | — | space `meteor_detailed`, charcoal |
| rock_prism | Prism Cluster | craterrim 6 | mining 36 | 8 | 72 | 150 | 90 s | prism_shard 1 | — | TD `detail-crystal`, emissive #dc78ee |
| herb_starthistle | Starthistle | craterrim 10 | herbalism 32 | 0 | 1 | 75 | 50 s | starthistle 1–2 | — | herb, emissive #5fe3ff |
| rock_starshard | Star Shard (night only; after `proj_observatory`) | craterrim 6 | mining 40 | 8 | 80 | 200 | appears at night | star_dust 1, prism_shard 0–1 | — | `rock_prism`, tinted gold |

**Filler nodes 1–2 tiers lower in every town region:**
- Amberfold: birch 6, iron 4, sunpetal 4.
- Rimeholt: pine 4, gold 3, maple 4.
- Sandmere: maple 4, coal 4, frostpine 3.
- Starfall: frostpine 4, rimesilver 4, sunpalm 3.

**Road groves** (`grove_*`) hold 6–8 nodes of the neighbouring towns' types. In total the world has about 410 nodes.

**Ore colours and visuals** move from `town.js:85,165` into `NODE_TYPES[t].crystal` and `.model`. Every new tree and fish type also gets a procedural fallback (content brief §3.2).

**Rich and ancient states** (`server/nodestates.js`). These are server-side states of existing tree, rock and herb nodes; no new models.
- **Rich:**
  - In every region, every 10 minutes, one live node becomes rich for 8 minutes.
  - Level gate +8, yield ×3, xp ×2.5, rare chance ×3.
  - Gold emissive tint.
  - A map dot and a Compass source for heroes in that region who meet the gate.
- **Ancient:**
  - In every region, once an hour (offset by region index × 7 min), for 15 minutes.
  - Level gate +16, yield ×5, xp ×6, one guaranteed rare roll.
  - Announced to everyone in the region, and on the Compass world-wide for heroes who meet the gate.
  - Examples: an ancient oak needs 17; an ancient skyash needs 48.
- The usual shared-node rule holds: everyone who hit it gets loot.
- The state travels in the node snapshot as `n.st = 0 | 1 | 2`.

### 4.4 Fish (`shared/fishing.js` becomes data-driven)
`rollFish(rng, table, rodTier, lvl, deep, ctx)` replaces the global table.
- **Which table:** `nodes[].table`, else the lake's `fish`, else `'mirror'`.
- **Spot level:** a table has a `lvl`; casting below it fails with "Fishing N needed here".
- **Clamps:** the rod tier clamp rises 3 → 7, the level clamp 20 → 40 (`fishing.js:63`).
- **Gear formula:** `zone = min(0.42, min(0.4, 0.22 + min(t−1,3)·0.045 + min(lvl,40)·0.003) + zoneBonus)`, `gain = 0.26 + (t−1)·0.03`, `drain = max(0.06, 0.17 − (t−1)·0.018)`.
- **Doubling:** `game.js:816`'s list of catches that cannot double becomes `FISH[id].legend || id === 'old_boot'`.

| Table (lvl) | Fish: d, kg, behaviour, xp, value | Legendary (deep spots only; rod tier; window) |
|---|---|---|
| mirror (1) | today's table, unchanged | Old Whiskers `lake_king` (rod 2, any time) |
| hollowmere (6) | minnow, perch, trout, pike, plus rivercarp ×0.5 weight | — (record board) |
| road_west (8) | perch, trout, rivercarp, amber_trout | — |
| amberfold (12) | rivercarp 46, 1–5, smooth, 55, 30 · amber_trout 54, 1–4, dart, 70, 40 · leaf_eel 62, 0.5–3, dart, 85, 55 | **Grandfather Carp** `legend_millcarp`: 92, 25–70 kg, mixed, 400 xp, 900 g. Mill Pond; rod 4; during autumn leaves weather |
| road_thornback (14) | trout, amber_trout, frost_smelt, ice_char | — |
| rimeholt (18) | frost_smelt 50, 0.2–1, dart, 80, 45 · ice_char 62, 1–4, mixed, 100, 70 · glacier_pike 74, 3–12, mixed, 130, 95 | **Rimejaw** `legend_rimejaw`: 95, 30–90 kg, 600 xp, 1,400 g. Rimeglass Tarn; rod 5; while it snows |
| road_midmarch (18) | rivercarp, ice_char, glacier_pike | — |
| road_saltmarsh (22) | ice_char, sand_goby, sunscale | — |
| sandmere (25) | sand_goby 56, 0.3–2, smooth, 120, 70 · sunscale 68, 1–6, dart, 150, 110 · glass_ray 78, 4–20, mixed, 190, 150 | **The Mirage** `legend_mirage`: 96, 20–60 kg, 900 xp, 2,200 g. Oasis; rod 6; noon (clock 25–35) |
| road_skystair (28) | glacier_pike, sunscale, star_minnow, glowfin | — |
| starfall (32) | star_minnow 60, 0.1–0.6, dart, 140, 90 · glowfin 72, 1–5, dart, 190, 140 · crater_sturgeon 84, 8–40, mixed, 240, 200 | **Comet Koi** `legend_comet_koi`: 98, 3–9 kg, dart, 1,200 xp, 3,000 g. Crater Lake; rod 7; night only |

**Weights in a town table:**
- shallow: 50 / 35 / 15;
- deep: 25 / 40 / 35·luck;
- plus today's `old_boot` (7).
- A legendary has weight `0.6·luck` in deep spots inside its window.
- `luck = 1 + 0.04·min(lvl,40) + 0.6·(rodTier−1)`, plus charm and lure bonuses.

**Records.**
- Every catch's kg is recorded in the journal (`best`).
- Each lake has a record board showing the top 5 server-wide.
- Every legendary a hero has landed hangs in their **shop's trophy wall** (drawn in the shop interior from journal records); no item is needed.

### 4.5 Items
Values follow the ladder:
- raw goods ×1.35–1.4 per town;
- bars and planks are their inputs + 10%;
- gear and tools ×1.8 per tier.

**Gear `req` is the town's band floor:** combat 12, 18, 25 and 32.

**Hearthvale additions:**

| id | Name | Tag | Value | Notes |
|---|---|---|---|---|
| whetstone | Whetstone | potion | 20 | tonic: tool power +1, 60 swings. **Gives `stone_brick` a use** |
| mint_tea | Mint Tea | food | 18 | meal: +10% gathering xp, 40 gathers |
| hearth_charm | Hearth Charm | kit | 44 | consumed: one free trip to your home stone (sold by suppliers only, at 60 g) |
| trophy_hearthvale | Hearthvale Trophy | trophy | — | bound |
| charm_wayfarer | Wayfarer's Charm | charm | — | bound; +8% walk speed out of battle (journal 50% reward) |
| letter_amberfold, letter_rimeholt, letter_sandmere, letter_starfall | Letters of introduction | letter | — | bound, nowarp |
| atlas_page_1 … atlas_page_12 | Ysolde's Atlas, page N | trophy | — | bound (§5.5) |

**Amberfold (tier 2):**

| id | Name | Tag | Value | Rarity | Stats and notes |
|---|---|---|---|---|---|
| maple_log | Maple Log | wood | 26 | common | |
| coal | Coal | ore | 22 | common | fuel for every later bar |
| hearthcap | Hearthcap | herb | 30 | uncommon | |
| amber_sap | Amber Sap | gem | 160 | rare | |
| venison / antler / honeycomb | Venison / Antler / Honeycomb | monster | 28 / 60 / 40 | common / uncommon / uncommon | |
| elder_antler | Elder Antler | monster | 180 | rare | |
| bandit_map | Bandit's Map | monster | 50 | rare | using it pins this week's nearest glimmer cache |
| heartwood_sap | Heartwood Sap | reagent | 45 | uncommon | Thornroot Warren reagent |
| rivercarp / amber_trout / leaf_eel | Rivercarp / Amber Trout / Leaf Eel | fish | 30 / 40 / 55 | common / common / uncommon | |
| legend_millcarp | Grandfather Carp | fish | 900 | legendary | |
| maple_plank | Maple Plank | plank | 58 | common | |
| steel_bar | Steel Bar | bar | 125 | uncommon | |
| carp_chowder | Carp Chowder | food | 45 | common | heals 90 |
| maple_glazed_carp | Maple-glazed Carp | food | 70 | uncommon | meal: +10% gathering xp, 60 gathers |
| hearthcap_pie | Hearthcap Pie | food | 75 | uncommon | meal: +10% def, 5 battles |
| venison_skewer | Venison Skewer | food | 80 | uncommon | meal: +8% atk, 5 battles |
| axe_steel / pick_steel | Steel Axe / Steel Pickaxe | tool | 1,100 | epic | tier 5, power 6, speed 495 / 515 |
| rod_amber | Amberline Rod | tool | 1,000 | epic | rod tier 4 |
| climbing_rope | Climbing Rope | kit | 400 | rare | `kit:'rope'` |
| steel_saber | Steel Saber | gear | 1,250 | epic | atk 36, req 12 |
| steel_brigandine | Steel Brigandine | gear | 1,150 | epic | def 16, hp 20, req 12 |
| amber_pendant | Amber Pendant | gear | 1,000 | epic | atk 7, def 6, hp 60, req 12 |
| thornwood_blade / thornroot_jerkin / heartwood_amulet | Thornroot set | gear | 1,100 / 1,050 / 950 | epic | 33 atk / 15 def + 20 hp / 6, 6, 55; `set:'thornroot'` |
| charm_forager_1 / _2 | Forager's Charm I / II | charm | 800 / 3,200 | rare / epic | treePower +1 / +2, doubleLog +5% / +10% |
| trophy_amberfold | Amberfold Trophy | trophy | — | — | bound |

**Rimeholt (tier 3):**

| id | Name | Tag | Value | Notes |
|---|---|---|---|---|
| frostpine_log | Frostpine Log | wood | 36 | |
| rimesilver_ore | Rimesilver Ore | ore | 48 | |
| snowbell | Snowbell | herb | 40 | |
| snow_fur | Snow Fur | hide | 45 | |
| rime_shard | Rime Shard | reagent | 60 | Icefall Mine reagent |
| mammoth_ivory | Mammoth Ivory | monster | 220 | rare |
| frost_smelt / ice_char / glacier_pike | fish | fish | 45 / 70 / 95 | |
| legend_rimejaw | Rimejaw | fish | 1,400 | legendary |
| frostpine_plank | Frostpine Plank | plank | 80 | |
| rimesilver_bar | Rimesilver Bar | bar | 170 | |
| fur_lining | Fur Lining | hide | 100 | |
| char_broth | Char Broth | food | 60 | heals 130 |
| snowbell_tea | Snowbell Tea | food | 90 | meal: +5% double-drop chance, 60 gathers |
| swiftfoot_draught | Swiftfoot Draught | potion | 110 | tonic: +20% walk speed out of battle, 10 minutes (the travel exception) |
| axe_rimesilver / pick_rimesilver | Rimesilver Axe / Pickaxe | tool | 2,000 | tier 6, power 7, speed 490 / 510 |
| rod_rime | Rimecaller Rod | tool | 1,900 | rod tier 5 |
| ice_picks | Ice Picks | kit | 900 | `kit:'picks'` |
| rimesilver_longsword | Rimesilver Longsword | gear | 2,250 | atk 48, req 18 |
| rimesilver_mail | Rimesilver Mail | gear | 2,100 | def 22, hp 40, req 18 |
| frostheart_locket | Frostheart Locket | gear | 1,900 | atk 9, def 8, hp 80, req 18 |
| rimeward_axeblade / rimeward_coat / frost_sigil | Rimeward set | gear | 2,000 / 1,900 / 1,750 | 44 atk / 20 def + 36 hp / 8, 7, 72; `set:'rimeward'` |
| charm_prospector_1 / _2, charm_angler_1 / _2 | charms | charm | 1,200 / 4,800 | rockPower +1 / +2 and doubleOre 5 / 10%; rodZone +0.02 / +0.04 and luck +10 / 20% |
| trophy_rimeholt | Rimeholt Trophy | trophy | — | bound |

**Sandmere (tier 4):**

| id | Name | Tag | Value | Notes |
|---|---|---|---|---|
| sunpalm_log | Sunpalm Log | wood | 50 | |
| date | Dates | food | 20 | heals 20 |
| sun_ore | Sun Ore | ore | 66 | |
| sunstone | Sunstone | gem | 300 | rare |
| desert_rose | Desert Rose | herb | 56 | |
| salt | Salt | ore | 20 | |
| glass_shard / wasp_honey / black_feather | monster drops | monster | 60 / 55 / 50 | |
| lion_mane | Lion Mane | hide | 80 | |
| tomb_resin | Tomb Resin | reagent | 85 | Ashkar's Tomb reagent |
| colossus_gear | Colossus Gear | monster | 320 | rare |
| sand_goby / sunscale / glass_ray | fish | fish | 70 / 110 / 150 | |
| legend_mirage | The Mirage | fish | 2,200 | legendary |
| sunpalm_plank | Sunpalm Plank | plank | 110 | |
| sunbronze_bar | Sunbronze Bar | bar | 225 | |
| glass | Glass | bar | 70 | |
| spiced_goby | Spiced Goby | food | 85 | heals 180 |
| prospectors_brew | Prospector's Brew | potion | 160 | tonic: rare drop chance ×1.5, 40 gathers |
| glow_lure | Glow Lure | potion | 120 | lure: luck +15%, legendary weight ×1.5, 10 casts |
| axe_sunbronze / pick_sunbronze | Sunbronze Axe / Pickaxe | tool | 3,600 | tier 7, power 9, speed 485 / 505 |
| rod_mirage | Mirage Rod | tool | 3,400 | rod tier 6 |
| hooded_lantern | Hooded Lantern | kit | 1,400 | `kit:'lantern'` |
| sunbronze_khopesh | Sunbronze Khopesh | gear | 4,000 | atk 62, req 25 |
| sunbronze_scale | Sunbronze Scale | gear | 3,800 | def 29, hp 60, req 25 |
| mirage_amulet | Mirage Amulet | gear | 3,500 | atk 11, def 10, hp 100, req 25 |
| ashkar_khopesh / ashkar_wraps / scarab_seal | Ashkar set | gear | 3,600 / 3,400 / 3,200 | 57 atk / 27 def + 55 hp / 10, 9, 92; `set:'ashkar'` |
| charm_herbalist_1 / _2, charm_artisan_1 / _2 | charms | charm | 1,600 / 6,400 | doubleHerb +15 / 30%; craftXp +10% / (+10% and perfectTick +1) |
| trophy_sandmere | Sandmere Trophy | trophy | — | bound |

**Starfall (tier 5):**

| id | Name | Tag | Value | Notes |
|---|---|---|---|---|
| skyash_log | Skyash Log | wood | 70 | |
| star_ore | Star Ore | ore | 92 | |
| prism_shard | Prism Shard | gem | 220 | rare |
| starthistle | Starthistle | herb | 78 | |
| star_dust | Star Dust | reagent | 120 | Shard Vault reagent |
| warden_core | Warden Core | monster | 450 | rare |
| star_minnow / glowfin / crater_sturgeon | fish | fish | 90 / 140 / 200 | |
| legend_comet_koi | Comet Koi | fish | 3,000 | legendary |
| skyash_plank | Skyash Plank | plank | 155 | |
| starmetal_bar | Starmetal Bar | bar | 470 | |
| starthistle_elixir | Starthistle Elixir | potion | 130 | heals 260 |
| starlight_feast | Starlight Feast | food | 200 | meal: +6% atk and +6% def, 5 battles |
| ironbark_tonic | Ironbark Tonic | potion | 150 | tonic: +10% def, 5 battles |
| axe_starmetal / pick_starmetal | Starmetal Axe / Pickaxe | tool | 6,500 | tier 8, power 12, speed 480 / 500 |
| rod_skyline | Skyline Rod | tool | 6,200 | rod tier 7 |
| starmetal_greatblade | Starmetal Greatblade | gear | 7,200 | atk 78, req 32 |
| starmetal_plate | Starmetal Plate | gear | 6,800 | def 36, hp 80, req 32 |
| prism_circlet | Prism Circlet | gear | 6,500 | atk 13, def 12, hp 120, req 32 |
| prism_blade / prismsworn_plate / starsight_circlet | Prismsworn set | gear | 6,500 / 6,100 / 5,900 | 72 atk / 33 def + 72 hp / 12, 11, 110; `set:'prismsworn'` |
| trophy_starfall | Starfall Trophy | trophy | — | bound |

**Speed floor.** The slowest Masterwork tool is 480 × 0.9 = 432 ms, above the 421 ms floor (`world.test.js:139`).

**Fishing rods.** Rods have no `req`; fishing spots and legendaries gate them instead.

### 4.6 Recipes
Every recipe is `{ id, out, qty: 1, in, lvl, xp, station, pattern }`. Recipes marked **[t]** carry `town: '<town>'` and must be made in that town's yard. Set pieces also need **reputation rank 2** there. ⇐X marks an import from town X.

**Hearthvale:**
- whetstone: 2 stone_brick + 1 copper_bar (lvl 4, grindstone, dress, 12 xp)
- mint_tea: 2 mint_leaf + 1 sunpetal (lvl 3, cookpot, brew, 10)

**Amberfold** (Smokehouse recipes are town-locked by the station itself):
- maple_plank: 2 maple_log (12, workbench, saw, 30)
- steel_bar: 1 iron_bar⇐H + 2 coal + 1 maple_log (12, forge, smelt, 45)
- carp_chowder: 2 rivercarp + 1 hearthcap (12, cookpot, stew, 40)
- climbing_rope: 3 leather + 2 maple_plank (12, workbench, stitch, 120)
- maple_glazed_carp: 1 amber_trout + 1 maple_log + 1 honeycomb (13, smokehouse, grill, 55)
- venison_skewer: 2 venison + 1 hearthcap (13, smokehouse, grill, 55)
- hearthcap_pie: 2 hearthcap + 1 venison + 1 sunpetal⇐H (14, smokehouse, stew, 60)
- rod_amber: 3 maple_plank + 1 steel_bar + 2 amber_trout (13, workbench, assemble, 250)
- axe_steel: 4 steel_bar + 2 maple_plank (14, anvil, forge_tool, 300)
- pick_steel: 4 steel_bar + 2 maple_plank + 1 gold_bar⇐H (14, anvil, forge_tool, 300)
- steel_saber: 5 steel_bar + 2 leather + 1 antler (15, anvil, forge_blade, 350)
- charm_forager_1 [t]: 2 maple_plank + 1 amber_sap + 1 golden_acorn⇐H (15, workbench, assemble, 300)
- steel_brigandine: 5 steel_bar + 3 leather (16, anvil, forge_plate, 380)
- amber_pendant: 2 gold_bar⇐H + 1 amber_sap + 2 honeycomb (17, grindstone, facet, 400)
- set [t, rep 2], all lvl 16, 420 xp:
  - thornwood_blade: 8 heartwood_sap + 3 steel_bar + 1 elder_antler (anvil, forge_blade)
  - thornroot_jerkin: 8 heartwood_sap + 3 leather + 2 steel_bar (workbench, stitch)
  - heartwood_amulet: 8 heartwood_sap + 1 amber_sap + 1 gold_bar⇐H (grindstone, facet)

**Rimeholt:**
- frostpine_plank: 2 frostpine_log (18, workbench, saw, 45)
- rimesilver_bar: 2 rimesilver_ore + 1 frostpine_log + 1 coal⇐A (18, forge, smelt, 65)
- fur_lining: 2 snow_fur (18, workbench, scrape, 45)
- char_broth: 2 ice_char + 1 snowbell (18, cookpot, stew, 60)
- snowbell_tea: 2 snowbell + 1 honeycomb⇐A (19, cookpot, brew, 70)
- rod_rime: 3 frostpine_plank + 1 rimesilver_bar + 2 ice_char (19, workbench, assemble, 420)
- swiftfoot_draught: 1 snowbell + 1 honeycomb⇐A + 1 frost_smelt (20, cookpot, brew, 75)
- ice_picks: 3 rimesilver_bar + 2 frostpine_plank (20, quench_trough, forge_tool, 400)
- axe_rimesilver: 4 rimesilver_bar + 2 frostpine_plank + 1 maple_plank⇐A (20, quench_trough, forge_tool, 500)
- pick_rimesilver: 4 rimesilver_bar + 2 frostpine_plank + 1 steel_bar⇐A (20, quench_trough, forge_tool, 500)
- charm_prospector_1 [t]: 2 rimesilver_bar + 1 rime_shard + 1 sapphire⇐H (20, grindstone, facet, 450)
- rimesilver_longsword: 5 rimesilver_bar + 1 fur_lining + 1 steel_bar⇐A (21, quench_trough, forge_blade, 550)
- charm_angler_1 [t]: 1 glacier_pike + 2 frostpine_plank + 1 leaf_eel⇐A (21, workbench, assemble, 450)
- rimesilver_mail: 5 rimesilver_bar + 2 fur_lining + 1 maple_plank⇐A (22, quench_trough, forge_plate, 580)
- frostheart_locket: 1 mammoth_ivory + 2 rimesilver_bar + 1 amber_sap⇐A (23, grindstone, facet, 600)
- set [t, rep 2], all lvl 22, 620 xp:
  - rimeward_axeblade: 8 rime_shard + 3 rimesilver_bar + 1 mammoth_ivory (anvil, forge_blade)
  - rimeward_coat: 8 rime_shard + 2 fur_lining + 2 rimesilver_bar (workbench, stitch)
  - frost_sigil: 8 rime_shard + 1 mammoth_ivory + 1 gold_bar⇐H (grindstone, facet)

**Sandmere:**
- sunpalm_plank: 2 sunpalm_log (25, workbench, saw, 60)
- sunbronze_bar: 2 sun_ore + 1 sunpalm_log + 1 copper_bar⇐H (25, forge, smelt, 85)
- glass: 2 salt + 1 sunpalm_log (25, glassworks, smelt, 60)
- spiced_goby: 2 sand_goby + 1 desert_rose + 1 salt (25, cookpot, grill, 80)
- hooded_lantern: 2 glass + 2 sunbronze_bar + 1 fur_lining⇐R (25, glassworks, assemble, 450)
- prospectors_brew: 2 desert_rose + 1 wasp_honey + 1 snowbell⇐R (26, cookpot, brew, 95)
- glow_lure: 1 glass + 1 wasp_honey + 1 black_feather (26, glassworks, facet, 95)
- rod_mirage: 3 sunpalm_plank + 1 glass + 2 sunscale (26, workbench, assemble, 600)
- charm_herbalist_1 [t]: 2 desert_rose + 1 glass + 1 hearthcap⇐A (26, glassworks, facet, 600)
- axe_sunbronze: 4 sunbronze_bar + 2 sunpalm_plank (27, anvil, forge_tool, 700)
- pick_sunbronze: 4 sunbronze_bar + 2 sunpalm_plank + 1 frostpine_plank⇐R (27, anvil, forge_tool, 700)
- sunbronze_khopesh: 5 sunbronze_bar + 1 lion_mane + 1 rimesilver_bar⇐R (27, anvil, forge_blade, 750)
- charm_artisan_1 [t]: 2 glass + 1 sunstone + 1 steel_bar⇐A (27, glassworks, facet, 650)
- sunbronze_scale: 5 sunbronze_bar + 2 fur_lining⇐R + 1 glass_shard (28, anvil, forge_plate, 780)
- mirage_amulet: 1 sunstone + 2 sunbronze_bar + 2 glass (29, glassworks, facet, 800)
- set [t, rep 2], all lvl 28, 820 xp:
  - ashkar_khopesh: 8 tomb_resin + 3 sunbronze_bar + 1 colossus_gear (anvil, forge_blade)
  - ashkar_wraps: 8 tomb_resin + 2 lion_mane + 2 sunbronze_bar (workbench, stitch)
  - scarab_seal: 8 tomb_resin + 1 sunstone + 1 glass (grindstone, facet)

**Starfall:**
- skyash_plank: 2 skyash_log (32, workbench, saw, 80)
- starmetal_bar: 2 star_ore + 1 skyash_log + 1 rimesilver_bar⇐R (32, starforge, smelt, 120)
- starthistle_elixir: 2 starthistle + 1 glowfin + 1 desert_rose⇐S (32, cookpot, elixir, 120)
- starlight_feast: 1 crater_sturgeon + 1 starthistle + 1 date⇐S (33, cookpot, stew, 130)
- ironbark_tonic: 2 skyash_log + 1 starthistle + 1 snowbell⇐R (33, cookpot, brew, 130)
- rod_skyline: 3 skyash_plank + 1 starmetal_bar + 2 glowfin + 1 glass⇐S (33, workbench, assemble, 900)
- axe_starmetal / pick_starmetal: 4 starmetal_bar + 2 skyash_plank + 1 prism_shard (34, starforge, forge_tool, 1,000)
- starmetal_greatblade: 5 starmetal_bar + 1 warden_core + 1 sunbronze_bar⇐S (35, starforge, forge_blade, 1,200)
- starmetal_plate: 6 starmetal_bar + 2 fur_lining⇐R + 1 lion_mane⇐S (35, starforge, forge_plate, 1,250)
- prism_circlet: 2 prism_shard + 2 starmetal_bar + 1 sunstone⇐S (36, grindstone, facet, 1,300)
- set [t, rep 2], all lvl 35, 1,250 xp:
  - prism_blade: 8 star_dust + 3 starmetal_bar + 1 warden_core (starforge, forge_blade)
  - prismsworn_plate: 8 star_dust + 3 starmetal_bar + 1 fur_lining⇐R (starforge, forge_plate)
  - starsight_circlet: 8 star_dust + 1 prism_shard + 1 sunstone⇐S (grindstone, facet)

**Crafting difficulty** (`shared/crafting.js`):
- `recipeTier` gains tiers 5 (lvl 13–20), 6 (21–28) and 7 (29+).
- `WIN/LEAD/SWEEP_H/PRESS_F` for tiers 5–7 **reuse tier 4's values**, since ±3 ticks is already the limit for touch input.
- The harder tiers add steps built from the existing step kinds:
  - tier 5: one extra `reheat` press plus one extra strike group;
  - tier 6: also a `chill` sweep (a sweep step with new skin text);
  - tier 7: both, plus one more strike group.
- `crafting.test.js` "every window reachable" covers tiers 5–7.
- `STATIONS` gains `smokehouse`, `quench_trough`, `glassworks` and `starforge`. Spots are claimed **by prop id**.

### 4.7 Dungeon kinds (`shared/dungeon.js`)
Each `DUNGEONS[kind]` gains:
- `kit: 'modular-dungeon'|'cave'` and `skin: 'default'|'variation-a'|'variation-b'`;
- `dust` (the reagent), `dressing: [slots]`, `fog`;
- `tiers` (recommended combat level per tier);
- `town`.

`TIERS` becomes per-tier-index multipliers shared by all kinds:

| Tier | hp | atk | def | loot |
|---|---|---|---|---|
| 1 | 1 | 1 | 0 | 1 |
| 2 | 1.6 | 1.35 | 3 | 1.6 |
| 3 | 2.45 | 1.9 | 5 | 2.5 |
| **deep** | 3.0 | 2.2 | 8 | 3.5 |

`scene/dungeon.js` swaps its 7 hard-coded `'modular-dungeon:'` prefixes for `kit`. The cave kit's `template-*` pieces match the shipped kit's bounds; its `room-*` and `corridor-wide*` prefabs are banned. `rollChest` uses `C.dustItem`.

| kind | Town, door | Kit / skin / dressing | Pool (elite) | Boss (telegraph) | Recommended T1/T2/T3/Deep | Reagent → set |
|---|---|---|---|---|---|---|
| hollow_crypt | Hearthvale (0,−74) | existing | existing | Pale Count | 5 / 8 / 12 / 18 | grave_dust → Barrow |
| thornroot_warren | Amberfold (−612,−10) | cave / default red-brown / roots, glowing mushrooms | root_thrall 13, warren_hog 13, thorn_wisp 14 (warren_hog) | **Mother Thorn** (keeper→#5f7a3a), L13 dboss: 572/38/15, 200 xp (Thorn Burst, aoe ×1.6) | 13 / 16 / 19 / 25 | heartwood_sap → Thornroot |
| icefall_mine | Rimeholt (−600,−720) | cave / variation-a slate / ice crystals (`grade:false`) | frost_miner 19, rime_crawler 19, ice_wisp 20 (frost_miner) | **The Frozen Foreman** (skeleton + ice crust), L19: 860/54/21, 335 xp (Avalanche, aoe ×1.8) | 19 / 22 / 25 / 31 | rime_shard → Rimeward |
| ashkar_tomb | Sandmere (650,−595) | modular-dungeon (no new GLBs) / sand fog / urns, obelisks | tomb_scarab 25, sand_mummy 26, tomb_guard 26 (tomb_guard) | **Queen Ashkar** (vampire→#c9a25a), L25: 1184/70/27, 497 xp (Sandstorm, aoe ×1.5 + drain .3) | 25 / 28 / 31 / 37 | tomb_resin → Ashkar |
| shard_vault | Starfall (−30,−1215) | cave / variation-b mauve / emissive crystals | vault_wisp 32, vault_grub 32, starguard_husk 33 (starguard_husk) | **The Star-Eater** (procedural crystal golem), L32: 1608/89/34, 720 xp (Prism Beam, ×2.4) | 32 / 36 / 40 / 44 | star_dust → Prismsworn |

**Pool monsters.** These are `dungeon: true` ids with `mobStats(L)` stats:

| L | hp / atk / def | xp |
|---|---|---|
| 13 | 286 / 36 / 13 | 133 |
| 14 | 309 / 38 / 14 | 147 |
| 19 | 430 / 51 / 19 | 223 |
| 20 | 456 / 54 / 20 | 240 |
| 25 | 592 / 67 / 25 | 331 |
| 26 | 621 / 70 / 26 | 351 |
| 32 | 804 / 85 / 32 | 480 |
| 33 | 836 / 88 / 33 | 503 |

Each drops its reagent at .35; the boss drops it at 1.0.

**Chests per kind:**
- **Vault:** gold [10, 18]·rec₁, reagent 2–3, and one roll on the table below.
- **Boss:** gold [24, 40]·rec₁, reagent 3–5, two rolls.
- **Table:** the town's bar ×3 (w 35), its healing food ×2 (w 30), its gem (w 10), a set piece (w 4, boss only), its charm I (w 3, boss only), nothing (w 18).

**Rules:**
- **Deep** unlocks after T3 of that kind.
- **Nightmare of the week:**
  - `weekIndex % 5` picks one kind; its Nightmare tier unlocks at combat 40 once that kind's T3 has been cleared.
  - Every monster is restatted with `mobStats(46, role)`: normal 1301/122/46; dungeon boss 2602/128/48.
  - Tier-1 multipliers, loot ×4.
  - It has its own top-5 weekly board.
- **First-clear bonus** (150 × loot gold plus double boss rolls) is paid once per (hero, kind) per day: the first clear of the day gets it. That is at most 5 a day, down from 15.
- **Featured dungeon** (`dayIndex % 5`): double boss rolls for everyone that day.
- `MAX_RUNS` 16 → 24.

### 4.8 Progression
**Bands** (combat level). Skills unlock the matching nodes and recipes.

| Band | Combat | Node gates | Recipes | Gear tier | Tool tier / power |
|---|---|---|---|---|---|
| Hearthvale | 1–12 | 1–8 | 1–10 | 1 | 1–4 / 1–5 |
| Amberfold | 12–18 | 12 | 12–17 | 2 | 5 / 6 |
| Rimeholt | 18–25 | 18 (salt 22) | 18–23 | 3 | 6 / 7 |
| Sandmere | 25–32 | 25 | 25–29 | 4 | 7 / 9 |
| Starfall | 32–40 | 32, 36 | 32–36 | 5 | 8 / 12 |
| Endgame | 40–50 | rich +8 / ancient +16 / star shard 40 | — | sets, charms II | — |

**Pacing** (`pace.mjs`; 240 gathering actions per focused hour):

| Skill band | xp needed | xp per action | Hours per skill |
|---|---|---|---|
| 1→12 | 8.8k | 22 | 1.7 |
| 12→18 | 17.4k | 46 | 1.6 |
| 18→25 | 36.7k | 62 | 2.5 |
| 25→32 | 58.0k | 84 | 2.9 |
| 32→40 | 96.9k | 115 | 3.5 |
| 40→50 | 173.9k | ≈150 (rich/ancient) | 4.8 |

- **Hero 50** (every skill at 33) takes about **54 h focused**.
- **All six skills at 50** takes about **102 h focused**: 4–6 months at 40 minutes a day.
- Hero level is unchanged (`levelFromXp(total/2)`), so no existing hero changes level.

**Sets** (`shared/sets.js`). Pieces are about 92% of the crafted line's stats.

| Set | 2 pieces | 3 pieces |
|---|---|---|
| barrow (wraith_blade, barrow_plate, ghostlight_amulet; they keep their own perks) | +30 hp | regenOut |
| thornroot | thornguard | forestXp |
| rimeward | frostbite | auraDef |
| ashkar | sunfire | critHeal |
| prismsworn | starlit | fastSpecial |

**Bad-luck protection.** At the town's Quartermaster (reputation rank 2), 8 `trophy_<town>` plus 8 of that town's reagent buy any set piece.

**Buffs** (`shared/buffs.js`, state in `heroes.buffs`):
- There are three slots, `meal`, `tonic` and `lure`, and one buff per slot; using a new one replaces the old.
- Uses tick down on the server in `server/gather.js` (gathering and fishing), `server/battle.js` and `server/crafting.js`.
- Only `swiftfoot_draught` and the shrine blessing are timed.
- Buffs survive logout.

**Milestones** (`shared/milestones.js`). Every level-up popup lists what unlocked, computed from `NODE_TYPES`, `RECIPES`, fish tables, dungeon tiers and passages, with a **Show me** button. Kinds are **P** passage/place, **Q** quality of life, **S** small side-grade, **C** cosmetic.

| Lvl | Foraging | Mining | Herbalism | Fishing | Combat | Crafting |
|---|---|---|---|---|---|---|
| 5 | Q "Next tree" offers 2 choices | Q same for rocks | Q same for herbs | Q fish shadows show size | Q crypt hint at hero *or* combat 5 | S Steady Hands: good windows +1 tick (tiers ≤ 4) |
| 10 | Q trees on the minimap within 60 m | P Smugglers' Cove; Q ore sense | Q herb sense | S bite window +100 ms | Q elite timers on the map | S Salvage: gear → 50% of its bars |
| 15 | S Sap tap: maple and frostpine drop amber_sap 5% | P Ninefold Barrow | S Bloom: 10% chance of +1 herb | S records +5% weight skew | S Second Stance: defend gives a charge | Q batch cap +5 |
| 20 | P Frozen Falls; S PERFECT window +8% | S PERFECT window +8% | S Gentle hands: 10% of picks don't deplete the herb | P Meltwater swim | S Rally: joining a friend's fight gives both +5% atk | P Ice Picks, the Frozen Falls kit |
| 25 | P Eyrie climb | S sunstone chance ×2 | S rare herbs ×1.5 | S Night Angler: +luck at night | Q Bounty Sense: elite ping 5 min early | C Maker's Mark: your name on crafted gear |
| 30 | Q rich and ancient trees on the map within 150 m | Q same for ore | Q same for herbs | Q Legend Lore: windows in the journal | S Mentor: +20% xp to party members 8+ levels lower | Q quick-craft fee 4% → 2% |
| 35 | S Grove Keeper (aura): trees near you regrow 20% faster for everyone | S same for rocks | S same for herbs | S Fish Fry: friends within 20 m get +10% fishing xp | S Guardian: defend shields the lowest-hp ally 30% | S Apprentice: friends at your yard get Steady Hands |
| 40 | **Choose:** Lumberjack (treePower +1) or Woodwright (25% chance of +1 plank) | Prospector (rockPower +1) or Smelter (25% chance of +1 bar) | Gatherer (+15% double) or Alchemist (25% chance of +1 consumable) | Angler (+20% rare weight) or Trophy (+25% kg) | Vanguard (+6% atk) or Warden (+6% def and hp) | Smith (perfectTick +1) or Artisan (+4% Masterwork) |
| 45 | C Verdant tool skin | C Ember skin | C satchel skin | C Golden Hook skin | C battle-worn cloak | C artisan's seal on your shop sign |
| 50 | C "Forest Warden"; both level-40 choices | C "Deepdelver" | C "Green Sage" | C "Lake Legend" | C "Champion of the Hearthlands" | C "Grandmaster" |

**Respec.** Changing a level-40 choice at any Town Hall costs 500 g. Each respec doubles the price, up to 8,000 g (`heroes.respecs`).

---
## 5. Always something to do

### 5.1 The guarantee
- **Seconds:** the context button is never blank, and every result screen has a next step.
- **Session:** the Compass always shows a goal with a route.
- **Day:** about 10 optional minutes that bank.
- **Week:** one shared aim (Big Orders, projects, the Grand Errand, Nightmare).
- **Months:** collections and a world that changes (journal, Cartographer, reputation, sets, records, Five Hearths).

### 5.2 Quests (`shared/quests.js`, `server/quests.js`)
```js
QUESTS[id] = { id, town, title, requires: [questId], min?: { combat?, hero? }, repeat: null | 'daily' | 'weekly',
  give?: { item: n },                  // handed out when the quest starts (letters)
  steps: [{ ev, match, n, text, hint, target }],
  reward: { gold, items?: { id: n }, xp?: { skill: n }, rep?: { town: n }, recipe?, title? } }
// ev: gather fish kill craft stock sell trade deliver travel attune discover dungeon order passage donate use
// match keys: item type monster tag region town station minGrade kind tier legend building id
// target: { kind: 'node'|'monster'|'building'|'stone'|'entrance'|'landmark'|'passage'|'town'|'lake', id?|type?|action?, town? }
```

**Events.** `server/events.js` `emit(c, ev, data)` replaces `advanceTutorial` at its four call sites and adds the rest of the events.
- `quests.js` advances any active step whose `match` fits.
- Rewards are granted only on the server.
- Progress is stored in `quest_progress`. `period` is 0 for one-off quests, the `dayIndex` for dailies and the `weekIndex` for weeklies.
- The client keeps the same `QUESTS` file for its text, which removes the duplicate list at `hud.js:21-26`.

**`hv_intro`**: Hearthvale's 10 steps. Steps 1–4 are today's tutorial with today's rewards; heroes who finished it continue at step 5.

| # | ev, match | Text | Reward |
|---|---|---|---|
| 1 | gather `{type:'tree_oak'}` | Chop an oak in Whisperwood | 20 g |
| 2 | craft `{item:'oak_plank'}` | Saw a plank at the Workbench | 30 g |
| 3 | kill `{monster:'slime'}` | Beat a Bog Slime (a slime now, not just any fight) | 50 g |
| 4 | stock `{}` | Put something on your shop shelf | 60 g |
| 5 | craft `{item:'pick_copper'}` | Forge a Copper Pickaxe | 80 g, 2 health_potion |
| 6 | attune `{id:'stone_wildwatch'}` | Attune the Wildwatch stone | 40 g |
| 7 | fish `{}` | Land a fish at Mirror Lake | 40 g |
| 8 | order `{town:'hearthvale'}` | Fill an order on the Order Board | 60 g, 30 rep |
| 9 | dungeon `{kind:'hollow_crypt', tier:1}` | Clear the Hollow Crypt (bring a friend) | 150 g |
| 10 | attune `{id:'stone_westmarch'}` | Take the West Gate road to the Westmarch Stones | 100 g, starts `af_intro` |

**Town chains.** Each has 6 steps and the same pattern. Step 1 carries a **letter** (bound, nowarp), so every road is walked once.

| Chain | Requires | Steps | Final reward |
|---|---|---|---|
| `af_intro` | hv_intro | 1 deliver letter_amberfold to the Amberfold town hall · 2 attune stone_amberfold · 3 sell 5 items to the Amberfold merchant · 4 craft at the Smokehouse · 5 fill an Amberfold order · 6 kill antlered_elder | 400 g, 100 rep, recipe venison_skewer, gives letter_rimeholt |
| `rh_intro` | af_intro | the same pattern; letter via the Thornback road; Quench Trough; kill old_tusk | 700 g, 100 rep, gives letter_sandmere |
| `sm_intro` | rh_intro | letter via Midmarch (W then E); Glassworks; kill brass_colossus | 1,100 g, 100 rep, gives letter_starfall |
| `sf_intro` | sm_intro | letter via the Skystair; Starforge; kill prism_warden | 1,600 g, 100 rep, title "Wayfarer" |
| `saga_hearths` (Five Hearths) | hv_intro | dungeon T1 of hollow_crypt → thornroot_warren → icefall_mine → ashkar_tomb → shard_vault | 300 g × tier per step; title "Hearthkeeper" |

**The Five Hearths.** Each step is personal. The *first* hero on the server to finish a town's step sets `meta.hearth_<town> = 1`, which turns that town's night lanterns on for everyone, with a banner.

**Step targets.** Steps whose target is in another town use cross-region Take me there (§5.3).

### 5.3 The Compass: one engine, four surfaces (`shared/goals.js`, pure)
```js
suggest(state, now) → [{ id, src, text, why, progress: [n, of], target, score }]   // sorted, never empty
// state: { hero (skills, level, bag, equip, stones, home, pos, region), quests, orders, almanac, journal,
//          till, storage, elite: {id, x, z, until}, nodeStates: [...], party, clock }
```

| Source (`src`) | Score | Example |
|---|---|---|
| `elite` (up, and within 600 m or on your band) | 95 | "Frostmaw is up at Thornback Pass, 18 min left" |
| `quest` (active step) | 90 | "Amberfold 4/6: cook at the Smokehouse" |
| `ready` (till over 200 g, storage, deliverable order or job) | 88 here, 60 elsewhere | "Collect 14 items in Amberfold storage" |
| `pinned` (a pinned recipe, order or journal page) | 85 | |
| `unlock` (a level-up unlock, for 30 min) | 75 | "Mining 18: Rimesilver Vein. Show me" |
| `ancient` (gate met; in region or in band) | 72 | "Ancient Frost Pine in Rimeholt Fells, 11 min" |
| `almanac` | 70 | |
| `upgrade` (next upgrade) | 65 | "Steel Pickaxe: need 2 Steel Bars → Coal Seam, 40 m" |
| `landmark` (undiscovered, within 150 m) | 50, or 80 while the region is under 25% discovered | |
| `journal` (a page at 75% or more) | 55 | |
| **fallback chain** | 10 | nearest unexplored cell cluster ("Unexplored: 140 m NW") → beat a lake record → "Visit {next town}" → "{friend} is at {place}: join them" |

**Next upgrade.** For each slot (axe, pick, rod, weapon, armour, trinket, charm), take the best recipe with `lvl ≤ crafting + 3` and `req` met that beats what is equipped. Expand its missing inputs one level and point at the nearest source the hero can work: a node, a camp, or the local market price.

**The card.**
- It shows the top goal; a chevron reveals 3 more.
- Tap to pin; swipe to snooze for 30 minutes (stored in localStorage).
- It re-ranks every 2 s, and switches only when a goal completes or a rival scores 15 or more higher.
- The card only *points*: the server never trusts it.

**Take me there:**
- Under 250 m: walk, with today's beacon and trail.
- Otherwise, if an attuned stone is within 150 m of the target: "Travel to {stone} ({fee} g)".
- Otherwise: route along the road graph.
- A `nowarp` item forces walking.

**Overworld context button** (`ui/context.js`).
- It is always visible outside dungeons, and checked at 5 Hz.
- A label holds for at least 0.4 s, with 1.5 m of distance hysteresis.
- E, F and Space trigger the same function.
- The first matching rule wins:
  1. Join {friend}'s fight (20 m)
  2. Join the hunt: {elite} (40 m)
  3. Collect till / storage
  4. Deliver {item} → {order or job}
  5. {Passage verb} ("Climb the Frozen Falls"; greyed with the requirement if it isn't met)
  6. Attune / Travel
  7. Enter {dungeon}
  8. Open cache / Take in the view / Read the ruin / Pray / Rest at the campfire
  9. Craft {pinned recipe} (in a yard)
  10. "Next {Oak} (9 m)", else "Chop {Oak}" (12 m)
  11. Cast again
  12. Fight {monster} (15 m, at most 3 levels above your con level)
  13. **"→ {top Compass goal}"**

**Result screens:**
- **Victory:** Fight another {Wolf} (14 m) · Done.
- **Node broken:** Next {Oak} (9 m).
- **Fish landed:** Cast again, plus "New record! 3.2 kg" when it is one.
- **Craft:** Again · Equip · Sell N here for P · Use in {recipe}.
- **Level-up:** names exactly what unlocked, with a **Show me** button.

### 5.4 Orders, the Big Order and the Almanac
**Town orders** (`shared/orders.js`, `server/orders.js`):
- **Templates.** Each town has 8–12 templates in its content pack: `{ key, kind, item|monster, qtyGold, mult, rep }`.
- **Seeding.** Every day, each board seeds 4 orders from `hash(town, dayIndex)`. They are the same for everyone, and everyone fills **their own copy**.
- **Slots.** A hero holds **at most 4 open orders per town**. Each lasts 3 days; on a new day, today's orders fill only the empty slots. Nothing is lost, and the board never shows more than 4.
- **Quantity:** `qty = max(1, round(qtyGold[tier] / value))`, with qtyGold 150 / 400 / 800 / 1,300 / 2,000 for T1–T5 (about 5 minutes of gathering).

| Kind | Example | Pay (× goods value) | Rep |
|---|---|---|---|
| gather or hunt | "12 Maple Logs" · "Thin out 6 Bramble Bears" (kills; goods value = 3 × mob gold) | 1.15, plus half the node xp | 15 |
| craft to grade | "3 Steel Bars, grade B or better" | 1.3, plus the craft xp | 20 |
| **import** | "Rimeholt needs 20 Maple Planks" | 1.25 + 0.05 per road leg from the source town, up to 1.5 | 25 |
| special | a record-weight fish, an elite trophy, an S-grade item | 1.5 | 30 |

**The Big Order.**
- Each town has one per day, shared by everyone: 10× a normal order's quantity, paid per unit as you deliver.
- When it fills, **everyone in that town region gets Festive** (+10% xp for 100 actions), plus a banner. Contributors get 25 rep.
- On Market Day the Big Order pays +50%.

**The Almanac** (dailies). These are quests with `repeat:'daily'`, generated per hero.
- **Three columns, one daily from each:**
  - *make* (gather or craft),
  - *venture* (fight, dungeon or elite),
  - *wander* (discover, deliver, fish, or help a friend).
- **Fit.** Dailies come only from content the hero has unlocked (skill gates met, stones attuned).
- **Rerolls.** 1 reroll a day.
- **Banking.** At most **6 open** dailies: today's 3 plus up to 3 carried over. A new day fills free slots only.
- **Pay:** 40 × tier gold, 100 × tier xp in the matching skill, and 1 material from the hero's best town. No currency layer.
- **The weekly "Grand Errand"** (`repeat:'weekly'`): 5 steps across at least 2 attuned towns. It pays 300 × the best tier in gold, 200 rep split across those towns, and one trophy. It banks 1 extra week.

**The "Today" strip** (top of the Almanac):
- the day twist and its world effect;
- the featured dungeon and this week's Nightmare;
- the next 3 elite windows;
- today's legendary windows (from clock and weather);
- the Market Day host town.

### 5.5 Journal and discovery (`shared/journal.js`, `server/journal.js`, `server/explore.js`)
**The bitmap.**
- 16 m cells over the land bounding box, 84 × 85 for this world, so 893 bytes per hero (table `explore`).
- `server/explore.js` marks cells within 32 m of the hero's position, sampled at 1 Hz from the `pos` event.
- The client receives the bits on login (base64) and deltas when it opens the map.
- If the bounding box grows, stored bits are re-projected using their saved `x0, z0, w, h`.

**Fog of war.** The world map (`ui/worldmap.js`, `mapdraw.js`) draws unexplored cells under fog. Landmarks show only once discovered, or once revealed by that region's vista.

**Region %:** `60 × explored land cells / region land cells + 40 × found landmarks / region landmarks`. Waystones, dungeon doors and lakes count as landmarks. Banners read "Amberwood · Combat 12+ · Discovered 9/24 (41%)".

**Pages.** One page per region, with tabs: Places, Creatures (kill counts), Gatherables (rich/ancient seen), Fish (record kg), Recipes, Secrets.
- Entries come from the content tables, so new content fills the journal by itself.
- Backfill: recipes from `craft_mastery`, landmarks from attuned stones, and Hearthvale's cells for existing heroes.

**Page rewards** (claimed on the page):

| Region % | Reward |
|---|---|
| 25% | map pins for the region's caches and fishing lakes |
| 50% | title "{Region} Wanderer" |
| 75% | a cloak tint in the biome's palette (new `AVATAR_OPTIONS.cloakTint` values, gated by `unlocks`) |
| 100% | waystone fees to stones in that region −50%, and a trophy plaque in your shop |

Whole journal:
- **50%** gives the `charm_wayfarer`.
- **100%** gives the title "Keeper of the Hearthlands".

**Landmark behaviour:**

| Kind | Context button | Effect | Reset |
|---|---|---|---|
| vista | Take in the view | 2.5 s camera pan toward `look`; pins every landmark in the region on your map; journal credit. **No fog change.** | once |
| ruin | Read the ruin | lore page, plus a small cache roll the first time | once |
| shrine | Pray | Wayfarer's Blessing: +15% walk speed for 10 minutes | 30 min |
| cache | Open | `CACHE_LOOT[tier]`: gold [20, 40] × tier, 1–2 region materials, 4% a charm I of the region's town | weekly per hero |
| secret | Search | one-off: a recipe scroll, a dye or a hint | once |
| curio | Pick up | becomes a bound item; return it to its town hall for 30 rep | once |
| npc | Talk | Pell the Pedlar sells 6 rotating goods from other towns at 1.5× value | daily stock |

Caches sparkle within 15 m.

**Glimmers.** Each week (`weekIndex`), 6 caches chosen by hash become glimmers: an extra loot roll and a dye chance. The notice posts and the Almanac name their **regions only** ("Glimmers in Westmarch and Rimeholt Fells").

**Ysolde's Atlas, the Cartographer hunt.**
- The Hearthvale tinker (an npc landmark by the market) hands out page 1 after `hv_intro`.
- Each later page lies in a cache; its riddle names the next region and the landmark near it.
- The chain:
  1. cache_under_pier
  2. cache_hollowlog
  3. cache_drowned_cart
  4. cache_millers_box
  5. cache_bearden
  6. cache_trappers
  7. cache_ninefold (passage)
  8. cache_cairn
  9. cache_caravan_box
  10. cache_eyrie (passage)
  11. cache_fallen_star
  12. secret_starfallen (swim)
- A page drops only when its cache is opened by a hero who holds the previous page.
- Reward: title "Cartographer", the back cosmetic `satchel`, and caches within 40 m pulse on your minimap for good.

### 5.6 Coming back
**The digest** (`server/digest.js`) is shown on connect when `now − last_active > 12 h`. It lists:
- shop sales;
- market fills and storage, by town;
- orders and jobs delivered, expired or refunded (from `notices`);
- friends' highlights: legendaries, boss firsts, projects, new towns;
- project progress;
- today's twist;
- one Compass goal.

It says what *happened*, never what you *missed*.

**Hearth Rest:**
- The pool is `min(hours away, 48) × (20 + 10 × heroLevel)` xp.
- Each xp grant pays +50% from the pool until it is empty.
- Stored in `heroes.rested`.

**Offline notices.** The `notices` table keeps job, order, market-fill and project events that are lost today (`server/game.js:168-176, 993-998`).

### 5.7 A world that moves
**Day twists** keep their crypt effects and gain a world effect:

| Twist | World effect |
|---|---|
| still | **Market Day**: the host town (`dayIndex % 5`) refills merchant premium pools ×2, and its Big Order pays +50% |
| restless | Elite windows last 30 minutes |
| bloodmoon | Elites drop +1 trophy |
| brittle | **Bountiful**: nodes respawn 25% faster |

**Town projects** (`shared/projects.js`, `server/projects.js`):
- **Target** for each need: `ceil(base × clamp(active7d, 2, 12) / 6)`. The owner can edit targets in the Town Hall.
- **Donations** earn 1 rep per 10 g of value. The plaque names the top 3 donors as founders.
- **Unlocks** are either a **map patch** (applied once and saved through `saveMap`, then `game.reloadWorld()` so every client reloads) or an **effect flag** in `meta`.

| id | Town | Needs (base) | Unlock |
|---|---|---|---|
| proj_hollowmere_bridge | Hearthvale | 300 oak_plank, 150 birch_plank, 200 stone_brick, 40 iron_bar, 6,000 g | patch: adds `dock_hm_mid`, removes the broken spans. Hearthvale to Fourways becomes 518 m |
| proj_great_mill | Amberfold | 250 maple_plank, 80 steel_bar, 200 stone_brick, 8,000 g | effect: plank recipes at Amberfold yards give 25% +1 output; patch: the mill sails turn |
| proj_rime_beacon | Rimeholt | 200 frostpine_log, 60 rimesilver_bar, 150 coal, 12,000 g | effect: the beacon skyline card lights; patch: a warm shelter (campfire + cookpot) and 2 caches at Thornpass Lodge |
| proj_waystation | Fourways | 100 maple_plank, 60 frostpine_plank, 60 glass, 10,000 g | patch: a tavern building with Rally (+5% xp for 100 actions for your party) and an import-only Fourways order board |
| proj_oasis_well | Sandmere | 100 sunbronze_bar, 150 glass, 16,000 g | patch: the Mirage Pool lake (3 spots, sandmere table) and 6 more sunpalms |
| proj_observatory | Starfall | 50 starmetal_bar, 25 prism_shard, 20,000 g | effect: vista_observatory pins every landmark world-wide; star-shard night nodes (§4.3) |

**Reputation** (`town_rep`):

| Rank | Points | Unlocks |
|---|---|---|
| 1 Stranger | 0 | orders |
| 2 Neighbour | 300 | Quartermaster (trophies → set pieces), set recipes, the town's buff-food recipe |
| 3 Friend | 1,000 | waystone fees to this town −50%; that town's charm II for sale (4× the value of charm I) |
| 4 Champion | 2,500 | town cloak, banner and shop sign skin |
| 5 Hero of {Town} | 5,000 | title, and your name on the Wall of Heroes (a plaque by the town's fountain) |

Sources:
- orders: 15–30;
- Big Order: 25;
- donations: 1 per 10 g;
- the town's boss and elites: 25, the first kill each day;
- journal milestones: 50;
- curios: 30;
- intro chain: 100.

**Feats** (`shared/feats.js`; 20, all firsts and none grinds; a title shows on the nameplate):
- All Roads Walked
- First Legendary
- All Five Legendaries
- Founder (a top-3 donor)
- Bridge Builder (donated to the bridge)
- Every Dungeon T3
- Deep Diver (any Deep)
- Nightmare Slayer
- Cartographer
- Hearthkeeper
- Helped in 50 Friends' Fights
- Ancient Find
- Masterwork Maker
- First S-grade at Tier 7
- Big Order Hero (filled a share of 10)
- Elite Hunter (all 8 elites)
- Passage Finder (all 5)
- Wanderer of Five Towns
- Grandmaster (any skill 50)
- Keeper of the Hearthlands

**Social:**
- **Travel to a party member:** the attuned stone nearest them, for the normal fee (`travel.party`).
- **Mentor** (combat 30): +20% xp for party members 8 or more levels lower.
- **Co-op auras** at level 35.
- **Elites:** loot for everyone who joins.
- **Big moments** (legendaries, boss firsts, projects, hearths) show as a **banner plus a map ping**, not only a chat line.
- **Remove** Merchant Ola's "haggle" line (`townsfolk.js:14`).

### 5.8 Guardrails and engagement telemetry
**Guardrails:**
- No streaks, no login calendars, and no limited-time power.
- Everything banks: dailies (6 open), orders (4 open per town, 3 days each), the weekly (2 weeks), rest (48 h).
- All dailies together take about 10 minutes. A reroll is free.
- Group progress counts for everyone: elites, Big Orders, projects and hearths.
- Every reward is rolled on the server.
- New gold comes only from bounded pools (§6).

**Telemetry:**
- `engage_day` per hero per day: minutes, sessions, **dead-air seconds** (overworld time with no move, no open panel and no context action), goals shown, taken and done.
- `goal_log` per source per day.
- **Target: dead air under 5% of session time.** It shows on the owner's Engagement tab with the Compass take-rate by source.

---
## 6. Economy

### 6.1 Region-scoped markets and storage
**Where you can trade.** `townAt(x, z)` returns the smallest containing region with `kind:'town'` (indexed in `shared/places.js`).
- Hearthvale's r 96 covers the whole island, so **today's instant dock buttons keep working there**.
- In the wilds and at outposts you can browse but not trade ("Head to a town to trade").
- Inside a dungeon run, the market is browse-only: `market.place` and `market.cancel` leave `RUN_RPC_OK`.

**Server-gated actions** (each needs `townAt(hero)` to be the right town):
- `market.place` (that town's book);
- `market.cancel` of a **sell** order, which must be in the order's town (cancelling a buy refunds gold, which is global, so it works anywhere);
- `npcSell`;
- `jobs.post` and `jobs.deliver` (in the job's town);
- `supplier.buy`;
- storage deposit and withdraw;
- `shop.move`.

**Player shops** keep remote visiting, the social feature. Each shop gets a **home town**, which sets which NPC customers visit and its `town_demand` pool. Stocking happens inside the shop room, as today; that leak is accepted (8 slots × 999).

**Goods never teleport.** A resting order that fills, a sell order cancelled from another town, or a job delivery to an absent poster all put the goods into **`town_storage`** for that (hero, town).
- Storage is free.
- It is collected automatically when you open that town's market.
- You can also deposit and withdraw by hand there, which lets you park goods (and avoid the toll, §6.3).

### 6.2 The town merchant (standing bid in every book)
Constants live in `shared/economy.js` as `TRADE[town] = { base, floorPool, rate: { wood, ore, herb, fish, food, hide, gem, gear } }`. Owner overrides are read through `knob()` (§6.5).

```
unitBid(town, item):
  v = ITEMS[item].value; g = tagGroup(item); base = T.base; rate = T.rate[g]
  if floorLeft(town,item) <= 0  → floor(v × 0.25)                                 // merchant is full: sell elsewhere
  if rate <= base               → floor(v × rate)                                 // a glut pays flat, with no premium
  else                          → floor(v × (base + (rate − base) × premFill(town,item)))
sale of q units: unit by unit, floorLeft −= v × min(base, rate); premFill −= 1/demandCap(v) when rate > base
floorLeft refills linearly to floorPool over 8 h; premFill refills to 1 over 8 h (×2 refill on the Market Day host)
```

| Tag group | Hearthvale | Amberfold | Rimeholt | Sandmere | Starfall |
|---|---|---|---|---|---|
| **base (floor)** | **0.60** | 0.55 | 0.55 | 0.50 | 0.50 |
| floor pool per (town, item) per 8 h | 3,000 g | 2,000 g | 2,000 g | 2,000 g | 2,000 g |
| wood / plank | 0.60 | **0.45** | **0.90** | **0.90** | 0.85 |
| ore / bar | **0.85** | **0.90** | **0.45** | 0.55 | 0.50 |
| herb | 0.70 | **0.50** | 0.80 | **0.90** | 0.70 |
| fish | 0.60 | **0.85** | **0.50** | **0.90** | 0.70 |
| food / potion | 0.80 | 0.80 | **0.90** | 0.70 | **0.95** |
| hide / monster | 0.80 | 0.60 | **0.85** | 0.55 | 0.55 |
| gem / reagent | 0.75 | 0.70 | 0.70 | **0.45** | 0.60 |
| tool / gear / kit / charm | 0.60 | 0.55 | 0.55 | 0.50 | 0.50 |

**Hearthvale** is ≥ 0.60 on every tag, so no seller in Hearthvale earns less than today. Only the shared floor pool (3,000 g per item per 8 h) can lower it, and only above that cap.

**The story players can work out:**
- Rimeholt burns Amberfold's wood.
- Sandmere eats everyone's fish.
- Amberfold's smiths buy ore.
- Starfall drinks potions.

**Suppliers** (gold sinks):
- Each town's stall sells its `supplies` (3 local raw staples, its heal food and `hearth_charm`) at **1.35× value**.
- At most 150 of each item per town per day (`town_supply`).
- The highest bid anywhere is 0.95×, so **there is no loop of buying from one NPC and selling to another**. `economy.test.js` asserts that every ask is above every bid in every town.

**Pell the Pedlar** (Fourways) sells 6 rotating goods from other towns at 1.5× value.

**The price board** ("Other towns" tab in every market) shows, for each town:
- the last trade price;
- the merchant bid now;
- the supplier ask;
- (Phase 5) the cargo bid.

A price gap nobody can see makes nobody travel.

**Worked example.**
- 40 Maple Planks (58 g) sell in Amberfold, a glut at 0.45, for 26 each, 1,040 g.
- In Rimeholt (0.90, full fill) they fetch 52 each, 2,080 g. That is +1,040 g for an 85 s walk.
- The premium is capped by `demandCap(58)` = 41 units per 8 h.
- By waystone the trip costs a 29 g fee plus a 35 g toll.

### 6.3 Waystone toll
`toll = min(120, floor(0.04 × max(0, floorValueCarried − 500)))`.
- `floorValueCarried` = Σ qty × value × 0.6 over bag items whose tag is wood, plank, ore, bar, herb, fish, hide, monster, gem or reagent.
- It is shown on the travel confirmation, and it is a sink.
- Walking is free, and storage lets you leave goods behind.

### 6.4 Faucets, sinks and targets
**Gold per active hour targets** (used by the alarms):

| Hearthvale | Amberfold | Rimeholt | Sandmere | Starfall |
|---|---|---|---|---|
| 1.5k | 3.0k | 4.0k | 5.0k | 6.0k |

Kill gold grows ×1.3 per tier while gear prices grow ×1.8, which is mildly deflationary. For example, a Steel Saber is about 25 minutes of Amberfold gold, and a Starmetal Greatblade about 72 minutes of Starfall gold.

| Faucet | Bound |
|---|---|
| Kill gold `[7,11]·L^0.6` per fighter (Hearthvale unchanged) | time only |
| Merchant floor | per-(town, item) pool |
| Merchant premium | `demandCap` per (town, item) |
| NPC shop customers | per-town pools, weights summing to 2.0× today's |
| Orders | 4 open per town per hero; goods-value sized |
| Big Order | one per town per day |
| Dailies and weekly | at most 6 and 2 open |
| Dungeon first clear | once per (hero, kind) per day |
| Caches | weekly per hero |
| Quests | one-time |

| Sink | Size |
|---|---|
| Today's fees (market 4%, shop 4%/8%, jobs 4%, quick-craft 4%) | kept |
| Waystone fee + toll | 25–51 g + up to 120 g |
| Supplier asks, Pell, hearth_charm | 1.35–1.5× value; 60 g |
| Town projects | 6,000–20,000 g plus goods, each |
| Charm II at the Quartermaster | 3,200–6,400 g |
| Respec | 500 → 8,000 g |
| Shop relocation | 500 × tier g |
| Town-hall cosmetics (3 per town: hat, back, cloak tint) | 1,000–8,000 g |
| Cargo crate purchases (Phase 5) | base price |

### 6.5 Telemetry and the owner's knobs (no governor)
**Data:**
- `Heroes.addGold(id, n, reason)` makes `reason` **required**; Phase 0 labels every call site.
- It writes `gold_flow(day, town, reason)`.
- `item_flow(day, item, kind)` records faucet items: gathered, dropped, chest, crafted, consumed by orders, sold to the merchant.
- The CPI is computed on demand from `market_trades`: the VWAP per town over a basket of each town's 3 staples, its bar, its plank and its food.

**The owner's Economy tab** (Town Hall, admin only) shows:
- faucets vs sinks over 7 days, by reason;
- gold per active hour by band (`engage_day` minutes against `gold_flow`);
- CPI per town;
- pool saturation.

**Alarms:**
- faucet/sink above 1.5 for 7 days;
- CPI up more than 3% a week;
- a band's gold per hour above 1.25× target.

Each alarm suggests a knob (floor pool, appetite, order multiplier, tax). **The owner applies it**: `owner.econ.set` writes `meta.econ_overrides`, and `knob(key)` reads the override, else the default. Overrides go to clients in `welcome` for price hints.

### 6.6 Cargo crates (Phase 5, optional, small)
- **Item.** `crate_<town>` is bound and nowarp, so waystones refuse it.
- **Buying.** At the town's supplier stall for base H 30, A 45, R 70, S 100, St 140. Stock is `20 + 6 × active7d` per town per day.
- **Selling.** At any *other* town's stall for `base × (1 + 0.55 × road_km) × fill`. `fill` falls from 1.0 to 0.7 as the (town, crate) pool drains, and refills over 8 h. Each party member within 30 m adds +10%, up to +30%.
- **Caps.** At most 3 carried; 6 delivered per hero per day.
- **Scale.** About +80 g a crate on the longest route. A bonus for walking with friends, not a farm.

---

## 7. Data: migrations, RPCs and messages

### 7.1 Migrations
Phase 0 adds a loader:
- Existing migrations 1–6 stay in `db.js` under `user_version`.
- New ones are files `server/migrations/NNN_name.js` (`export default (db, now) => {}`), applied in number order when absent from `schema_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`, each in its own transaction.
- Numbers are pre-assigned, so parallel packages never collide.

```sql
-- 007_telemetry (Phase 1, P8)
CREATE TABLE gold_flow (day INTEGER NOT NULL, town TEXT NOT NULL, reason TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, town, reason));
CREATE TABLE item_flow (day INTEGER NOT NULL, item TEXT NOT NULL, kind TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, item, kind));
CREATE TABLE perf_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL, device TEXT NOT NULL, region TEXT NOT NULL,
  fps_p50 REAL, fps_p5 REAL, draws_p95 INTEGER, tris_p95 INTEGER, load_ms INTEGER, at INTEGER NOT NULL);
CREATE INDEX idx_perf_day ON perf_samples(day, device, region);

-- 008_towns (Phase 1, M3)
ALTER TABLE market_orders ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
ALTER TABLE market_trades ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
CREATE INDEX idx_orders_town_book ON market_orders(town, item, side, status, price);
CREATE INDEX idx_trades_town_item ON market_trades(town, item, ts);
CREATE TABLE town_demand (town TEXT NOT NULL, item TEXT NOT NULL, fill REAL NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (town, item));
INSERT INTO town_demand SELECT 'hearthvale', item, fill, at FROM npc_demand;   -- npc_demand stays, read-only, for one release
CREATE TABLE merchant_pool (town TEXT NOT NULL, item TEXT NOT NULL, floor_left REAL NOT NULL, prem_fill REAL NOT NULL,
  at INTEGER NOT NULL, PRIMARY KEY (town, item));
CREATE TABLE town_storage (account_id INTEGER NOT NULL REFERENCES accounts(id), town TEXT NOT NULL, item TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0), PRIMARY KEY (account_id, town, item));
CREATE TABLE town_supply (town TEXT NOT NULL, item TEXT NOT NULL, day INTEGER NOT NULL, sold INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (town, item));
ALTER TABLE shops ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';
ALTER TABLE jobs ADD COLUMN town TEXT NOT NULL DEFAULT 'hearthvale';

-- 009_hero_world (Phase 1, M2)
ALTER TABLE heroes ADD COLUMN home TEXT NOT NULL DEFAULT 'hearthvale';
ALTER TABLE heroes ADD COLUMN buffs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE heroes ADD COLUMN perks TEXT NOT NULL DEFAULT '{}';      -- level-40 choices
ALTER TABLE heroes ADD COLUMN respecs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE heroes ADD COLUMN rested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE heroes ADD COLUMN title TEXT;

-- 010_quests (Phase 2, E1)
CREATE TABLE quest_progress (account_id INTEGER NOT NULL REFERENCES accounts(id), quest TEXT NOT NULL,
  period INTEGER NOT NULL DEFAULT 0, step INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active', started_at INTEGER NOT NULL, done_at INTEGER,
  PRIMARY KEY (account_id, quest, period));
CREATE INDEX idx_quest_active ON quest_progress(account_id, state);
INSERT INTO quest_progress (account_id, quest, period, step, n, state, started_at)
  SELECT account_id, 'hv_intro', 0, MIN(tutorial, 4), 0, 'active', created_at FROM heroes;   -- column heroes.tutorial is kept
CREATE TABLE almanac_meta (account_id INTEGER PRIMARY KEY, rerolled_day INTEGER NOT NULL DEFAULT -1, pins TEXT NOT NULL DEFAULT '[]');

-- 011_journal (Phase 2, E3)
CREATE TABLE journal (account_id INTEGER NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, id TEXT NOT NULL,
  first_at INTEGER NOT NULL, best REAL, n INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (account_id, kind, id));
CREATE TABLE explore (account_id INTEGER PRIMARY KEY REFERENCES accounts(id), bits BLOB NOT NULL, w INTEGER NOT NULL,
  h INTEGER NOT NULL, x0 REAL NOT NULL, z0 REAL NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE landmark_uses (account_id INTEGER NOT NULL, landmark TEXT NOT NULL, period INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (account_id, landmark));
CREATE TABLE journal_claims (account_id INTEGER NOT NULL, page TEXT NOT NULL, pct INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (account_id, page, pct));
INSERT OR IGNORE INTO journal (account_id, kind, id, first_at, best, n)
  SELECT account_id, 'recipe', recipe, 0, best, n FROM craft_mastery;

-- 012_return (Phase 2, E4)
CREATE TABLE notices (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, kind TEXT NOT NULL,
  data TEXT NOT NULL, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_notices ON notices(account_id, seen, id);

-- 013_orders (Phase 2, E5)
CREATE TABLE order_slots (account_id INTEGER NOT NULL, town TEXT NOT NULL, slot INTEGER NOT NULL, order_key TEXT NOT NULL,
  day INTEGER NOT NULL, got INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (account_id, town, slot));
CREATE TABLE big_orders (town TEXT NOT NULL, day INTEGER NOT NULL, item TEXT NOT NULL, need INTEGER NOT NULL,
  got INTEGER NOT NULL DEFAULT 0, done_at INTEGER, PRIMARY KEY (town, day));
CREATE TABLE big_order_shares (town TEXT NOT NULL, day INTEGER NOT NULL, account_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (town, day, account_id));
CREATE TABLE town_rep (account_id INTEGER NOT NULL, town TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, town));

-- 014_engage (Phase 2, E7)
CREATE TABLE engage_day (day INTEGER NOT NULL, account_id INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0, dead_air_s INTEGER NOT NULL DEFAULT 0, goals_shown INTEGER NOT NULL DEFAULT 0,
  goals_taken INTEGER NOT NULL DEFAULT 0, goals_done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, account_id));
CREATE TABLE goal_log (day INTEGER NOT NULL, src TEXT NOT NULL, shown INTEGER NOT NULL DEFAULT 0,
  taken INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src));

-- 015_living (Phase 5, L2/L3/L4)
CREATE TABLE projects (id TEXT PRIMARY KEY, need TEXT NOT NULL, got TEXT NOT NULL DEFAULT '{}', started_at INTEGER NOT NULL,
  done_at INTEGER);
CREATE TABLE project_donations (project TEXT NOT NULL, account_id INTEGER NOT NULL, value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, account_id));
CREATE TABLE feats (account_id INTEGER NOT NULL, feat TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_id, feat));
CREATE TABLE cargo_stock (town TEXT NOT NULL, day INTEGER NOT NULL, sold INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (town, day));
CREATE TABLE cargo_hero (account_id INTEGER NOT NULL, day INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day));
CREATE TABLE cargo_pool (town TEXT NOT NULL, crate TEXT NOT NULL, fill REAL NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (town, crate));
```

**Rules:**
- `dungeon_daily` needs no change. The first-clear rule queries `(account, kind, day)` before paying.
- Elite state is computed from the clock and is never stored.
- Rich and ancient node states live in memory, rebuilt on boot.

### 7.2 RPCs (registered through `server/rpc.js`: `register(name, fn, { inRun: bool })`)
| RPC | Payload → result | Package |
|---|---|---|
| market.summary | {} → { town, browseOnly, items } | M3 |
| market.book | { item, town? } → { town, bids, asks, npcBid, supplierAsk, last } | M3 |
| market.place / market.cancel | as today; town-gated (§6.1) | M3 |
| market.board | { item } → { towns: [{ town, last, npcBid, ask, cargoBid? }] } | M3 |
| npcSell | { item, qty } → { gold, unit, full: bool } | M3 |
| merchant.quote | { item, qty } → { unit, total, glut } | M3 |
| storage.get / .collect / .deposit / .withdraw | { town? } / {} / { item, qty } → { items, moved } | M3 |
| supplier.list / supplier.buy | {} → { town, stock: [{ item, ask, left }] } / { item, qty } | M3 |
| jobs.list | {} → { here, elsewhere, mine, now } | M3 |
| shop.move | { town } → { town, fee } | M3 |
| travel | { to } → { fee, toll } (refused with a nowarp item) | M2 |
| travel.party | { member } → { to, fee } | M2 |
| travel.home | {} (uses a hearth_charm) | M2 |
| passage.use | { id } → { x, z } | M2 |
| use | { item } → { heal?, buff? } (replaces `drink`, which stays as an alias) | M4 |
| equip | { item } (checks `req` and the charm slot) | M4 |
| perks.choose / perks.respec | { skill, pick } / { skill } → { fee } | M4 |
| quest.list / quest.pin | {} → { active, done } / { id } | E1 |
| goals.log | { shown: { src: n }, taken: { src: n }, done: { src: n } } every 60 s | E2 |
| journal.get / journal.claim | { page? } → { pages, claims } / { page, pct } → { reward } | E3 |
| explore.bits | {} → { x0, z0, w, h, bits: base64 } | E3 |
| landmark.use | { id } → { kind, loot?, lore?, pins?, page? } | E3 |
| digest.get / digest.ack / notices.ack | {} / {} / { upto } | E4 |
| orders.list / orders.deliver / big.give | { town? } → { town, slots, big } / { slot, qty } / { qty } | E5 |
| almanac.get / almanac.reroll | {} → { dailies, weekly, today } / { slot } | E5 |
| elite.info | {} → { up: { id, x, z, until }, next: [{ id, at }] } | L1 |
| project.list / project.donate | {} / { id, item?, qty?, gold? } → { progress } | L2 |
| rep.get / qm.list / qm.buy | {} / { town } / { item } | L2 |
| feats.get / title.set | {} / { feat } | L3 |
| cargo.buy / cargo.sell | { qty } / {} → { gold } | L4 |
| owner.econ / owner.econ.set / owner.perf / owner.engage | admin only → reports; `econ.set { key, value }` | E7 |
| perf.sample | { device, region, fps50, fps5, draws95, tris95, loadMs }, rate-limited to 1 per 60 s | P8 |

**In-run RPCs.** `inRun` is true for: equip, use, quest.list, almanac.get, journal.get, digest.get, market.summary, market.book, market.board, perf.sample, and everything that is allowed in a run today.

**New server → client messages:**
- `quest` { id, step, done?, reward? }
- `unlock` { skill, lvl, list }
- `notice` { kind, text }
- `banner` { kind, text, x?, z? }
- `elite` { id, x, z, until, next }
- `buffs` { meal, tonic, lure }
- `storage` { town, n }
- `world` { hearths, projects, clockOffset }
- `econ` { overrides }
- Snapshot node rows gain `st` (0, 1 rich, 2 ancient).
- `welcome` gains `home`, `charm`, `buffs`, `perks` and `title`.

---

## 8. Client and editor changes

### 8.1 Client UI
| Surface | Change | File |
|---|---|---|
| Goal card | Always on (it no longer hides at `tutorial >= 4`); top goal plus a chevron for 3 more; pin and snooze; cross-region Take me there | `ui/goalcard.js` (new; the quest card and guide move here from `hud.js`) |
| Context button | `ctxBtn` stays visible in the overworld; rules in §5.3; on phones it is the big thumb button above the dock | `ui/context.js` |
| Result buttons | Victory, node broken, fish landed, craft | `ui/results.js` |
| Level-up | A popup listing unlocks with Show me | `ui/levelup.js` |
| Dock | Opens the *current* town's market, craft and town panels; Shop enters your shop | `ui/dock.js` |
| Market | Title `${town.name} Market`; tabs Here / Other towns (price board) / Storage; Buy and Sell disabled outside a town | `ui/market.js` |
| Board | Orders (4 slots), Big Order bar, player jobs (Here / Elsewhere) | `ui/board.js` |
| Almanac | Dailies, weekly, Today strip | `ui/almanac.js` |
| Journal | Pages, tabs, % rings, claims, Cartographer pages | `ui/journal.js` |
| World map | Fog of war from the bitmap; pins (landmarks, caches, rich/ancient, elite, glimmer regions); "Combat N+" band labels; price-board link | `ui/worldmap.js`, `ui/mapdraw.js` |
| Banners | "{Region} · Combat N+ · Skills N+ · Discovered x/y"; event banners | `ui/banners.js` |
| Equipment | Charm slot, `req` shown in red when unmet, set bonus lines, buff chips with uses left | `ui/hero-panel.js` |
| Digest | A panel on connect after 12 h | `ui/digest.js` |
| Owner tabs | Economy, Performance, Engagement (admin) | `ui/owner.js` |
| Name colours | `conColor(lvl − round((hero + 2·combat)/3))` | `ui/labels.js` |
| Copy | Remove the "haggle" line; "Crypt" wording uses the dungeon's name | `scene/townsfolk.js`, `ui/dungeon-panels.js` |

### 8.2 World editor (so the owner can keep building)
**Fields:**
- regions: `biome`, `stone`, `trade`, `autoCover`, `kind` (now including `outpost`);
- zones: `biome` (with "(inherit)") and a `cover` density multiplier;
- buildings: `style`, `kit`, `tex`, and `action` as a select;
- lakes: `kind`, `fish`;
- nodes: `table`;
- docks: `style`;
- spawns: `elite` toggle and elite `lvl`/`name`.

**Palette:** Market, Workshop, Shop, Town Hall, Order Board, Supplier stall, 5-station set, the 4 signature stations, Gate, Bridge dock, Campfire, Notice post. **Stations can be copied and deleted.**

**New kinds:**
- **landmark** (kind, reset, loot, look, page);
- **passage** (two handles, kind, requirement, kit);
- **skyline** (at most 6).

**Stamps:**
- **Stamp town kit** places the §3.1 layout at the cursor with ids `<t>_*`.
- **Stamp outpost** places the §1.4 bundle.

**Lints panel.** Each lint jumps to the problem:
- 100 m road gaps;
- an incomplete town kit;
- a point more than 300 m from a stone;
- region minimums;
- reachability (follows passages and the road graph);
- a node level outside its band;
- an island not reached by any passage;
- map size above 200 KB gzipped.

**Budget meter.** `shared/budget.js` gives each chunk under the cursor green, amber or red against §9.1. It shows estimated draws, tris and materials, and a whole-map census.

**Speed and safety:**
- **Incremental rebuild:** only the touched chunks and the changed entity.
- **Drafts in IndexedDB** instead of localStorage, whose 5 MB cap fails at about 2.5 MB.
- The undo stack stores diffs.
- A region jump list.
- A **patch report** that lists which patches applied or were skipped, and why.

---
## 9. Mobile performance

### 9.1 Budgets
Measured on the phone profile: 390×844, DPR 3, `low`, pixel ratio 1.5, shadow map 1024. Desktop gets about 2×.

The draw count is the number that matters. SwiftShader fps means nothing, so real-phone fps comes from the perf beacon.

| Item | Budget | Today (perf brief) |
|---|---|---|
| Draw calls, default camera | **≤ 250**: main ≤ 150, shadow ≤ 60 (on frames that re-render it), heroes + silhouette ≤ 40 | 817–919 |
| Draw calls, worst framing (zoomed out) and a 9-hero crowd | **≤ 400** | 1,459 / 1,684 |
| Triangles | **≤ 150k**: main ≤ 110k, shadow ≤ 30k; worst ≤ 220k | 206k–345k |
| Per hero / per mob | **≤ 8 / ≤ 4** draws; mobs use a blob shadow on low | 118 / ~11 |
| Near chunk (≤ 48 m) / far chunk | **≤ 25 + 8 shadow / ≤ 4** draws | ~150 InstancedMeshes in central chunks |
| GPU textures | **≤ 24 MiB** (≤ 32 MiB with 3 biome packs resident) | 44 → 116 MiB |
| Shader programs | **≤ 40**, all compiled before they are seen | 64 → 99, compiled mid-game (322–768 ms hitches) |
| Render JS / update JS per frame (perf-brief Xeon) | **≤ 5 ms / ≤ 2.5 ms**; ≤ 25 ms render at 4× CPU throttle | 15.4 / 2.0 ms; 77 ms at 4× |
| Chunk build step | **≤ 4 ms per frame**, time-sliced | 8–19 ms |
| Long tasks while walking | **none over 50 ms** (Xeon) | 322–768 ms compile frames |
| Fog and view (low) | fog per §2.2 × 0.75; `camera.far` = `viewRadius` = fog far + 10; ≤ 12 resident chunks | fog 100, far 900, radius 120 |
| First load | **≤ 3 MB compressed** before the first frame, ≤ 6 s at 10 Mbps / 60 ms | 11.4 MB, 470 requests, 16.4 s |
| Each biome or kit pack | ≤ 400 KB gzipped, at most 20 models, loaded lazily | everything loads up front |
| Map JSON | ≤ 200 KB gzipped (the real world is about 60 KB) | 19.4 KB |
| Server tick (410 nodes, 240 mobs, 10 players) | **≤ 2 ms p95** at 20 Hz; a route request ≤ 20 ms; nav memory proportional to tiles visited | walks every node and mob every tick |
| Real phones (perf beacon) | town squares: fps p50 ≥ 30, p5 ≥ 20 on the owner's mid-range Android | unknown |

**How a default view fits in about 250 draws:**
- 4 near chunks × 25 = 100
- 5 far chunks × 4 = 20
- 10 mobs × 4 = 40
- own hero plus 3 friends × 8 = 32
- sky, sea, weather and skyline = 4
- shadow ≤ 60, on frames where it re-renders

### 9.2 Engine work (all in Phase 1, before any content)
| # | Change | Expected saving | Package |
|---|---|---|---|
| 1 | Precompress `.glb/.js/.css/.png` (br + gz) at build; serve with `content-encoding`, `Vary` and immutable caching; `?v=<hash>` URLs | 11.4 → about 2.2 MB; GLBs 8.6 → 1.5 MB (measured gzip) | P1 |
| 2 | Shadows on demand. Remove `game.js:1958`; re-render only when the texel-snapped centre moves 3 m or a caster changes. Box ±20 m pushed toward the look point. `PCFShadowMap` on low. Casters on low are only buildings, trees and rocks over 1.5 m | −514 draws, −4.7 ms (measured) | P2 |
| 3 | Heroes in their own `Scene`, so passes 2–3 walk a few objects, not 4,000. Silhouette for your own hero and party only, without hulls | −483 draws with 9 heroes (measured) | P2 |
| 4 | One `scene.updateMatrixWorld()` per frame. `matrixAutoUpdate = false` on statics. The town leaves the graph during dungeon runs | up to −20–25% of render JS | P2 |
| 5 | Deduplicate textures per image URI and materials per (texture, colour, flags). One outline program (thickness as a uniform). `compileAsync` on a hidden warm-up group per pack, at load and on prefetch | 116 → about 20 MiB; programs under 40; no compile hitches | P3 |
| 6 | Manifest groups `core`, `biome:<id>`, `kit:cave`, `mobs:<town>`. `ensureGroup(id)` prefetches when a region is within 250 m, or during a waystone fade. Drop a group 2 regions away. Monsters with no model use the tinted slime | first load is core only | P3 |
| 7 | Fog-bound view: `camera.far` = `viewRadius` = fog far + 10; the sky dome is scaled inside it | the worst framing falls toward default-view cost | P2 (camera), P4 (radius) |
| 8 | Stream nodes, buildings, stations, stones, lakes, docks, plazas, entrances, labels and emitters with chunks. Instance nodes per type per chunk (a depleted node collapses its matrix). Labels are culled by distance before `project()`. Emitters run within 60 m, with a pool per kind | world-size costs stop growing | P4 (+P2 labels, fx) |
| 9 | Near chunks merge static props by material, with one merged hull per material and scenery outlines only within 40 m. Far chunks become 1–3 vertex-coloured meshes with no hull or shadow, and ground at half segments. Skyline: one instanced draw of at most 6 fog-exempt cards from a 512×256 atlas rendered once at load. Weather: one GPU `Points` draw | a dense chunk ~150 → ~25 draws | P4 |
| 10 | Time-slice `buildChunk` into ground, cover, props and nodes steps of ≤ 4 ms. Pre-filter `LANDS` per chunk (`near.lands`) for `heightAt`/`colourAt`. Generate cover on the client (§9.3) | no 30–60 ms stream hitches | P4 |
| 11 | Coast baked into a distance texture at load. This removes the 64-circle cap the 79-circle world needs, and the per-pixel loop. Lake and sea colours become uniforms per biome | GPU saving; 64-circle cap gone | P5 |
| 12 | Server: spatial index for lands, lakes and regions. Nav grid allocated per 32 m tile (a Map, not one `Uint8Array`). A road graph from `paths`: A* to the road, Dijkstra along it, A* off it, sliced at 2 ms. Regions with no hero within 150 m sleep (no mob or node ticks; catch up on wake). Each mob's snapshot key is computed once per snapshot. Mob interest is 50 m on low clients, with at most 20 shown | tick and routes hold at 17× the land | P7 |
| 13 | Merged avatars: rigid part groups → 6–8 vertex-coloured meshes with one hull each. No outline past 25 m, hidden past 60 m. Mobs ≤ 4 draws with a blob shadow. Townsfolk use per-region stop lists, at most 20 in the world and only the nearest 6 animate | about −100 draws per visible friend | P6 |

**Summed effect.** Items 2, 3, 4, 5 and 7 take the town view from about 850 draws to about 300, and render JS from about 14 to about 6 ms (summed measured deltas). Item 9 reaches ≤ 250.

### 9.3 How new content stays inside the budget
- **Cover generated on the client.**
  - Ground cover comes from `BIOMES[biome].cover`, deterministic from the chunk seed like today's tufts.
  - It skips paths, plazas, buildings, nodes and lakes; it never blocks; and the server and nav never see it.
  - It is merged into 1–2 meshes per chunk, drawn only within 48 m, and halved on low.
  - The map stores only blocking props, landmarks, nodes and stations: about 300 blocking props per town and 150 per road.
- **Authoring caps per chunk** (the editor's budget meter and `perf:census`):
  - ≤ 40 blocking props
  - ≤ 12 materials after dedupe
  - ≤ 1 landmark of ≤ 3k tris
  - ≤ 40 nodes
  - ≤ 6 camps, at least 40 m apart, ≤ 5 mobs each
- **Per biome:** ≤ 3 variants per scatter slot; atlas packs for dense scatter; wrecks and siege towers only as one-off landmarks; each `grade:false` flag costs one program.
- **Town centres:** ≤ 60 main draws with merged buildings.
- **The engagement layer:**
  - world markers are one instanced mesh of at most 32;
  - the Compass re-ranks at 0.5 Hz on the client and the context button checks at 5 Hz, both over lists local to the chunk;
  - the journal and map build only when opened.
- **The dungeon kit:** cave `template-*` pieces only.

### 9.4 Proving it: stress map, census, budget estimator, beacon
- **`scripts/gen-stress-map.mjs` → `maps/fixtures/stress.json`.**
  - It uses §1.4's 79 land circles, lakes and stones exactly.
  - Every town is dressed at Hearthvale density with today's models: about 3,500 blocking props, 410 nodes, 60 camps (240 mobs), 45 buildings, 12 stones and 6 skyline cards.
  - Cover rules are taken from `meadow` for every region, until the biome packs exist.
- **`npm run perf:census`** (`scripts/perf/census.mjs`, promoted from `scratchpad/world/tools/perf*.cjs`):
  - It uses Playwright Chromium with the phone profile.
  - It runs 3 framings (default, zoomed out, crowd of 9) at fixed spots: today's island (spawn, Whisperwood, Wilds), plus, on the stress map or real map, every town square and every road midpoint.
  - It reports draws, tris, textures, programs, render/update ms, the longest task and first-load bytes.
  - It fails on any budget miss.
- **`shared/budget.js`** estimates draws and tris per chunk from map data (props by slot·variant and merge rules, nodes, buildings, camps). It drives the editor meter. `budget.test.js` keeps it within 15% of the census on both maps.
- **Perf beacon** (`client/src/util/perfbeacon.js`):
  - Every 60 s it sends fps p50 and p5, draws p95, tris p95 and load ms, tagged with the region and a device class (GPU renderer string hashed, plus `low`).
  - Results show on the owner's Performance tab.
  - **Gate G1 needs the owner's mid-range Android at fps p50 ≥ 30 and p5 ≥ 20 in Hearthvale square.**

---
## 10. Implementation plan

**Rules:**
- **Phase 0 is a mechanical refactor with zero behaviour change.** Phase 1 is the first phase that changes the game, and it is the mobile-performance foundation plus the multi-town plumbing. No content lands before Gate G1.
- **Packages in a phase run in parallel in one working tree.** Their owned files are **disjoint**, and a package edits only files it owns.
- Each phase has one **integration package (I*)**. It alone owns the hub files (`server/game.js`, `client/src/game.js`, `client/src/ui/hud.js`, `client/src/ui/panels.js`, `server/party.js`) and wires feature modules in through the Phase 0 registries.
- **Interfaces across package lines are pinned in this spec.** Where package A calls a module that package B builds, Phase 0 creates that module as a stub with its final signature.
- **Every package:**
  - keeps `npm test` green;
  - adds its own tests;
  - does not regress `npm run perf:census` (once it exists);
  - never commits.
  The lead merges at each gate.
- **Migrations and map patches have pre-assigned numbers:**
  - migrations 007–015 (§7.1);
  - map patches `010_hearthvale_landmarks`, `015_hearthvale_gates`, `020_amberfold`, `030_rimeholt`, `040_sandmere`, `050_starfall`, `060_fourways`, `065_hollowmere`;
  - project unlock patches in `maps/patches/projects/` (not applied automatically).
- **The game stays playable at every gate.** Players see new content only from Phase 3.

### Phase 0: Seams (1 agent, about 2 days, zero behaviour change)
Package **S0** owns every file it touches.

**Server:**
- `server/rpc.js`: `register(name, fn, { inRun })`; the `rpc` handler dispatches through it.
- The RPC table and domain code move out of `server/game.js`:
  - `server/trade.js`: market.*, npcSell, jobs.*
  - `server/travel.js`: travel, attune
  - `server/gear.js`: equip, drink, avatar, profile
  - `server/move.js`: the move handler and path request
  - `server/gather.js`: hitNode, grantGather, cast, reel, land
- `server/battle.js`: the `Battle` class, moved out of `channel.js`.
- `server/events.js`: `emit(c, ev, data)` and `on(ev, fn)`, emitted at every hook:
  - gather, fish, kill, craft, stock, sell, trade, deliver, travel, attune;
  - dungeon clear, job delivered/expired, market fill;
  - gold;
  - `pos` (1 Hz).
  `advanceTutorial` becomes a listener.
- `Heroes.addGold(id, n, reason)`, with every call site labelled. Also `heroes.getField/setField(id, col, value)` with a whitelist (buffs, perks, respecs, rested, home, title), so later packages never need to own `heroes.js` for simple fields.
- `server/migrations/index.js`: a loader with `schema_migrations`.
- **Stubs with final signatures:**
  - `server/nodestates.js` (`tickNodeStates(ch, now)`, `stateOf(n)`);
  - `server/storage.js` (`put`, `take`, `list`);
  - `server/telemetry.js` (`goldFlow`, `itemFlow`);
  - `server/rep.js` (`rankOf(heroId, town)` returns 1, `add()` does nothing). Phase 2's E5 implements it, and `server/crafting.js` checks recipe `rep` through it from Phase 1.

**Shared:**
- `NODE_TYPES` moves to `shared/nodes.js`; colliders, `isWalkable` and `NavGrid` move to `shared/nav.js`. Both are re-exported from `world.js`.
- `shared/places.js`: `regionAt`, `townAt`, `biomeAt` (returns meadow or wilds today).
- `shared/content/index.js`: an empty registry merged into ITEMS, NODE_TYPES, MONSTERS, RECIPES, DUNGEONS and CHESTS.

**Client:**
- `client/src/game.js` is split into:
  - `scene/render.js` (passes, shadow update)
  - `scene/mood.js`
  - `ui/labels.js`
  - `world/services.js` (goCraft, goBuilding, openPlace, contextAction)
  - `ui/context.js` (dungeon-only, as today)
- `ui/hud.js` is split into:
  - `ui/goalcard.js` (quest card, guide, `#questTarget`)
  - `ui/dock.js`
  - `ui/banners.js`
  - a `hud.mount(slot, el)` registry
- `ui/panels.js` is split into `ui/market.js`, `ui/board.js`, `ui/battle-panels.js` and `ui/hero-panel.js`.
- `scene/manifest.js` → `scene/manifest/index.js` + `core.js`, with a `registerGroup()` stub.
- `scene/procprops.js` gains `registerProc(slot, builder)`.

**Tests:**
- `seams.test.js`:
  - RPC dispatch;
  - the tutorial path emits its events in order;
  - migrations 1–6 produce an identical schema, and the loader is a no-op;
  - re-exports still work.
- The existing suite passes unchanged, and the perf census (scratchpad tools) is within ±5%.

### Phase 1: Foundation: mobile performance and multi-town plumbing (15 parallel packages, about 5 days)
**Content in this phase:**
- Only Hearthvale is visible.
- `maps/fixtures/twotown.json` ("Testvale", a 70 m town at (400, 0) with a kit, a cave dungeon kind and its own trade table) exercises every system in tests.
- The stress map exercises performance.

| Pkg | Owns (disjoint) | Delivers | Tests |
|---|---|---|---|
| **P1** Transport | `server/app.js`, `scripts/precompress.mjs`, `vite.config.js`, `server/tests/static.test.js` | §9.2 item 1: br/gz precompression in a Vite `closeBundle` plugin; `content-encoding`, `Vary`, 304, immutable caching; hashed URLs | encoding negotiation, ETag/304, core payload ≤ 3 MB |
| **P2** Render loop | `client/src/scene/render.js`, `client/src/ui/labels.js`, `client/src/scene/fx.js`, `client/src/scene/grade.js` | items 2, 3, 4 and 7 (camera); label distance culling; emitters only within 60 m, each kind with its own pool | census deltas (P8) |
| **P3** Assets and packs | `client/src/scene/assets.js`, `scene/toon.js`, `scene/manifest/index.js`, `scene/manifest/core.js`, `client/src/ui/proc-icons.js`, `scripts/import-models.mjs`, `scripts/check-manifest.mjs` | items 5 and 6; bands blue/purple/dark/ice; `metal` capped at value < 0.7; per-slot `grade:false`; `PALETTES['space-kit']`; `ensureGroup()`; `registerIcons(town, map)` | `check-manifest` (every slot has a group and its file exists); programs ≤ 40, textures ≤ 24 MiB (census) |
| **P4** Chunks and statics | `client/src/scene/town.js`, `scene/chunkmerge.js`, `scene/procprops.js`, `scene/scatter.js`, `scene/skyline.js`, `scene/weather.js`, `server/tests/scatter.test.js` | items 7 (radius), 8, 9 and 10. Calls `groundAt(x,z,near)` and `BIOMES[...].cover` from M1, `weatherAt` from M1, and `water.setLakeColors` from P5. Node-state tint from snapshot `st` (1 gold, 2 violet). Exposes `rebuildChunksAround(x, z)` for the editor and `registerChunkStatic(list, builder)` so later lists (landmarks, outposts) stream with chunks. `scatterPoints(i, j, rules, near, seed)` is pure JS | scatter is deterministic and skips paths, plazas, buildings, nodes and lakes; build step ≤ 4 ms; Hearthvale's chunk props are unchanged (meadow has no cover rules) |
| **P5** Water | `client/src/scene/water.js` | item 11; `setSeaColors(shallow, deep)`, `setLakeColors(id, shallow, deep)`; `kind:'ice'` tint | census with 79 lands on the stress map |
| **P6** Characters | `client/src/scene/avatar.js`, `scene/mobs.js`, `scene/townsfolk.js`, `scene/tools.js` | item 13 | census: 9-hero crowd ≤ 400 draws |
| **P7** Server scale | `server/channel.js`, `server/static.js`, `server/move.js`, `shared/nav.js`, `shared/roads.js`, `server/tests/scale.test.js`, `server/tests/realtime.test.js`, `server/tests/bigworld.test.js` | item 12; per-entity `speedMul`; snapshot node `st`; calls `tickNodeStates` (M4); `ch.addMob(def, at)` / `ch.removeMob(id)` for elites | tick ≤ 2 ms p95 (stress map, 10 bots); Hearthvale→Starfall route ≤ 20 ms; nav memory < 0.5 MB after a crossing; sleep and wake |
| **P8** Perf gate and telemetry | `package.json`, `scripts/perf/*`, `scripts/gen-stress-map.mjs`, `maps/fixtures/stress.json`, `shared/budget.js`, `client/src/util/perfbeacon.js`, `server/telemetry.js`, `server/migrations/007_telemetry.js`, `server/tests/budget.test.js`, `server/tests/telemetry.test.js` | §9.4; `perf.sample` RPC; `gold_flow`/`item_flow` writers | estimator within 15% of the census; gold conserved and labelled |
| **M1** World model and biomes | `shared/world.js`, `shared/places.js`, `shared/biomes.js`, `shared/biomes/meadow.js`, `shared/biomes/wilds.js`, `shared/clock.js`, `client/src/scene/mood.js`, `client/src/util/ambience.js`, `server/tests/world.test.js`, `server/tests/biomes.test.js` | new lists (`landmarks`, `passages`, `skyline`) and fields (§1, §2) validated in `mapProblems`; region `kind:'outpost'`; indexed `townAt/regionAt/biomeAt`; `groundAt()`; the 1.5 s mood lerp and night tint; ambience presets | meadow and wilds equal today's constants; `biomeAt` for zone/region/default; the clock and weather are deterministic |
| **M2** Town services and travel | `shared/stations.js`, `server/crafting.js`, `server/travel.js`, `server/heroes.js`, `server/migrations/009_hero_world.js`, `client/src/scene/buildings.js`, `client/src/world/services.js`, `client/src/ui/dock.js`, `server/tests/travel.test.js`, `server/tests/towns.test.js` | nearest station by prop id; spot claims keyed by prop id; `town` recipe lock; `RECIPES[kit][style]` with an ftk fallback; home stone; `travel.home/party`, `passage.use`; nowarp refusal; toll (§6.3); the dock acts for the current town | craft at Testvale's anvil; a locked recipe is refused elsewhere; a passage needs its skill or kit; nowarp; the toll formula |
| **M3** Town economy | `server/market.js`, `server/shop.js`, `server/jobs.js`, `server/storage.js`, `server/trade.js`, `shared/economy.js`, `shared/shop.js`, `server/migrations/008_towns.js`, `client/src/ui/market.js`, `client/src/ui/shop-panels.js`, `client/src/ui/board.js`, `server/tests/economy.test.js`, `server/tests/shop.test.js`, `server/tests/jobs.test.js` | §6.1–6.3 and the §7.2 market/storage/supplier RPCs; `knob()` with overrides; per-town customers and demand weights | books isolated per town; the region gate; conservation through storage; floor and premium pools capped; ask > every bid; Hearthvale bid ≥ today's; a v6 save upgrades in place |
| **M4** Content engine | `shared/items.js`, `shared/monsters.js`, `shared/recipes.js`, `shared/nodes.js`, `shared/fishing.js`, `shared/crafting.js`, `shared/buffs.js`, `shared/perks.js`, `shared/sets.js`, `shared/content/index.js`, `server/battle.js`, `server/gather.js`, `server/gear.js`, `server/nodestates.js`, `client/src/ui/hero-panel.js`, `server/tests/fishing.test.js`, `server/tests/crafting.test.js`, `server/tests/combat.test.js`, `server/tests/progression.test.js` | item fields (§4.1); computed `QUALITY_BASES`; `mobStats`; elite restat; per-place fish tables and clamps; crafting tiers 5–7; buffs (use-counted); the perk vocabulary in battle and gather; sets; charm slot and `req`; rich/ancient states; the `use` RPC | windows reachable at tiers 5–7; tool speed floor; every legendary catchable by a scripted bot (≥ 60%) with its rod in its window; buffs count down only on use; perks and sets; the ±15% curve |
| **M5** Dungeon kinds | `shared/dungeon.js`, `server/dungeons.js`, `client/src/scene/dungeon.js`, `client/src/ui/dungeon-panels.js`, `scripts/dungeon-balance.js`, `server/tests/dungeon.test.js` | §4.7: kit and skin, per-kind tiers, Deep, Nightmare restat, `dustItem`, first clear once per (hero, kind) per day, featured kind, `MAX_RUNS` 24, crypt wording by kind | Testvale's cave kind generates and runs; first-clear cap; Nightmare stats equal `mobStats(46)` |
| **M6** Map pipeline and editor | `server/map.js`, `client/src/editor/editor.js`, `client/src/editor/kinds.js`, `scripts/world/lib.mjs`, `maps/patches/README.md`, `maps/fixtures/twotown.json`, `shared/content/testvale.js`, `server/tests/patches.test.js`, `server/tests/editor.test.js` | patch loader (§11.2); editor §8.2 (fields, palette, kinds, stamps, lints, budget meter, incremental rebuild, IndexedDB drafts, patch report); the Testvale fixture | a patch applies once; skips ids that already exist; never re-adds an entry the owner deleted; skips footprint collisions with a report; reachability over passages |
| **I1** Integration | `server/game.js`, `server/party.js`, `server/rooms.js`, `server/index.js`, `client/src/game.js`, `client/src/ui/hud.js`, `client/src/ui/panels.js`, `client/src/room.js`, `client/src/main.js`, `scripts/bots.js`, `README.md` | wires every module; town gate on RPCs; `RUN_RPC_OK` → `inRun`; `conColor` rule; `welcome` fields; region in party `where` | `npm test`; a bot run on Hearthvale and Testvale |

**Gate G1** (all must pass before any Phase 3 content):
- **Today's island**, phone profile:
  - default view ≤ 250 draws; worst framing ≤ 400; 9-hero crowd ≤ 400;
  - tris ≤ 150k (worst 220k);
  - textures ≤ 24 MiB; programs ≤ 40, all precompiled;
  - render JS ≤ 5 ms and update ≤ 2.5 ms (Xeon); ≤ 25 ms render at 4× throttle;
  - no long task over 50 ms on the walk spawn → Wilds → crypt door;
  - first load ≤ 3 MB compressed and ≤ 6 s at 10 Mbps.
- **The stress map** at the final coordinates passes the same budgets at every town square and road midpoint, with a server tick ≤ 2 ms p95 and 10 bots spread out.
- **The owner's mid-range Android** reports fps p50 ≥ 30 and p5 ≥ 20 in Hearthvale square (perf beacon).
- **Testvale** plays end to end in tests: its own book, storage, merchant, crafting, dungeon kind and biome lookup.
- **Hearthvale** plays exactly as before, apart from fog at 75 m on low.

### Phase 2: The guidance spine on today's island (8 parallel packages, about 4 days)
| Pkg | Owns | Delivers | Tests |
|---|---|---|---|
| **E1** Quests | `shared/quests.js`, `server/quests.js`, `server/migrations/010_quests.js`, `shared/content/hearthvale/quests.js`, `server/tests/quests.test.js` | §5.2 engine; `hv_intro`; the tutorial migration; `startGenerated(hero, def, period)` for the Almanac | event matching; rewards only on the server; heroes at tutorial 0–4 land on the right step; letters and nowarp |
| **E2** Compass and buttons | `shared/goals.js`, `client/src/ui/goalcard.js`, `client/src/ui/context.js`, `client/src/ui/results.js`, `client/src/ui/levelup.js`, `client/src/ui/battle-panels.js`, `scripts/smoke-mobile.cjs`, `server/tests/goals.test.js` | §5.3 in full; `goals.log` batching | never empty across 1,000 random states; the next-upgrade path; 15-point hysteresis; the context-button rule order |
| **E3** Journal and discovery | `shared/journal.js`, `server/journal.js`, `server/explore.js`, `server/landmarks.js`, `server/migrations/011_journal.js`, `client/src/ui/journal.js`, `client/src/ui/worldmap.js`, `client/src/ui/mapdraw.js`, `client/src/ui/banners.js`, `client/src/scene/landmarks.js`, `client/src/scene/interior.js`, `maps/patches/010_hearthvale_landmarks.json`, `server/tests/journal.test.js` | §5.5: bitmap, fog of war, region %, page rewards, landmark kinds, glimmers, Cartographer page logic, records and the shop trophy wall | once-only and weekly resets; 60/40 %; claims; bitmap re-projection; page chain order |
| **E4** Return and rest | `server/digest.js`, `server/notices.js`, `server/heroes.js`, `server/migrations/012_return.js`, `client/src/ui/digest.js`, `server/tests/digest.test.js` | §5.6 | the digest after 12 h; the rest pool formula; offline notices for job, order and fill events |
| **E5** Orders, Almanac, reputation | `shared/orders.js`, `server/orders.js`, `server/almanac.js`, `server/rep.js`, `server/migrations/013_orders.js`, `client/src/ui/board.js`, `client/src/ui/almanac.js`, `shared/content/hearthvale/orders.js`, `server/tests/orders.test.js`, `server/tests/almanac.test.js` | §5.4 for Hearthvale; the Big Order and Festive; rep points (ranks visible; unlocks come in Phase 5) | same seed for everyone; personal copies; at most 4 slots; 3-day expiry; pay reasons; at most 6 dailies; one reroll |
| **E6** Milestones | `shared/milestones.js`, `server/perks.js`, `client/src/ui/skills-panel.js`, `client/src/ui/hero-panel.js`, `server/tests/perks.test.js` | §4.8 milestone table to perk keys; level-40 choice and respec | every milestone maps to a vocabulary key; the respec price doubles to its cap; Grandmaster grants both choices |
| **E7** Engagement telemetry and owner tabs | `server/engage.js`, `server/owner.js`, `server/migrations/014_engage.js`, `client/src/ui/owner.js`, `server/tests/owner.test.js` | dead-air metric; `goal_log`; Economy, Performance and Engagement tabs; `owner.econ.set` with alarms (§6.5) | report snapshot; admin-only; overrides read through `knob()` |
| **I2** Integration | hub files, `shared/content/hearthvale/index.js`, `shared/content/hearthvale/items.js`, `scripts/bots.js`, `README.md` | wiring; Hearthvale additions (§4.5); bots that follow the Compass | — |

**Gate G2:**
- A scripted new player reaches level 5 with the Compass never empty (sampled every 2 s).
- Dead air is under 5% in 30-minute bot runs.
- The context button is never blank in a 10-minute mobile smoke run.
- A hero at tutorial 4 continues at step 5.
- The census is unchanged from G1 (±5%).

### Phase 3: The vertical slice: Amberfold and the Westmarch (4 parallel packages, about 5 days)
| Pkg | Owns | Delivers | Tests |
|---|---|---|---|
| **W1a** Amberfold content | `shared/content/amberfold/*.js` (index, items, nodes, monsters, recipes, fish, dungeon, quests, orders, trade, customers), `client/src/ui/proc-icons/amberfold.js`, `server/tests/content-amberfold.test.js` | all T2 rows of §4 and `af_intro` | every drop, input and spawn resolves; fight sims within ±15% of §4.2; node gates in band; ask > bid |
| **W1b** Amberfold world and art | `scripts/world/amberfold.mjs`, `maps/patches/020_amberfold.json`, `shared/biomes/autumn.js`, `client/src/scene/manifest/autumn.js`, `manifest/kit-cave.js`, `manifest/mobs-amberfold.js`, `client/src/scene/proc/amberfold.js`, `client/public/models/autumn/**`, `client/public/models/cave/**` | lands, regions and zones for westmarch/amberfold/amberwood; road; stones; town kit; lakes; nodes; camps; landmarks; skyline (oak, mill); Warren door; cover rules | census at 6 spots; budget meter green; the pack ≤ 400 KB gz; reachability |
| **W1c** Hearthvale gate and letters | `maps/patches/015_hearthvale_gates.json`, `shared/content/hearthvale/quests.js`, `shared/content/hearthvale/items.js` | `gate_west`, path extension, letters, `hv_intro` step 10 → `af_intro` | the patch applies to a copy of the owner's live map |
| **I3** Integration and balance | hub files, `shared/content/index.js`, `scripts/sim/fight.mjs`, `scripts/sim/gold.mjs`, `scripts/sim/pace.mjs`, `server/tests/world-content.test.js`, `CREDITS.md`, `ASSETS.md` | wiring; sims (ports of `scratchpad/world/spec/*.mjs`); content invariants: town kit present, density lints, ±15% curve, a source for every input, every resource and material used by at least one recipe, order template or project need (legendaries, trophies and letters exempt), every item tagged | — |

**Gate G3:**
- The census passes in Amberfold square, the yard, Amberwood, the Westmarch midpoint, the Elder Oak and the Warren door.
- First load is still ≤ 3 MB, and the Amberfold pack loads lazily.
- A bot walks Hearthvale → Amberfold with no long task over 50 ms.
- The owner's phone reports fps p50 ≥ 30 in Amberfold square.
- **A 2-hour playtest with friends** of `af_intro`, orders and the Warren.

### Phase 4: The rest of the world (5 parallel packages, about 6 days)
Each W package follows the W1a + W1b pattern for its towns and roads, owning only files under its own names:
- `shared/content/<town>/*`
- `client/src/ui/proc-icons/<town>.js`
- `scripts/world/<town>.mjs`
- its numbered patches
- `shared/biomes/<biome>.js`
- `client/src/scene/manifest/<biome>.js` and `manifest/mobs-<town>.js`
- `client/src/scene/proc/<town>.js`
- `client/public/models/<biome>/**`
- `server/tests/content-<town>.test.js`

| Pkg | Scope (patch) |
|---|---|
| **W2** | Rimeholt + Rimeholt Fells + Thornback road, pass_frozenfalls, Icefall Mine, alpine biome (`030_rimeholt`) |
| **W3** | Sandmere + the Dunesea + Midmarch East + Saltmarsh outpost, desert biome, Ashkar's Tomb (`040_sandmere`) |
| **W4** | Starfall + the Crater Rim + Skystair + Skystair outpost, pass_eyrie, pass_meltwater, crystal biome, Shard Vault (`050_starfall`) |
| **W5** | Fourways hub + Midmarch West + pass_ninefold + Hollowmere causeway with the broken bridge, `gate_north`, the bridgehead outpost, Pell, road fish tables, heath biome (`060_fourways`, `065_hollowmere`; `shared/content/fourways/*`) |
| **I4** | Integration and balance (the same files as I3); all towns added to `world-content.test.js`; census spot list |

**Gate G4:**
- Census at 3 spots per town and 2 per road (32 spots) within budget.
- Reachability, the 100 m rule and the 300 m stone rule are green.
- 10 bots spread across the world keep the tick ≤ 2 ms p95.
- The owner's phone reports fps p50 ≥ 30 in every town square.
- Intro chains from `af_intro` to `sf_intro` complete in a bot run.

### Phase 5: The living world (5 parallel packages, about 4 days)
| Pkg | Owns | Delivers | Tests |
|---|---|---|---|
| **L1** Elites and world effects | `shared/elites.js`, `shared/schedule.js`, `server/elites.js`, `client/src/ui/eventbanner.js`, `server/tests/elites.test.js` | §4.2 elites; twist world effects; Market Day; legendary windows on the Today strip | exactly one elite up (more on restless days); hp rescale when someone joins; loot for every fighter |
| **L2** Projects and Quartermaster | `shared/projects.js`, `server/projects.js`, `server/quartermaster.js`, `server/migrations/015_living.js`, `maps/patches/projects/*.json`, `client/src/ui/projects.js`, `client/src/ui/quartermaster.js`, `server/tests/projects.test.js` | §5.7 projects (patch unlocks through `saveMap` + `reloadWorld`); rep-rank unlocks; trophies → set pieces; charm II | target scaling; the unlock patch applies once; the bridge becomes walkable; rank gates |
| **L3** Feats, titles, saga | `shared/feats.js`, `server/feats.js`, `shared/content/saga.js`, `client/src/ui/titles.js`, `server/tests/feats.test.js` | 20 feats; nameplate titles; Five Hearths with server-wide hearth flags | firsts fire once; hearth flags persist |
| **L4** Cargo (optional) | `shared/cargo.js`, `server/cargo.js`, `client/src/ui/cargo.js`, `client/src/scene/cargo.js`, `server/tests/cargo.test.js` | §6.6; the crate on your back (1 draw); price-board cargo bids | caps; waystones refuse; no NPC loop |
| **I5** Integration | hub files, `README.md` | wiring, docs | — |

**Gate G5:**
- Every gate check above still holds.
- A one-week soak on the owner's server shows faucet/sink ≤ 1.5 and dead air < 5%.

---

## 11. Compatibility with existing saves and the existing map

### 11.1 Saves
- **Migrations add only.** Migrations 007–015 add tables or columns. `town` columns default to `'hearthvale'`, as does `heroes.home`. Existing orders, trades, shops and jobs become Hearthvale's.
- **NPC demand.** `npc_demand` is copied into `town_demand` and kept read-only for one release.
- **Tutorial.** `heroes.tutorial` maps to quest `hv_intro` at `min(tutorial, 4)`. Heroes who finished it continue at step 5 and get guidance on day one. The column is kept.
- **Journal backfill:**
  - recipes come from `craft_mastery`;
  - attuned stones count as found landmarks;
  - Hearthvale's cells are marked explored on first login.
  - Fish records start fresh.
- **Items.**
  - No item id changes, and every one of today's 17 quality bases stays in the computed `QUALITY_BASES` (tested).
  - `STARTER_EQUIP` gains `charm: null`, which the existing merge applies to old saves.
  - `req` is checked only when equipping.
- **Heroes.** Hero levels don't change (same formula). Positions stay valid (Hearthvale's land is unchanged). Attunements carry over.
- **Economy.** Hearthvale's merchant pays ≥ today's 0.6 on every tag until an item's shared floor pool (3,000 g per 8 h) is spent.

### 11.2 The map
**The shipped map.** `maps/world.json` is not modified and stays Hearthvale-only at rev 1.
- Hearthvale's region has no `biome` field, so it falls back to `meadow`.
- `meadow` has no cover rules, so its 720 hand-placed cover props stay the only cover.

New content ships as **id-keyed patches** in `maps/patches/NNN_*.json`:
```json
{ "id": "020_amberfold", "add": { "lands": [...], "regions": [...], "buildings": [...], "...": [] }, "remove": [] }
```

**Applying patches** (`server/map.js`):
1. Load as today: the map with the higher rev wins.
2. Run the patches in number order. Each patch runs once if its id is not already in `map.patches`:
   - add every entry whose id is not already used;
   - skip any entry whose footprint collides with an existing building or blocking prop, and log it in the patch report;
   - record the patch id in `map.patches`.
3. If anything changed, save through the existing `saveMap` path (rev bump, 30 backups).

**Properties:**
- Applying patches is idempotent.
- The owner's edits are never overwritten.
- Entries the owner deleted stay deleted, because the patch is already recorded.
- `remove` lists are allowed only in project unlock patches (`maps/patches/projects/`), which `server/projects.js` applies when a project completes. Then `game.reloadWorld()` reloads every client.

**Validation.** All new map fields are optional, so older format-2 maps load unchanged. `mapProblems` validates the new lists.

**Clients:**
- A protocol version bump forces a reload, and manifest groups are versioned by content hash.
- Old clients ignore unknown message types until they reload.

---

## 12. What we cut and why
| Cut | Why |
|---|---|
| Volcanic T5 (Cinderhold), lava water, and the swamp/tropical/coast/badlands packs | The hardest biomes in the asset brief. Crystal Starfall plus 6 other biomes give enough variety |
| Explorer: 8 outposts, Lantern Isles, Caldera Rim, Molten Deep T4–5, Expeditions and Seals, courier parcels, a shared town-order pool | Two to three times the content bill; duplicate daily systems. We keep 5 outposts at road stones |
| Engagement: Glass Flats outlaw region, hunter's horn, automatic governor, Almanac stamps and satchels, 60 feats, Starforge stars, auto-swapping trinkets, appetites below 0.6 in Hearthvale, per-hero floor cap, banking 12 orders, `gen` merge, Prism Deep T4, Salmon Run and Meteor Shower events | Sprawl, power creep, regressions or hidden state. Each is replaced above |
| Progression: the 0.95 km² ring, the daily 13-minute cargo routine, Ascended, Mythic tiers, charm tier III, 4 new crafting patterns, 120 h to hero 50 | Authoring load, chore-shaped loops and power creep. Crates survive as a small optional Phase 5 |
| Feasibility: the 0.25 km² four-town C as the size target | Undershoots "expansive, decent size" |
| Saltwind Ferry | Replaced by the Hollowmere bridge, which needs no sea-dock engine change |
| Vista fog lift | Breaks the fog-bound view budget; the vista keeps its pan and its map reveal |
| Tempering (def ↔ hp) and perk reforging | New mechanics with little gain; signature stations make town-locked recipes instead |
| Fish derby, festivals, push notifications, relief terrain | Later steps |

**If time runs short, cut in this order:**
1. L4 cargo
2. L3 feats beyond 10
3. Weather on low
4. The ambience motifs (keep sfx)
5. Glimmers
6. Charm II
7. The Nightmare rotation (keep Deep tiers)
8. Signature stations (fold their recipes into the base stations with `town` locks)
9. **Starfall ships as the Observatory project.** Friends build the road's end together and the town opens when it is done, so the cut becomes an event.

**Never cut:**
- the Phase 1 budgets and gate;
- Phase 0's seams and the map patches;
- the Compass, context button and result buttons;
- orders;
- the journal with discovery;
- per-town markets with storage and pooled faucets;
- telemetry and the perf beacon.
