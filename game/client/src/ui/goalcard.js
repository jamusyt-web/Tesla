// The goal card: the Compass's face (SPEC §5.3). It shows the best thing to
// do now, with three more behind the chevron; tap the pin to keep a goal on
// top, swipe it away (or tap "Later") to snooze it for half an hour. It
// re-ranks every 2 s but only switches when its goal is done or a rival is
// clearly better. "Take me there" walks you (or offers a waystone when it's
// far). The edge arrow, beacon and trail point at the goal's target.
//
// It also keeps the engagement numbers the owner sees (server/engage.js):
// goals shown, taken and done per source, and dead air.
import * as THREE from 'three';
import { h, clear } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';
import { Compass } from '../world/compass.js';
import { pickShown } from '../../../shared/goals.js';

const RERANK_MS = 2000;
const LOG_MS = 60_000;
const DEAD_GRACE = 5; // seconds of stillness before it counts as dead air
const SRC_LABEL = { quest: 'Quest', almanac: 'Today', ready: 'Ready', pinned: 'Pinned', unlock: 'New', ancient: 'Rare find', rich: 'Rich node', upgrade: 'Next upgrade', order: 'Order', landmark: 'Discover', journal: 'Journal', fallback: 'Explore', elite: 'Elite' };
const SRC_GLYPH = { quest: 'scroll', almanac: 'hourglass', ready: 'coins', unlock: 'star', ancient: 'spark', rich: 'spark', upgrade: 'hammer', order: 'scroll', landmark: 'eye', journal: 'book', fallback: 'compass' };

export class GoalCard {
  constructor(hud) {
    this.hud = hud;
    this.compass = null;
    this.shown = null;
    this.open = false;
    this.lock = null; // the one tree / monster the guide points at, until it's gone
    this.t = 0;
    this.nextRank = 0;
    this.stats = { shown: {}, taken: {}, done: {}, dead: 0 };
    this.still = 0;
    this.lastLog = Date.now();
    this.el = h('div.quest.goal.hidden');
    this.arrowIcon = h('div.ga-icon', h('i'));
    this.arrowLabel = h('div.ga-label');
    this.arrow = h('div.guide-arrow.hidden', this.arrowIcon, this.arrowLabel);
    this.#swipe();
  }

  attach(game) {
    this.compass = new Compass(game);
  }
  // A fresh arrival: fetch the journal, orders and the map of where you've been.
  onWelcome() {
    this.settleUntil = Date.now() + 6000;
    this.compass?.load().then(() => this.rank(true));
    this.rank(true);
  }

