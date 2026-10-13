import * as THREE from 'three';
import * as assets from './assets.js';
import { mesh } from './toon.js';
import { SHADOW_LAYER } from './chunkmerge.js';
import { NavGrid } from '../../../shared/world.js';
import { dungeonCol, dungeonWalkable, dungeonBounds, setGate, roomAt, linkAt, trapUp, trapWarn, CELL, DUNGEONS } from '../../../shared/dungeon.js';

// A dungeon run, drawn from the layout the server sends (shared/dungeon.js
// makes it): 4 m floor tiles, walls on every floor edge that meets rock,
// gates and arches in the doorways, the dressing, torches and traps.
//
// - Only rooms the party has seen are drawn (the server owns that list).
// - The camera turns in quarter turns; walls on the camera's side drop to
//   stubs so you can always see in.
// - No point lights: torches are a glow plus a pool of light on the floor,
//   so nothing has to recompile when you go in or come out.

const SIDES = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const WALL_ROT = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const STUB = 0.14; // a cut-away wall's height, as a share of the full one
// Which wall a thing facing into the room at `rot` hangs on.
const sideOfRot = (rot) => ['n', 'w', 's', 'e'][((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4];

// Soft round glow (for torch flames and pools of light on the floor).
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, map: glowTexture(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

// Many copies of one model, each tagged with the room it belongs to, so a
// room's copies can be shown or hidden as it's discovered.
class Copies {
  constructor(parent, slot, items, opts = {}) {
    this.items = items;
    this.group = items.length ? assets.instanced(slot, items, opts) : null;
    if (!this.group) return;
    parent.add(this.group);
    this.base = this.group.children.map((m) => {
      m.frustumCulled = false; // instances span the whole crypt
      return m.instanceMatrix.array.slice();
    });
    this.show(new Set());
  }
  // Only the copies in seen rooms are drawn: they're packed at the front and
  // the mesh draws just that many (hidden copies would still cost vertices).
  show(revealed) {
    if (!this.group) return;
    this.group.children.forEach((m, k) => {
      const a = m.instanceMatrix.array;
      const b = this.base[k];
      let n = 0;
      this.items.forEach((it, i) => {
        if (!revealed.has(it.room)) return;
        for (let q = 0; q < 16; q++) a[n * 16 + q] = b[i * 16 + q];
        n++;
      });
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    });
  }
  each(fn) {
    this.group?.traverse((o) => o.isMesh && fn(o));
  }
}

export class DungeonView {
  constructor(scene, layout, { low = false, fx = null } = {}) {
    this.scene = scene;
    this.fx = fx;
    this.layout = layout;
    // Which dungeon model kit draws it (SPEC §4.7); a kind whose kit isn't
    // loaded falls back to the crypt's pieces.
    const K = DUNGEONS[layout.kind] ?? {};
    this.kit = K.kit && assets.has(`${K.kit}:template-wall`) ? K.kit : 'modular-dungeon';
    this.low = low;
    const L = layout;
    this.root = new THREE.Group();
    this.root.name = 'dungeon';
    scene.add(this.root);
    this.pickables = [];
    this.labels = []; // { what, text, glyph, pos, el? } tappable places (HTML labels)
    this.revealed = new Set();
    this.camSide = 's';
    this.anims = []; // (dt, t, ms) => void
    this.col = dungeonCol(L);
    this.nav = new NavGrid(this.col, { bounds: dungeonBounds(L), walkable: dungeonWalkable });

    const cellCh = (i, j) => (i < 0 || j < 0 || i >= L.w || j >= L.h ? '#' : L.cells[j][i]);
    const cx = (i) => L.ox + (i + 0.5) * CELL;
    const cz = (j) => L.oz + (j + 0.5) * CELL;
    // Which room a floor cell belongs to (a corridor: the room it leads to).
    const roomOfCell = (i, j) => roomAt(L, cx(i), cz(j))?.id ?? linkAt(L, cx(i), cz(j))?.b ?? 0;
    this.roomOfPoint = (x, z) => roomOfCell(Math.floor((x - L.ox) / CELL), Math.floor((z - L.oz) / CELL));

    // The way back up replaces one stretch of the Entry Hall's wall.
    const ex = L.exit;
    const inward = [Math.sin(ex.rot), Math.cos(ex.rot)];
    const edge = [ex.x - inward[0] * 1.15, ex.z - inward[1] * 1.15];
    const stairCell = [Math.floor((edge[0] + inward[0] * 0.5 - L.ox) / CELL), Math.floor((edge[1] + inward[1] * 0.5 - L.oz) / CELL)];
    const stairSide = sideOfRot(ex.rot);

    // ── Floors, walls and corners ───────────────────────────────────────
    const floors = [[], [], []];
    const walls = { n: [[], []], s: [[], []], e: [[], []], w: [[], []] };
    const corners = { nw: [], ne: [], se: [], sw: [] }; // a corner drops with either of its walls
    let k = 0;
    for (let j = 0; j < L.h; j++)
      for (let i = 0; i < L.w; i++) {
        if (cellCh(i, j) === '#') continue;
        const room = roomOfCell(i, j);
        const x = cx(i);
        const z = cz(j);
        const hash = (i * 73856093) ^ (j * 19349663);
        const fv = (hash >>> 0) % 10 < 2 ? 1 + ((hash >>> 4) & 1) : 0;
        floors[fv].push({ x, z, room });
        for (const [side, [dx, dz]] of Object.entries(SIDES)) {
          if (cellCh(i + dx, j + dz) !== '#') continue;
          if (room === 0 && i === stairCell[0] && j === stairCell[1] && side === stairSide) continue;
          const v = (hash >>> (8 + k++ % 5)) % 5 === 0 ? 1 : 0;
          walls[side][v].push({ x: x + dx * (CELL / 2), z: z + dz * (CELL / 2), rot: WALL_ROT[side], room });
        }
        // Inside corners: fill the gap where two walls' backs meet.
        const rock = (dx, dz) => cellCh(i + dx, j + dz) === '#';
        const sv = [2, 1.02, 2];
        if (rock(0, -1) && rock(-1, 0)) corners.nw.push({ x: x - 2, z: z - 2, rot: 0, sv, room });
        if (rock(0, -1) && rock(1, 0)) corners.ne.push({ x: x + 2, z: z - 2, rot: -Math.PI / 2, sv, room });
        if (rock(0, 1) && rock(1, 0)) corners.se.push({ x: x + 2, z: z + 2, rot: Math.PI, sv, room });
        if (rock(0, 1) && rock(-1, 0)) corners.sw.push({ x: x - 2, z: z + 2, rot: Math.PI / 2, sv, room });
      }
    this.floors = ['template-floor', 'template-floor-detail', 'template-floor-detail-a'].map((n, v) => new Copies(this.root, `${this.kit}:${n}`, floors[v], { castShadow: false, outline: false }));
    for (const f of this.floors)
      f.each((m) => {
        m.userData.ground = true;
        m.receiveShadow = true;
      });
    this.pickables.push(...this.floors.map((f) => f.group).filter(Boolean));
    this.walls = {};
    for (const side of Object.keys(SIDES)) {
      const g = new THREE.Group();
      this.root.add(g);
      const parts = [new Copies(g, `${this.kit}:template-wall`, walls[side][0], { castShadow: false }), new Copies(g, `${this.kit}:template-wall-detail-a`, walls[side][1], { castShadow: false })];
      this.walls[side] = { group: g, parts, h: 1, sides: [side] };
    }
    for (const type of Object.keys(corners)) {
      const g = new THREE.Group();
      this.root.add(g);
      this.walls[type] = { group: g, parts: [new Copies(g, `${this.kit}:template-wall-corner`, corners[type], { castShadow: false })], h: 1, sides: [...type] };
    }
    // Without the kit: plain blocks, so a missing model never leaves you in the void.
    if (!assets.has(`${this.kit}:template-wall`)) this.#fallbackWalls(walls);

    // ── The way out ─────────────────────────────────────────────────────
    const stairs = assets.make(`${this.kit}:stairs`);
    if (stairs) {
      stairs.object.scale.set(0.9, 0.5, 0.48);
      stairs.object.rotation.y = ex.rot;
      stairs.object.position.set(edge[0] - inward[0] * 1.06, 0, edge[1] - inward[1] * 1.06);
      this.root.add(stairs.object);
      this.stairs = stairs.object;
    }
    this.#usable('exit', { x: ex.x, z: ex.z, r: 1.6, text: 'Way out', glyph: 'stairs', y: 3.4, room: 0 }, stairs?.object);

    // ── Gates (bars that drop into the floor) and arches ────────────────
    this.gates = new Map();
    for (const g of L.gates) {
      const made = assets.make(`${this.kit}:gate-metal-bars`);
      const obj = made?.object ?? mesh(new THREE.BoxGeometry(4, 4, 0.3), '#4a4540');
      obj.position.set(g.x, 0, g.z);
      obj.rotation.y = g.dir === 'n' || g.dir === 's' ? 0 : Math.PI / 2;
      const bars = obj.getObjectByName('gate') ?? obj;
      if (g.key)
        bars.traverse((o) => {
          if (!o.isMesh || o.material?.side === THREE.BackSide || !o.material?.color) return;
          o.material = o.material.clone(); // the Vault's bars are gilded
          o.material.color.set('#e8c25a');
        });
      this.root.add(obj);
      const gv = { g, obj, bars, open: false, t: 1, side: g.dir, rooms: [g.from], h: 1, lock: null };
      if (g.key) {
        gv.lock = { what: `gate:${g.id}`, text: 'Bone Key needed', glyph: 'key', pos: new THREE.Vector3(g.x, 3.2, g.z), room: g.from, lock: true };
        this.labels.push(gv.lock);
      }
      obj.traverse((o) => o.isMesh && (o.userData.dtap = `gate:${g.id}`));
      this.pickables.push(obj);
      this.gates.set(g.id, gv);
    }
    this.arches = L.arches.map((a, i) => {
      const made = assets.make(`${this.kit}:gate`);
      if (!made) return null;
      made.object.position.set(a.x, 0, a.z);
      made.object.rotation.y = a.dir === 'n' || a.dir === 's' ? 0 : Math.PI / 2;
      this.root.add(made.object);
      return { obj: made.object, side: OPP[a.dir], rooms: [L.links[i].b], h: 1 };
    }).filter(Boolean);

    // ── Dressing ────────────────────────────────────────────────────────
    const bySlot = new Map();
    const onWall = { n: [], s: [], e: [], w: [] }; // torches and banners (hidden with a cut-away wall)
    const pools = [];
    const flames = { n: [], s: [], e: [], w: [] };
    const fires = [];
    const pillars = [];
    for (const p of L.props) {
      const room = this.roomOfPoint(p.x, p.z);
      if (p.use) continue;
      if (p.slot === 'dg_torch') {
        const side = sideOfRot(p.rot);
        const [ix, iz] = [Math.sin(p.rot), Math.cos(p.rot)];
        onWall[side].push({ slot: 'dg_lantern', x: p.x - ix * 0.2, z: p.z - iz * 0.2, y: 1.75, rot: p.rot, room });
        flames[side].push({ x: p.x + ix * 0.25, z: p.z + iz * 0.25, y: 2.05, room }); // just in front of the lantern's glass
        pools.push({ x: p.x + ix * 1.2, z: p.z + iz * 1.2, s: 7, room });
        continue;
      }
      if (p.slot === 'dg_banner') {
        const side = sideOfRot(p.rot);
        onWall[side].push({ slot: 'dg_banner', x: p.x - Math.sin(p.rot) * 0.42, z: p.z - Math.cos(p.rot) * 0.42, y: 1.3, rot: p.rot, room });
        continue;
      }
      if (p.slot === 'dg_fire') {
        fires.push({ x: p.x, z: p.z, y: 0.9, s: 2.2, room });
        pools.push({ x: p.x, z: p.z, s: 9, room });
      }
      if (p.slot === 'dg_pillar') {
        pillars.push({ ...p, room });
        continue;
      }
      const v = assets.variantCount(p.slot) > 1 ? Math.abs(Math.round(p.x * 7 + p.z * 13)) % assets.variantCount(p.slot) : 0;
      const key = `${p.slot}|${v}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push({ x: p.x, z: p.z, rot: p.rot, room });
    }
    this.props = [...bySlot.entries()].map(([key, items]) => {
      const [slot, v] = key.split('|');
      return new Copies(this.root, slot, items, { variant: +v });
    });
    this.wallProps = {};
    for (const side of Object.keys(SIDES)) {
      const g = new THREE.Group();
      this.root.add(g);
      const per = new Map();
      for (const it of onWall[side]) {
        if (!per.has(it.slot)) per.set(it.slot, []);
        per.get(it.slot).push(it);
      }
      const parts = [...per.entries()].map(([slot, items]) => new Copies(g, slot, items, { castShadow: false, outline: slot !== 'dg_banner' }));
      parts.push(this.#glows(g, flames[side], '#ffb04a', 1.3));
      this.wallProps[side] = { group: g, parts };
    }
    // Tall pillars are their own meshes, so one standing between the camera
    // and you can fade (like the town's buildings).
    this.fades = [];
    this.pillars = pillars.map((p) => {
      const made = assets.make('dg_pillar', { unique: true });
      if (!made) return null;
      made.object.position.set(p.x, 0, p.z);
      this.root.add(made.object);
      made.object.updateMatrixWorld(true);
      const mats = [];
      const outlines = [];
      made.object.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material.side === THREE.BackSide) outlines.push(o);
        else mats.push(...[].concat(o.material));
      });
      const f = { box: new THREE.Box3().setFromObject(made.object), mats, outlines, op: 1, obj: made.object, room: p.room };
      this.fades.push(f);
      return f;
    }).filter(Boolean);
    this.fires = this.#glows(this.root, fires, '#ff9a3c', 1);
    this.pools = this.#pools(this.root, pools, '#ffae5c', this.low ? 0.33 : 0.4);
    this.flameT = 0;

    // ── Things to use: the brazier, the shrine, the Vault ───────────────
    for (const p of L.props.filter((q) => q.use && q.use !== 'exit')) {
      const room = this.roomOfPoint(p.x, p.z);
      const slot = { rest: 'dg_brazier', shrine: 'dg_altar', vault: 'dg_chest' }[p.use];
      const made = assets.make(slot);
      const obj = made?.object ?? mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.9, 10), '#6b5a48');
      obj.position.set(p.x, 0, p.z);
      obj.rotation.y = p.rot;
      if (p.use === 'vault') obj.scale.setScalar(1.6);
      this.root.add(obj);
      if (p.use === 'rest') {
        this.brazier = { obj, glow: this.#glows(this.root, [{ x: p.x, z: p.z, y: 1.2, s: 3.4, room }], '#ffb347', 1) };
        this.restPool = this.#pools(this.root, [{ x: p.x, z: p.z, s: 13, room }], '#ffb347', 0.5);
      }
      if (p.use === 'shrine') this.altar = { obj, glow: this.#glows(this.root, [{ x: p.x, z: p.z, y: 1.4, s: 2.6, room }], '#8fc4ff', 0.9), pool: this.#pools(this.root, [{ x: p.x, z: p.z, s: 10, room }], '#7fb2ff', 0.45) };
      if (p.use === 'vault') this.vault = { obj, made, room };
      const text = { rest: 'Last Light', shrine: 'Shrine', vault: 'Vault' }[p.use];
      const glyph = { rest: 'fire', shrine: 'spark', vault: 'lock' }[p.use];
      this.#usable(p.use, { x: p.x, z: p.z, r: 1.4, text, glyph, y: p.use === 'vault' ? 2.4 : 2.6, room }, obj);
    }
    // The Pale Count's chest appears when he falls.
    const bc = L.bossChest;
    const bm = assets.make('dg_chest');
    this.bossChest = { obj: bm?.object ?? mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), '#8a5a2a'), made: bm, room: this.roomOfPoint(bc.x, bc.z) };
    this.bossChest.obj.position.set(bc.x, 0, bc.z);
    this.bossChest.obj.scale.setScalar(2);
    this.bossChest.obj.visible = false;
    this.root.add(this.bossChest.obj);
    this.#usable('boss', { x: bc.x, z: bc.z, r: 1.6, text: 'Boss chest', glyph: 'trophy', y: 2.8, room: this.bossChest.room, hidden: true }, this.bossChest.obj);

    // ── Spike traps (in step with the server's clock) ───────────────────
    this.traps = L.traps.map((t) => {
      const made = assets.make('dg_trap');
      const obj = made?.object ?? mesh(new THREE.BoxGeometry(3.4, 0.2, 3.4), '#5a524a');
      obj.position.set(t.x, 0, t.z);
      this.root.add(obj);
      const spikes = obj.getObjectByName('spikes');
      const warn = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8).rotateX(-Math.PI / 2), additive('#ff3a2a', 0));
      warn.position.set(t.x, 0.06, t.z);
      this.root.add(warn);
      return { t, obj, spikes, base: spikes?.position.y ?? 0, warn, room: this.roomOfPoint(t.x, t.z), up: false };
    });

    // Your own lantern: a warm pool of light that follows you.
    this.lantern = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive('#ffcf8a', 0.38));
    this.lantern.scale.setScalar(11);
    this.lantern.renderOrder = 1;
    this.root.add(this.lantern);

    this.root.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && o.material?.blending !== THREE.AdditiveBlending && o.material?.side !== THREE.BackSide) (o.castShadow = true), o.layers.enable(SHADOW_LAYER);
    });
  }

  // A thing you can tap to walk over and use (with its label).
  #usable(what, { x, z, r, text, glyph, y, room, hidden = false }, obj) {
    const pick = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2.6, 10), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.set(x, 1.3, z);
    pick.userData.dtap = what;
    this.root.add(pick);
    this.pickables.push(pick);
    obj?.traverse((o) => o.isMesh && (o.userData.dtap = what));
    const label = { what, text, glyph, pos: new THREE.Vector3(x, y, z), room, hidden, x, z, pick };
    this.labels.push(label);
    return label;
  }
  label(what) {
    return this.labels.find((l) => l.what === what);
  }

  // Additive glows (camera-facing points), one draw call per set.
  #glows(parent, items, color, size) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(items.flatMap((g) => [g.x, g.y, g.z]), 3));
    const mat = new THREE.PointsMaterial({ color, map: glowTexture(), size: size * (this.low ? 1.1 : 1), sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.items = items;
    pts.userData.size = mat.size;
    pts.userData.scale = items.map((g) => g.s ?? 1);
    if (items.some((g) => g.s)) {
      // Points have one size; a bigger fire just gets two layers.
      mat.size *= Math.max(...items.map((g) => g.s ?? 1));
      pts.userData.size = mat.size;
    }
    parent.add(pts);
    pts.userData.show = (revealed) => {
      const a = geo.attributes.position.array;
      items.forEach((g, i) => (a[i * 3 + 1] = revealed.has(g.room) ? g.y : -50));
      geo.attributes.position.needsUpdate = true;
    };
    pts.userData.show(new Set());
    return pts;
  }
  // Pools of light on the floor (one instanced quad each).
  #pools(parent, items, color, opacity) {
    if (!items.length) return null;
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive(color, opacity), items.length);
    im.frustumCulled = false;
    im.renderOrder = 1;
    const o = new THREE.Object3D();
    im.userData.show = (revealed) => {
      items.forEach((p, i) => {
        o.position.set(p.x, 0.035 + i * 0.0005, p.z);
        o.scale.setScalar(revealed.has(p.room) ? p.s : 0);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    };
    im.userData.show(new Set());
    parent.add(im);
    return im;
  }

  #fallbackWalls(walls) {
    const geo = new THREE.BoxGeometry(CELL, 4.15, 0.6).translate(0, 2.07, -0.3);
    for (const side of Object.keys(SIDES)) {
      const items = [...walls[side][0], ...walls[side][1]].map((it) => ({ ...it }));
      if (!items.length) continue;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshToonMaterial({ color: '#77736c' }), items.length);
      const o = new THREE.Object3D();
      items.forEach((it, i) => {
        o.position.set(it.x, 0, it.z);
        o.rotation.y = it.rot;
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      this.walls[side].group.add(im);
    }
  }

  // ── State from the server ─────────────────────────────────────────────
  reveal(rooms) {
    let grew = false;
    for (const r of rooms) if (!this.revealed.has(r)) (this.revealed.add(r), (grew = true));
    if (!grew) return;
    const R = this.revealed;
    for (const f of this.floors) f.show(R);
    for (const w of Object.values(this.walls)) for (const p of w.parts) p.show(R);
    for (const w of Object.values(this.wallProps)) for (const p of w.parts) p.isPoints ? p.userData.show(R) : p.show(R);
    for (const p of this.props) p.show(R);
    this.fires.userData.show(R);
    this.pools?.userData.show(R);
    for (const x of [this.brazier?.glow, this.altar?.glow, this.altar?.pool, this.restPool]) x?.userData.show(R);
    for (const gv of this.gates.values()) gv.obj.visible = gv.rooms.some((r) => R.has(r)) || R.has(gv.g.to);
    for (const a of this.arches) a.obj.visible = a.rooms.some((r) => R.has(r));
    for (const t of this.traps) t.obj.visible = t.warn.visible = R.has(t.room);
    if (this.stairs) this.stairs.visible = R.has(0);
    for (const o of [this.vault?.obj, this.brazier?.obj, this.altar?.obj]) if (o) o.visible = R.has(this.roomOfPoint(o.position.x, o.position.z));
    for (const f of this.pillars) f.obj.visible = R.has(f.room);
  }
  isRevealed(room) {
    return this.revealed.has(room);
  }
  // Gates open: the bars sink into the floor; the paths open up.
  openGates(ids, animate = true) {
    let any = false;
    for (const id of ids) {
      const gv = this.gates.get(id);
      if (!gv || gv.open) continue;
      gv.open = true;
      gv.t = animate ? 0 : 1;
      setGate(this.col, id, true);
      if (gv.lock) gv.lock.hidden = true;
      any = true;
    }
    if (any) this.nav.invalidate();
    return any;
  }
  setKey(has) {
    this.hasKey = has;
    const v = this.label('vault');
    if (v) v.glyph = has ? 'key' : 'lock';
    for (const gv of this.gates.values()) if (gv.lock) gv.lock.text = has ? 'Opens when the room is clear' : 'Bone Key needed';
  }
  showBossChest(animate = true) {
    if (this.bossChest.obj.visible) return;
    this.bossChest.obj.visible = true;
    this.label('boss').hidden = false;
    if (animate) this.bossChest.rise = 0;
  }
  openChest(which) {
    const c = which === 'vault' ? this.vault : this.bossChest;
    if (!c?.made?.actions || c.opened) return;
    c.opened = true;
    const a = c.made.actions.open;
    if (!a) return;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().play();
  }
  usedFire(which) {
    // The brazier's flame dims once you've had your Last Light; the shrine's when it's spent.
    if (which === 'rest' && this.brazier) this.brazier.glow.material.opacity = 0.45;
    if (which === 'shrine' && this.altar) {
      this.altar.glow.material.opacity = 0.2;
      this.altar.pool.material.opacity = 0.1;
    }
  }

  // The camera looks in from this side: its walls drop to stubs.
  setCamSide(side) {
    this.camSide = side;
  }
  // The side a camera at yaw `yaw` is on.
  static sideOfYaw(yaw) {
    return ['s', 'e', 'n', 'w'][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4];
  }

  update(dt, t, serverMs, hero) {
    // Cut-away walls ease down and back up.
    const ease = Math.min(1, dt * 7);
    for (const [side, w] of Object.entries(this.walls)) {
      const want = w.sides.includes(this.camSide) ? STUB : 1;
      if (Math.abs(w.h - want) > 0.002) {
        w.h += (want - w.h) * ease;
        w.group.scale.y = w.h;
      }
      if (this.wallProps[side]) this.wallProps[side].group.visible = w.h > 0.6;
    }
    for (const gv of this.gates.values()) {
      const want = gv.side === this.camSide ? STUB : 1;
      gv.h += (want - gv.h) * ease;
      if (gv.t < 1) gv.t = Math.min(1, gv.t + dt / 0.9);
      gv.obj.scale.y = gv.h;
      if (gv.bars !== gv.obj) {
        gv.bars.position.y = -3.6 * (gv.open ? gv.t * gv.t : 0);
        gv.bars.visible = !(gv.open && gv.t >= 1);
      }
    }
    for (const a of this.arches) {
      const want = a.side === this.camSide ? STUB : 1;
      a.h += (want - a.h) * ease;
      a.obj.scale.y = a.h;
    }
    if (this.stairs) this.stairs.visible = this.revealed.has(0) && this.camSide !== sideOfRot(this.layout.exit.rot);
    // Flicker.
    this.flameT += dt;
    const f = 1 + Math.sin(t * 13) * 0.05 + Math.sin(t * 7.3) * 0.04;
    for (const w of Object.values(this.wallProps)) for (const p of w.parts) if (p.isPoints) p.material.size = p.userData.size * f;
    this.fires.material.size = this.fires.userData.size * f;
    if (this.brazier) this.brazier.glow.material.size = this.brazier.glow.userData.size * (1 + Math.sin(t * 9) * 0.06);
    if (this.pools) this.pools.material.opacity = (this.low ? 0.33 : 0.4) * (0.94 + Math.sin(t * 11) * 0.03 + Math.sin(t * 5.1) * 0.03);
    // Spikes: up, down, and a red warning just before they rise.
    for (const tr of this.traps) {
      const up = trapUp(tr.t, serverMs);
      const warn = !up && trapWarn(tr.t, serverMs);
      if (tr.spikes) tr.spikes.position.y += ((up ? tr.base : tr.base - 0.32) - tr.spikes.position.y) * Math.min(1, dt * (up ? 30 : 8));
      tr.warn.material.opacity += ((warn ? 0.55 : up ? 0.25 : 0) - tr.warn.material.opacity) * Math.min(1, dt * 12);
      tr.up = up;
    }
    // Chests: the boss chest rises from the floor; lids animate.
    const bc = this.bossChest;
    if (bc.rise != null && bc.rise < 1) {
      bc.rise = Math.min(1, bc.rise + dt / 0.8);
      bc.obj.position.y = -1.8 * (1 - bc.rise) ** 2;
    }
    this.vault?.made?.mixer?.update(dt);
    bc.made?.mixer?.update(dt);
    if (hero) this.lantern.position.set(hero.x, 0.045, hero.z);
    // Embers from the brazier and the boss room's fire baskets.
    if (this.fx) {
      const fires = this.fires.userData.items;
      for (const f of [...(this.brazier ? [{ x: this.brazier.obj.position.x, z: this.brazier.obj.position.z, y: 1.1, room: 0, big: true }] : []), ...fires]) {
        if (!this.revealed.has(f.room) || Math.random() > dt * (f.big ? 16 : 7)) continue;
        this.fx.puff.burst(new THREE.Vector3(f.x, f.y + 0.2, f.z), { ambient: 'embers', n: 1, color: ['#ffb347', '#ff7a2a', '#ffe08a'], speed: 0.5, up: 2.4, gravity: -1, size: f.big ? 0.26 : 0.18, life: 0.7, jitter: f.big ? 0.4 : 0.2 });
      }
    }
    for (const a of this.anims) a(dt, t, serverMs);
  }

  dispose() {
    this.scene.remove(this.root);
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      const g = o.geometry;
      if (g && !g.userData.shared && !seen.has(g)) {
        seen.add(g);
        g.dispose();
      }
      if (o.isPoints) o.material.dispose();
    });
  }
}
