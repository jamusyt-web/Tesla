import * as THREE from 'three';
import { h, clear } from '../util/dom.js';
import { getToken } from '../net/api.js';
import { useGrade } from '../scene/grade.js';
import * as assets from '../scene/assets.js';
import { buildTown, disposeTown } from '../scene/town.js';
import { Particles } from '../scene/fx.js';
import { PROC_BUILDERS } from '../scene/procprops.js';
import { setWorld, mapProblems, formatMap, upgradeMap, buildColliders, NavGrid, approachPoint, doorPoint, NODE_TYPES, stoneFront, STONE_RANGE, EXTENT } from '../../../shared/world.js';
import { paintWorld } from '../ui/mapdraw.js';
import { KINDS, KIND_KEYS, PALETTE, show, store } from './kinds.js';

// The world editor: a top-down view of the real world where the server owner
// places, moves and removes things, then saves the map back to the server.
// It works on its own copy of the map and rebuilds the view after each change.

const DRAFT_KEY = 'hv_editor_draft';
const GRID = 0.5;
const ROT_STEP = Math.PI / 12; // 15°
const SEL = '#ffd84a';
// Big areas: click to select them first, so dragging inside one still pans.
const AREAS = new Set(['spawns', 'zones', 'lakes', 'plazas', 'regions', 'paths', 'lands']);
const AREA_COL = { lands: '#e8d9a8', spawns: '#e0503a', zones: '#7fc06a', lakes: '#5fb3e0', plazas: '#d9c7a3', regions: '#b48cff', docks: '#c9a24a' };
const json = (o) => JSON.stringify(o);
const r2 = (v) => Math.round(v * 100) / 100;

export async function openEditor(root, { onProgress = () => {} } = {}) {
  const res = await fetch('/api/map');
  if (!res.ok) throw new Error(`Couldn't load the map (HTTP ${res.status}).`);
  const etag = res.headers.get('etag');
  const map = await res.json();
  await assets.loadAssets(onProgress);
  return new Editor(root, map, etag);
}