  // Rank again (every 2 s, or now when something changed).
  rank(force = false) {
    const C = this.compass;
    if (!C || !this.hud.game?.me) return;
    const now = Date.now();
    if (!force && now < this.nextRank) return;
    this.nextRank = now + RERANK_MS;
    const list = C.suggest(now);
    const prev = this.shown;
    // Settling in (the first seconds after arriving, while quests and the
    // journal load): always the top goal.
    const next = now < (this.settleUntil ?? 0) ? list[0] : pickShown(list, prev?.id);
    if (prev && !list.some((g) => g.id === prev.id) && !C.snoozed(now).has(prev.id)) this.#count('done', prev.src);
    if (next && next.id !== prev?.id) {
      this.#count('shown', next.src);
      this.lock = null;
    }
    this.shown = next ? list.find((g) => g.id === next.id) : null;
    this.render();
  }
  #count(k, src) {
    this.stats[k][src] = (this.stats[k][src] ?? 0) + 1;
  }

  render() {
    const g = this.shown;
    const hud = this.hud;
    if (!g || hud.game?.dungeon || hud.game?.room) {
      this.el.classList.add('hidden');
      return;
    }
    const C = this.compass;
    const pinned = C.pins().includes(g.id);
    const route = C.route(g);
    const bar = g.progress ? h('div.gbar', h('i', { style: { width: `${Math.min(100, Math.round((100 * g.progress[0]) / Math.max(1, g.progress[1])))}%` } }), h('span', `${g.progress[0]}/${g.progress[1]}`)) : null;
    const more = this.open ? h('div.gmore', ...C.list.filter((x) => x.id !== g.id).slice(0, 3).map((x) => this.#row(x))) : null;
    clear(this.el).append(
      ...[h('div.ghead', { on: { click: () => ((this.open = !this.open), this.render()) } }, glyph(SRC_GLYPH[g.src] ?? 'compass'), h('b', SRC_LABEL[g.src] ?? 'Goal'), h('span.gwhy', g.why && g.why.length < 28 && g.why !== SRC_LABEL[g.src] ? g.why : ''), h('span.chev' + (this.open ? '.on' : ''), '›')),
      h('div.gtext', g.text),
      bar,
      h(
        'div.gbtns',
        route ? h('button.btn.small.green', { on: { click: () => this.take(g, route) } }, glyph(route.mode === 'travel' ? 'waystone' : 'compass'), route.label) : null,
        h('button.btn.small.icon' + (pinned ? '.on' : ''), { title: pinned ? 'Unpin' : 'Pin it on top', 'aria-label': 'Pin', on: { click: () => (C.pin(g.id), this.rank(true)) } }, glyph('pin')),
        h('button.btn.small.icon', { title: 'Later (30 min)', 'aria-label': 'Later', on: { click: () => this.snooze() } }, glyph('hourglass')),
      ),
      more].filter(Boolean),
    );
    this.el.classList.remove('hidden');
  }
  #row(x) {
    return h('div.gitem', { on: { click: () => ((this.shown = x), (this.lock = null), (this.open = false), this.#count('shown', x.src), this.render()) } }, glyph(SRC_GLYPH[x.src] ?? 'compass'), h('span', x.text), x.progress ? h('span.muted', ` ${x.progress[0]}/${x.progress[1]}`) : null);
  }

  take(g, route = this.compass.route(g)) {
    if (!route) return;
    sfx.tap();
    this.#count('taken', g.src);
    route.run();
  }
  snooze() {
    if (!this.shown) return;
    this.compass.snooze(this.shown.id);
    this.shown = null;
    this.rank(true);
  }
  // Swipe the card left to snooze it.
  #swipe() {
    let x0 = null;
    this.el.addEventListener('pointerdown', (e) => (x0 = e.clientX));
    this.el.addEventListener('pointerup', (e) => {
      if (x0 != null && x0 - e.clientX > 80) this.snooze();
      x0 = null;
    });
  }

  // Out of the way during a battle.
  hide(hidden) {
    this.el.style.visibility = hidden ? 'hidden' : '';
  }

  // Where the shown goal points: one tree or monster is kept until it's gone,
  // so the guide never flips between two.
  target() {
    const g = this.hud.game;
    const goal = this.shown;
    if (!goal || !g || !this.compass) return null;
    if (this.lock?.goal === goal.id) {
      if (this.lock.node != null) {
        if (g.town.nodes.get(this.lock.node)?.alive) return this.lock.at;
      } else if (this.lock.mob != null) {
        const m = g.mobs.get(this.lock.mob);
        if (m && m.state !== 'dead') return Object.assign(this.lock.at, { x: m.x, z: m.z });
      } else if (Date.now() - this.lock.t < 3000) return this.lock.at;
    }
    const at = this.compass.locate(goal.target);
    if (!at || at.here) return (this.lock = null);
    this.lock = { goal: goal.id, at, t: Date.now(), node: at.node ?? null, mob: at.mob ?? null };
    return at;
  }

  // Every frame: rank now and then, count dead air, and steer the guide.
  frame(dt) {
    this.t += dt;
    const g = this.hud.game;
    this.rank();
    this.#deadAir(dt);
    const tg = g && !g.battle && !g.fishing && !g.dungeon && !g.room ? this.target() : null;
    g?.setGuide(tg && tg.label != null ? { ...tg, label: tg.label || this.shown?.text?.slice(0, 24) || '' } : null);
    if (!tg) return this.arrow.classList.add('hidden');
    const p = g.myPos();
    const dist = Math.hypot(tg.x - p.x, tg.z - p.z);
    const s = g.project(new THREE.Vector3(tg.x, tg.y ?? 2, tg.z));
    const m = 50;
    const onScreen = s.vis && s.x > m && s.x < innerWidth - m && s.y > 110 && s.y < innerHeight - 130;
    const hideNear = dist < 3.5 || !!g.gather;
    this.arrow.classList.toggle('hidden', hideNear);
    this.arrowLabel.textContent = `${tg.label || 'Goal'} · ${Math.round(dist)}m`;
    if (onScreen) {
      this.arrow.classList.add('over');
      this.arrow.style.transform = `translate(${s.x}px, ${s.y - 40 + Math.sin(this.t * 6) * 7}px)`;
      return;
    }
    // Off screen: the arrow orbits your hero and points the way.
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

  // Dead air: in the world, standing still, nothing open, nothing going on.
  #deadAir(dt) {
    const g = this.hud.game;
    if (!g?.me) return;
    const idle = !g.dungeon && !g.room && !g.battle && !g.gather && !g.fishing && !g.craft && !this.hud.panels.cur && !this.hud.worldMap?.isOpen && !g.me.local.path && !this.hud.fight;
    this.still = idle ? this.still + dt : 0;
    if (this.still > DEAD_GRACE) this.stats.dead += dt;
    const now = Date.now();
    if (now - this.lastLog < LOG_MS) return;
    this.lastLog = now;
    const s = this.stats;
    this.stats = { shown: {}, taken: {}, done: {}, dead: 0 };
    this.hud.sock.rpc('goals.log', { shown: s.shown, taken: s.taken, done: s.done, dead: Math.round(s.dead) }, { auto: true }).catch(() => {});
  }
}
