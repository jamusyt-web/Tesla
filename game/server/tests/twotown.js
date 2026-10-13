// Two towns for tests: the fixture map maps/fixtures/twotown.json (Hearthvale
// plus Testvale at (400, 0); made by scripts/world/twotown.mjs) and the
// Testvale content pack (shared/content/testvale.js), installed into the
// live tables for a test and taken out again afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TESTVALE from '../../shared/content/testvale.js';
import { installPack, uninstallPack } from '../../shared/content/install.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'maps', 'fixtures', 'twotown.json');
export const TV = { x: 400, z: 0 };

// The fixture map. Without `cave`, the cave's door is left out (it needs the pack).
export function twoTownMap({ cave = false } = {}) {
  const m = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (!cave) m.entrances = m.entrances.filter((e) => e.kind !== 'testvale_cave');
  return m;
}

// Put Testvale's content into the game's tables (and take it out again).
export const installTestvale = () => installPack(TESTVALE);
export const uninstallTestvale = () => uninstallPack(TESTVALE);
