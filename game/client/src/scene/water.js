import * as THREE from 'three';

// Stylised water: shallow→deep colour by distance from the shore, drifting
// sparkles, and a wobbling foam line. `inner` water (lakes) foams at its rim;
// the sea foams around the island coast at `coast` radius.
export function waterMaterial({ radius, shallow = '#7fe0f7', deep = '#2f9fd8', foamAt = null, coast = null, fog = null, opacity = 0.9 }) {
  return new THREE.ShaderMaterial({
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    uniforms: {
      time: { value: 0 },
      radius: { value: radius },
      shallow: { value: new THREE.Color(shallow) },
      deep: { value: new THREE.Color(deep) },
      foamAt: { value: foamAt ?? -1 },
      coast: { value: coast ?? -1 },
      fogColor: { value: fog?.color?.isColor ? fog.color : new THREE.Color(fog?.color ?? '#cdeaf7') },
      fogNear: { value: fog?.near ?? 1e6 },
      fogFar: { value: fog?.far ?? 2e6 },
      opacity: { value: opacity },
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
      uniform float time, radius, foamAt, coast, fogNear, fogFar, opacity;
      uniform vec3 shallow, deep, fogColor;
      varying vec2 vP; varying float vDist;
      void main() {
        float r = length(vP);
        float ang = atan(vP.y, vP.x);
        vec3 c;
        float foam = 0.0;
        if (foamAt > 0.0) {
          // Lake: deep in the middle, shallow toward the rim, foam at the edge.
          float k = clamp(r / radius, 0.0, 1.0);
          c = mix(deep, shallow, smoothstep(0.25, 0.95, k));
          float edge = foamAt + sin(ang * 14.0 + time * 1.5) * 0.18 + sin(ang * 5.0 - time) * 0.12;
          foam = smoothstep(edge - 0.55, edge - 0.15, r) * (1.0 - smoothstep(edge + 0.2, edge + 0.6, r));
        } else {
          // Sea: shallow near the coast, deep further out, foam hugging the coast.
          float d = r - coast;
          c = mix(shallow, deep, smoothstep(0.0, 40.0, d));
          float wob = sin(ang * 40.0 + time * 1.2) * 0.35 + sin(ang * 13.0 - time * 0.7) * 0.4;
          foam = (1.0 - smoothstep(0.2, 1.6, abs(d - 0.5 - wob))) * 0.85;
          foam += (1.0 - smoothstep(0.1, 0.5, abs(d - 3.0 - wob - sin(time * 0.8) * 0.8))) * 0.35;
        }
        // Sparkles drifting across the surface.
        float sp = sin(vP.x * 1.7 + time * 1.3) * sin(vP.y * 1.9 - time * 1.1) * sin((vP.x + vP.y) * 0.9 + time * 0.6);
        c += vec3(pow(max(sp, 0.0), 10.0)) * 0.55;
        c = mix(c, vec3(1.0), clamp(foam, 0.0, 1.0) * 0.85);
        float f = smoothstep(fogNear, fogFar, vDist);
        gl_FragColor = vec4(c, opacity);
        #include <tonemapping_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
        #include <colorspace_fragment>
      }`,
  });
}

// The sea around any coastline: `lands` are the map's land circles (up to 64),
// so the shader can tell how far each point is from the nearest shore.
// `center` is the plane's position (it's laid flat, so local y is world -z).
export function seaMaterial({ lands, center, shallow = '#58a8bc', deep = '#1b4f74', fog = null }) {
  const MAX = 64;
  const arr = Array.from({ length: MAX }, (_, i) => (lands[i] ? new THREE.Vector3(lands[i].x, lands[i].z, lands[i].r) : new THREE.Vector3(0, 0, -1)));
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      lands: { value: arr },
      nLands: { value: Math.min(MAX, lands.length) },
      center: { value: new THREE.Vector2(center[0], center[1]) },
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
      uniform float time, fogNear, fogFar;
      uniform int nLands;
      uniform vec3 lands[${MAX}];
      uniform vec3 shallow, deep, fogColor;
      varying vec2 vW; varying float vDist;
      void main() {
        // Distance past the beach (the walkable edge plus ~5 m of sloping shore).
        float d = 1e6;
        for (int i = 0; i < ${MAX}; i++) {
          if (i >= nLands) break;
          d = min(d, length(vW - lands[i].xy) - lands[i].z);
        }
        d -= 5.2;
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
