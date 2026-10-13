// The HTML label layer over the 3D view (always crisp, never clipped): place
// names, heroes' and monsters' name tags, the crypt's labels, and floating
// text (damage numbers, loot, PERFECT!). Owned by the GameClient g.
import * as THREE from 'three';
import { h } from '../util/dom.js';
import { glyph } from './glyphs.js';

export class Labels {
  constructor(g) {
    this.g = g;
    this.layer = h('div.labels');
    this.static = []; // the town's place and zone labels
  }

  // The town's labels: places you can tap to walk to, and zone names.
  makeStatic() {
    const g = this.g;
    this.static = g.town.labels.map((l) => {
      const el =
        l.kind === 'place'
          ? h('div.place', { on: { click: (e) => (e.stopPropagation(), g.goBuilding(l.id)) } }, h('span.ic', l.glyph ? glyph(l.glyph) : l.icon), l.text)
          : l.kind === 'board'
            ? h('div.place', { on: { click: (e) => (e.stopPropagation(), g.goBoard(l.id)) } }, h('span.ic', glyph(l.glyph)), l.text)
          : l.kind === 'stone'
            ? h('div.place.stone', { on: { click: (e) => (e.stopPropagation(), g.goStone(l.id, { openMap: true })) } }, h('span.ic', glyph(l.glyph)), l.text)
          : l.kind === 'crypt'
            ? h('div.place.crypt', { on: { click: (e) => (e.stopPropagation(), g.goCrypt(l.id)) } }, h('span.ic', glyph(l.glyph)), l.text)
            : h('div.zone-tag', l.text);
      this.layer.append(el);
      return { ...l, el };
    });
  }
  showStatic(on) {
    for (const l of this.static) l.el.style.display = on ? '' : 'none';
  }

  // The crypt's labels (doors, fires, chests…): tap one to go and use it.
  makeDungeon(view) {
    for (const l of view.labels) {
      l.el = h('div.place.dplace' + (l.lock ? '.lock' : ''), { on: { click: (e) => (e.stopPropagation(), this.g.useThing(l.what)) } }, h('span.ic', glyph(l.glyph)), h('span.tx', l.text));
      this.layer.append(l.el);
    }
  }
  removeDungeon(view) {
    for (const l of view.labels) l.el?.remove();
  }
  refreshDungeon() {
    for (const l of this.g.dungeon?.labels ?? []) {
      if (!l.el) continue;
      l.el.querySelector('.tx').textContent = l.text;
      l.el.querySelector('.ic').replaceChildren(glyph(l.glyph));
    }
  }

  // A world position on screen: { x, y, vis }.
  project(v, out = {}) {
    const p = v.clone().project(this.g.camera);
    out.x = (p.x * 0.5 + 0.5) * innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * innerHeight;
    out.vis = p.z < 1 && p.z > -1 && out.x > -100 && out.x < innerWidth + 100 && out.y > -100 && out.y < innerHeight + 100;
    return out;
  }

  // Floating text at a world position (damage numbers, loot, PERFECT!).
  float(pos, text, cls = '') {
    const s = this.project(pos);
    if (!s.vis) return;
    const el = h('div.float' + (cls ? '.' + cls.split(' ').join('.') : ''), text);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    this.layer.append(el);
    setTimeout(() => el.remove(), 1700);
  }

  // Every frame: move each label over what it names, hide what's off screen or far.
  update() {
    const g = this.g;
    const cam = g.camera.position;
    const tmp = {};
    const v = new THREE.Vector3();
    for (const pv of g.players.values()) {
      v.copy(pv.av.root.position).setY(3.0);
      this.project(v, tmp);
      const far = v.distanceTo(cam) > 70;
      pv.tag.style.display = tmp.vis && !far && !pv.hidden ? '' : 'none';
      if (tmp.vis) pv.tag.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, -100%)`;
    }
    for (const mv of g.mobs.values()) {
      v.copy(mv.mob.root.position).setY(mv.mob.height || 1.6);
      this.project(v, tmp);
      const show = tmp.vis && mv.mob.root.visible && (mv.state === 'battle' || Math.hypot(mv.x - g.me.local.x, mv.z - g.me.local.z) < (g.dungeon ? 18 : 13));
      mv.tag.style.display = show ? '' : 'none';
      if (show) mv.tag.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, -100%)`;
    }
    if (g.dungeon) {
      for (const l of g.dungeon.labels) {
        if (!l.el) continue;
        this.project(l.pos, tmp);
        const show = tmp.vis && !l.hidden && !g.battle && g.dungeon.isRevealed(l.room) && l.pos.distanceTo(cam) < 60;
        l.el.style.display = show ? '' : 'none';
        if (show) l.el.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, -100%)`;
      }
      return;
    }
    for (const l of this.static) {
      this.project(l.pos, tmp);
      const d = l.pos.distanceTo(cam);
      const show = tmp.vis && d < (l.kind === 'zone' ? 75 : 95) && !g.battle;
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate3d(${tmp.x}px, ${tmp.y}px, 0) translate(-50%, ${l.kind === 'zone' ? '-50%' : '-100%'})`;
    }
  }
}
