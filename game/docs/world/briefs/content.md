# Brief: content and progression systems (researcher 3 of 6)

Scope: the content tables in `shared/`, how they gate progress, where the island's content runs out, and what has to change to add tiers 4 and 5 for new towns. All numbers come from the code. I re-checked the derived figures (xp curve, kill counts, fight sims, source/use maps) with `scratchpad/world/content/calc.mjs`, which imports the real modules. Anything marked **(est.)** is an estimate, and anything marked **(proposal)** is my suggestion, not current behaviour.

---

## 1. What exists today

### 1.1 Resources and materials, by tier (`shared/items.js:24-62`, sources from `world.js` NODE_TYPES, `monsters.js`, `dungeon.js` CHESTS)

| Tier | id (value g, rarity) | Source | Used in |
|---|---|---|---|
| 1 | `oak_log` (4) | tree_oak | oak_plank, copper_bar, grilled_fish |
| 1 | `stone` (3) | rock_stone, rock_copper | stone_brick only |
| 1 | `copper_ore` (8) | rock_copper; goblin 0.5, crab 0.45 | copper_bar |
| 1 | `mint_leaf` (5) | herb_mint | fish_stew, health_potion |
| 1 | `minnow` (6), `perch` (10) | fishing; perch also crab 0.5 | grilled_fish / fish_stew |
| 1 | `slime_gel` (7), `wolf_pelt` (15) | slime 0.9, grub 0.4 / wolf, boar, bear | health_potion / leather |
| 2 | `birch_log` (9) | tree_birch | birch_plank, iron_bar |
| 2 | `iron_ore` (16, unc) | rock_iron; golem 0.8, skeleton 0.7, crypt_skeleton 0.2, vault chest | iron_bar |
| 2 | `sunpetal` (11, unc) | herb_sun; grub 0.5 | moon_elixir |
| 2 | `trout` (16, unc) | fishing | rod_fine |
| 2 | `goblin_coin` (25, unc) | goblin 0.6, skeleton 0.5 | amulet_sapphire |
| 2 | `grave_dust` (18, unc) | crypt mobs 0.35, Pale Count 1.0, every crypt chest | wraith_blade, barrow_plate, ghostlight_amulet |
| 3 | `pine_log` (18, unc) | tree_pine | gold_bar |
| 3 | `gold_ore` (34, rare) | rock_gold | gold_bar |
| 3 | `moonbloom` (24, rare) | herb_moon; ghost 0.6 | moon_elixir, ghostlight_amulet |
| 3 | `pike` (45, rare) | fishing | rod_master |
| 3 | `golem_core` (80, rare) | golem 0.35, bear 0.08, boss chest | sword_gold |
| rare | `golden_acorn` (120), `sapphire` (150, epic), `golden_koi` (90, epic), `lake_king` "Old Whiskers" (420, legendary), `old_boot` (1) | tree rares, rock rares + ghost 0.03 + chests, fishing | axe_gold / pick_gold + amulet / moon_elixir / **nothing** / **nothing** |
| mats | `oak_plank` 10, `stone_brick` 8, `copper_bar` 22, `leather` 34 (T1); `birch_plank` 22, `iron_bar` 42 (T2); `gold_bar` 85 (T3) | workbench, grindstone, forge (leather also drops from boar 0.6) | `stone_brick` has **no use** |

Consumables (all they do is `heal`): grilled_fish 30 hp (18 g), fish_stew 45 (30 g), health_potion 60 (30 g), moon_elixir 150 (110 g).

### 1.2 Tools (`items.js:71-81`)
| Tool | tier | power | speed ms | value |
|---|---|---|---|---|
| axe_wood / copper / iron / gold | 1/2/3/4 | 1/2/3/5 | 700/620/560/500 | 15/90/240/650 |
| pick_wood / copper / iron / gold | 1/2/3/4 | 1/2/3/5 | 720/640/580/520 | 15/90/240/650 |
| rod_basic / rod_fine / rod_master | 1/2/3 | (unused) | none | 15/160/720 |

