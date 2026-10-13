# Map patches

New content for the world map ships here as **patches**, so that a server
owner's own edits are never overwritten (SPEC §11.2).

A patch is a JSON file named `NNN_name.json` (three digits, then a name):

```json
{ "add": { "lands": [], "regions": [], "buildings": [], "props": [], "...": [] } }
```

Every entry needs an `id`. When the server starts it applies the patches in
number order. Each patch runs **once**:

- every entry whose id is new is added;
- an entry whose id is already on the map is skipped (the owner's version wins);
- a building or blocking prop that would overlap an existing building or
  blocking prop is skipped;
- the patch's id is then recorded in the map's `patches` list, so it never
  runs again. Anything the owner deletes later stays deleted.

If a patch added anything, the server saves the map as its own copy (with a
backup of the old one). The world editor's **Patches** button shows what
applied and what was skipped, and why.

`remove` lists are only allowed in project patches (`projects/`), which the
game applies when the town project that unlocks them is finished.

World-building scripts (`scripts/world/*.mjs`) write these files with the
helpers in `scripts/world/lib.mjs`.
