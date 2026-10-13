// The light and air: fog, sky, sea, sun and ambient light, weather and the
// background music for the biome where the camera looks (shared/biomes.js).
// Moving into another biome blends everything over 1.5 s (all uniforms, so
// nothing recompiles). On a map with a clock the night tints it all (shared/
// clock.js). The crypt has its own light (setCrypt).
import * as THREE from 'three';
import { biome, LOW_FOG } from '../../../shared/biomes.js';
import { biomeAt } from '../../../shared/places.js';
import { nightness, weatherAt } from '../../../shared/clock.js';
import { MAP } from '../../../shared/world.js';
import { setSeaColors } from './water.js';
import { ambience } from '../util/ambience.js';

const BLEND_S = 1.5;
const NIGHT = new THREE.Color('#3a4270');
const COLORS = ['fog', 'hemiSky', 'hemiGround', 'sun', 'top', 'mid', 'bot', 'seaShallow', 'seaDeep'];

export class Mood {
  constructor(g) {
    this.g = g;
    this.biome = null; // where the camera looks
    this.from = null;
    this.to = null;
    this.k = 1; // how far the blend has come
    this.cur = null;
    this.night = -1;
    this.nextWeather = 0;
    this.townLight = null; // the town's light, kept while underground
  }

  // A biome's look, as numbers (phones see less far).
  #look(id) {
    const b = biome(id);
    const L = b.light;
    const low = this.g.low;
    const c = (v) => new THREE.Color(v);
    return {
      fog: c(L.fog), near: L.fogNear * (low ? LOW_FOG.near : 1), far: L.fogFar * (low ? LOW_FOG.far : 1),
      hemiSky: c(L.hemiSky), hemiGround: c(L.hemiGround), hemi: L.hemi, sun: c(L.sun), sunI: L.sunI, exposure: L.exposure,
      top: c(b.sky.top), mid: c(b.sky.mid), bot: c(b.sky.bot), seaShallow: c(b.sea.shallow), seaDeep: c(b.sea.deep),
    };
  }

  // Every frame, after the camera moved.
  update(dt = 0) {
    const g = this.g;
    const c = g.cam;
    if (g.dungeon) {
      // Fog just past the hero.
      g.scene.fog.near = c.curDist + 8;
      g.scene.fog.far = c.curDist + 34;
      return;
    }
    const id = biomeAt(c.target.x, c.target.z);
    if (id !== this.biome) {
      this.biome = id;
      this.to = this.#look(id);
      this.from = this.cur ? { ...this.cur, ...Object.fromEntries(COLORS.map((k) => [k, this.cur[k].clone()])) } : this.to;
      this.k = this.cur ? 0 : 1;
      this.cur ??= { ...this.to, ...Object.fromEntries(COLORS.map((k) => [k, this.to[k].clone()])) };
      ambience.set(biome(id).ambience);
    }
    const now = g.sock?.serverNow?.() ?? Date.now();
    const n = MAP?.clock ? Math.round(nightness(now) * 200) / 200 : 0;
    if (this.k >= 1 && n === this.night) return this.#weather(now);
    this.k = Math.min(1, this.k + dt / BLEND_S);
    this.night = n;
    const e = THREE.MathUtils.smoothstep(this.k, 0, 1);
    const C = this.cur;
    for (const k of COLORS) C[k].lerpColors(this.from[k], this.to[k], e);
    for (const k of ['near', 'far', 'hemi', 'sunI', 'exposure']) C[k] = this.from[k] + (this.to[k] - this.from[k]) * e;
    // Apply, with the night's tint on top.
    const f = g.scene.fog;
    f.color.copy(C.fog).lerp(NIGHT, 0.35 * n);
    f.near = C.near;
    f.far = C.far;
    g.hemi.color.copy(C.hemiSky).lerp(NIGHT, 0.35 * n);
    g.hemi.groundColor.copy(C.hemiGround).lerp(NIGHT, 0.35 * n);
    g.hemi.intensity = C.hemi;
    g.sun.color.copy(C.sun);
    g.sun.intensity = C.sunI;
    g.renderer.toneMappingExposure = C.exposure * (1 - 0.15 * n);
    const sky = g.town?.sky?.material.uniforms;
    if (sky) for (const k of ['top', 'mid', 'bot']) sky[k].value.copy(C[k]).lerp(NIGHT, 0.35 * n);
    setSeaColors(C.seaShallow, C.seaDeep);
    this.#weather(now);
  }

  // Weather for the biome where the camera looks (checked every few seconds).
  #weather(now) {
    if (now < this.nextWeather || !this.g.weather) return;
    this.nextWeather = now + 5000;
    const w = weatherAt(this.biome, now);
    this.g.weather.set(w?.kind ?? null, w?.rate);
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
      this.townLight = null;
      this.night = -1; // the town's look is applied afresh
      this.k = 1;
    }
    g.el.classList.toggle('in-dungeon', crypt);
  }
}
