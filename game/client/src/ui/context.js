// The round button above the dock: the best thing to do right here (SPEC
// §5.3). Out in the world it is always there: join a friend's fight,
// collect, hand in, travel, open a cache, chop the next tree… and, when
// nothing is near, the Compass's top goal. Underground: rest, pray, open a
// chest, leave. The game works out what it is (world/services.js
// contextAction); `off` greys it out (you can't yet). E, F and Space press
// it. A label holds for at least 0.4 s so it never flickers.
import { h } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';

const HOLD_MS = 400;

export class ContextButton {
  constructor(hud) {
    this.hud = hud;
    this.ctx = null;
    this.since = 0;
    this.el = h('button.ctxbtn.hidden', { on: { click: () => (sfx.tap(), this.press()) } });
  }
  press() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.rule === 'compass') this.hud.goal.stats.taken.context = (this.hud.goal.stats.taken.context ?? 0) + 1;
    ctx.fn();
  }
  update() {
    const g = this.hud.game;
    const now = performance.now();
    const next = g && !g.battle && !g.room ? g.contextAction(this.ctx?.key ?? null) : null;
    // Hold the label a moment, unless it vanished (nothing to do) or we're underground.
    if (this.ctx && next && next.label !== this.ctx.label && now - this.since < HOLD_MS && !g.dungeon) return;
    if (!next || next.label !== this.ctx?.label) this.since = now;
    this.ctx = next;
    this.el.classList.toggle('hidden', !next);
    if (!next) return;
    const key = next.label + next.glyph + !!next.off;
    if (this.el.dataset.k === key) return;
    this.el.dataset.k = key;
    this.el.classList.toggle('off', !!next.off);
    this.el.classList.toggle('far', next.rule === 'compass');
    this.el.replaceChildren(glyph(next.glyph), h('span', next.label));
  }
  hide() {
    this.el.classList.add('hidden');
  }
}