Quality (`items.js:102-120`): Fine and Masterwork apply ×1.15 / ×1.3 to atk, def and hp (at least +1 / +2), ×0.95 / ×0.9 to speed, add +0.015 / +0.03 to rod zone, and ×1.4 / ×2.2 to value. **`power` is not scaled.**

### 1.3 Gear (3 slots only: weapon / armor / trinket)
| Item | atk | def | hp | value | recipe lvl | notes |
|---|---|---|---|---|---|---|
| sword_wood "Training Sword" | 4 | | | 12 | starter | |
| sword_copper | 9 | | | 110 | 3 | |
| sword_iron | 16 | | | 260 | 6 | |
| wraith_blade "Wraithsteel Blade" | 19 | | | 430 | 7 | perk `quickSpecial` (special needs 2 charges, not 3) |
| sword_gold "Sunforged Blade" | 26 | | | 700 | 10 | Masterwork version: atk 34 |
| armor_leather "Leather Vest" | | 4 | | 90 | 3 | |
| barrow_plate | | 8 | 35 | 400 | 7 | |
| armor_iron "Iron Plate" | | 10 | | 320 | 7 | **this is the best armor in the game** |
| ghostlight_amulet | 2 | 2 | 20 | 320 | 6 | perk `mender` (heals ×1.4) |
| amulet_sapphire | 5 | 5 | 40 | 520 | 9 | |

### 1.4 Monsters (`shared/monsters.js:3-80`). `lvl` is only shown on screen (name colour, map label). No logic reads it.
| id | lvl | hp | atk | def | xp | gold | drops |
|---|---|---|---|---|---|---|---|
| slime | 1 | 40 | 6 | 1 | 14 | 4-9 | slime_gel .9 |
| caterpillar (Thornback Grub) | 2 | 55 | 8 | 2 | 20 | 5-11 | sunpetal .5, slime_gel .4 |
| crab | 3 | 70 | 10 | 5 | 26 | 7-14 | perch .5, copper_ore .45 |
| wolf | 4 | 85 | 12 | 3 | 32 | 9-18 | wolf_pelt .85 |
| ghost (Barrow Wisp) | 5 | 95 | 15 | 3 | 42 | 12-22 | moonbloom .6, sapphire .03 |
| boar | 6 | 130 | 18 | 6 | 52 | 14-26 | leather .6, wolf_pelt .4 |
| goblin | 7 | 150 | 19 | 6 | 60 | 18-35 | goblin_coin .6, copper_ore .5 |
| skeleton | 9 | 210 | 24 | 9 | 95 | 26-45 | iron_ore .7, goblin_coin .5 |
| bear (Rimefang) | 10 | 300 | 27 | 11 | 125 | 32-55 | wolf_pelt .9, golem_core .08 |
| golem (boss) | 11 | 420 | 30 | 12 | 160 | 50-90 | golem_core .35, iron_ore .8 |
| crypt: thrall 4, crypt_skeleton 5, crypt_wisp 5, pale_count 8 (boss, telegraphed Blood Mist) | | 80/100/95/360 | 12/14/15/20 | 3/6/3/7 | 24/30/30/160 | | grave_dust .35 (boss 1.0) |

Rough fit for the overworld mobs: hp ≈ 22·lvl (bosses ~38·lvl), atk ≈ 2.6·lvl + 2, def ≈ lvl, xp ≈ 9–12·lvl (boss ~14·lvl), gold ≈ [3·lvl, 5·lvl]. Island camps (`maps/world.json`): slime 6, wolf 5, goblin 4, golem 2, grub 4, crab 4, ghost 3, boar 4, skeleton 3, bear 2.

Hero (`monsters.js:83`): atk = 8 + 2·heroLvl + 2·combatLvl + gear, def = 2 + heroLvl + gear, hp = 90 + 12·heroLvl + gear. `damage = max(1, round((atk·mult − 0.6·def)·U(0.88,1.12)))`. Special ×2.4, crit 12% ×1.6, defend ×0.35. Out-of-battle regen is 4 hp/s (`channel.js:38`).

