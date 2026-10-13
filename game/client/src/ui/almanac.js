// The Book: one panel with three tabs. Quests (every chain you're on), Today
// (the Almanac: three dailies, the weekly Grand Errand and the day's news)
// and the Journal (client/src/ui/journal.js).
import { h, clear } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { glyph } from './glyphs.js';
import { questDef, rewardText, stepNeed, QUESTS } from '../../../shared/quests.js';
import '../../../shared/almanac.js';
import { renderJournal } from './journal.js';

const COL = { make: ['Make', 'hammer'], venture: ['Venture', 'swords'], wander: ['Wander', 'compass'] };

// Panel builders are called as fn.call(panels, c, args) (see panels.js).
export const ALMANAC_PANELS = {
  book(c, args = {}) {
    let tab = args.tab ?? 'quests';
    let alm = null;
    let jr = null;
    const C = () => this.hud.goal.compass;
    const go = (target) => {
      const at = C()?.locate(target);
      if (!at) return this.hud.toast("Can't find the way there yet.", 'err');
      this.close();
      at.go();
    };
    const load = async () => {
      try {
        if (tab === 'today') alm = await this.sock.rpc('almanac.get');
        if (tab === 'journal') jr = await this.sock.rpc('journal.get');
        if (tab === 'journal' && jr) C()?.setJournal(jr);
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      if (this.cur === c) render();
    };
    const stepRow = (def, row, i) => {
      const s = def.steps[i];
      const state = i < row.step ? 'done' : i === row.step ? 'now' : 'later';
      const need = stepNeed(s);
      return h(
        'div.qstep.' + state,
        h('span.qdot', state === 'done' ? '✓' : String(i + 1)),
        h('div.grow', h('div', s.text, state === 'now' && need > 1 ? h('span.muted', ` ${row.n}/${need}`) : null), state === 'now' && s.hint ? h('div.s', s.hint) : null),
        state === 'now' && s.target?.kind !== 'bag' ? h('button.btn.small.green', { on: { click: () => go(s.target) } }, glyph('compass'), 'Go') : null,
      );
    };
    const render = () => {
      clear(c.body);
      this.title(c, tab === 'journal' ? 'Journal' : tab === 'today' ? 'Almanac' : 'Quests', tab === 'journal' ? 'book' : tab === 'today' ? 'hourglass' : 'scroll');
      c.body.append(h('div.tabs', ...[['quests', 'Quests'], ['today', 'Today'], ['journal', 'Journal']].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), render(), load()) } }, l))));
      if (tab === 'quests') {
        const C0 = C();
        const rows = [...(C0?.quests.values() ?? [])].filter((r) => !r.id.startsWith('alm:') && !r.id.startsWith('err:'));
        if (!rows.length) c.body.append(h('div.empty', h('div.big', '📜'), 'No quests right now. New chains open as you go: check back after a level or two!'));
        rows.sort((a, b) => (a.id === 'hv_intro' ? -1 : b.id === 'hv_intro' ? 1 : 0));
        for (const r of rows) {
          const def = questDef(r.id);
          if (!def) continue;
          c.body.append(h('div.qcard', h('div.qtitle', h('b', def.title), h('span.muted', ` ${r.step + 1}/${def.steps.length}`)), ...def.steps.map((_, i) => stepRow(def, r, i)), def.reward ? h('div.s.qreward', 'Reward: ', rewardText(def.reward)) : null));
        }
        const done = [...(C0?.done ?? [])].filter((id) => QUESTS[id]);
        if (done.length) c.body.append(h('div.section-title', 'Done'), h('div.muted', done.map((id) => QUESTS[id].title).join(' · ')));
        return;
      }
      if (tab === 'today') {
        if (!alm) return c.body.append(h('div.empty', 'Opening the Almanac…'));
        const t = alm.today;
        c.body.append(
          h(
            'div.today',
            h('div.kv', h('span', '🌙 Tonight'), h('b', t.twist.name)),
            h('div.s', t.twist.text),
            h('div.kv', h('span', '⭐ Featured dungeon'), h('b', t.featured.name)),
            h('div.kv', h('span', '💀 This week’s Nightmare'), h('b', t.nightmare.name)),
            ...t.legends.map((l) => h('div.kv', h('span', '🐟 Legend'), h('b', `${l.name}${l.rod > 1 ? ` (rod tier ${l.rod})` : ''}`))),
          ),
        );
        c.body.append(h('div.section-title', 'Dailies'), h('div.muted', 'Bank up to six: nothing is lost if you skip a day. One free reroll a day.'));
        for (const d of alm.dailies) {
          const def = questDef(d.id);
          if (!def) continue;
          const s = def.steps[0];
          const [label, ic] = COL[def.col] ?? ['Daily', 'scroll'];
          c.body.append(
            h(
              'div.rowcard' + (d.done ? '.done' : ''),
              h('div.ic', glyph(ic)),
              h('div.grow', h('div.t', s.text, stepNeed(s) > 1 && !d.done ? h('span.muted', ` ${d.n}/${stepNeed(s)}`) : null), h('div.s', `${label} · ${rewardText(def.reward)}`)),
              d.done ? h('span.chip.on', 'Done') : h('button.btn.small.green', { on: { click: () => go(s.target) } }, 'Go'),
              !d.done && alm.rerollLeft ? h('button.btn.small', { title: 'Swap it for another (once a day)', on: { click: () => this.rpc('almanac.reroll', { id: d.id, period: d.period }).then((r) => ((alm = r), sfx.pop(), render())) } }, '↻') : null,
            ),
          );
        }
        for (const w of alm.weekly) {
          const def = questDef(w.id);
          if (!def) continue;
          c.body.append(h('div.section-title', 'The Grand Errand (this week)'), h('div.qcard', ...def.steps.map((_, i) => stepRow(def, w, i)), h('div.s.qreward', 'Reward: ', rewardText(def.reward))));
        }
        return;
      }
      if (!jr) return c.body.append(h('div.empty', 'Opening your journal…'));
      renderJournal.call(this, c.body, jr, {
        claim: (page, pct) => this.rpc('journal.claim', { page, pct }).then((r) => (this.hud.toast(r.reward.text, 'gold'), sfx.coin(), load())),
        title: (t) => this.rpc('title.set', { title: t }).then((r) => ((jr.title = r.title), this.hud.toast(r.title ? `You are now known as ${r.title}.` : 'Title hidden.'), render())),
        go,
        rerender: () => render(),
      });
    };
    c.refresh = () => render();
    render();
    load();
  },
};
