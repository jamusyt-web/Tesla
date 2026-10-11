import * as THREE from 'three';
import { h, clear } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { Avatar } from '../scene/avatar.js';
import { AVATAR_OPTIONS, DEFAULT_AVATAR, randomAvatar, NAME_RE } from '../../../shared/avatar.js';
import { toon } from '../scene/toon.js';
import { useGrade } from '../scene/grade.js';

const LABELS = {
  skin: 'Skin', hairStyle: 'Hair', hairColor: 'Hair color', eyes: 'Eyes', eyeColor: 'Eye color',
  outfit: 'Outfit', outfitColor: 'Outfit color', pantsColor: 'Pants', hat: 'Hat', back: 'Back',
};
const ORDER = ['skin', 'hairStyle', 'hairColor', 'eyes', 'eyeColor', 'outfit', 'outfitColor', 'pantsColor', 'hat', 'back'];

// Full-screen character creator with a live, spinnable 3D preview.
// mode 'create' asks for a name; mode 'edit' just saves the look.
export function openCreator(root, { mode = 'create', initial = null, onDone, onCancel }) {
  let cfg = { ...DEFAULT_AVATAR, ...(initial || (mode === 'create' ? randomAvatar() : {})) };
  const canvasWrap = h('div.stage');
  const nameIn = h('input', { placeholder: 'Hero name', maxLength: 16, value: '' });
  const err = h('div.err');
  const opts = h('div');
  const saveBtn = h('button.btn.green.big', { style: { flex: 1 } }, mode === 'create' ? 'Begin your journey' : 'Save appearance');
  const el = h(
    'div.creator',
    canvasWrap,
    h(
      'div.side',
      h('div.scroll', h('h2', mode === 'create' ? 'Create your hero' : 'Customize your look'), mode === 'create' ? h('label.field', h('span', 'Name'), nameIn) : null, opts),
      h('div.foot', h('button.btn.plain.big', { 'aria-label': 'Random look', on: { click: () => ((cfg = randomAvatar()), rebuild(true)) } }, 'Random'), mode === 'edit' ? h('button.btn.plain.big', { on: { click: () => close(onCancel) } }, 'Cancel') : null, saveBtn),
    ),
  );
  canvasWrap.append(h('div.spin-hint', 'Drag to spin'));
  root.append(el);

  // 3D preview
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  useGrade(renderer);
  canvasWrap.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#c8d8ec', '#6b5a48', 1.3));
  const sun = new THREE.DirectionalLight('#ffe4bc', 2.7);
  sun.position.set(3, 6, 5);
  sun.castShadow = true;
  scene.add(sun);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.3, 32), toon('#7a6e5e'));
  plat.position.y = -0.15;
  plat.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.08, 8, 40), toon('#8a6a3a'));
  rim.rotation.x = Math.PI / 2;
  scene.add(plat, rim);
  let av = null;
  let yaw = 0.35;
  const rebuild = (anim) => {
    if (av) scene.remove(av.root);
    av = new Avatar(cfg, { equip: { weapon: 'sword_wood' } });
    av.root.rotation.y = yaw;
    scene.add(av.root);
    if (anim) {
      av.play(['wave', 'cheer', 'jump', 'dance'][Math.floor(Math.random() * 4)]);
      sfx.pop();
    }
    drawOpts();
  };
  const resize = () => {
    const w = canvasWrap.clientWidth;
    const hh = canvasWrap.clientHeight;
    renderer.setSize(w, hh);
    cam.aspect = w / hh;
    const narrow = w / hh < 0.8;
    cam.position.set(0, 1.7, narrow ? 9.4 : 7.6);
    cam.lookAt(0, 1.2, 0);
    cam.updateProjectionMatrix();
  };
  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, yaw }));
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  function onMove(e) {
    if (drag) yaw = drag.yaw + (e.clientX - drag.x) * 0.012;
  }
  function onUp() {
    drag = null;
  }
  let running = true;
  const clock = new THREE.Clock();
  const loop = () => {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    if (!drag) yaw += dt * 0.25;
    if (av) {
      av.root.rotation.y = yaw;
      av.update(dt);
    }
    renderer.render(scene, cam);
  };

  function drawOpts() {
    clear(opts);
    for (const k of ORDER) {
      const values = AVATAR_OPTIONS[k];
      const isColor = values[0].startsWith('#');
      opts.append(
        h(
          'div.opt-group',
          h('h4', LABELS[k]),
          h(
            'div.swatches',
            ...values.map((v) =>
              isColor
                ? h('button.swatch' + (cfg[k] === v ? '.on' : ''), { style: { background: v }, on: { click: () => ((cfg = { ...cfg, [k]: v }), rebuild(false)) } })
                : h('button.chip' + (cfg[k] === v ? '.on' : ''), { on: { click: () => ((cfg = { ...cfg, [k]: v }), rebuild(true)) } }, v),
            ),
          ),
        ),
      );
    }
    opts.append(err);
  }

  function close(cb) {
    running = false;
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    renderer.dispose();
    renderer.forceContextLoss();
    el.remove();
    cb?.();
  }

  saveBtn.addEventListener('click', async () => {
    sfx.unlock();
    err.textContent = '';
    const name = nameIn.value.trim();
    if (mode === 'create' && !NAME_RE.test(name)) {
      err.textContent = 'Name must be 3–16 letters, numbers or spaces.';
      nameIn.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await onDone({ name, avatar: cfg });
      close();
    } catch (e) {
      err.textContent = e.message;
      saveBtn.disabled = false;
    }
  });

  addEventListener('resize', resize);
  rebuild(false);
  requestAnimationFrame(() => {
    resize();
    loop();
  });
}