### 1.5 Fish (`shared/fishing.js:18-40`)
| id | d | kg | behaviour | xp | value | weight shallow / deep |
|---|---|---|---|---|---|---|
| old_boot | 4 | .4-.9 | floater | 3 | 1 | 7 / 7 |
| minnow | 12 | .05-.3 | smooth | 9 | 6 | 48 / 18 |
| perch | 24 | .3-1.4 | smooth | 14 | 10 | 30 / 22 |
| trout | 40 | .8-3.2 | dart | 22 | 16 | 14·luck / 24·luck |
| pike | 64 | 2-9 | mixed | 40 | 45 | 3·luck / 10·luck |
| golden_koi | 74 | 1-4 | dart | 70 | 90 | 1·luck / 2.5·luck |
| lake_king | 92 | 18-60 | mixed | 180 | 420 | 0 / 0.6·luck, only with rod tier 2 or better |

luck = 1 + 0.04·fishLvl + 0.6·(rodTier−1). The **one global table** depends only on rod tier, level and whether the spot is deep (`isDeepSpot`: inside `lake.deep`). There is one lake (Mirror Lake) and one node type, `fish_spot` (6 spots). `fishingGear` clamps the rod tier to 3 and the level to 20 (`fishing.js:160-162`).

### 1.6 Recipes by station (`shared/recipes.js:4-38`). Crafting "tier" = `recipeTier` (lvl ≤2 → 1, ≤5 → 2, ≤8 → 3, otherwise 4)
- **workbench**: oak_plank L1 (2 oak), birch_plank L3 (2 birch), leather L2 (2 pelt), armor_leather L3 (3 leather), rod_fine L5 (3 birch_plank, 1 iron_bar, 2 trout), rod_master L8 (2 gold_bar, 3 birch_plank, 2 pike).
- **grindstone**: stone_brick L1 (2 stone), ghostlight_amulet L6, amulet_sapphire L9 (sapphire, 2 gold_bar, 3 goblin_coin).
- **forge**: copper_bar L2 (2 ore + 1 oak), iron_bar L5 (2 ore + 1 birch), gold_bar L8 (2 ore + 1 pine).
- **anvil**: axe/pick_copper L3 (3 bar, 2 oak_plank), axe/pick_iron L6 (4 iron_bar, 2 birch_plank), axe_gold L10 (+golden_acorn) / pick_gold L10 (+sapphire), sword_copper L3, sword_iron L6, sword_gold L10 (+golem_core), armor_iron L7, wraith_blade L7, barrow_plate L7.
- **cookpot**: grilled_fish L1, fish_stew L2, health_potion L2, moon_elixir L9 (2 moonbloom, 2 sunpetal, 1 golden_koi).

Batch caps (`crafting.js:93`): materials up to min(25, 5 + 2·(lvl−1)), consumables up to min(10, 2 + lvl), tools and gear 1. Refining barely adds value (iron_bar: inputs worth 41 g, output 42 g; gold_bar: 86 g in, 85 g out). Crafting pays in XP and grade bonus, not in margin.

---

## 2. The progression curve and where it stops

`xpForLevel(L)` = Σ floor(40·i^1.6) for i < L (`skills.js:14`). `MAX_LEVEL = 50`. Hero level = `levelFromXp(totalSkillXp / 2)`.

