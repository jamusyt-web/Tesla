// The current world's collision and navigation, rebuilt when the map changes
// (the world editor saves a new map). Read it through world(), never keep a copy.
import { NODES, buildColliders, NavGrid } from '../shared/world.js';
import './map.js'; // the world map is loaded before anything reads it

const build = () => {
  const col = buildColliders();
  return { nodes: NODES, col, nav: new NavGrid(col) };
};
let STATIC = build();
export const world = () => STATIC;
export const rebuildWorld = () => (STATIC = build());
