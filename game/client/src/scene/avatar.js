import * as THREE from 'three';
import { mesh, toon, shade } from './toon.js';
import { buildTool } from './tools.js';
import { bakeSkinned, mergeRigid, skinnedCopies } from './merge.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sanitizeAvatar, CLOAK_TINTS } from '../../../shared/avatar.js';

const OL = 0.036;
// Proportions: ~3 heads tall, 2.28 m overall. Not a chibi, still stylised.
const HIP = 0.84;
const HEAD_Y = 1.9;
const HEAD_S = 0.76;
const HOL = OL / HEAD_S; // head children are scaled by HEAD_S; keep their ink line the same weight
// Phones draw heroes with a little less curve detail (setAvatarDetail).
let DETAIL = 1;
export const setAvatarDetail = (k) => (DETAIL = k);
const seg = (n, min) => Math.max(min, Math.round(n * DETAIL));
const sph = (r, ws = 18, hs = 14) => new THREE.SphereGeometry(r, seg(ws, 6), seg(hs, 4));
const cyl = (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, seg(s, 6));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// A tool or weapon, merged into a mesh or two (built once per item). Heroes
// wear skinned copies of it on their hand or back bone.
const toolProtos = new Map();
function toolProto(id) {
  let proto = toolProtos.get(id);
  if (!proto) {
    const raw = buildTool(id);
    const tip = raw.userData.tip;
    raw.userData = {};
    proto = mergeRigid(raw);
    proto.userData.tipAt = tip ? tip.position.clone() : null; // where a rod's line leaves it
    proto.traverse((o) => o.geometry && (o.geometry.userData.shared = true));
    toolProtos.set(id, proto);
  }
  return proto;
}
const isHull = (o) => o.isMesh && o.material.side === THREE.BackSide;

// A full-body stylised hero built from primitives. Every slot (hair, outfit, hat,
// back) is swappable, and tools/weapons attach to a hand socket so tool skins
// show up automatically. Once built, the body is baked into one skinned mesh
// and one ink shell (scene/merge.js): the moving parts are bones, so a hero
// costs a few draw calls instead of about sixty.
export class Avatar {
  constructor(cfg, { equip = {}, shadowBlob = true, layer = 0 } = {}) {
    this.layer = layer;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.equip = equip;
    this.state = 'idle';
    this.walkPhase = 0;
    this.t = 0;
    this.oneShot = null; // { name, t, dur }
    this.flash = 0;
    this.held = null;
    this.heldId = null;
    if (shadowBlob) {
      const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.02;
      blob.renderOrder = -1;
      this.root.add(blob);
    }
    this.build(cfg);
  }