| L | total xp | to next | | L | total | to next | | L | total | to next |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 40 | | 11 | 6,937 | 1,854 | | 21 | 39,569 | 5,219 |
| 2 | 40 | 121 | | 12 | 8,791 | 2,131 | | 22 | 44,788 | 5,622 |
| 3 | 161 | 231 | | 13 | 10,922 | 2,423 | | 23 | 50,410 | 6,037 |
| 4 | 392 | 367 | | 14 | 13,345 | 2,728 | | 24 | 56,447 | 6,462 |
| 5 | 759 | 525 | | 15 | 16,073 | 3,046 | | 25 | 62,909 | 6,898 |
| 6 | 1,284 | 703 | | 16 | 19,119 | 3,377 | | 26 | 69,807 | 7,345 |
| 7 | 1,987 | 899 | | 17 | 22,496 | 3,722 | | 27 | 77,152 | 7,802 |
| 8 | 2,886 | 1,114 | | 18 | 26,218 | 4,078 | | 28 | 84,954 | 8,270 |
| 9 | 4,000 | 1,345 | | 19 | 30,296 | 4,446 | | 29 | 93,224 | 8,747 |
| 10 | 5,345 | 1,592 | | 20 | 34,742 | 4,827 | | 30 | 101,971 | 9,235 |

(Level 50 needs 391,742 xp.) One skill going from 10 to 20 costs 29,397 xp, 5.5× the cost of 1 to 10. **Hero level 14 = all six skills at 10** (6 × 5,345 / 2 = 16,035, just short of 16,073 for hero level 15).

Actions needed to reach skill 10 on a single source: oak 764, birch 357, pine 168; stone 891, copper 486, iron 243, gold 128; moonbloom 243; goblins 90, skeletons 57, golems 34. Crafting is the fastest skill because batching multiplies XP: one gold_bar batch at crafting 8 is 19 × 28 = 532 xp before the grade multiplier (up to ×1.4).

**What a hero does at each level** (skill gates from NODE_TYPES, recipe `lvl`, dungeon `rec`):
- **1–3**: oak, stone, mint, minnows and perch; slimes, grubs and crabs; oak planks, bricks, grilled fish, then copper bars, leather and potions at crafting 2.
- **3–5**: birch (forage 4), copper vein (mining 2), sunpetal (herb 3); wolves and ghosts. Copper axe, pick and sword plus the Leather Vest at crafting 3. Iron vein at mining 5 (needs a copper pick). Hollow Crypt tier 1 is recommended at level 5, and a toast fires at combat 5 (`hud.js:235`).
- **5–8**: iron bars and the Angler Rod (crafting 5), iron tools and sword (6), Ghostlight Amulet (6), Iron Plate and the crypt gear (7). Boar 6, goblin 7, moonbloom (herb 7). Crypt tier 2 is recommended at 8.
- **8–10**: pine (forage 8, needs a tier-2 axe), gold vein (mining 8, needs a tier-3 pick), gold bars and the Starcatcher Rod (8), skeleton 9, Moon Elixir and the Sapphire Amulet (9), bear 10.
- **10–12**: golden tools and the Sunforged Blade (crafting 10), golem boss 11, crypt tier 3 recommended at 12.
- **12+**: **nothing new unlocks.** The last gates are forage 8, mining 8, herb 7, crafting 10, monster level 11 and crypt tier 3. Fishing has no level gates at all. Past that, the only goals left are Masterwork rolls, the weekly crypt leaderboard, rare drops (Old Whiskers, sapphires) and trading.

**The ceiling is skill ~10 / hero ~12–15**, against a cap of 50. Passive growth beyond it: `doubleChance` stops rising at level 26 (50%), the fishing zone stops improving at fishing level 20, and crafting windows only ease at 5 and 15 levels over a recipe.

Fight sim (hero level = combat level, typical gear for that level, mid rolls, mob move ×1.2):
- L7 with iron sword and plate: golem takes 10 rounds and costs 129% of hp, so it is not soloable.
- L11 with Sunforged Blade, Iron Plate and Sapphire Amulet (atk 83, def 28, hp 262): golem takes 6 rounds and costs 36% of hp. Every other island mob dies in 1–4 rounds.
- L15: atk 99, def 32, hp 310. Fully Masterwork at L15: atk 109, def 34, hp 368.

New tier-4 monsters therefore have to start around those stats.

**Time estimate (est.):** about 300 trees for forage 10, about 90–150 fights for combat 10. One dedicated player probably "finishes" the island in roughly 8–15 hours of play. Node supply is shared and limited: 8 pines with a 40 s respawn give at most about 12 pine logs' worth of nodes per minute for the whole server.

