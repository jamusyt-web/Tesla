import * as THREE from 'three';
import { mesh, toon, shade } from './toon.js';
import { MONSTERS } from '../../../shared/monsters.js';
import * as assets from './assets.js';

const OL = 0.025;
const sph = (r, a = 16, b = 12) => new THREE.SphereGeometry(r, a, b);

function eyes(parent, y, z, spread, r = 0.09, color = '#2b1d14') {
  for (const s of [-1, 1]) {
    const e = mesh(sph(r, 10, 8), color);
    e.scale.set(0.9, 1.1, 0.5);
    e.position.set(spread * s, y, z);
    const hl = new THREE.Mesh(sph(r * 0.35, 6, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
    hl.position.set(r * 0.3, r * 0.35, r * 0.4);
    e.add(hl);
    parent.add(e);
  }
}

// Cute low-poly monsters with simple procedural animation.
export class Mob {
  constructor(type) {
    this.type = type;
    this.def = MONSTERS[type];
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.t = Math.random() * 10;
    this.oneShot = null;
    this.mats = [];
    this.legs = [];
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 18), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.18, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.root.add(blob);
    this.blob = blob;
    if (assets.has(`mob_${type}`)) this.#fromModel(`mob_${type}`);
    else if (this[type]) this[type]();
    else this.slime(); // unknown type without a model: a tinted blob
    this.root.traverse((o) => {
      if (o.isMesh && o.material.side !== THREE.BackSide && o !== blob) o.castShadow = true;
    });
  }

  #fromModel(slot) {
    const made = assets.make(slot, { unique: true });
    this.body.add(made.object);
    made.object.traverse((o) => {
      if (o.isMesh && o.material.side !== THREE.BackSide) this.mats.push(...[].concat(o.material));
    });
    this.height = made.size.y + 0.4;
    this.blob.scale.setScalar(Math.max(made.size.x, made.size.z) * 0.8);
    if (made.mixer) {
      this.mixer = made.mixer;
      this.anim = { idle: assets.findClip(made.actions, 'idle'), walk: assets.findClip(made.actions, 'walk'), attack: assets.findClip(made.actions, 'attack'), hit: assets.findClip(made.actions, 'hit'), die: assets.findClip(made.actions, 'die') };
      this.loop = null;
      this.#loop('idle');
    }
  }

  #loop(name) {
    const a = this.anim?.[name] || this.anim?.idle;
    if (!a || this.loop === a) return;
    a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.2).play();
    this.loop?.fadeOut(0.2);
    this.loop = a;
  }

  m(color) {
    const mt = toon(color, { unique: true });
    this.mats.push(mt);
    return mt;
  }

  slime() {
    const mat = new THREE.MeshToonMaterial({ color: this.def.color, emissive: this.def.color, emissiveIntensity: 0.18 });
    this.mats.push(mat);
    const b = mesh(sph(0.62, 20, 14), null, { outline: OL, mat });
    b.scale.set(1, 0.8, 1);
    b.position.y = 0.5;
    this.body.add(b);
    const shine = new THREE.Mesh(sph(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }));
    shine.position.set(-0.25, 0.85, 0.32);
    this.body.add(shine);
    eyes(this.body, 0.6, 0.52, 0.2, 0.1);
    const mouth = mesh(new THREE.TorusGeometry(0.07, 0.02, 5, 10, Math.PI), '#2b1d14');
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, 0.42, 0.58);
    this.body.add(mouth);
    this.scale = 1;
    this.height = 1.3;
  }

  wolf() {
    const fur = this.m(this.def.color);
    const belly = this.m('#d9d6cf');
    const torso = mesh(new THREE.CapsuleGeometry(0.38, 0.8, 6, 12), null, { outline: OL, mat: fur });
    torso.rotation.x = Math.PI / 2;
    torso.position.y = 0.85;
    this.body.add(torso);
    const head = new THREE.Group();
    head.position.set(0, 1.25, 0.75);
    this.body.add(head);
    this.headG = head;
    const skull = mesh(sph(0.36), null, { outline: OL, mat: fur });
    head.add(skull);
    const snout = mesh(new THREE.CapsuleGeometry(0.15, 0.25, 4, 8), null, { outline: OL, mat: belly });
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.08, 0.35);
    head.add(snout);
    const nose = mesh(sph(0.07, 8, 6), '#2b1d14');
    nose.position.set(0, -0.02, 0.56);
    head.add(nose);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.12, 0.3, 4), null, { outline: OL, mat: fur });
      ear.position.set(0.2 * s, 0.33, -0.02);
      ear.rotation.z = -0.3 * s;
      head.add(ear);
    }
    eyes(head, 0.08, 0.3, 0.15, 0.07, '#e8b23a');
    for (const [x, z] of [[-0.22, 0.45], [0.22, 0.45], [-0.22, -0.45], [0.22, -0.45]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.7, z);
      const leg = mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.6, 8), null, { outline: OL, mat: fur });
      leg.position.y = -0.32;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    const tail = mesh(new THREE.ConeGeometry(0.14, 0.6, 8), null, { outline: OL, mat: fur });
    tail.position.set(0, 1.05, -0.8);
    tail.rotation.x = -2.2;
    this.body.add(tail);
    this.tail = tail;
    this.height = 1.9;
  }

  goblin() {
    const skin = this.m(this.def.color);
    const cloth = this.m('#8a5a33');
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.15 * s, 0.5, 0);
      const leg = mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.45, 8), null, { outline: OL, mat: cloth });
      leg.position.y = -0.24;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    const torso = mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.6, 12), null, { outline: OL, mat: cloth });
    torso.position.y = 0.8;
    this.body.add(torso);
    const head = new THREE.Group();
    head.position.y = 1.45;
    this.body.add(head);
    this.headG = head;
    const skull = mesh(sph(0.42), null, { outline: OL, mat: skin });
    head.add(skull);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.12, 0.55, 5), null, { outline: OL, mat: skin });
      ear.position.set(0.48 * s, 0.05, 0);
      ear.rotation.z = (Math.PI / 2 + 0.25) * -s;
      head.add(ear);
    }
    const nose = mesh(new THREE.ConeGeometry(0.08, 0.25, 6), null, { outline: OL, mat: skin });
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.05, 0.45);
    head.add(nose);
    eyes(head, 0.08, 0.36, 0.16, 0.08, '#d23');
    const arm = new THREE.Group();
    arm.position.set(0.4, 1.05, 0);
    const a = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.45, 8), null, { outline: OL, mat: skin });
    a.position.y = -0.2;
    const club = mesh(new THREE.CylinderGeometry(0.12, 0.05, 0.75, 8), '#7a5233', { outline: OL });
    club.position.set(0, -0.45, 0.3);
    club.rotation.x = 1.2;
    arm.add(a, club);
    this.body.add(arm);
    this.arm = arm;
    this.height = 2.1;
  }

  golem() {
    const stone = this.m(this.def.color);
    const moss = this.m('#5fa34a');
    const core = new THREE.MeshToonMaterial({ color: '#7ff0ff', emissive: '#3fd0ff', emissiveIntensity: 0.9 });
    const chunk = (w, h, d, x, y, z, mt = stone) => {
      const b = mesh(new THREE.BoxGeometry(w, h, d), null, { outline: OL, mat: mt });
      b.position.set(x, y, z);
      this.body.add(b);
      return b;
    };
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.45 * s, 1.0, 0);
      const leg = mesh(new THREE.BoxGeometry(0.5, 1.0, 0.55), null, { outline: OL, mat: stone });
      leg.position.y = -0.5;
      pivot.add(leg);
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    chunk(1.6, 1.3, 1.1, 0, 1.75, 0);
    chunk(1.65, 0.25, 1.15, 0, 2.35, 0, moss);
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), core);
    c.position.set(0, 1.8, 0.58);
    this.body.add(c);
    this.core = c;
    const head = new THREE.Group();
    head.position.set(0, 2.75, 0.1);
    this.body.add(head);
    this.headG = head;
    const skull = mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), null, { outline: OL, mat: stone });
    head.add(skull);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.05), core);
      e.position.set(0.18 * s, 0.05, 0.36);
      head.add(e);
      const arm = new THREE.Group();
      arm.position.set(1.0 * s, 2.2, 0);
      const up = mesh(new THREE.BoxGeometry(0.45, 1.3, 0.5), null, { outline: OL, mat: stone });
      up.position.y = -0.6;
      const fist = mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), null, { outline: OL, mat: stone });
      fist.position.y = -1.35;
      arm.add(up, fist);
      this.body.add(arm);
      (this.arms ||= []).push(arm);
    }
    this.blob.scale.setScalar(2);
    this.height = 3.6;
  }

  play(name) {
    this.oneShot = { name, t: 0, dur: { attack: 0.6, hurt: 0.35, die: 0.8 }[name] || 0.5 };
    if (name === 'hurt') this.flash = 0.3;
    const clip = this.anim?.[{ attack: 'attack', hurt: 'hit', die: 'die' }[name]];
    if (clip) {
      clip.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.08).play();
      clip.clampWhenFinished = name === 'die';
      this.oneShot.clip = true;
    }
  }

  update(dt, moving) {
    this.t += dt;
    const t = this.t;
    if (this.mixer) {
      // Animated model: clips do the work; keep procedural lunge/knockback for punch.
      this.#loop(moving ? 'walk' : 'idle');
      this.mixer.update(dt);
      this.body.position.set(0, 0, 0);
      const os = this.oneShot;
      if (os) {
        os.t += dt;
        const k = Math.min(1, os.t / os.dur);
        if (os.name === 'attack') this.body.position.z = Math.sin(Math.PI * k) * 1.0;
        else if (os.name === 'hurt') this.body.position.z = -Math.sin(Math.PI * k) * 0.35;
        else if (os.name === 'die' && !os.clip) this.body.scale.setScalar(1 - k * 0.9);
        if (os.t >= os.dur && os.name !== 'die') this.oneShot = null;
      }
      this.#flashTick(dt);
      return;
    }
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.set(1, 1, 1);
    if (this.type === 'slime') {
      const hop = moving ? Math.abs(Math.sin(t * 6)) : Math.abs(Math.sin(t * 2.5)) * 0.25;
      this.body.position.y = hop * 0.5;
      const sq = 1 - hop * 0.15;
      this.body.scale.set(1 + (1 - sq), sq + (moving ? hop * 0.2 : 0), 1 + (1 - sq));
    } else {
      const sp = moving ? 9 : 0;
      this.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(t * sp + (i % 2) * Math.PI + (i > 1 ? Math.PI : 0)) * 0.6 : 0));
      if (!moving) this.body.position.y = Math.sin(t * 2) * 0.03;
      if (this.tail) this.tail.rotation.z = Math.sin(t * (moving ? 12 : 3)) * 0.4;
      if (this.arm) this.arm.rotation.x = moving ? Math.sin(t * 9) * 0.5 : Math.sin(t * 2) * 0.1;
      if (this.core) this.core.rotation.y += dt * 2;
      if (this.arms) this.arms.forEach((a, i) => (a.rotation.x = moving ? Math.sin(t * 5 + i * Math.PI) * 0.4 : 0));
    }
    const os = this.oneShot;
    if (os) {
      os.t += dt;
      const k = Math.min(1, os.t / os.dur);
      if (os.name === 'attack') {
        this.body.position.z += Math.sin(Math.PI * k) * 1.3;
        this.body.position.y += Math.sin(Math.PI * k) * 0.4;
        if (this.arms) this.arms.forEach((a) => (a.rotation.x = -Math.sin(Math.PI * k) * 2));
        if (this.arm) this.arm.rotation.x = -Math.sin(Math.PI * k) * 2.4;
      } else if (os.name === 'hurt') {
        this.body.position.z -= Math.sin(Math.PI * k) * 0.4;
        this.body.rotation.x = -Math.sin(Math.PI * k) * 0.2;
      } else if (os.name === 'die') {
        this.body.scale.multiplyScalar(1 - k * 0.9);
        this.body.rotation.y = k * 6;
      }
      if (os.t >= os.dur && os.name !== 'die') this.oneShot = null;
    }
    this.#flashTick(dt);
  }

  #flashTick(dt) {
    if (this.flash > 0) {
      this.flash -= dt;
      const on = this.flash > 0 && Math.floor(this.flash * 30) % 2 === 0;
      for (const m of this.mats) m.emissive?.set(on ? '#ff3030' : '#000000');
    }
  }
}

export const mobColor = (type) => shade(MONSTERS[type].color, 1);
