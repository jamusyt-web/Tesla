// Skyline beacons: far landmarks (a giant oak, a mill, a beacon tower) seen
// as flat cards past the fog, so a town far off still shows on the horizon.
// All cards are one instanced draw; their pictures are rendered once, at load,
// into a 512×256 atlas (4 × 2 cells of 128 px), from each card's model slot.
//
// Map list `skyline` (at most 6): { id, kind, x, z, h, card: '<model slot>' }.
// A card fades in beyond the fog's far edge and is fully there 20 m further
// out; nearer than that the real landmark (drawn by its chunk) takes over.
// The camera draws nothing past fog far + 10 m, so a card further out is
// drawn closer along the same line of sight, shrunk to the same size on screen.
import * as THREE from 'three';
import * as assets from './assets.js';

const CELLS = [4, 2];
const MAX = CELLS[0] * CELLS[1];

function renderAtlas(renderer, cards) {
  const rt = new THREE.WebGLRenderTarget(512, 256);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#e8eef6', '#6b5a48', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), scissor: renderer.getScissorTest() };
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setScissorTest(true);
  cards.forEach((c, i) => {
    const made = assets.make(c.card, { outline: false, castShadow: false });
    if (!made) return;
    const s = made.size;
    const half = Math.max(s.x, s.y, s.z) * 0.55;
    cam.left = -half;
    cam.right = half;
    cam.top = half * 2 - 0.1;
    cam.bottom = -0.1;
    cam.position.set(0, half, 20);
    cam.lookAt(0, half, 0);
    cam.updateProjectionMatrix();
    scene.add(made.object);
    const x = (i % CELLS[0]) * 128;
    const y = (CELLS[1] - 1 - Math.floor(i / CELLS[0])) * 128;
    renderer.setViewport(x, y, 128, 128);
    renderer.setScissor(x, y, 128, 128);
    renderer.render(scene, cam);
    scene.remove(made.object);
  });
  renderer.setScissorTest(prev.scissor);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  return rt;
}

// Returns { object, update(camera, fogFar) } or null when the map has no cards.
export function buildSkyline(renderer, scene, cards) {
  cards = (cards ?? []).filter((c) => assets.has(c.card)).slice(0, Math.min(6, MAX));
  if (!cards.length) return null;
  const rt = renderAtlas(renderer, cards);
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const cell = new Float32Array(cards.length * 2);
  const alpha = new Float32Array(cards.length);
  cards.forEach((c, i) => ((cell[i * 2] = i % CELLS[0]), (cell[i * 2 + 1] = CELLS[1] - 1 - Math.floor(i / CELLS[0]))));
  geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cell, 2));
  const alphaAttr = new THREE.InstancedBufferAttribute(alpha, 1);
  alphaAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('alpha', alphaAttr);
  const mat = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: rt.texture } },
    vertexShader: `attribute vec2 cell; attribute float alpha; varying vec2 vUv; varying float vA;
      void main(){ vUv = (uv + cell) / vec2(${CELLS[0]}.0, ${CELLS[1]}.0); vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying float vA;
      void main(){ vec4 c = texture2D(atlas, vUv); if (c.a * vA < 0.02) discard; gl_FragColor = vec4(c.rgb, c.a * vA); }`,
    transparent: true,
    depthWrite: false,
  });
  const im = new THREE.InstancedMesh(geo, mat, cards.length);
  im.frustumCulled = false;
  im.renderOrder = -1;
  scene.add(im);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  return {
    object: im,
    update(cam, fogFar) {
      const c0 = cam.position;
      cards.forEach((c, i) => {
        const dx = c.x - c0.x;
        const dz = c.z - c0.z;
        const dist = Math.hypot(dx, dz);
        alpha[i] = THREE.MathUtils.smoothstep(dist, fogFar, fogFar + 20);
        // Drawn just inside the far plane, at the size it would have out there.
        const k = Math.min(1, (cam.far - 6) / Math.max(dist, 1));
        p.set(c0.x + dx * k, c0.y + (0 - c0.y) * k, c0.z + dz * k);
        q.setFromAxisAngle(up, Math.atan2(c0.x - c.x, c0.z - c.z)); // facing the camera
        s.set(c.h * k, c.h * k, 1);
        im.setMatrixAt(i, m.compose(p, q, s));
      });
      im.instanceMatrix.needsUpdate = true;
      alphaAttr.needsUpdate = true;
    },
  };
}
