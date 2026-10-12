# Art & 3D models

Hearthvale mixes three kinds of art:

| What | Where it comes from | Change it by |
|---|---|---|
| **Your hero** (body, hair, outfits, hats, tools in hand) | Built in code: `client/src/scene/avatar.js`, `tools.js` | Options in `shared/avatar.js`, tool skins in `shared/items.js` |
| **World models** (trees, rocks, buildings, props, creatures, item icons) | `.glb` files in `client/public/models/`, listed in `client/src/scene/manifest.js` | Editing the manifest (below) |
| **Everything else** (ground, water, sky, effects, UI) | Built in code: `client/src/scene/town.js`, `fx.js`, `style.css` | Code |

*Where* things stand in the world is separate from what they look like: positions live in the world map, `maps/world.json` (see the README). A prop there names a model slot from the manifest, so swapping a slot's model changes every copy placed in the map.

Every imported model is drawn with the game's own look: cel shading, ink outlines and a colour grade (`client/src/scene/assets.js`, plus the whole-screen grade in `client/src/scene/grade.js`). That's why models from different sources still feel like one game.

## Swapping in your own model (or one from an AI generator)

1. Export it as **.glb** (binary glTF). Most tools can: Blender, Meshy, Tripo, Higgsfield, Kenney Shape, MagicaVoxel and others.
   - Keep it Y-up. The loader re-centres it and stands it on the ground, so its origin doesn't matter.
   - Keep it light. Scenery should be roughly under 5,000 triangles; heroes and monsters under 15,000.
   - Animated creatures: name the clips `idle`, `walk`, `attack`, `hit`, `die` where you can. Without an `attack` or `hit` clip the game animates a lunge or knockback itself.
2. Put the file in `client/public/models/custom/`, for example `client/public/models/custom/my-oak.glb`.
3. In `client/src/scene/manifest.js`, point the slot at it and give it a size:

   ```js
   tree_oak: { url: '/models/custom/my-oak.glb', height: 4.8 },
   ```

   - **Sizing:** use `height` (metres), `width` (the largest horizontal side), `fit: [x, z]` (fit inside a footprint), or a raw `scale`.
   - **Turning:** `rotY` turns the model.
   - **Variants:** a list of urls gives random variants.
   - **Fallback:** delete a slot to go back to the built-in version.
4. Reload. If the file is missing or broken, the game logs a warning and uses the built-in fallback, so nothing breaks.

### Recolouring without a 3D editor

- **`recolor: { materialName: '#hex' }`**: repaints named materials. Use this for models with plain colours per material.
- **`remap: [{ band, to: '#hex' }]`**: repaints a model that takes its colours from a small palette image, as most Kenney packs do.
  - `band` picks which colours to change: `metal`, `red`, `orange`, `yellow`, `green`, `white` or `warm`.
  - Leave `band` out to tint the whole model.
  - Light and dark shades are kept.
  - Example: `axe_gold` is the iron axe with `remap: [{ band: 'metal', to: '#ffd23f' }]`.
- **`texture: '/models/…/palette.png'`**: swaps in a different palette image with the same layout. This is how each building gets its own roof colour.
- **`glowBand: { band, color, amount }`**: makes only part of a model glow, such as a lantern's glass.
- **`heights: [..]`**: gives each variant its own size.

### Item icons

The pictures in the bag, market and workshop are rendered from 3D models, once, when first shown.

- **Using a model:** give an item a model through a slot named `icon:<itemId>`, e.g. `'icon:oak_log'`. Turn it for its portrait with `pose: [x, y, z]` (degrees).
- **Built in code:** a few icons that no pack has are built in `client/src/ui/proc-icons.js`: fishing rods, the leather vest, the amulet, the acorn and the metal bars.
- **Fallback:** an item with neither shows its emoji.

To make your own icon, add an `icon:<itemId>` slot pointing at your .glb. A manifest slot always wins over the code-built icon.

### Buildings

Buildings are snapped together from Kenney's modular Fantasy Town Kit pieces in `client/src/scene/buildings.js`: walls, roofs and chimneys on a grid.

The Wilds gate is assembled from castle-kit pieces the same way.

- **Replacing a building:** to use a single model of your own instead, have `buildModular()` return your model for that building id. Keep it inside the building's footprint (`w` × `d` in `maps/world.json`), because that footprint is what players collide with.

### Dungeons

Dungeon runs are built from Kenney's **Modular Dungeon Kit** (`client/public/models/modular-dungeon/`) by `client/src/scene/dungeon.js`, on a 4 m grid: `template-floor` (plus two detail variants) for every floor cell, `template-wall` / `template-wall-detail-a` on every floor edge that meets rock, `template-wall-corner` (scaled up) in the inside corners, `gate-metal-bars` in each doorway a room's monsters guard (its `gate` part is the bars that sink into the floor), `gate` as the open arch at the far end of each corridor, and `stairs` (squashed into one cell) as the way out.

- **Pivots matter:** these pieces are loaded *raw* (no re-centering), because the wall's pivot sits on its face and the floor tile is centred. A replacement must keep the same size and pivot: a wall is 4 m wide with its face on z = 0 and its body behind it (towards −z), about 4.15 m tall.
- **No ink outlines** on the kit pieces (`outline: false`): the walls are open panels, and an outline shell would cover their faces.
- **Colours:** the kit's lavender stone is warmed to grey stone with a `remap` (`CRYPT_STONE` in the manifest); the graveyard fire baskets and lanterns get dark iron and a glowing flame (`CRYPT_IRON`).
- **Dressing** uses the `dg_*` slots (brazier, altar, chests, coffins, pillars, urns, banners, rubble, traps, lanterns), mostly from the Graveyard Kit and Mini Dungeon. The generator in `shared/dungeon.js` decides where each goes; the manifest decides what it looks like.
- **Monsters:** `mob_thrall` (graveyard zombie), `mob_crypt_skeleton`, `mob_crypt_wisp` (the ghost, tinted blue) and `mob_pale_count` (the vampire, the boss).
- **The crypt door** in the overworld is `crypt_base` + `crypt_roof` + `crypt_door` (Graveyard Kit `crypt-large`), with `dg_fire` braziers and `crypt_grave` gravestones, built in `client/src/scene/town.js`.

## Re-importing asset packs

The third-party models were copied in with:

```bash
node scripts/import-models.mjs <folder-of-unzipped-packs>
```

It copies only the models the manifest uses, plus their textures, and writes `client/public/models/CREDITS.md`.

To browse a pack in the game's style first, render contact sheets:

```bash
node scripts/asset-sheet.mjs "<pack>/Models/GLB format" sheets/<pack>
```

This needs Playwright, as a dev tool only.

## Licenses

The current packs are by Kenney (kenney.nl) and are **CC0**: free for commercial use, changes allowed, no credit required. We credit them anyway in `client/public/models/CREDITS.md`.

The HUD icons in `client/public/ui/icons/` come from [game-icons.net](https://game-icons.net) (by Lorc, Delapouite and contributors) under **CC BY 3.0**, which requires credit. The credit line sits at the bottom of the Town Hall panel; keep it if you add or swap icons. To add one, take its SVG (any colour; the game recolours it), save it as `client/public/ui/icons/<name>.svg` and use `glyph('<name>')` from `client/src/ui/glyphs.js`. (The `key`, `crypt`, `stairs` and `fire` icons were drawn for Hearthvale itself.)
