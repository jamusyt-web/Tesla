// The round button above the dock: the best thing to do right here (join a
// friend's fight, rest, pray, open a chest, leave). Dungeon-only today; the
// game works out what it is (world/services.js contextAction).
import { h } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';

export class ContextButton {
  constructor(hud) {
    this.hud = hud;
    this.ctx = null;
    this.el = h('button.ctxbtn.hidden', { on: { click: () => (sfx.tap(), this.ctx?.fn()) } });
  }
  update() {
    const g = this.hud.game;
    const ctx = g?.dungeon && !g.battle ? g.contextAction() : null;
    this.ctx = ctx;
    this.el.classList.toggle('hidden', !ctx);
    if (!ctx) return;
    const key = ctx.label + ctx.glyph;
    if (this.el.dataset.k === key) return;
    this.el.dataset.k = key;
    this.el.replaceChildren(glyph(ctx.glyph), h('span', ctx.label));
  }
  hide() {
    this.el.classList.add('hidden');
  }
}
