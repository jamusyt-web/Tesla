// The light and air: fog, sky light and sun colour for where the camera is.
// The Wilds are hazier, greener-grey and a touch dimmer than town; the crypt
// is dark blue-grey with a cool moon overhead. (Phase 1, M1: biomes, the 1.5 s
// lerp and night tint live here.)
import * as THREE from 'three';
import { zonesOfKind } from '../../../shared/world.js';

const MOOD = { fog: new THREE.Color('#b8c4c8'), fogWild: new THREE.Color('#9faea6'), sun: new THREE.Color('#ffe4bc'), sunWild: new THREE.Color('#ffd0a0') };
// Phones see a little less far (and the camera draws nothing past the fog).
const LOW_NEAR = 0.9;
const LOW_FAR = 0.75;

export class Mood {
  constructor(g) {
    this.g = g;
    this.w = undefined; // how far into the Wilds (0–1); undefined = work it out afresh
    this.townLight = null; // the town's light, kept while underground
  }

  // Every frame, after the camera moved.
  update() {
    const g = this.g;
    const c = g.cam;
    if (g.dungeon) {
      // Fog just past the hero.
      g.scene.fog.near = c.curDist + 8;
      g.scene.fog.far = c.curDist + 34;
      return;
    }
    let w = 0;
    for (const zn of zonesOfKind('wilds')) w = Math.max(w, 1 - THREE.MathUtils.smoothstep(Math.hypot(c.target.x - zn.x, c.target.z - zn.z), zn.r * 0.2, zn.r));
    if (w === this.w) return;
    this.w = w;
    const f = g.scene.fog;
    f.color.lerpColors(MOOD.fog, MOOD.fogWild, w);
    f.near = (20 - 6 * w) * (g.low ? LOW_NEAR : 1);
    f.far = (100 - 30 * w) * (g.low ? LOW_FAR : 1);
    g.hemi.intensity = 1.3 - 0.25 * w;
    g.sun.color.lerpColors(MOOD.sun, MOOD.sunWild, w);
  }

  // Crypt light: dark blue-grey fog, a cool moon overhead, a touch more exposure.
  setCrypt(crypt) {
    const g = this.g;
    const f = g.scene.fog;
    if (crypt) {
      this.townLight ??= { fog: f.color.clone(), near: f.near, far: f.far, hemi: [g.hemi.color.clone(), g.hemi.groundColor.clone(), g.hemi.intensity], sun: [g.sun.color.clone(), g.sun.intensity], exp: g.renderer.toneMappingExposure, clear: g.renderer.getClearColor(new THREE.Color()) };
      f.color.set('#1b1e27');
      // (Not scene.background: that would clear the screen on each of the frame's three passes.)
      g.renderer.setClearColor(f.color);
      g.hemi.color.set('#a9b8d6');
      g.hemi.groundColor.set('#6a5546');
      g.hemi.intensity = 1.35;
      g.sun.color.set('#c9d6ff');
      g.sun.intensity = 1.0;
      g.renderer.toneMappingExposure = 1.25;
    } else if (this.townLight) {
      const T = this.townLight;
      f.color.copy(T.fog);
      f.near = T.near;
      f.far = T.far;
      g.renderer.setClearColor(T.clear);
      g.hemi.color.copy(T.hemi[0]);
      g.hemi.groundColor.copy(T.hemi[1]);
      g.hemi.intensity = T.hemi[2];
      g.sun.color.copy(T.sun[0]);
      g.sun.intensity = T.sun[1];
      g.renderer.toneMappingExposure = T.exp;
      this.w = undefined; // the Wilds' haze is worked out afresh
    }
    g.el.classList.toggle('in-dungeon', crypt);
  }
}
