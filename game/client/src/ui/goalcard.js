// The goal card (today: the tutorial quest card) and the guide that points
// the way: the edge-of-screen arrow here, and the in-world beacon and trail
// (game.setGuide). Phase 2 turns this into the Compass's goal card.
import * as THREE from 'three';
import { h, clear } from '../util/dom.js';
import { glyph } from './glyphs.js';
import { BUILDINGS, SPAWNS, GATE, doorPoint } from '../../../shared/world.js';
import { MONSTERS } from '../../../shared/monsters.js';

const TUTORIAL_TEXT = [
  { text: 'Fell an oak in Whisperwood', hint: 'Tap a tree, then strike as the ring closes.', target: 'tree' },
  { text: 'Saw oak planks at the Workshop', hint: 'Tap Craft, choose Oak Plank at the workbench, then saw in time.', target: 'workshop' },
  { text: `Slay a ${MONSTERS.slime.name}`, hint: 'Beyond the Wilds Gate, to the north.', target: 'slime' },
  { text: 'Stock a display in your shop', hint: 'Tap Shop, then tap an empty display and set a price.', target: 'shop' },
];

export class GoalCard {
  constructor(hud) {
    this.hud = hud;
    this.lock = null; // the one tree / slime the guide is showing, until done
    this.t = 0;
    this.el = h('div.quest.hidden');
    this.arrowIcon = h('div.ga-icon', h('i'));
    this.arrowLabel = h('div.ga-label');
    this.arrow = h('div.guide-arrow.hidden', this.arrowIcon, this.arrowLabel);
  }

  render() {
    const hud = this.hud;
    const step = hud.me.tutorial ?? 0;
    const q = TUTORIAL_TEXT[step];
    if (!q) {
      this.el.classList.add('hidden');
      this.arrow.classList.add('hidden');
      return;
    }
    clear(this.el).append(
      h('b', `Quest ${step + 1}/${TUTORIAL_TEXT.length}`),
      h('div', { style: { fontWeight: 600 } }, q.text),
      h('div.muted', q.hint),
      h('button.btn.small.green', { style: { marginTop: '6px' }, on: { click: () => this.target()?.go() } }, glyph('compass'), 'Take me there'),
      h('br'),
      h('button.skip', { on: { click: () => (hud.sock.rpc('tutorialSkip'), (hud.me.tutorial = 99), this.render()) } }, 'skip tutorial'),
    );
    this.el.classList.remove('hidden');
  }

  // Out of the way during a battle.
  hide(hidden) {
    this.el.style.visibility = hidden ? 'hidden' : '';
  }

  // Where the current quest wants you to go. Targets are *locked* (one tree,
  // one slime) until done, so the guide never flips between candidates.
  target() {
    const hud = this.hud;
    const step = hud.me.tutorial ?? 0;
    const q = TUTORIAL_TEXT[step];
    const g = hud.game;
    if (!q || !g) return null;
    const p = g.myPos();
    if (q.target === 'tree') {
      const lock = this.lock?.kind === 'tree' ? g.town.nodes.get(this.lock.id) : null;
      if (!lock || !lock.alive) {
        const n = g.nearestNode('tree_oak');
        this.lock = n ? { kind: 'tree', id: n.id } : null;
      }
      if (!this.lock) return null;
      const n = g.nodePos(this.lock.id);
      return { x: n.x, z: n.z, y: 5.4, label: 'Oak tree', go: () => g.goNode(n.id) };
    }
    if (q.target === 'slime') {
      if (p.z > GATE.z - 1) return { x: GATE.x, z: GATE.z, y: 8.5, label: 'Wilds Gate', go: () => g.walkTo(GATE.x, GATE.z - 6, true) };
      let mv = this.lock?.kind === 'slime' ? g.mobs.get(this.lock.id) : null;
      if (!mv || mv.state === 'dead') {
        mv = null;
        for (const m of g.mobs.values()) if (m.type === 'slime' && m.state !== 'dead' && (!mv || Math.hypot(m.x - p.x, m.z - p.z) < Math.hypot(mv.x - p.x, mv.z - p.z))) mv = m;
        this.lock = mv ? { kind: 'slime', id: mv.id } : null;
      }
      if (!mv) {
        // None in sight: head for the nearest slime camp on the map.
        const camp = SPAWNS.filter((sp) => sp.monster === 'slime').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        return camp ? { x: camp.x, z: camp.z, y: 2.6, label: MONSTERS.slime.name, go: () => g.walkTo(camp.x, camp.z, true) } : null;
      }
      const id = mv.id;
      return { x: mv.x, z: mv.z, y: 2.6, label: MONSTERS.slime.name, go: () => g.goMob(id) };
    }
    const b = BUILDINGS.find((x) => x.id === q.target);
    const [dx, dz] = doorPoint(b);
    return { x: dx, z: dz, y: 3.2, label: b.label, go: () => hud.travel(b.id) };
  }

  // Every frame: the in-world beacon and trail, and an edge arrow when off-screen.
  frame(dt) {
    this.t += dt;
    const g = this.hud.game;
    const tg = g && !g.battle && !g.fishing && !g.dungeon ? this.target() : null;
    g?.setGuide(tg);
    if (!tg) return this.arrow.classList.add('hidden');
    const p = g.myPos();
    const dist = Math.hypot(tg.x - p.x, tg.z - p.z);
    const s = g.project(new THREE.Vector3(tg.x, tg.y, tg.z));
    const m = 50;
    const onScreen = s.vis && s.x > m && s.x < innerWidth - m && s.y > 110 && s.y < innerHeight - 130;
    const hideNear = dist < 3.5 || !!g.gather;
    this.arrow.classList.toggle('hidden', hideNear);
    this.arrowLabel.textContent = `${tg.label} · ${Math.round(dist)}m`;
    if (onScreen) {
      this.arrow.classList.add('over');
      this.arrow.style.transform = `translate(${s.x}px, ${s.y - 40 + Math.sin(this.t * 6) * 7}px)`;
      return;
    }
    // Direction relative to where the camera is looking (works even when
    // the target is behind you). The arrow orbits your hero, so it never
    // covers menus and always reads as "go this way".
    this.arrow.classList.remove('over');
    const yaw = g.cam.curYaw ?? g.cam.yaw;
    const dx = tg.x - p.x;
    const dz = tg.z - p.z;
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const ang = Math.atan2(-fwd, right);
    const me = g.project(new THREE.Vector3(p.x, 1.1, p.z));
    const r = Math.min(115, Math.min(innerWidth, innerHeight) * 0.22);
    this.arrow.style.transform = `translate(${me.x + Math.cos(ang) * r}px, ${me.y + Math.sin(ang) * r}px)`;
    this.arrowIcon.style.transform = `rotate(${ang}rad)`;
  }
}