  build(cfg) {
    this.cfg = sanitizeAvatar(cfg);
    const c = this.cfg;
    if (this.rig) this.body.remove(this.rig);
    for (const m of this.baked ?? []) (this.body.remove(m), m.geometry.dispose());
    this.tail = null;
    const rig = new THREE.Bone();
    this.rig = rig;
    this.body.add(rig);
    this.mats = [];
    const skin = toon(c.skin, { unique: true });
    const top = toon(c.outfitColor, { unique: true });
    const shirt = toon(c.outfit === 'overalls' || c.outfit === 'vest' ? '#d9cfb8' : c.outfitColor, { unique: true });
    const pants = toon(c.pantsColor, { unique: true });
    const shoe = toon('#3b2a1e');
    this.mats.push(skin, top, shirt, pants);
    const M = (geo, mat, outline = OL) => mesh(geo, null, { outline, mat });

    // ── Legs
    this.legs = [-1, 1].map((s) => {
      const pivot = new THREE.Bone();
      pivot.position.set(0.14 * s, HIP, 0);
      const leg = M(cyl(0.1, 0.085, 0.62), pants);
      leg.position.y = -0.33;
      const boot = M(new THREE.CapsuleGeometry(0.11, 0.1, 4, 8), shoe);
      boot.rotation.x = Math.PI / 2;
      boot.position.set(0, -0.74, 0.06);
      pivot.add(leg, boot);
      rig.add(pivot);
      return pivot;
    });

    // ── Torso
    const torso = new THREE.Bone();
    torso.position.y = HIP;
    rig.add(torso);
    this.torso = torso;
    const robe = c.outfit === 'robe';
    const chest = M(cyl(0.3, 0.25, 0.62, 16), top);
    chest.position.y = 0.31;
    torso.add(chest);
    const shoulders = M(sph(0.3, 16, 10), top);
    shoulders.scale.set(1.15, 0.5, 0.9);
    shoulders.position.y = 0.6;
    torso.add(shoulders);
    const neck = M(cyl(0.1, 0.11, 0.16, 10), skin);
    neck.position.y = 0.68;
    torso.add(neck);
    if (robe) {
      const skirt = M(cyl(0.3, 0.5, 0.86, 16), top);
      skirt.position.y = -0.36;
      torso.add(skirt);
      const sash = M(new THREE.TorusGeometry(0.28, 0.05, 6, 20), toon('#c9a54a'), 0);
      sash.rotation.x = Math.PI / 2;
      sash.position.y = 0.08;
      torso.add(sash);
    } else if (c.outfit === 'tunic') {
      const skirt = M(cyl(0.31, 0.38, 0.26, 16), top);
      skirt.position.y = 0.0;
      torso.add(skirt);
      const collar = M(new THREE.TorusGeometry(0.17, 0.04, 6, 16), toon('#d9cfb8'), 0);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.6;
      torso.add(collar);
    } else if (c.outfit === 'adventurer') {
      const belt = M(new THREE.TorusGeometry(0.27, 0.045, 6, 20), toon('#4a3020'), 0);
      belt.rotation.x = Math.PI / 2;
      belt.position.y = 0.08;
      const buckle = M(new THREE.BoxGeometry(0.1, 0.08, 0.04), toon('#c9a54a'), 0);
      buckle.position.set(0, 0.08, 0.28);
      const strap = M(new THREE.BoxGeometry(0.08, 0.78, 0.04), toon('#4a3020'), 0);
      strap.position.set(0, 0.32, 0.28);
      strap.rotation.z = 0.7;
      torso.add(belt, buckle, strap);
    } else if (c.outfit === 'overalls') {
      for (const s of [-1, 1]) {
        const st = M(new THREE.BoxGeometry(0.07, 0.4, 0.03), pants, 0);
        st.position.set(0.12 * s, 0.42, 0.26);
        torso.add(st);
      }
      const bib = M(new THREE.BoxGeometry(0.34, 0.26, 0.05), pants, 0);
      bib.position.set(0, 0.2, 0.28);
      const lower = M(cyl(0.27, 0.29, 0.22, 16), pants);
      lower.position.y = 0.02;
      torso.add(bib, lower);
      chest.material = shirt;
      shoulders.material = shirt;
    } else if (c.outfit === 'vest') {
      chest.material = shirt;
      shoulders.material = shirt;
      for (const s of [-1, 1]) {
        const panel = M(new THREE.BoxGeometry(0.2, 0.48, 0.05), top, 0);
        panel.position.set(0.15 * s, 0.3, 0.28);
        panel.rotation.y = -0.25 * s;
        torso.add(panel);
      }
      const back = M(new THREE.BoxGeometry(0.5, 0.5, 0.05), top, 0);
      back.position.set(0, 0.3, -0.28);
      torso.add(back);
    }

    // ── Arms
    this.arms = [-1, 1].map((s) => {
      const pivot = new THREE.Bone();
      pivot.position.set(0.38 * s, 1.4, 0);
      const sleeve = M(cyl(0.085, robe ? 0.13 : 0.09, 0.56, 10), shirt);
      sleeve.position.y = -0.27;
      const hand = M(sph(0.1, 12, 10), skin);
      hand.position.y = -0.58;
      pivot.add(sleeve, hand);
      pivot.rotation.z = 0.1 * s;
      rig.add(pivot);
      return pivot;
    });
    this.socket = new THREE.Bone(); // tools in hand ride this bone
    this.socket.position.set(0, -0.6, 0.02);
    this.socket.scale.setScalar(1.15); // tools in proportion to the longer body
    this.socket.rotation.x = 2.09; // tool juts forward-down from the fist
    this.arms[1].add(this.socket);

    // ── Head
    const head = new THREE.Bone();
    head.position.y = HEAD_Y;
    head.scale.setScalar(HEAD_S);
    rig.add(head);
    this.head = head;
    const skull = M(sph(0.5, 24, 18), skin, HOL);
    skull.scale.set(0.92, 1.04, 0.95);
    head.add(skull);
    const nose = M(sph(0.04, 8, 6), toon(shade(c.skin, 0.9)), 0);
    nose.scale.set(0.8, 1, 1.2);
    nose.position.set(0, -0.07, 0.49);
    head.add(nose);
    for (const s of [-1, 1]) {
      const ear = M(sph(0.09, 8, 8), skin, HOL);
      ear.position.set(0.48 * s, -0.04, 0);
      head.add(ear);
    }
    this.#buildFace(head, c);
    this.#buildHair(head, c);
    this.#buildHat(head, c);
    this.#buildBack(rig, c);

    // Sword rests on the back when hands are busy or idle.
    this.backSlot = new THREE.Bone();
    this.backSlot.position.set(0.18, 1.2, -0.33);
    this.backSlot.rotation.set(0, 0, 2.6);
    rig.add(this.backSlot);
    // Bake the body before the tools go on (they come and go).
    const { meshes, hull, skeleton, bones } = bakeSkinned(rig, this.body);
    this.baked = [...meshes, hull].filter(Boolean);
    this.mats = meshes.map((m) => m.material);
    this.skeleton = skeleton;
    this.bone = { socket: bones.indexOf(this.socket), back: bones.indexOf(this.backSlot) };
    this.backTool = [];
    this.heldTool = [];
    this.setEquip(this.equip);
    this.inkOn = true;
    this.#markLayer(this.body);
  }

