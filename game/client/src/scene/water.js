import * as THREE from 'three';

// Colours that a biome can change at any time (and that are kept for water
// built later, as chunks stream in): the sea's, and each lake's by id.
let seaMat = null;
let seaColors = null;
const lakeMats = new Map(); // lake id → its material (the latest built)
const lakeColors = new Map(); // lake id → [shallow, deep]
export function setSeaColors(shallow, deep) {
  seaColors = [shallow, deep];
  if (seaMat) seaMat.uniforms.shallow.value.set(shallow), seaMat.uniforms.deep.value.set(deep);
}
export function setLakeColors(id, shallow, deep) {
  lakeColors.set(id, [shallow, deep]);
  const m = lakeMats.get(id);
  if (m) m.uniforms.shallow.value.set(shallow), m.uniforms.deep.value.set(deep);
}

// Stylised water: shallow→deep colour by distance from the shore, drifting
// sparkles, and a wobbling foam line at the rim. A lake of kind 'ice' is
// frozen: pale, still, with a frosty rim. (All lakes share one shader.)
export function waterMaterial({ id = null, radius, shallow = '#7fe0f7', deep = '#2f9fd8', foamAt = null, fog = null, opacity = 0.9, ice = false }) {
  [shallow, deep] = lakeColors.get(id) ?? [shallow, deep];
  const m = new THREE.ShaderMaterial({
    transparent: !ice && opacity < 1,
    depthWrite: ice || opacity >= 1,
    uniforms: {
      time: { value: 0 },
      radius: { value: radius },
      shallow: { value: new THREE.Color(shallow) },
      deep: { value: new THREE.Color(deep) },
      foamAt: { value: foamAt ?? radius },
      ice: { value: ice ? 1 : 0 },
      fogColor: { value: fog?.color?.isColor ? fog.color : new THREE.Color(fog?.color ?? '#cdeaf7') },
      fogNear: { value: fog?.near ?? 1e6 },
      fogFar: { value: fog?.far ?? 2e6 },
      opacity: { value: ice ? 1 : opacity },
    },
    vertexShader: `
      varying vec2 vP; varying float vDist;
      void main() {
        vP = position.xy;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time, radius, foamAt, ice, fogNear, fogFar, opacity;
      uniform vec3 shallow, deep, fogColor;
      varying vec2 vP; varying float vDist;
      void main() {
        float t = time * (1.0 - ice); // ice holds still
        float r = length(vP);
        float ang = atan(vP.y, vP.x);
        // Deep in the middle, shallow toward the rim, foam (or frost) at the edge.
        float k = clamp(r / radius, 0.0, 1.0);
        vec3 c = mix(deep, shallow, smoothstep(0.25, 0.95, k));
        float edge = foamAt + sin(ang * 14.0 + t * 1.5) * 0.18 + sin(ang * 5.0 - t) * 0.12;
        float foam = smoothstep(edge - 0.55, edge - 0.15, r) * (1.0 - smoothstep(edge + 0.2, edge + 0.6, r));
        // Ice: pale and milky, with a few long cracks.
        float crack = 1.0 - smoothstep(0.0, 0.06, abs(sin(vP.x * 0.45 + sin(vP.y * 0.3) * 2.0)) * abs(sin(vP.y * 0.37 - vP.x * 0.12)));
        c = mix(c, mix(vec3(0.86, 0.93, 0.98), c, 0.35) - crack * 0.12, ice);
        foam = mix(foam, foam * 0.6 + smoothstep(radius * 0.8, radius, r) * 0.25, ice);
        // Sparkles drifting across the surface.
        float sp = sin(vP.x * 1.7 + t * 1.3) * sin(vP.y * 1.9 - t * 1.1) * sin((vP.x + vP.y) * 0.9 + t * 0.6);
        c += vec3(pow(max(sp, 0.0), 10.0)) * (0.55 + ice * 0.3);
        c = mix(c, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
        float f = smoothstep(fogNear, fogFar, vDist);
        gl_FragColor = vec4(c, opacity);
        #include <tonemapping_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
        #include <colorspace_fragment>
      }`,
  });
  if (id != null) lakeMats.set(id, m);
  return m;
}