class Editor {
  constructor(root, map, etag) {
    this.map = upgradeMap(map);
    for (const k of KIND_KEYS) this.map[k] ??= [];
    this.base = etag;
    this.savedJson = json(map);
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null; // { kind, id }
    this.tool = 'select'; // select | place | path | spawn
    this.placing = null; // palette item
    this.drawing = null; // path being drawn: [[x, z], ...]
    this.opts = { snap: true, vary: true, areas: true, colliders: false };
    this.tab = 'place';
    this.cam = { x: map.spawn.x, z: map.spawn.z, yaw: 0, pitch: 0.95, dist: 60 };
    this.keys = new Set();
    this.pointers = new Map();

    // ── 3D view
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    useGrade(renderer);
    this.renderer = renderer;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#9fb4bc');
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1200);
    const hemi = new THREE.HemisphereLight('#c8d8ec', '#6b5a48', 1.3);
    const sun = new THREE.DirectionalLight('#ffe4bc', 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 220 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    scene.add(hemi, sun, sun.target);
    this.sun = sun;
    this.fx = new Particles(scene);
    this.fx.puff = new Particles(scene, 300, true);
    this.overlay = new THREE.Group();
    this.overlay.renderOrder = 10;
    scene.add(this.overlay);
    this.ghost = new THREE.Group();
    scene.add(this.ghost);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll();

    // ── Page
    this.labelsEl = h('div.ed-labels');
    this.statusEl = h('div.ed-status');
    this.sideEl = h('div.ed-side');
    this.topEl = h('div.ed-top');
    this.el = h('div.editor', renderer.domElement, this.labelsEl, this.topEl, this.sideEl, this.statusEl);
    root.append(this.el);
    this.#bindInput();
    this.#drawTop();
    this.#drawSide();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.rebuildNow();
    this.#offerDraft();
    window.__ed = this; // handy for debugging and automated tests
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ── Map helpers ─────────────────────────────────────────────────────
  list(kind) {
    return (this.map[kind] ??= []);
  }
  find(sel = this.sel) {
    return sel ? this.list(sel.kind).find((e) => e.id === sel.id) ?? null : null;
  }
  newId(kind) {
    // Heroes remember waystones by id: never hand a new stone an old one's id.
    if (kind === 'stones') return `stone_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const used = new Set(KIND_KEYS.flatMap((k) => this.list(k).map((e) => e.id)));
    const pre = KINDS[kind].prefix;
    let n = 0;
    for (const id of used) {
      const m = id.startsWith(pre) && /^\d+$/.test(id.slice(pre.length)) ? Number(id.slice(pre.length)) : -1;
      if (m >= n) n = m + 1;
    }
    while (used.has(`${pre}${n}`)) n++;
    return `${pre}${n}`;
  }
  get dirty() {
    return json(this.map) !== this.savedJson;
  }
  snap(v) {
    return this.opts.snap ? Math.round(v / GRID) * GRID : r2(v);
  }

  // Every edit goes through here: it can be undone, and the view catches up.
  change(fn, { rebuild = true } = {}) {
    const before = json(this.map);
    fn();
    if (json(this.map) === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
    this.#afterChange(rebuild);
  }
  #afterChange(rebuild = true) {
    try {
      localStorage.setItem(DRAFT_KEY, json({ base: this.base, map: this.map, t: Date.now() }));
    } catch {}
    if (this.sel && !this.find()) this.sel = null;
    if (rebuild) this.scheduleRebuild();
    else this.drawOverlay();
    this.#drawSide();
    this.#drawTop();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(json(this.map));
    this.map = JSON.parse(this.undoStack.pop());
    this.#afterChange();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(json(this.map));
    this.map = JSON.parse(this.redoStack.pop());
    this.#afterChange();
  }

  // ── Rebuilding the 3D world from the working map ───────────────────
  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuildNow(), 40);
    this.drawOverlay();
  }
  rebuildNow() {
    const t0 = performance.now();
    try {
      setWorld(this.map);
    } catch (e) {
      this.say(e.message, true);
      return;
    }
    if (this.town) disposeTown(this.town);
    this.town = buildTown(this.scene, this.fx, { focus: { x: this.cam.x, z: this.cam.z } });
    this.town.viewRadius = this.#viewRadius();
    this.buildMs = Math.round(performance.now() - t0);
    this.drawOverlay();
  }

  // ── Picking ─────────────────────────────────────────────────────────
  #ndc(cx, cy) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }
  // Where the cursor meets the ground (y = 0).
  groundAt(cx, cy) {
    this.raycaster.setFromCamera(this.#ndc(cx, cy), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }
  // What the cursor is over, as a world point (first thing the ray hits).
  surfaceAt(cx, cy) {
    if (!this.town) return this.groundAt(cx, cy);
    this.raycaster.setFromCamera(this.#ndc(cx, cy), this.camera);
    const hit = this.raycaster.intersectObject(this.town.root, true).find((i) => i.object.visible !== false);
    return hit ? hit.point : this.groundAt(cx, cy);
  }
  // Everything under a point, best match first (small things beat big areas).
  candidates(x, z) {
    const out = [];
    for (const kind of KIND_KEYS) {
      const K = KINDS[kind];
      for (const e of this.list(kind)) {
        let d = Infinity;
        let size = 1;
        if (kind === 'paths') {
          for (let i = 1; i < e.pts.length; i++) d = Math.min(d, segDist(x, z, e.pts[i - 1], e.pts[i]));
          if (d > e.w + 0.6) continue;
        } else {
          const s = K.hit(e);
          if (s.w) {
            if (Math.abs(x - e.x) > s.w / 2 + 0.3 || Math.abs(z - e.z) > s.d / 2 + 0.3) continue;
            d = Math.hypot(x - e.x, z - e.z);
            size = Math.max(s.w, s.d);
          } else {
            d = Math.hypot(x - e.x, z - e.z);
            if (d > s.r + 0.3) continue;
            size = s.r;
          }
        }
        out.push({ kind, id: e.id, score: K.order * 1000 + d / Math.max(size, 0.5) });
      }
    }
    return out.sort((a, b) => a.score - b.score);
  }
  pickAt(cx, cy) {
    const p = this.surfaceAt(cx, cy);
    if (!p) return null;
    const list = this.candidates(p.x, p.z);
    if (!list.length) return null;
    // Clicking the same spot again steps through what's stacked there.
    const lp = this.lastPick;
    let i = 0;
    if (lp && Math.hypot(lp.x - p.x, lp.z - p.z) < 0.6 && lp.ids === list.map((c) => c.id).join()) i = (lp.i + 1) % list.length;
    this.lastPick = { x: p.x, z: p.z, ids: list.map((c) => c.id).join(), i };
    return list[i];
  }
  select(sel) {
    this.sel = sel ? { kind: sel.kind, id: sel.id } : null;
    if (sel) this.tab = 'selected';
    this.pathPoint = null;
    this.drawOverlay();
    this.#drawSide();
  }

  // ── Actions ─────────────────────────────────────────────────────────
  place(item, x, z) {
    const e = { id: this.newId(item.kind), ...item.make(this.snap(x), this.snap(z), this.map, this.opts) };
    this.change(() => this.list(item.kind).push(e));
    // Plants, props and nodes: keep placing. Anything bigger: select it to set it up.
    if (item.kind !== 'props' && item.kind !== 'nodes') {
      this.setTool('select');
      this.select({ kind: item.kind, id: e.id });
    }
    return e;
  }
  remove() {
    const e = this.find();
    if (!e) return;
    if (e.station) return this.say("Crafting stations can be moved but not deleted (the Workshop needs all five).", true);
    if (this.sel.kind === 'buildings' && !e.deco) return this.say(`The ${e.label} can be moved but not deleted: the game needs it.`, true);
    if (this.sel.kind === 'gates' && this.list('gates').length === 1) return this.say('The world needs at least one gatehouse.', true);
    if (this.sel.kind === 'lands' && this.list('lands').length === 1) return this.say('The world needs some land.', true);
    const { kind, id } = this.sel;
    this.change(() => (this.map[kind] = this.list(kind).filter((x) => x.id !== id)));
    this.sel = null;
    this.#drawSide();
  }
  duplicate() {
    const e = this.find();
    if (!e || e.station || (this.sel.kind === 'buildings' && !e.deco)) return this.say("That one can't be copied.", true);
    const copy = { ...structuredClone(e), id: this.newId(this.sel.kind) };
    if (copy.pts) copy.pts = copy.pts.map(([x, z]) => [x + 2, z + 2]);
    else Object.assign(copy, { x: e.x + 2, z: e.z + 2 });
    this.change(() => this.list(this.sel.kind).push(copy));
    this.select({ kind: this.sel.kind, id: copy.id });
  }
  rotate(dir) {
    const e = this.find();
    if (!e) return;
    if (this.sel.kind === 'buildings') {
      const order = ['n', 'e', 's', 'w'];
      this.change(() => (e.face = order[(order.indexOf(e.face || 's') + (dir > 0 ? 1 : 3)) % 4]));
    } else if ('rot' in e || this.sel.kind === 'props' || this.sel.kind === 'nodes') {
      this.change(() => (e.rot = +((((e.rot || 0) + dir * ROT_STEP) % (Math.PI * 2)) + 0).toFixed(3)));
    }
  }
  finishPath() {
    const pts = dedupe(this.drawing);
    this.drawing = null;
    this.tool = 'select';
    if (!pts || pts.length < 2) return this.#drawTop(), this.drawOverlay(), this.say('A path needs at least two points.');
    const e = { id: this.newId('paths'), pts, w: 1.6 };
    this.change(() => this.list('paths').push(e));
    this.select({ kind: 'paths', id: e.id });
    this.#drawTop();
    this.say('Path added. Drag its points to reshape it, or set its width in the panel.');
  }
  setTool(tool, item = null) {
    if (this.tool === 'path' && tool !== 'path' && this.drawing?.length >= 2) return this.finishPath();
    this.tool = tool;
    this.placing = item;
    this.drawing = tool === 'path' ? [] : null;
    this.#clearGhost();
    if (item) this.#makeGhost(item);
    this.#drawTop();
    this.drawOverlay();
    this.say(
      {
        select: 'Click something to select it. Drag it to move it. Drag empty ground to look around.',
        place: `Click to place ${item?.label ?? ''}. Keep clicking to place more; Esc to stop.`,
        path: 'Click to add path points. Double-click, Enter or Esc to finish.',
        spawn: 'Click where new heroes should appear.',
      }[tool],
    );
  }

  // ── Saving ──────────────────────────────────────────────────────────
  // Things that would trap or confuse players: unreachable nodes, doors and camps.
  reachability() {
    setWorld(this.map);
    const col = buildColliders();
    const nav = new NavGrid(col);
    const sp = this.map.spawn;
    const out = [];
    if (!nav.nearestOpen(sp.x, sp.z)) out.push('The spawn point is inside something solid.');
    for (const n of this.map.nodes) if (!approachPoint(n, sp.x, sp.z, col, nav)) out.push(`${NODE_TYPES[n.type]?.name ?? n.type} ${n.id} at ${r2(n.x)}, ${r2(n.z)}`);
    for (const b of this.map.buildings) {
      const [x, z] = doorPoint(b);
      if (!nav.findPath(sp.x, sp.z, x, z)) out.push(`The door of ${b.label || b.id}`);
    }
    for (const s of this.map.spawns) {
      const p = nav.nearestOpen(s.x, s.z);
      if (!p || !nav.findPath(sp.x, sp.z, p[0], p[1])) out.push(`Monster camp ${s.id}`);
    }
    // Waystones: you arrive in front of them, and must be able to walk up to attune.
    for (const st of this.map.stones) {
      const [x, z] = stoneFront({ rot: 0, ...st });
      const p = nav.nearestOpen(x, z);
      if (!p || Math.hypot(p[0] - st.x, p[1] - st.z) > STONE_RANGE - 1 || !nav.findPath(sp.x, sp.z, p[0], p[1])) out.push(`Waystone ${st.name || st.id}`);
    }
    return out;
  }
  async save() {
    const bad = mapProblems(this.map);
    if (bad.length) return this.dialog('The map has problems', h('ul', ...bad.slice(0, 20).map((b) => h('li', b))), [['OK']]);
    this.say('Checking every path from the spawn point…');
    await new Promise((r) => setTimeout(r, 30));
    const stuck = this.reachability();
    if (stuck.length) {
      const go = await this.dialog(
        "Some things can't be reached",
        h('div', h('p', "Players starting at the spawn point can't walk to:"), h('ul', ...stuck.slice(0, 15).map((s) => h('li', s))), stuck.length > 15 ? h('p', `…and ${stuck.length - 15} more.`) : null),
        [['Keep editing'], ['Save anyway', 'red']],
      );
      if (go !== 1) return this.say('Not saved.');
    }
    this.say('Saving…');
    const r = await fetch('/api/map', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() || ''}` }, body: JSON.stringify({ map: this.map, base: this.base }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return this.dialog("Couldn't save", h('p', { style: { whiteSpace: 'pre-wrap' } }, body.error || `HTTP ${r.status}`), [['OK']]);
    this.base = body.etag;
    this.map.rev = body.rev;
    this.savedJson = json(this.map);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    this.#drawTop();
    this.#drawSide();
    this.say(`Saved (version ${body.rev}). Everyone in the world was sent back in to the new version.`);
  }
  export() {
    const a = h('a', { href: URL.createObjectURL(new Blob([formatMap(this.map)], { type: 'application/json' })), download: `hearthvale-map-v${this.map.rev ?? 0}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.say('Map file downloaded. Send it over to share your changes.');
  }
  import() {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      let m;
      try {
        m = JSON.parse(await f.text());
      } catch {
        return this.say("That file isn't a map (not valid JSON).", true);
      }
      m = upgradeMap(m);
      const bad = mapProblems(m);
      if (bad.length) return this.dialog("Can't load that map", h('ul', ...bad.slice(0, 20).map((b) => h('li', b))), [['OK']]);
      this.change(() => {
        for (const k of Object.keys(this.map)) delete this.map[k];
        Object.assign(this.map, m);
        for (const k of KIND_KEYS) this.map[k] ??= [];
      });
      this.sel = null;
      this.say(`Loaded ${f.name}. Save to make it live.`);
    };
    input.click();
  }
  async exit() {
    if (this.dirty && (await this.dialog('Leave the editor?', h('p', "Your changes aren't saved to the world yet. They stay in this browser as a draft, and the editor offers them back next time."), [['Stay'], ['Leave', 'red']])) !== 1) return;
    this.leaving = true;
    location.href = '/';
  }
  async #offerDraft() {
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    } catch {}
    if (!d?.map || json(d.map) === this.savedJson) return;
    const same = d.base === this.base;
    const when = new Date(d.t).toLocaleString();
    const pick = await this.dialog('Unsaved changes found', h('p', same ? `You have unsaved edits from ${when}. Pick up where you left off?` : `You have unsaved edits from ${when}, but the world has been saved since. Loading them would undo those newer changes when you save.`), [['Start fresh'], ['Restore my edits', same ? 'green' : 'red']]);
    if (pick === 1) {
      this.change(() => {
        for (const k of Object.keys(this.map)) delete this.map[k];
        Object.assign(this.map, upgradeMap(d.map));
      });
      this.say('Draft restored.');
    } else {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }
  }

  // ── Overlay: selection, areas, colliders, spawn point ──────────────
  drawOverlay() {
    const g = this.overlay;
    for (const o of [...g.children]) {
      g.remove(o);
      o.geometry?.dispose();
    }
    this.labels = [];
    const ring = (x, z, r, col, w = 0.15, op = 0.85) => g.add(at(new THREE.Mesh(new THREE.RingGeometry(Math.max(0.01, r - w / 2), r + w / 2, Math.min(96, 24 + Math.round(r * 2))), flat(col, op)), x, z));
    const rect = (x, z, wd, dp, col, w = 0.15, op = 0.85) => {
      for (const [dx, dz, sx, sz] of [[0, -dp / 2, wd + w, w], [0, dp / 2, wd + w, w], [-wd / 2, 0, w, dp], [wd / 2, 0, w, dp]]) g.add(at(new THREE.Mesh(plane(sx, sz), flat(col, op)), x + dx, z + dz));
    };
    const line = (a, b, col, w = 0.15, op = 0.85) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3) return;
      const m = at(new THREE.Mesh(plane(w, len), flat(col, op)), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      m.rotation.z = Math.atan2(b[0] - a[0], b[1] - a[1]);
      g.add(m);
    };
    const label = (text, x, z, cls = '') => this.labels.push({ text, x, z, cls });
    if (this.opts.areas) {
      for (const kind of ['lands', 'regions', 'zones', 'lakes', 'plazas', 'spawns']) for (const e of this.list(kind)) {
        ring(e.x, e.z, e.r, AREA_COL[kind], kind === 'regions' ? 0.5 : 0.18, 0.6);
        if (kind !== 'plazas' && kind !== 'lakes' && kind !== 'lands') label(KINDS[kind].name(e), e.x, e.z, kind);
      }
      for (const b of this.map.buildings) label(b.label || 'Cottage', b.x, b.z, 'buildings');
    }
    if (this.opts.colliders) {
      setWorld(this.map);
      const col = buildColliders();
      for (const c of col.circles) ring(c.x, c.z, c.r, '#ffffff', 0.08, 0.7);
      for (const r of col.rects) rect(r.x, r.z, r.w, r.d, '#ffffff', 0.08, 0.7);
    }
    // Spawn point: where new heroes appear.
    const sp = this.map.spawn;
    ring(sp.x, sp.z, 0.9, '#6fe36b', 0.25, 0.95);
    label('Spawn point', sp.x, sp.z, 'spawn');
    // Selection
    const e = this.find();
    if (e) {
      const K = KINDS[this.sel.kind];
      if (this.sel.kind === 'paths') {
        e.pts.forEach((p, i) => {
          if (i) line(e.pts[i - 1], p, SEL, 0.2, 0.9);
          ring(p[0], p[1], 0.45, i === this.pathPoint ? '#ffffff' : SEL, 0.3, 1);
        });
      } else {
        const s = K.hit(e);
        if (s.w) rect(e.x, e.z, s.w, s.d, SEL, 0.25, 1);
        else ring(e.x, e.z, Math.max(s.r, 0.5), SEL, Math.max(0.12, Math.min(0.5, s.r * 0.08)), 1);
        if (this.sel.kind === 'props' && e.r > 0 && e.r < s.r - 0.05) ring(e.x, e.z, e.r, '#ffffff', 0.08, 0.9);
      }
    }
    // A path being drawn
    if (this.drawing?.length) {
      this.drawing.forEach((p, i) => {
        ring(p[0], p[1], 0.4, SEL, 0.25, 1);
        if (i) line(this.drawing[i - 1], p, SEL, 0.2, 0.9);
      });
      if (this.hover) line(this.drawing[this.drawing.length - 1], [this.hover.x, this.hover.z], SEL, 0.12, 0.5);
    }
    clear(this.labelsEl);
    for (const l of this.labels) l.el = this.labelsEl.appendChild(h('div.ed-tag' + (l.cls ? '.' + l.cls : ''), l.text));
  }

  // ── Ghost: what you're about to place, or what you're dragging ─────
  #clearGhost() {
    for (const o of [...this.ghost.children]) this.ghost.remove(o);
    this.ghost.visible = false;
  }
  #makeGhost(item, e = null) {
    this.#clearGhost();
    const proto = e ?? item.make(0, 0, this.map, { ...this.opts, vary: false });
    let obj = null;
    if (item.kind === 'props') {
      if (proto.slot.startsWith('proc_')) obj = PROC_BUILDERS[proto.slot]?.(proto, { fx: this.fx, animate: () => {} });
      else if (assets.has(proto.slot)) obj = assets.make(proto.slot, { variant: proto.v || 0 }).object;
    } else if (item.kind === 'nodes' && assets.has(proto.type)) obj = assets.make(proto.type).object;
    else if (item.kind === 'buildings') obj = new THREE.Mesh(new THREE.BoxGeometry(proto.w, 4, proto.d), new THREE.MeshBasicMaterial({ color: SEL, transparent: true, opacity: 0.35 }));
    if (obj) {
      if (proto.s) obj.scale.multiplyScalar(proto.s);
      if (proto.rot) obj.rotation.y = proto.rot;
      if (item.kind === 'buildings') obj.position.y = 2;
      this.ghost.add(obj);
    }
    this.ghostFor = item;
  }

  // ── Input ───────────────────────────────────────────────────────────
  #bindInput() {
    const c = this.renderer.domElement;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.#down(e));
    c.addEventListener('pointermove', (e) => this.#move(e));
    c.addEventListener('pointerup', (e) => this.#up(e));
    c.addEventListener('pointercancel', (e) => this.#up(e));
    // Double-click finishes a path, but only on its last point: quick clicks
    // spread across the map are just more points.
    c.addEventListener('dblclick', (e) => {
      const g = this.groundAt(e.clientX, e.clientY);
      const last = this.drawing?.[this.drawing.length - 2];
      if (this.tool === 'path' && g && last && Math.hypot(g.x - last[0], g.z - last[1]) < 1.5) this.finishPath();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist = Math.max(6, Math.min(320, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    addEventListener('keydown', (e) => this.#key(e, true));
    addEventListener('keyup', (e) => this.#key(e, false));
    addEventListener('beforeunload', (e) => {
      if (this.dirty && !this.leaving) e.preventDefault();
    });
  }
  #key(e, down) {
    if (e.target.closest?.('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (!down) return this.keys.delete(k);
    this.keys.add(k);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') return e.preventDefault(), e.shiftKey ? this.redo() : this.undo();
    if (ctrl && k === 'y') return e.preventDefault(), this.redo();
    if (ctrl && k === 'd') return e.preventDefault(), this.duplicate();
    if (ctrl && k === 's') return e.preventDefault(), this.save();
    if (ctrl) return;
    if (k === 'escape') {
      if (this.tool !== 'select') this.setTool('select');
      else this.select(null);
    } else if (k === 'enter' && this.tool === 'path') this.finishPath();
    else if (k === 'delete' || k === 'backspace') this.pathPoint != null ? this.#removePathPoint() : this.remove();
    else if (k === 'q') this.rotate(-1);
    else if (k === 'e') this.rotate(1);
    else if (k === 'g') this.toggle('snap');
    else if (k === 'v') this.setTool('select');
    else if (k === 'p') this.setTool('path');
    else if (k === 'm' && !e.repeat) this.overview();
  }
  #down(e) {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) return (this.drag = { mode: 'pinch', ...this.#pinch() });
    const right = e.button === 2 || e.button === 1;
    const ground = this.groundAt(e.clientX, e.clientY);
    this.drag = { mode: right ? 'orbit' : null, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, grab: ground, moved: false };
    if (right || !ground) return;
    if (this.tool !== 'select') return; // place / path / spawn act on click (pointerup)
    // Pressing on the selected thing (or one of a selected path's points) starts moving it.
    const sel = this.find();
    if (sel) {
      if (this.sel.kind === 'paths') {
        const i = sel.pts.findIndex((p) => Math.hypot(p[0] - ground.x, p[1] - ground.z) < 0.9);
        if (i >= 0) {
          this.pathPoint = i;
          this.drag.mode = 'point';
          this.drag.before = json(this.map);
          this.drawOverlay();
          return;
        }
      } else if (this.candidates(ground.x, ground.z).some((c) => c.kind === this.sel.kind && c.id === this.sel.id)) return this.#startMove(sel, ground);
    }
    // Grabbing something solid moves it straight away; big areas need a click first.
    const top = this.candidates(ground.x, ground.z)[0];
    if (top && !AREAS.has(top.kind)) {
      this.select(top);
      return this.#startMove(this.find(), ground);
    }
    this.drag.mode = 'pan';
  }
  #startMove(e, ground) {
    this.drag.mode = 'move';
    this.drag.before = json(this.map);
    this.drag.off = { x: e.x - ground.x, z: e.z - ground.z };
  }
  #move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) Object.assign(p, { x: e.clientX, y: e.clientY });
    const g = this.groundAt(e.clientX, e.clientY);
    this.hover = g;
    if (g) this.cursorText = `${r2(g.x)}, ${r2(g.z)}`;
    const d = this.drag;
    if (!d) {
      if (this.ghostFor && g) {
        this.ghost.visible = true;
        this.ghost.position.set(this.snap(g.x), 0, this.snap(g.z));
      }
      if (this.drawing) this.drawOverlay();
      return;
    }
    if (d.mode === 'pinch') {
      const now = this.#pinch();
      this.cam.dist = Math.max(6, Math.min(320, this.cam.dist * (d.dist / now.dist)));
      this.cam.yaw -= now.angle - d.angle;
      Object.assign(d, now);
      return;
    }
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
    if (d.mode === 'orbit') {
      this.cam.yaw -= (e.clientX - d.lx) * 0.006;
      this.cam.pitch = Math.max(0.35, Math.min(1.5, this.cam.pitch + (e.clientY - d.ly) * 0.005));
    } else if (d.mode === 'pan' && d.grab && g) {
      // Keep the grabbed spot of ground under the cursor.
      this.cam.x += d.grab.x - g.x;
      this.cam.z += d.grab.z - g.z;
    } else if (d.mode === 'move' && d.moved && g) {
      const e2 = this.find();
      if (e2) {
        e2.x = this.snap(g.x + d.off.x);
        e2.z = this.snap(g.z + d.off.z);
        if (!this.ghost.children.length && (this.sel.kind === 'props' || this.sel.kind === 'nodes' || this.sel.kind === 'buildings')) this.#makeGhost({ kind: this.sel.kind }, e2);
        this.ghost.visible = true;
        this.ghost.position.set(e2.x, 0, e2.z);
        this.drawOverlay();
        this.#drawSide();
      }
    } else if (d.mode === 'point' && d.moved && g) {
      const e2 = this.find();
      if (e2) {
        e2.pts[this.pathPoint] = [this.snap(g.x), this.snap(g.z)];
        this.drawOverlay();
      }
    }
    d.lx = e.clientX;
    d.ly = e.clientY;
  }
  #up(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d || d.mode === 'pinch') {
      if (this.pointers.size < 2) this.drag = null;
      return;
    }
    this.drag = null;
    if ((d.mode === 'move' || d.mode === 'point') && d.moved) {
      // The move happened live; record it as one undoable step.
      this.#clearGhost();
      if (json(this.map) !== d.before) {
        this.undoStack.push(d.before);
        this.redoStack.length = 0;
        this.#afterChange();
      }
      return;
    }
    if (d.moved || d.mode === 'orbit') return;
    const g = this.groundAt(e.clientX, e.clientY);
    if (!g) return;
    if (this.tool === 'place' && this.placing) return this.place(this.placing, g.x, g.z);
    if (this.tool === 'path') {
      this.drawing.push([this.snap(g.x), this.snap(g.z)]);
      return this.drawOverlay();
    }
    if (this.tool === 'spawn') {
      this.change(() => (this.map.spawn = { x: this.snap(g.x), z: this.snap(g.z) }), { rebuild: false });
      return this.setTool('select');
    }
    if (d.mode === 'point') return; // clicked a path point: it's selected
    this.select(this.pickAt(e.clientX, e.clientY));
  }
  #pinch() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  #removePathPoint() {
    const e = this.find();
    if (!e || e.pts.length <= 2) return this.say('A path needs at least two points; delete the whole path instead (select it, then Delete).', true);
    const i = this.pathPoint;
    this.pathPoint = null;
    this.change(() => e.pts.splice(i, 1));
  }
  toggle(k) {
    this.opts[k] = !this.opts[k];
    this.#drawTop();
    this.drawOverlay();
  }

  // ── Frame ───────────────────────────────────────────────────────────
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  loop(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // WASD / arrows pan, relative to where the camera faces.
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    if (f || r) {
      const sp = this.cam.dist * 0.9 * dt;
      const sy = Math.sin(this.cam.yaw);
      const cy = Math.cos(this.cam.yaw);
      this.cam.x += (-sy * f + cy * r) * sp;
      this.cam.z += (-cy * f - sy * r) * sp;
    }
    const c = this.cam;
    const hor = Math.cos(c.pitch) * c.dist;
    this.camera.position.set(c.x + Math.sin(c.yaw) * hor, Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * hor);
    this.camera.lookAt(c.x, 0, c.z);
    this.sun.position.set(c.x + 40, 60, c.z + 10);
    this.sun.target.position.set(c.x, 0, c.z);
    if (this.town) {
      this.town.viewRadius = this.#viewRadius();
      this.town.update(dt, now / 1000, this.camera);
    }
    this.fx.update(dt);
    this.fx.puff.update(dt);
    this.renderer.render(this.scene, this.camera);
    // Labels follow their spot on screen.
    const v = new THREE.Vector3();
    for (const l of this.labels ?? []) {
      v.set(l.x, 0.5, l.z).project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = on ? '' : 'none';
      if (on) l.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
    }
    this.statusEl.textContent = `${this.statusMsg ?? ''}${this.cursorText ? `   ·   ${this.cursorText}` : ''}`;
    requestAnimationFrame((t) => this.loop(t));
  }
  say(msg, err = false) {
    this.statusMsg = msg;
    this.statusEl.classList.toggle('err', !!err);
  }

  // ── Panels ──────────────────────────────────────────────────────────
  #drawTop() {
    const b = (label, fn, { on = false, title = '', cls = '' } = {}) => h('button.ed-btn' + (on ? '.on' : '') + cls, { title, on: { click: fn } }, label);
    clear(this.topEl).append(
      h('div.ed-group', b('Select', () => this.setTool('select'), { on: this.tool === 'select', title: 'Select and move (V)' }), b('Place', () => ((this.tab = 'place'), this.#drawSide(), this.setTool('select')), { on: this.tool === 'place', title: 'Pick something to place from the panel' }), b('Path', () => this.setTool('path'), { on: this.tool === 'path', title: 'Draw a dirt path (P)' })),
      h('div.ed-group', b('Undo', () => this.undo(), { title: 'Ctrl+Z' }), b('Redo', () => this.redo(), { title: 'Ctrl+Y' })),
      h('div.ed-group', b('Map', () => this.overview(), { title: 'The whole world from above: click anywhere to jump there (M)' })),
      h('div.ed-group', b('Snap', () => this.toggle('snap'), { on: this.opts.snap, title: 'Snap to a half-metre grid (G)' }), b('Areas', () => this.toggle('areas'), { on: this.opts.areas, title: 'Show zones, camps and regions' }), b('Solid', () => this.toggle('colliders'), { on: this.opts.colliders, title: 'Show what blocks walking' })),
      h('div.ed-group', b(this.dirty ? 'Save •' : 'Save', () => this.save(), { cls: this.dirty ? '.hot' : '', title: 'Save to the world (Ctrl+S)' }), b('Export', () => this.export(), { title: 'Download the map as a file' }), b('Import', () => this.import(), { title: 'Load a map file' }), b('Exit', () => this.exit())),
    );
  }
  #drawSide() {
    const tabs = [['place', 'Place'], ['selected', 'Selected'], ['world', 'World']];
    const body = h('div.ed-body');
    clear(this.sideEl).append(h('div.ed-tabs', ...tabs.map(([k, l]) => h('button' + (this.tab === k ? '.on' : ''), { on: { click: () => ((this.tab = k), this.#drawSide()) } }, l))), body);
    if (this.tab === 'place') this.#palette(body);
    else if (this.tab === 'selected') this.#inspector(body);
    else this.#world(body);
  }
  #palette(body) {
    const q = h('input.ed-search', { placeholder: 'Search…', value: this.query || '' });
    const lists = h('div');
    const fill = () => {
      clear(lists);
      const term = q.value.trim().toLowerCase();
      for (const sec of PALETTE) {
        const items = sec.items.filter((it) => !term || it.label.toLowerCase().includes(term) || it.slot?.includes(term));
        if (!items.length) continue;
        lists.append(h('div.ed-sec', sec.title), h('div.ed-items', ...items.map((it) => h('button.ed-item' + (this.placing === it ? '.on' : ''), { on: { click: () => this.setTool('place', it) } }, it.label))));
      }
    };
    q.addEventListener('input', () => ((this.query = q.value), fill()));
    fill();
    body.append(q, h('label.ed-check', h('input', { type: 'checkbox', checked: this.opts.vary, on: { change: (e) => (this.opts.vary = e.target.checked) } }), ' Natural variety (random turn and size for plants and nodes)'), lists);
  }
  #inspector(body) {
    const e = this.find();
    if (!e) return body.append(h('p.ed-muted', 'Nothing selected. Click something in the world. Clicking the same spot again picks the next thing underneath.'));
    const kind = this.sel.kind;
    const K = KINDS[kind];
    body.append(h('div.ed-title', K.name(e)), h('div.ed-muted', `${K.label} · ${e.id}`));
    for (const f of K.fields(e)) {
      let input;
      if (f.type === 'readonly') input = h('span.ed-ro', String(e[f.key] ?? ''));
      else if (f.type === 'select') input = h('select', ...f.options.map(([v, l]) => h('option', { value: v, selected: e[f.key] === v }, l)));
      else if (f.type === 'check') input = h('input', { type: 'checkbox', checked: !!e[f.key] });
      else if (f.type === 'color') input = h('input', { type: 'color', value: e[f.key] || '#74a04c' });
      else if (f.type === 'text') input = h('input', { type: 'text', value: e[f.key] ?? '' });
      else input = h('input', { type: 'number', step: f.type === 'deg' ? 15 : f.step, value: show(f, e[f.key]) });
      if (f.type !== 'readonly')
        input.addEventListener('change', () => {
          const v = store(f, f.type === 'check' ? input.checked : input.value);
          this.change(() => {
            if (v === undefined || v === '') delete e[f.key];
            else e[f.key] = v;
          });
        });
      body.append(h('label.ed-field', h('span', f.label), input, f.help ? h('small', f.help) : null));
    }
    const act = (label, fn, cls = '') => h('button.ed-btn' + cls, { on: { click: fn } }, label);
    const row = h('div.ed-actions');
    if (kind === 'paths') {
      row.append(
        act('Add points', () => {
          this.say('Click to add points to the end of this path; Esc when done.');
          this.tool = 'path';
          this.drawing = e.pts.map((p) => [...p]);
          const id = e.id;
          // Finishing replaces this path's points instead of making a new path.
          this.finishPath = () => {
            const pts = dedupe(this.drawing);
            this.drawing = null;
            this.tool = 'select';
            delete this.finishPath;
            const p = this.list('paths').find((x) => x.id === id);
            if (p && pts?.length >= 2) this.change(() => (p.pts = pts));
            this.#drawTop();
            this.say('Path updated.');
          };
          this.#drawTop();
        }),
        act('Remove point', () => (this.pathPoint != null ? this.#removePathPoint() : this.say('Click one of the path\'s points first.'))),
      );
    } else if (kind === 'buildings' || 'rot' in e || kind === 'nodes' || kind === 'props') row.append(act('Turn ⟲', () => this.rotate(-1)), act('Turn ⟳', () => this.rotate(1)));
    row.append(act('Copy', () => this.duplicate()), act('Delete', () => this.remove(), '.danger'));
    body.append(row, h('p.ed-muted', 'Drag it in the world to move it. Q / E turn it, Delete removes it, Ctrl+D copies it.'));
  }
  #world(body) {
    const m = this.map;
    const field = (label, input) => h('label.ed-field', h('span', label), input);
    const name = h('input', { type: 'text', value: m.name || '' });
    name.onchange = () => this.change(() => (m.name = name.value), { rebuild: false });
    const counts = KIND_KEYS.map((k) => `${this.list(k).length} ${KINDS[k].label.toLowerCase()}${this.list(k).length === 1 ? '' : 's'}`).join(', ');
    body.append(
      h('div.ed-title', 'World'),
      field('Name', name),
      h('div.ed-actions', h('button.ed-btn', { on: { click: () => this.setTool('spawn') } }, 'Move the spawn point'), h('button.ed-btn', { on: { click: () => this.#jump(m.spawn) } }, 'Go to it')),
      h('p.ed-muted', `Version ${m.rev ?? 0}${this.dirty ? ' (with unsaved changes)' : ''}. ${counts}.`),
      h('div.ed-sec', 'Regions'),
      ...this.list('regions').map((r) => h('button.ed-item', { on: { click: () => (this.#jump(r), this.select({ kind: 'regions', id: r.id })) } }, KINDS.regions.name(r))),
      h('p.ed-muted', 'Regions are your towns and areas, each with a difficulty tier (1 = starter). Add one from Place → Buildings & areas.'),
      h('div.ed-sec', 'Waystones'),
      ...this.list('stones').map((st) => h('button.ed-item', { on: { click: () => (this.#jump(st), this.select({ kind: 'stones', id: st.id })) } }, st.name || st.id)),
      h('div.ed-sec', 'Buildings'),
      ...this.list('buildings').filter((b) => !b.deco).map((b) => h('button.ed-item', { on: { click: () => (this.#jump(b), this.select({ kind: 'buildings', id: b.id })) } }, b.label || b.id)),
      h('div.ed-sec', 'Land'),
      ...this.list('lands').map((l) => h('button.ed-item', { on: { click: () => (this.#jump(l), this.select({ kind: 'lands', id: l.id })) } }, `Land ${l.id} (${Math.round(l.r)} m)`)),
      h('p.ed-muted', 'Land is made of circles: overlap them to make any coastline, or put one far out at sea for a new island. Add one from Place → Buildings & areas.'),
      h('div.ed-sec', 'Keys'),
      h('p.ed-muted', 'Drag ground: pan · Right-drag: turn the view · Wheel: zoom · WASD: move · M: whole-world map · Q/E: turn selection · Del: delete · Ctrl+D: copy · Ctrl+Z / Ctrl+Y: undo / redo · G: snap · Ctrl+S: save'),
    );
  }
  // Zoomed out, the editor shows more of the world than the game ever does.
  #viewRadius() {
    return Math.max(150, this.cam.dist * 1.6);
  }
  #jump(p) {
    this.cam.x = p.x;
    this.cam.z = p.z;
  }

  // The whole world from above (the same map players see, every waystone
  // shown). Click anywhere to jump the camera there; wheel zooms, drag pans.
  overview() {
    if (this.overviewEl) return this.overviewEl.close();
    setWorld(this.map); // draw the map as edited, saved or not
    const canvas = h('canvas');
    const wrap = h('div.ed-overview', h('div.ed-ov-head', h('b', 'World map'), h('span.ed-muted', 'Click to jump there · wheel: zoom · drag: pan · M or Esc: close'), h('button.ed-btn', { on: { click: () => close() } }, 'Close')), canvas);
    this.el.append(wrap);
    const r = canvas.getBoundingClientRect();
    const v = { W: r.width, H: r.height, dpr: Math.min(2, devicePixelRatio || 1) };
    canvas.width = Math.round(v.W * v.dpr);
    canvas.height = Math.round(v.H * v.dpr);
    const E = EXTENT;
    const minS = Math.min((v.W - 40) / (E.x1 - E.x0), (v.H - 80) / (E.z1 - E.z0));
    Object.assign(v, { s: minS, cx: (E.x0 + E.x1) / 2, cz: (E.z0 + E.z1) / 2 - 20 / minS });
    const toWorld = (sx, sy) => [v.cx + (sx - v.W / 2) / v.s, v.cz + (sy - v.H / 2) / v.s];
    const draw = () => {
      const x = canvas.getContext('2d');
      const text = paintWorld(x, v, { known: 'all' });
      // Where the editor camera is now, and the spawn point.
      const at = (wx, wz) => [v.W / 2 + (wx - v.cx) * v.s, v.H / 2 + (wz - v.cz) * v.s];
      const [cx, cy] = at(this.cam.x, this.cam.z);
      x.strokeStyle = '#ffe9a8';
      x.lineWidth = 2;
      x.setLineDash([6, 4]);
      x.beginPath();
      x.arc(cx, cy, Math.max(10, this.cam.dist * 0.6 * v.s), 0, Math.PI * 2);
      x.stroke();
      x.setLineDash([]);
      const [px, py] = at(this.map.spawn.x, this.map.spawn.z);
      text('★ spawn', px, py, '700 12px "Alegreya Sans", sans-serif', '#ffe9a8');
    };
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.offsetX, y: e.offsetY, cx: v.cx, cz: v.cz, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      v.cx = drag.cx - (e.offsetX - drag.x) / v.s;
      v.cz = drag.cz - (e.offsetY - drag.y) / v.s;
      draw();
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const [wx, wz] = toWorld(e.offsetX, e.offsetY);
      this.#jump({ x: wx, z: wz });
      close();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wz] = toWorld(e.offsetX, e.offsetY);
      v.s = Math.max(minS, Math.min(10, v.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      v.cx = wx - (e.offsetX - v.W / 2) / v.s;
      v.cz = wz - (e.offsetY - v.H / 2) / v.s;
      draw();
    }, { passive: false });
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    addEventListener('keydown', onKey);
    const close = () => {
      removeEventListener('keydown', onKey);
      wrap.remove();
      this.overviewEl = null;
    };
    this.overviewEl = { close };
    draw();
  }

  // A small modal; resolves with the index of the button pressed.
  dialog(title, content, buttons) {
    return new Promise((resolve) => {
      const done = (i) => (m.remove(), resolve(i));
      const m = h('div.ed-modal', h('div.ed-dialog', h('div.ed-title', title), content, h('div.ed-actions', ...buttons.map(([l, cls], i) => h('button.ed-btn' + (cls ? '.' + cls : ''), { on: { click: () => done(i) } }, l)))));
      this.el.append(m);
    });
  }
}

const flatCache = new Map();
function flat(col, op) {
  const k = col + op;
  if (!flatCache.has(k)) flatCache.set(k, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  return flatCache.get(k);
}
const plane = (w, d) => new THREE.PlaneGeometry(w, d);
// Lay a flat overlay mesh on the ground at (x, z), drawn over everything.
function at(m, x, z) {
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.12, z);
  m.renderOrder = 20;
  return m;
}
// Drop points that sit on top of the one before (a double-click adds one).
const dedupe = (pts) => pts?.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.3);
function segDist(px, pz, a, b) {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
}