  // How much of a hero to draw at distance d (metres): no ink lines past
  // 25 m, nothing past 60 m. Returns whether it should be drawn at all.
  setDetail(d) {
    const ink = d < 25;
    if (ink !== this.inkOn) {
      this.inkOn = ink;
      this.root.traverse((o) => isHull(o) && (o.visible = ink));
    }
    return d < 60;
  }

  #markLayer(obj) {
    // Heroes live only on their own layer so the renderer can draw them in a
    // separate pass (needed for the x-ray silhouette to ignore self-overlap).
    if (this.layer) obj.traverse((o) => o.isMesh && o.layers.set(this.layer));
  }

  #buildFace(head, c) {
    const ink = toon('#2b1d14');
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const eyeMat = toon(c.eyeColor);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(0.18 * s, 0.0, 0.45);
      g.rotation.y = 0.32 * s;
      if (c.eyes === 'happy') {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 12, Math.PI), ink);
        arc.position.y = -0.02;
        g.add(arc);
      } else if (c.eyes === 'sleepy') {
        const lid = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.1, 3, 6), ink);
        lid.rotation.z = Math.PI / 2;
        g.add(lid);
      } else {
        const big = c.eyes === 'sparkle' ? 1.25 : 1;
        const eye = new THREE.Mesh(sph(0.075 * big, 14, 12), eyeMat);
        eye.scale.set(0.9, 0.95, 0.45);
        eye.position.y = 0.02;
        const hl = new THREE.Mesh(sph(0.018 * big, 8, 6), white);
        hl.position.set(0.022, 0.05, 0.04);
        g.add(eye, hl);
        if (c.eyes === 'sparkle') {
          const hl2 = new THREE.Mesh(sph(0.014, 6, 6), white);
          hl2.position.set(-0.03, -0.035, 0.04);
          g.add(hl2);
        }
      }
      head.add(g);
      if (c.eyes === 'happy') {
        const blush = new THREE.Mesh(sph(0.065, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff8f8f', transparent: true, opacity: 0.15 }));
        blush.scale.set(1.2, 0.6, 0.3);
        blush.position.set(0.3 * s, -0.13, 0.37);
        blush.rotation.y = 0.6 * s;
        head.add(blush);
      }
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.11, 3, 6), toon(shade(c.hairColor, 0.7)));
      brow.rotation.z = Math.PI / 2 + 0.22 * s;
      brow.position.set(0.18 * s, 0.12, 0.44);
      brow.rotation.y = 0.32 * s;
      head.add(brow);
    }
    let mouth;
    if (c.eyes === 'happy') {
      mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 10, Math.PI), ink);
      mouth.rotation.z = Math.PI;
      mouth.position.set(0, -0.15, 0.46);
    } else {
      mouth = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.07, 3, 6), ink);
      mouth.rotation.z = Math.PI / 2;
      mouth.position.set(0, -0.17, 0.46);
    }
    head.add(mouth);
    this.mouth = mouth;
  }

  #buildHair(head, c) {
    if (c.hairStyle === 'bald') return;
    const hm = toon(c.hairColor, { unique: true });
    this.mats.push(hm);
    const M = (geo) => mesh(geo, null, { outline: HOL, mat: hm });
    const hatCovers = ['wizard', 'beanie', 'straw'].includes(c.hat);
    if (c.hairStyle === 'mohawk') {
      for (let i = 0; i < 6; i++) {
        const a = -0.5 + i * 0.32;
        const fin = M(new THREE.ConeGeometry(0.09, 0.32, 4));
        fin.position.set(0, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
        fin.rotation.x = a;
        if (!hatCovers) head.add(fin);
      }
      return;
    }
    const cap = M(new THREE.SphereGeometry(0.535, seg(24, 8), seg(14, 5), 0, Math.PI * 2, 0, Math.PI * 0.36));
    cap.position.y = 0.02;
    cap.rotation.x = -0.12;
    head.add(cap);
    const backLen = { spiky: 0.58, bob: 0.66, long: 0.8, bun: 0.6, ponytail: 0.6 }[c.hairStyle] || 0.6;
    const back = M(new THREE.SphereGeometry(0.545, seg(24, 8), seg(14, 5), Math.PI, Math.PI, 0.1, Math.PI * backLen));
    head.add(back);
    // Fringe tufts across the forehead.
    const tufts = c.hairStyle === 'spiky' ? 5 : 4;
    for (let i = 0; i < tufts; i++) {
      const a = -0.75 + (i / (tufts - 1)) * 1.5;
      const t = M(sph(0.15, 10, 8));
      t.scale.set(1, 0.75, 0.6);
      t.position.set(Math.sin(a) * 0.43, 0.28 - Math.abs(a) * 0.08, Math.cos(a) * 0.36);
      head.add(t);
    }
    if (c.hairStyle === 'spiky' && !hatCovers) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const sp = M(new THREE.ConeGeometry(0.13, 0.36, 5));
        sp.position.set(Math.cos(a) * 0.26, 0.48, Math.sin(a) * 0.26 - 0.05);
        sp.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        head.add(sp);
      }
    }
    if (c.hairStyle === 'bob' || c.hairStyle === 'long') {
      for (const s of [-1, 1]) {
        const side = M(new THREE.CapsuleGeometry(0.14, c.hairStyle === 'long' ? 0.55 : 0.22, 4, 8));
        side.position.set(0.42 * s, c.hairStyle === 'long' ? -0.3 : -0.12, -0.02);
        head.add(side);
      }
    }
    if (c.hairStyle === 'long') {
      const slab = M(new THREE.CapsuleGeometry(0.3, 0.5, 4, 10));
      slab.scale.set(1.2, 1, 0.45);
      slab.position.set(0, -0.45, -0.3);
      head.add(slab);
    }
    if (c.hairStyle === 'bun' && !hatCovers) {
      const bun = M(sph(0.2, 14, 10));
      bun.position.set(0, 0.45, -0.32);
      head.add(bun);
    }
    if (c.hairStyle === 'ponytail') {
      const tie = M(sph(0.1, 8, 8));
      tie.position.set(0, 0.2, -0.55);
      const tail = M(new THREE.CapsuleGeometry(0.12, 0.45, 4, 8));
      const sway = new THREE.Bone(); // it sways, so it gets a bone of its own
      sway.position.set(0, -0.15, -0.66);
      sway.rotation.x = 0.35;
      sway.add(tail);
      head.add(tie, sway);
      this.tail = sway;
    }
  }

  #buildHat(head, c) {
    const M = (geo, col, ol = HOL) => mesh(geo, col, { outline: ol });
    if (c.hat === 'wizard') {
      const brim = M(cyl(0.78, 0.78, 0.05, 24), '#2e2b5e');
      brim.position.y = 0.36;
      const cone = M(new THREE.ConeGeometry(0.46, 0.95, 18), '#2e2b5e');
      cone.position.set(0, 0.84, -0.06);
      cone.rotation.x = -0.18;
      const band = M(cyl(0.44, 0.46, 0.08, 20), '#c9a54a', 0);
      band.position.y = 0.42;
      const star = M(new THREE.OctahedronGeometry(0.08), '#c9a54a', 0);
      star.position.set(0, 0.62, 0.36);
      head.add(brim, cone, band, star);
    } else if (c.hat === 'crown') {
      const ring = M(cyl(0.3, 0.32, 0.18, 16, 1), '#c9a54a');
      ring.position.y = 0.5;
      head.add(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const p = M(new THREE.ConeGeometry(0.06, 0.16, 4), '#c9a54a', 0);
        p.position.set(Math.cos(a) * 0.29, 0.66, Math.sin(a) * 0.29);
        const gem = M(sph(0.035, 6, 6), i % 2 ? '#e24a5b' : '#4a8fe2', 0);
        gem.position.set(Math.cos(a) * 0.31, 0.52, Math.sin(a) * 0.31);
        head.add(p, gem);
      }
    } else if (c.hat === 'beanie') {
      const dome = M(new THREE.SphereGeometry(0.56, seg(20, 8), seg(12, 5), 0, Math.PI * 2, 0, Math.PI * 0.5), '#8a3a2e');
      dome.position.y = 0.08;
      const fold = M(new THREE.TorusGeometry(0.53, 0.07, 8, 24), '#d9cfb8');
      fold.rotation.x = Math.PI / 2;
      fold.position.y = 0.12;
      const pom = M(sph(0.12, 10, 8), '#d9cfb8');
      pom.position.y = 0.66;
      head.add(dome, fold, pom);
    } else if (c.hat === 'straw') {
      const brim = M(cyl(0.88, 0.9, 0.04, 28), '#c9a865');
      brim.position.y = 0.3;
      const crown = M(cyl(0.4, 0.45, 0.28, 20), '#c9a865');
      crown.position.y = 0.46;
      const band = M(cyl(0.455, 0.455, 0.08, 20), '#7a2a22', 0);
      band.position.y = 0.37;
      head.add(brim, crown, band);
    } else if (c.hat === 'bandana') {
      const band = M(new THREE.TorusGeometry(0.5, 0.07, 8, 24), '#7a2a22');
      band.rotation.x = Math.PI / 2 - 0.25;
      band.position.y = 0.2;
      const knot = M(sph(0.09, 8, 8), '#7a2a22');
      knot.position.set(0, 0.12, -0.52);
      head.add(band, knot);
      for (const s of [-1, 1]) {
        const tail = M(new THREE.BoxGeometry(0.08, 0.25, 0.03), '#7a2a22', 0);
        tail.position.set(0.08 * s, -0.02, -0.55);
        tail.rotation.z = 0.3 * s;
        head.add(tail);
      }
    } else if (c.hat === 'leaf') {
      const leaf = M(sph(0.2, 10, 8), '#5fbf4f');
      leaf.scale.set(0.5, 0.12, 1);
      leaf.position.set(0.05, 0.6, 0);
      leaf.rotation.z = 0.4;
      const stem = M(cyl(0.02, 0.02, 0.12, 5), '#7a5a33', 0);
      stem.position.set(0, 0.52, 0);
      head.add(leaf, stem);
      this.leaf = leaf;
    }
  }

  #buildBack(rig, c) {
    this.wings = null;
    this.cape = null;
    if (c.back === 'cape') {
      const geo = new THREE.PlaneGeometry(0.78, 1.3, 4, 6);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, -Math.pow(pos.getX(i), 2) * 0.6);
      geo.computeVertexNormals();
      // Both faces as one sheet (front and a flipped copy), so it bakes into the body.
      const flip = geo.clone();
      const ix = flip.index.array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
      const nr = flip.attributes.normal;
      for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
      const sheet = mergeGeometries([geo, flip]);
      const cape = new THREE.Mesh(sheet, toon(CLOAK_TINTS[c.cloakTint] ?? shade(c.outfitColor, 0.75)));
      const pivot = new THREE.Bone();
      pivot.position.set(0, 1.44, -0.3);
      cape.position.y = -0.65;
      pivot.add(cape);
      pivot.rotation.x = 0.12;
      rig.add(pivot);
      this.cape = pivot;
    } else if (c.back === 'backpack') {
      const pack = mesh(new THREE.BoxGeometry(0.46, 0.5, 0.24), '#a0703f', { outline: OL });
      pack.position.set(0, 1.14, -0.38);
      const flap = mesh(new THREE.BoxGeometry(0.48, 0.18, 0.26), '#7c5530', { outline: 0 });
      flap.position.set(0, 1.34, -0.38);
      const roll = mesh(cyl(0.08, 0.08, 0.5, 10), '#5a6e3a', { outline: OL });
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0, 1.46, -0.36);
      rig.add(pack, flap, roll);
    } else if (c.back === 'wings') {
      // Glassy and lit from within: unshaded, so it needs no shader of its own.
      const mat = new THREE.MeshBasicMaterial({ color: '#d4f1ff', transparent: true, opacity: 0.78, side: THREE.DoubleSide });
      this.wings = [-1, 1].map((s) => {
        const w = new THREE.Mesh(sph(0.35, 12, 8), mat);
        w.scale.set(1, 0.6, 0.08);
        w.position.x = 0.33 * s;
        const pivot = new THREE.Group();
        pivot.position.set(0.05 * s, 1.3, -0.32);
        pivot.add(w);
        rig.add(pivot);
        return pivot;
      });
    }
  }

  setEquip(equip) {
    this.equip = { ...equip };
    this.backTool = this.#wear(this.backTool, equip.weapon, this.bone.back);
    if (this.heldKind) this.hold(this.heldKind, true);
  }

  // kind: 'axe' | 'pick' | 'rod' | 'weapon' | null — shows the equipped item of that kind in hand.
  hold(kind, force = false) {
    if (!force && kind === this.heldKind) return;
    this.heldKind = kind;
    this.socket.clear();
    this.held = null;
    const id = kind ? this.equip[kind] : null;
    this.heldTool = this.#wear(this.heldTool, id, this.bone.socket);
    if (id) {
      // (game.js reads held.userData.tip for the fishing line)
      this.held = new THREE.Object3D();
      const at = toolProto(id).userData.tipAt;
      if (at) {
        const tip = new THREE.Object3D();
        tip.position.copy(at);
        this.held.add(tip);
        this.held.userData.tip = tip;
      }
      this.socket.add(this.held);
    }
    for (const m of this.backTool) m.visible = kind !== 'weapon' && (!isHull(m) || this.inkOn !== false);
  }

  // Swap the meshes of a worn tool: old ones off, item `id`'s on (riding `bone`).
  #wear(old, id, bone) {
    for (const m of old) this.body.remove(m);
    if (!id) return [];
    const list = skinnedCopies(toolProto(id), this.skeleton, bone, this.mats[0]);
    for (const m of list) {
      this.body.add(m);
      if (this.layer) m.layers.set(this.layer);
      if (isHull(m) && this.inkOn === false) m.visible = false;
    }
    return list;
  }

  play(name, dur) {
    const d = dur ?? { swing: 0.42, attack: 0.6, hurt: 0.4, pick: 0.45, cast: 0.5, reel: 0.45, wave: 1.4, dance: 2.4, cheer: 1.3, heart: 1.2, skill: 0.9, jump: 0.6 }[name] ?? 0.5;
    this.oneShot = { name, t: 0, dur: d };
    if (name === 'hurt') this.flash = 0.3;
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    if (s === 'walk' && this.oneShot && ['wave', 'dance', 'cheer', 'heart'].includes(this.oneShot.name)) this.oneShot = null;
  }

  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t;
    const [legL, legR] = this.legs;
    const [armL, armR] = this.arms;
    // Reset pose.
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.position.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, -0.1);
    armR.rotation.set(0, 0, 0.1);
    this.head.rotation.set(0, 0, 0);
    this.torso.scale.set(1, 1, 1);

    const st = this.state;
    if (st === 'walk') {
      this.walkPhase += dt * (5 + speed * 1.1);
      const p = this.walkPhase;
      legL.rotation.x = Math.sin(p) * 0.62;
      legR.rotation.x = -Math.sin(p) * 0.62;
      armL.rotation.x = -Math.sin(p) * 0.5;
      armR.rotation.x = Math.sin(p) * 0.5;
      this.body.position.y = Math.abs(Math.sin(p)) * 0.05;
      this.rig.rotation.x = 0.06;
      this.head.rotation.z = Math.sin(p) * 0.04;
    } else if (st === 'sit') {
      this.body.position.y = -0.6;
      legL.rotation.x = legR.rotation.x = -1.45;
      armL.rotation.x = armR.rotation.x = -0.5;
    } else if (st === 'ko') {
      this.rig.rotation.x = -Math.PI / 2;
      this.rig.position.set(0, 0.32, -0.6);
      this.head.rotation.z = 0.3;
    } else {
      const br = Math.sin(t * 2.2);
      this.torso.scale.set(1 + br * 0.012, 1 + br * 0.02, 1);
      this.head.position.y = HEAD_Y + br * 0.01;
      armL.rotation.z = -0.1 - br * 0.03;
      armR.rotation.z = 0.1 + br * 0.03;
      if (st === 'battle') {
        armR.rotation.x = -0.8;
        legL.rotation.x = 0.25;
        legR.rotation.x = -0.25;
        this.body.position.y = Math.abs(Math.sin(t * 4)) * 0.04;
      } else if (st === 'fish') {
        armR.rotation.x = -1.15 + Math.sin(t * 1.5) * 0.04;
        armL.rotation.x = -0.9;
        armL.rotation.z = 0.35;
      } else if (st === 'gather') {
        armR.rotation.x = -0.55;
        armL.rotation.x = -0.45;
      }
    }

    // One-shot actions layered on top.
    const os = this.oneShot;
    if (os) {
      os.t += dt;
      const k = clamp01(os.t / os.dur);
      switch (os.name) {
        case 'swing': {
          // Windup over the shoulder, then a fast strike.
          const a = k < 0.45 ? -0.55 + (-3.3 + 0.55) * ease(k / 0.45) : -3.3 + (3.3 - 0.35) * ease((k - 0.45) / 0.55);
          armR.rotation.x = a;
          armL.rotation.x = a * 0.7;
          armL.rotation.z = 0.35;
          this.rig.rotation.x = k < 0.45 ? -0.08 : 0.18 * Math.sin(Math.PI * clamp01((k - 0.45) / 0.55));
          this.rig.rotation.y = k < 0.45 ? -0.3 * ease(k / 0.45) : -0.3 + 0.6 * ease((k - 0.45) / 0.55);
          this.body.position.y = k > 0.45 && k < 0.7 ? -0.05 : 0;
          break;
        }
        case 'attack':
        case 'skill': {
          const lunge = Math.sin(Math.PI * k);
          this.body.position.z = lunge * (os.name === 'skill' ? 1.6 : 1.1);
          if (os.name === 'skill') {
            this.body.position.y = Math.sin(Math.PI * k) * 0.9;
            this.body.rotation.y = k * Math.PI * 2;
          }
          armR.rotation.x = k < 0.4 ? -2.8 * ease(k / 0.4) : -2.8 + 2.6 * ease((k - 0.4) / 0.6);
          break;
        }
        case 'hurt':
          this.body.position.z = -Math.sin(Math.PI * k) * 0.35;
          this.rig.rotation.x = -Math.sin(Math.PI * k) * 0.25;
          break;
        case 'pick':
          this.rig.rotation.x = Math.sin(Math.PI * k) * 0.5;
          this.body.position.y = -Math.sin(Math.PI * k) * 0.2;
          armR.rotation.x = -Math.sin(Math.PI * k) * 1.2;
          armL.rotation.x = -Math.sin(Math.PI * k) * 1.2;
          break;
        case 'cast':
          armR.rotation.x = k < 0.5 ? -1.15 - 1.8 * ease(k / 0.5) : -2.95 + 1.8 * ease((k - 0.5) / 0.5);
          break;
        case 'reel':
          armR.rotation.x = -1.15 - Math.sin(Math.PI * k) * 1.5;
          this.rig.rotation.x = -Math.sin(Math.PI * k) * 0.15;
          break;
        case 'wave':
          armR.rotation.z = 2.6 + Math.sin(os.t * 14) * 0.35;
          this.head.rotation.z = 0.12;
          break;
        case 'cheer':
          armR.rotation.z = 2.7;
          armL.rotation.z = -2.7;
          this.body.position.y = Math.abs(Math.sin(os.t * 7)) * 0.5;
          break;
        case 'dance':
          this.body.rotation.y = Math.sin(os.t * 5) * 0.8;
          this.body.position.y = Math.abs(Math.sin(os.t * 10)) * 0.2;
          armR.rotation.z = 1.6 + Math.sin(os.t * 10) * 0.8;
          armL.rotation.z = -1.6 + Math.sin(os.t * 10) * 0.8;
          legL.rotation.z = Math.max(0, Math.sin(os.t * 10)) * 0.4;
          legR.rotation.z = Math.min(0, Math.sin(os.t * 10)) * 0.4;
          break;
        case 'heart':
          this.head.rotation.z = Math.sin(os.t * 6) * 0.15;
          armL.rotation.x = armR.rotation.x = -1.2;
          armL.rotation.z = 0.5;
          armR.rotation.z = -0.5;
          break;
        case 'jump':
          this.body.position.y = Math.sin(Math.PI * k) * 0.6;
          break;
      }
      if (os.t >= os.dur) this.oneShot = null;
    }

    if (this.cape) this.cape.rotation.x = 0.12 + (st === 'walk' ? 0.35 + Math.sin(t * 9) * 0.06 : Math.sin(t * 2) * 0.04);
    if (this.wings) this.wings.forEach((w, i) => (w.rotation.y = (i ? -1 : 1) * (0.3 + Math.sin(t * (st === 'walk' ? 14 : 5)) * 0.25)));
    if (this.tail) this.tail.rotation.x = 0.35 + Math.sin(t * (st === 'walk' ? 10 : 2)) * 0.12;
    // Damage flash.
    if (this.flash > 0) {
      this.flash -= dt;
      const on = this.flash > 0 && Math.floor(this.flash * 30) % 2 === 0;
      for (const m of this.mats) m.emissive?.set(on ? '#ff3030' : '#000000');
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }
}
