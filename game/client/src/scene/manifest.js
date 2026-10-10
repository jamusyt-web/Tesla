// Every external 3D model the game uses, by "slot". Swap any model by
// pointing its url at a different .glb (files live in client/public/models/).
// Sizing: `height` (metres), `width` (largest horizontal side), `fit: [x, z]`
// (fit inside a footprint), or a raw `scale`. `rotY` turns the model.
// A list of urls = random variants. Remove a slot to fall back to the
// built-in procedural version.
export const MODELS = {};
