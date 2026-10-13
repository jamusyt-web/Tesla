// What a battle in the world won (or that it was lost).
import { h } from '../util/dom.js';
import { itemSlot } from './itemui.js';

// Panel builders are called as fn.call(panels, c, args) (see panels.js), so
// `this` is the Panels; the helpers below are called the same way.
export const BATTLE_PANELS = {
  result(c, r) {
    this.title(c, r.victory ? 'Victory' : 'Defeat', r.victory ? 'trophy' : 'skull');
    if (r.victory) {
      c.body.append(
        h('div.result', h('div.big', 'Victory'), h('div', { style: { fontWeight: 700, fontSize: '20px' } }, `+${r.gold} 🪙  ·  +${r.xp?.amount || 0} Combat XP`)),
        h('div.loot-row', ...Object.entries(r.loot || {}).map(([id, n], i) => {
          const s = itemSlot(id, n);
          s.style.animationDelay = i * 0.12 + 's';
          return s;
        })),
        h('button.btn.green.block.big', { on: { click: () => this.close() } }, 'Continue'),
      );
    } else {
      c.body.append(h('div.result.lose', h('div.big', 'Defeat'), h('p', 'You’re driven back. Mend your wounds, better your gear, and bring allies — anyone can join your fight.')), h('button.btn.block.big', { on: { click: () => this.close() } }, 'OK'));
    }
  },
};