---

## 3. How to add new tiers: every place that must change

### 3.1 Resource / material item
1. Add an `ITEMS` entry (`items.js:24-96`): `{ name, icon (emoji fallback), cat, value, rarity }`.
2. Add a 3D icon: a manifest slot `'icon:<id>'` (`client/src/scene/manifest.js:235-277`; recolor or remap an existing Kenney model, the way the ores use `NK('rock_smallE')` with a new `grass` colour, logs use a remap of `tree-log-small`, and swords remap the `metal` band) **or** an entry in `PROC_ICONS` (`client/src/ui/proc-icons.js:179`; `ingot(color)` for bars). Without either, the emoji shows. Today grave_dust, wraith_blade, barrow_plate and ghostlight_amulet have no 3D icon.
3. Optional: add it to an NPC customer's `likes` list (`shared/shop.js` CUSTOMERS; Sir Gareth, Old Tom, Chef Basil and Ranger Fen each list items by id). The NPC demand cap is derived from value automatically (test at `shop.test.js:137`).

### 3.2 Gathering node
1. Add a `NODE_TYPES` entry (`world.js:289-301`): `{ kind: tree|rock|herb|fish, tool, skill, name, hp, tier (min tool tier), lvl, xp, respawn, r, drops, rare }`. Map validation (`mapProblems`) and the editor palette (`editor/kinds.js:68,169`) pick it up automatically.
2. Add a client model: manifest slot `<type>` (and `<type>_stump` for trees) at `manifest.js:100-117`. **The procedural fallback is keyed by type name** (`town.js` `#buildProcedural`): it only knows `tree_oak`, `tree_birch`, `tree_pine`, `rock_*`, `herb_*` and exactly `fish_spot`. A new tree or fish-spot type without a model renders as **nothing, with no tap target**.
3. Ore crystal colours are hard-coded twice (`town.js:85` and `town.js:165-166`); stump colours at `town.js:102`; tree height at `town.js:67` (only `tree_pine` is tall).
4. The server error text assumes the tool is an axe or a pickaxe (`server/game.js:689-690`).

### 3.3 Tools
- Add the item with `tool`, `tier`, `power` and `speed`, plus a `skin` (handle/head/edge/glow), which drives the in-hand model (`client/src/scene/tools.js`: axe blade size `0.85 + tier·0.1`, a spike at tier ≥ 3, pick arc thickness by tier). Add the base to **`QUALITY_BASES`** (`items.js:107`, an explicit list) or it gets no Fine/Masterwork versions. Add an icon slot.
- **Speed floor:** `world.test.js:139` requires `(SWING_GATE − SWING_FLOOR)·P > 80 ms`, so P > 421 ms. Masterwork multiplies speed by 0.9, so **a new base tool speed must be at least 469 ms**. Gold is already 500/520, so speed has almost no room left and progression must come from `power`.
- **Rods:** `fishingGear` clamps the tier to 3 (`fishing.js:160`) and the bite window is `900 + tier·200` (`game.js:762`). A tier-4 rod does nothing until that clamp is raised and the zone cap (0.42) is revisited.

### 3.4 Gear
Add an `ITEMS` entry with `slot`, `atk/def/hp`, optional `perk` (the engine only understands `quickSpecial` and `mender`: `game.js:84`, `channel.js:363`), a `skin` for weapons, an entry in `QUALITY_BASES`, an icon and a recipe. **There is no level requirement to equip** (`game.js:846-855`), so a level-1 player can buy any blade off the market. With more tiers this matters more. (proposal) Add a `req: { combat: N }` field checked in `equip()`. Armor and trinkets are not drawn on the avatar (no armor code in `client/src/scene/`).

