import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coastTexture } from '../../client/src/scene/water.js';

// The sea reads the distance to the nearest shore from a texture baked at load.
test('coast distance texture matches the land circles', () => {
  const lands = [{ x: 0, z: 0, r: 96 }, { x: 150, z: 40, r: 60 }, { x: -400, z: 300, r: 30 }];
  const [x0, z0, size, res] = [-600, -600, 1200, 512];
  const data = coastTexture(lands, x0, z0, size, res).image.data;
  const h = size / res;
  let worst = 0;
  for (let j = 0; j < res; j += 7)
    for (let i = 0; i < res; i += 5) {
      const x = x0 + (i + 0.5) * h;
      const z = z0 + (j + 0.5) * h;
      const d = Math.min(...lands.map((l) => Math.hypot(x - l.x, z - l.z) - l.r));
      const got = (data[j * res + i] / 255) * 56 - 8;
      worst = Math.max(worst, Math.abs(Math.max(-8, Math.min(48, d)) - got));
    }
  assert.ok(worst < 0.15, `worst error ${worst}`);
});
