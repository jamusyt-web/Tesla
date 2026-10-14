// Weather: falling leaves, snow, rain, drifting dust or night sparkles, as one
// GPU-animated Points draw in a box that follows the camera. The positions
// never change on the CPU: each particle's fall and sway come from time in the
// vertex shader, wrapped into the box around the camera.
//
// const w = new Weather(g); w.set('snow', 0.8); w.set(null) clears it.
// (Which weather a place has comes from its biome; see BIOMES[...].weather.)
import * as THREE from 'three';

const KINDS = {
  leaves: { color: '#d9792f', color2: '#e8b13d', size: 6, fall: 1.1, sway: 1.4, spin: 1 },
  snow: { color: '#ffffff', color2: '#e4efff', size: 6, fall: 1.4, sway: 0.6, spin: 0 },
  rain: { color: '#a9c4dc', color2: '#cddcea', size: 4, fall: 14, sway: 0.05, spin: 0, streak: 1 },
  dust: { color: '#e2c99a', color2: '#f0dcb8', size: 4, fall: -0.1, sway: 2.2, spin: 0 },
  sparkle: { color: '#fff6c8', color2: '#d8d0ff', size: 5, fall: -0.2, sway: 0.3, spin: 0, twinkle: 1 },
};
const BOX = [36, 18, 36]; // metres around the camera

const vert = `
uniform float time, fall, sway, size, rate;
uniform vec3 origin, box;
attribute vec4 seed;
varying float vA;
varying float vMix;
void main() {
  if (seed.w > rate) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = seed.xyz * box;
  p.y -= time * fall * (0.7 + seed.w * 0.6);
  p.x += sin(time * 0.9 + seed.w * 40.0) * sway;
  p.z += cos(time * 0.7 + seed.w * 31.0) * sway;
  // wrap into the box centred on the camera
  p = mod(p - origin + box * 0.5, box) - box * 0.5 + origin;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * (0.6 + seed.w * 0.8) * (30.0 / max(1.0, -mv.z));
  vA = 1.0 - smoothstep(0.35, 0.5, length(p.xz - origin.xz) / box.x);
  vMix = fract(seed.w * 7.0);
}`;
const frag = `
uniform vec3 color, color2;
uniform float streak, twinkle, time;
varying float vA;
varying float vMix;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  if (streak > 0.5) q.x *= 4.0;
  float d = length(q);
  if (d > 0.5) discard;
  float a = vA * (1.0 - smoothstep(0.3, 0.5, d));
  if (twinkle > 0.5) a *= 0.5 + 0.5 * sin(time * 6.0 + vMix * 50.0);
  gl_FragColor = vec4(mix(color, color2, vMix), a * 0.9);
}`;

export class Weather {
  constructor(g, { count } = {}) {
    this.g = g;
    this.n = count ?? (g.low ? 700 : 1400);
    this.kind = null;
    this.points = null;
    this.ready = null;
  }

  #make() {
    const seeds = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n * 4; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    const u = (v) => ({ value: v });
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: u(0), fall: u(1), sway: u(1), size: u(6), rate: u(1), origin: u(new THREE.Vector3()), box: u(new THREE.Vector3(...BOX)), color: u(new THREE.Color()), color2: u(new THREE.Color()), streak: u(0), twinkle: u(0) },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.renderOrder = 2;
    this.points = pts;
    this.g.scene.add(pts);
    // Compile before it's ever seen (no mid-game shader hitch).
    this.ready = Promise.resolve(this.g.renderer.compileAsync?.(pts, this.g.camera, this.g.scene)).catch(() => {});
  }

  // kind: 'leaves' | 'snow' | 'rain' | 'dust' | 'sparkle' | null; rate 0–1.
  set(kind, rate = 0.6) {
    if (!kind || !KINDS[kind]) {
      this.kind = null;
      if (this.points) this.points.visible = false;
      return;
    }
    if (!this.points) this.#make();
    this.kind = kind;
    const k = KINDS[kind];
    const U = this.points.material.uniforms;
    U.color.value.set(k.color);
    U.color2.value.set(k.color2);
    U.fall.value = k.fall;
    U.sway.value = k.sway;
    U.size.value = k.size;
    U.rate.value = Math.max(0, Math.min(1, rate));
    U.streak.value = k.streak ?? 0;
    U.twinkle.value = k.twinkle ?? 0;
    this.ready.then(() => this.kind === kind && (this.points.visible = true));
  }

  update(dt) {
    if (!this.points?.visible) return;
    const U = this.points.material.uniforms;
    U.time.value += dt;
    U.origin.value.copy(this.g.camera.position);
  }
}