### 3.5 Monsters
Add a `MONSTERS` entry `{ name, lvl, hp, atk, def, xp, gold: [a,b], color, drops, moves: [{name, mult, aoe?, drain?}], boss?, telegraph? }`. Add a camp in `maps/world.json` `spawns` (the editor lists all MONSTERS). Add a model slot `mob_<id>` (`manifest.js:184-196`); without it, `mobs.js:38-40` uses a method named after the type if one exists, otherwise a tinted slime. Map validation does **not** check monster ids in spawns.

### 3.6 Fish (needs code)
A new fish = a `FISH` entry, an `ITEMS` entry and an icon. **There is no per-place table:** `fishTable()` lists ids inline (`fishing.js:29-40`), and the server call is `rollFish(rng, rodTier, lvl, isDeepSpot(node))` (`channel.js:175`). (proposal) Add `lakes[].fish` (a table id in the map) or a `table` key on new `fish_spot_*` node types (each needs its own visual: see 3.2). Then pass it through `rollFish`, make `fishTable(table, ...)` data-driven, and keep the Old Whiskers style "legendary per lake" pattern. Also update `game.js:816`, which hard-codes `old_boot` and `lake_king` as not doubling.

### 3.7 Recipes and stations
- Recipes are pure data (`recipes.js`). `crafting.test.js:9,69,81` replays every recipe automatically. A new `pattern` needs a `PATTERNS` entry and `STEP_TEXT` skins (`crafting.js:36-83`).
- **Difficulty stops at tier 4:** `recipeTier` (`crafting.js:90`) and the `WIN/LEAD/SWEEP_H/PRESS_F` tables (`:18-21`) only have keys 1–4, so a level-20 recipe plays like a level-9 one. Adding tier 5 means extending all four tables and `recipeTier`, and keeping the test "every window reachable" (`crafting.test.js:81`) passing.
- **Stations are single instances:** `stations.js:6` uses `PROPS.find((p) => p.station === id)`, so `spotsOf` and `stationPos` always return **the first forge or anvil in the world**. `Crafting.start` then fails with "Walk up to the Anvil first" (`server/crafting.js:93`) at any other town's workshop, and spot claims are keyed by station type (`ch.spots`). Workshops in new towns need a "nearest station prop of this type" lookup, with spot claims keyed by prop id. `inYard` already handles many stations.

### 3.8 Dungeon kinds
- Data: add `DUNGEONS[kind] = { name, blurb, pool, elite, boss: { monster, adds } }` and `CHESTS[kind] = { vault, boss }` (`dungeon.js:22,132`), plus an `entrances` entry in the map.
- Hard-coded crypt assumptions to fix:
  - `rollChest` always adds `grave_dust` (`dungeon.js:166`); make it `C.dustItem`.
  - `TIERS` (1–3) are shared by all kinds, and their `rec.gear` text names crypt-era gear (`dungeon.js:32-36`). A kind needs its own tier list or a level offset.
  - Room dressing slots are crypt-only (`dg_coffin`, `dg_urn`, `dg_altar`… in `dungeon.js:374-400`; models at `manifest.js:198-226` with `CRYPT_STONE`).
  - The entrance building uses the `CRYPT` footprint and `crypt_*` models (`world.js:238`, `manifest.js:226-229`).
  - The default kind `'hollow_crypt'` appears in `server/game.js:1098`, `client/src/ui/dungeon-panels.js:28`, `client/src/game.js:1934` and `editor/kinds.js:180`.
  - "Crypt" wording: `dungeon-panels.js:58`, `hud.js:235`, "Bone Key" (`server/dungeons.js:376`), crypt fog (`client/src/game.js:1681`).
  - The run cap `MAX_RUNS = 16` is global across all kinds.
- Unlocks: `bestTier(heroId, kind)` is already per kind (`game.js:461`).

