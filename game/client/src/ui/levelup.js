// The level-up popup (SPEC §5.3): names exactly what a new skill level
// opened (a tree you can chop now, a recipe, a perk), each with a "Show me"
// that points the Compass at it. Several levels at once share one popup.
import { h, clear } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';
import { SKILLS } from '../../../shared/skills.js';

const KIND = { P: 'New', Q: 'Handy', S: 'Perk', C: 'Look' };

export class LevelUp {
  constructor(hud) {
    this.hud = hud;
    this.queue = [];
    this.el = h('div.unlock.hidden');
    this.timer = null;
  }
  // { skill, lvl, list }
  add(m) {
    this.queue.push(m);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.show(), 250); // gather a burst of levels
  }
  show() {
    const items = this.queue.splice(0);
    if (!items.length) return;
    const top = items[items.length - 1];
    const sk = SKILLS[top.skill];
    const rows = items.flatMap((m) => m.list.map((u) => ({ ...u, lvl: m.lvl, skill: m.skill })));
    clear(this.el).append(
      h('div.uhead', h('b', `${sk?.icon ?? ''} ${sk?.name ?? top.skill} ${top.lvl}`), h('button.close', { 'aria-label': 'Close', on: { click: () => this.close() } }, '✕')),
      h(
        'div.ulist',
        ...rows.slice(0, 6).map((u) =>
          h(
            'div.urow',
            h('span.chip', KIND[u.kind] ?? 'New'),
            h('span.utext', u.text),
            u.show ? h('button.btn.small.green', { on: { click: () => (this.close(), this.showMe(u)) } }, glyph('compass'), 'Show me') : null,
            u.choose ? h('button.btn.small.purple', { on: { click: () => (this.close(), this.hud.panels.open('skills', { skill: u.skill })) } }, 'Choose') : null,
          ),
        ),
      ),
    );
    this.el.classList.remove('hidden');
    sfx.level?.();
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => this.close(), 12000);
  }
  // Point the Compass at it: the card shows it, the guide walks you there.
  showMe(u) {
    const card = this.hud.goal;
    const goal = { id: `unlock:${u.skill}:${u.lvl}:${u.text}`, src: 'unlock', text: u.text, why: 'New', target: u.show, score: 99, progress: null };
    card.shown = goal;
    card.lock = null;
    card.render();
    card.take(goal);
  }
  close() {
    this.el.classList.add('hidden');
  }
}
