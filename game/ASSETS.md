# Art & 3D models

Hearthvale mixes three kinds of art:

| What | Where it comes from | Change it by |
|---|---|---|
| **Your hero** (body, hair, outfits, hats, tools in hand) | Built in code: `client/src/scene/avatar.js`, `tools.js` | Options in `shared/avatar.js`, tool skins in `shared/items.js` |
| **World models** (trees, rocks, buildings, props, creatures, item icons) | `.glb` files in `client/public/models/`, listed in `client/src/scene/manifest.js` | Editing the manifest (below) |
| **Everything else** (ground, water, sky, effects, UI) | Built in code: `client/src/scene/town.js`, `fx.js`, `style.css` | Code |

Every imported model is drawn with the game's own look: cel shading, ink outlines and a warm colour grade (`client/src/scene/assets.js`). That's why models from different sources still feel like one game.

## Swapping in your own model (or one from an AI generator)

1. Export it as **.glb** (binary glTF). Most tools can: Blender, Meshy, Tripo, Higgsfield, Kenney Shape, MagicaVoxel and others.
   - Keep it Y-up. The loader re-centres it and stands it on the ground, so its origin doesn't matter.
   - Keep it light. Scenery should be roughly under 5,000 triangles; heroes and monsters under 15,000.
   - Animated creatures: name the clips `idle`, `walk`, `attack`, `hit`, `die` where you can.
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
