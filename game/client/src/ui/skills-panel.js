// Skills (SPEC §4.8): each skill's level and what every level ahead
// unlocks, the level-40 choice (free the first time) and how much a change
// costs at a Town Hall.
import { h, clear } from '../util/dom.js';
import { SKILLS, SKILL_IDS, levelFromXp, levelProgress } from '../../../shared/skills.js';
import { ladder } from '../../../shared/milestones.js';
import { PICKS, PICK_LVL } from '../../../shared/perks.js';

const KIND = { P: 'New', Q: 'Handy', S: 'Perk', C: 'Look' };

export const SKILL_PANELS = {
  skills(c, args = {}) {
    let skill = args.skill ?? 'foraging';
    let info = null;
    const render = () => {
      clear(c.body);
      this.title(c, 'Skills', 'star');
      const me = this.me;
      c.body.append(h('div.tabs.wrap', ...SKILL_IDS.map((s) => h('button' + (s === skill ? '.on' : ''), { on: { click: () => ((skill = s), render()) } }, `${SKILLS[s].icon} ${levelFromXp(me.skills?.[s] || 0)}`))));
      const xp = me.skills?.[skill] || 0;
      const L = levelFromXp(xp);
      const pr = levelProgress(xp);
      c.body.append(h('div.rowcard', h('div.ic', SKILLS[skill].icon), h('div.grow', h('div.t', `${SKILLS[skill].name} ${L}`), h('div.gbar', h('i', { style: { width: `${Math.round(100 * pr.pct)}%` } })))));
      // The level-40 choice.
      const P = PICKS[skill];
      const mine = me.perks?.[skill];
      c.body.append(h('div.section-title', `Level ${PICK_LVL}: choose one`), h('div.muted', L >= 50 ? 'Grandmaster: you have both.' : L < PICK_LVL ? `At ${SKILLS[skill].name} ${PICK_LVL} you pick one. You can change it later at a Town Hall.` : mine ? `Changing it at a Town Hall costs ${info?.nextRespec ?? 500} 🪙.` : 'Free the first time.'));
      for (const k of ['a', 'b']) {
        const on = mine === k || L >= 50;
        const btn = L >= PICK_LVL && L < 50 && !on ? h('button.btn.small' + (mine ? '' : '.green'), { on: { click: () => this.rpc(mine ? 'perks.respec' : 'perks.choose', { skill, pick: k }).then((r) => ((me.perks = r.perks), info && r.next && (info.nextRespec = r.next), render())) } }, mine ? 'Change' : 'Choose') : on ? h('span.chip.on', 'Yours') : null;
        c.body.append(h('div.rowcard' + (on ? '' : '.dim'), h('div.grow', h('div.t', P[k].name), h('div.s', P[k].text)), btn));
      }
      c.body.append(h('div.section-title', 'Unlocks'));
      for (const step of ladder(skill))
        c.body.append(h('div.ladder' + (step.lvl <= L ? '.got' : ''), h('b', String(step.lvl)), h('div.grow', ...step.list.map((u) => h('div', h('span.chip', KIND[u.kind] ?? 'New'), ' ', u.text)))));
    };
    render();
    this.sock.rpc('perks.info', {}, { auto: true }).then((r) => ((info = r), this.cur === c && render())).catch(() => {});
  },
};