### 3.9 Towns and regions
`regions[].tier` only drives labels: `TIER_NAMES = ['', 'Starter', 'Novice', 'Adept', 'Veteran', 'Elite']` (`mapdraw.js:5`), five names ready for five towns. The NPC sell rate (`NPC_SELL_RATE 0.6`, `game.js:31`), the market and the NPC demand pools are all global today, so town price differences would be new code (another brief's topic).

---

## 4. Gaps, and conventions to keep

**Gaps**
1. **Tier-4 tools gate nothing.** The highest node tier is 3 (rock_gold); pine only needs tier 2. axe_gold and pick_gold are speed/power upgrades only.
2. **Armor stops at Iron Plate (def 10, crafting 7).** There is no gold or epic armor and no tier-4 armor, and Barrow Plate (8 def + 35 hp) is arguably better than Iron Plate. There are only two trinkets and three gear slots.
3. **Dead-end items:** `stone_brick` (and so `stone`) has no recipe use; `lake_king` and `old_boot` are sell-only. Trout and pike are each used once (rods). Every consumable is a plain heal: there are no buffs, foods for gathering, or lures.
4. **Content ends at skill ~10 of 50** (section 2). Every 1→10 curve is reused, but 10→20 costs 5.5× as much with no new sources.
5. **Fishing has no places:** one global table, one node type, no level gates, and the rod tier is clamped at 3.
6. **Crafting difficulty is capped at tier 4,** and stations are single-instance (3.7).
7. **No equip requirements,** and the monster level shown on screen is compared to the *hero* level (`client/src/game.js:552`), which a pure crafter inflates.
8. **No item is a "town currency".** Grave Dust is the one place-specific reagent pattern, and it works well: dungeon drop → 3 signature gear pieces. It is worth repeating per town.

**(proposal) Shape for towns 2–5, one tier each.** Keep Hearthvale as tiers 1–3 (levels 1–12). Each new town then adds:
- one tree, one ore (+ a bar), one herb, 2–3 fish with a legendary;
- 3–4 monsters and a boss;
- a dungeon with its own "dust" reagent and three signature gear pieces;
- a weapon, armor and trinket tier, a tool tier and a rod tier;
- 1–2 foods or potions.

Level bands: town 2 ≈ 10–18, town 3 ≈ 16–24, town 4 ≈ 22–30, town 5 ≈ 28–36. Continue the existing ratios:
- Node xp about ×2 per tier (7→15→32 trees, 11→22→42 ores), giving ~65 / 120 / 220. Node hp ≈ xp/1.5–2.
- Tool power 5 → 7 → 9 → 12, with speed held at ≥ 470 ms.
- Weapon atk 26 → 36 → 48 → 62 → 78. Armor def 10 → 16 → 22 → 29 → 36 (+hp). Trinket hp 40 → 70 → 100.
- Monsters on the fit in 1.4 (hp ≈ 22·lvl, atk ≈ 2.6·lvl + 2, def ≈ lvl, xp ≈ 10·lvl, gold ≈ [3·lvl, 5·lvl]).
- Item value about ×2 per tier (logs 4/9/18 → 36/70; bars 22/42/85 → 170/340).
- Dungeon tiers per kind, with `rec.level` set inside the town's band.

**Conventions to keep**
- **ids:** snake_case. Material prefixes such as `copper_`, `iron_`, `gold_` (`<metal>_bar`, `<metal>_ore`, `sword_<metal>`, `axe_<metal>`, `pick_<metal>`). Quality variants are `<base>~fine` / `~master`. Node types are `tree_*`, `rock_*`, `herb_*`. Model slots are `mob_<id>`, `icon:<id>` and `<node>_stump`.
- **Names:** plain English, evocative for higher tiers ("Sunforged Blade", "Starcatcher Rod", "Ruinwarden Golem", "Old Whiskers"). Monster names follow a "Place/trait + creature" pattern ("Timber Wolf", "Barrow Wisp", "Rimefang Bear").
- **Rarity ladder:** common → uncommon → rare → epic by tier; legendary only for one-off trophies.
- Every item gets an emoji `icon` as a fallback, plus a cheap recolour/remap icon slot. Avoid new GLB files where a remap works, since that keeps mobile download size down.
- Content is data in `shared/`. The server is authoritative for all rolls (`grantGather`, `#reward`, `rollChest`, `outcomeOf`). Comments are written in plain English.