// How far each point of the sea is from the nearest shore, baked once into a
// texture (1 byte a texel, -8 to 48 m), so the sea shader reads it instead of
// looping over every land circle per pixel (and any number of lands works).
const D0 = -8;
const D1 = 48;
export function coastTexture(lands, x0, z0, size, res = 1024) {
  const data = new Uint8Array(res * res).fill(255);
  const h = size / res;
  const B = 32; // texels per block: blocks far from every coast stay "deep"
  for (let bj = 0; bj < res; bj += B)
    for (let bi = 0; bi < res; bi += B) {
      const bx0 = x0 + bi * h;
      const bz0 = z0 + bj * h;
      const bx1 = bx0 + B * h;
      const bz1 = bz0 + B * h;
      const near = lands.filter((l) => Math.hypot(Math.max(0, bx0 - l.x, l.x - bx1), Math.max(0, bz0 - l.z, l.z - bz1)) - l.r < D1);
      if (!near.length) continue;
      const i1 = Math.min(res, bi + B);
      const j1 = Math.min(res, bj + B);
      // Deep inland (every corner well inside one land): all "land".
      const inside = near.some((l) => Math.max(Math.hypot(bx0 - l.x, bz0 - l.z), Math.hypot(bx1 - l.x, bz0 - l.z), Math.hypot(bx0 - l.x, bz1 - l.z), Math.hypot(bx1 - l.x, bz1 - l.z)) < l.r + D0);
      if (inside) {
        for (let j = bj; j < j1; j++) data.fill(0, j * res + bi, j * res + i1);
        continue;
      }
      const nx = near.map((l) => l.x);
      const nz = near.map((l) => l.z);
      const nr = near.map((l) => l.r);
      const k = 255 / (D1 - D0);
      for (let j = bj; j < j1; j++) {
        const z = z0 + (j + 0.5) * h;
        for (let i = bi; i < i1; i++) {
          const x = x0 + (i + 0.5) * h;
          let d = Infinity;
          for (let n = 0; n < nx.length; n++) {
            const dx = x - nx[n];
            const dz = z - nz[n];
            const e = Math.sqrt(dx * dx + dz * dz) - nr[n];
            if (e < d) d = e;
          }
          data[j * res + i] = d <= D0 ? 0 : d >= D1 ? 255 : Math.round((d - D0) * k);
        }
      }
    }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// The sea around any coastline: `lands` are the map's land circles. The
// plane is `size` wide at `center` (laid flat, so local y is world -z).
export function seaMaterial({ lands, center, size, shallow = '#58a8bc', deep = '#1b4f74', fog = null }) {
  [shallow, deep] = seaColors ?? [shallow, deep];
  const x0 = center[0] - size / 2;
  const z0 = center[1] - size / 2;
  seaMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      coast: { value: coastTexture(lands, x0, z0, size) },
      center: { value: new THREE.Vector2(center[0], center[1]) },
      origin: { value: new THREE.Vector2(x0, z0) },
      size: { value: size },
      shallow: { value: new THREE.Color(shallow) },
      deep: { value: new THREE.Color(deep) },
      fogColor: { value: fog?.color?.isColor ? fog.color : new THREE.Color(fog?.color ?? '#cdeaf7') },
      fogNear: { value: fog?.near ?? 1e6 },
      fogFar: { value: fog?.far ?? 2e6 },
    },
    vertexShader: `
      varying vec2 vW; varying float vDist;
      uniform vec2 center;
      void main() {
        vW = center + vec2(position.x, -position.y);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time, fogNear, fogFar, size;
      uniform sampler2D coast;
      uniform vec2 origin;
      uniform vec3 shallow, deep, fogColor;
      varying vec2 vW; varying float vDist;
      void main() {
        // Distance past the beach (the walkable edge plus ~5 m of sloping shore).
        float d = texture2D(coast, (vW - origin) / size).r * ${(D1 - D0).toFixed(1)} + ${D0.toFixed(1)} - 5.2;
        vec3 c = mix(shallow, deep, smoothstep(0.0, 40.0, d));
        float wob = sin(vW.x * 0.45 + vW.y * 0.2 + time * 1.2) * 0.35 + sin(vW.y * 0.31 - vW.x * 0.12 - time * 0.7) * 0.4;
        float foam = (1.0 - smoothstep(0.2, 1.6, abs(d - 0.5 - wob))) * 0.85;
        foam += (1.0 - smoothstep(0.1, 0.5, abs(d - 3.0 - wob - sin(time * 0.8) * 0.8))) * 0.35;
        float sp = sin(vW.x * 1.7 + time * 1.3) * sin(vW.y * 1.9 - time * 1.1) * sin((vW.x + vW.y) * 0.9 + time * 0.6);
        c += vec3(pow(max(sp, 0.0), 10.0)) * 0.55;
        c = mix(c, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
        float f = smoothstep(fogNear, fogFar, vDist);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
        #include <colorspace_fragment>
      }`,
  });
  return seaMat;
}

// A soft tiling grass/dirt speckle texture to break up flat ground colours.
export function groundTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Soft blotches.
  for (let i = 0; i < 70; i++) {
    const r = 10 + rnd() * 26;
    const px = rnd() * S;
    const py = rnd() * S;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const v = rnd() > 0.5 ? 255 : 228;
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        x.save();
        x.translate(ox, oy);
        x.fillStyle = g;
        x.fillRect(px - r, py - r, r * 2, r * 2);
        x.restore();
      }
  }
  // Tiny grass strokes.
  for (let i = 0; i < 900; i++) {
    const px = rnd() * S;
    const py = rnd() * S;
    const v = 205 + Math.floor(rnd() * 40);
    x.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + (rnd() - 0.5) * 3, py - 2 - rnd() * 4);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(36, 36);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
