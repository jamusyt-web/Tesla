// What a battle in the world won (or that it was lost).
import { h } from '../util/dom.js';
import { itemSlot } from './itemui.js';
import { MONSTERS } from '../../../shared/monsters.js';

// The next one like the one you just beat, within 40 m (for "Fight another").
function another(g, type, not) {
  if (!g || !type) return null;
  const p = g.myPos();
  let best = null;
  for (const m of g.mobs.values()) {
    if (m.type !== type || m.id === not || m.state === 'dead' || m.battle) continue;
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    if (d <= 40 && (!best || d < best.d)) best = { id: m.id, d };
  }
  return best;
}

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
        ...(() => {
          // What next: another of the same, or back to your goal.
          const g = this.hud.game;
          const next = another(g, r.type, r.mob);
          const goal = this.hud.goal.shown;
          return [
            next ? h('button.btn.green.block.big', { on: { click: () => (this.close(), g.goMob(next.id)) } }, `Fight another ${MONSTERS[r.type]?.name ?? ''} (${Math.round(next.d)} m)`) : null,
            goal ? h('button.btn.block' + (next ? '' : '.green.big'), { on: { click: () => (this.close(), this.hud.goal.take(goal)) } }, `→ ${goal.text}`) : null,
            h('button.btn.block', { on: { click: () => this.close() } }, 'Done'),
          ];
        })(),
      );
    } else {
      c.body.append(h('div.result.lose', h('div.big', 'Defeat'), h('p', 'You’re driven back. Mend your wounds, better your gear, and bring allies — anyone can join your fight.')), h('button.btn.block.big', { on: { click: () => this.close() } }, 'OK'));
    }
  },
};
