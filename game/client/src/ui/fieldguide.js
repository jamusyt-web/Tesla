// The field guide (a Book tab): every tree, rock, herb, fish and creature in
// the world, and each one's kinds to find. Found ones are drawn in colour,
// the rest as shadows with where to look. Each page pays at 25, 50 and 100%
// (the server decides: server/fieldguide.js).
import { h } from '../util/dom.js';
import { glyph } from './glyphs.js';
import { iconEl } from './itemui.js';
import { GUIDE_STEPS, GUIDE_PAGES, guideReward } from '../../../shared/fieldguide.js';

let pageId = 'trees';

// What an entry's numbers say: how many, and the best one.
function countText(p, e) {
  if (!e.found) return e.where.length ? `Look in ${e.where.slice(0, 2).join(' or ')}` : 'Somewhere out there';
  if (p === 'fish') return `Caught ${e.n}${e.best ? ` · record ${e.best} kg` : ''}`;
  if (p === 'creatures') return `Beaten ${e.n}`;
  return `Gathered ${e.n}${e.best ? ` · best haul ${e.best}` : ''}`;
}

// Called as renderGuide.call(panels, body, data, { claim, go, rerender }).
export function renderGuide(body, fg, act) {
  const claims = new Set(fg.claims);
  body.append(h('div.tabs.wrap', ...fg.pages.map((p) => h('button' + (p.id === pageId ? '.on' : ''), { on: { click: () => ((pageId = p.id), act.rerender()) } }, `${p.icon} ${p.name} ${p.pct}%`))));
  const p = fg.pages.find((x) => x.id === pageId) ?? fg.pages[0];
  if (!p) return;
  const kinds = p.entries.filter((e) => e.found).length;
  body.append(
    h('div.rowcard', h('div.pring', { style: { '--p': `${p.pct}%` } }, h('span', `${p.pct}%`)), h('div.grow', h('div.t', `${p.icon} ${p.name}`), h('div.s', `${kinds} of ${p.entries.length} found · ${p.got} of ${p.all} kinds ticked off`))),
    h(
      'div.claims',
      ...GUIDE_STEPS.map((s) => {
        const done = claims.has(`${p.id}:${s}`);
        const can = p.pct >= s && !done;
        const r = guideReward(p.id, s);
        return h('button.claim' + (done ? '.done' : can ? '.can' : ''), { disabled: !can, on: { click: () => can && act.claim(p.id, s) } }, done ? `✓ ${s}%` : `${s}%`, h('small', r?.text ?? ''));
      }),
    ),
  );
  // The 50% cloak: wear it.
  const tint = GUIDE_PAGES.find((x) => x.id === p.id)?.cloak;
  if (fg.cloaks.includes(tint)) {
    const hud = this.hud;
    const on = hud.myAvatar?.cloakTint === tint && hud.myAvatar?.back === 'cape';
    const avatar = { ...hud.myAvatar, back: 'cape', cloakTint: on ? 'none' : tint };
    body.append(h('button.btn.small' + (on ? '' : '.green'), { on: { click: () => this.rpc('avatar', { avatar }).then(() => (hud.setAvatar(avatar), act.rerender())) } }, on ? 'Take off the cloak' : `Wear the ${tint} cloak`));
  }
  for (const e of p.entries) {
    body.append(
      h(
        'div.rowcard.gentry' + (e.found ? '' : '.unknown') + (e.done ? '.full' : ''),
        h('div.ic', e.icon ? iconEl(e.icon) : p.icon),
        h(
          'div.grow',
          h('div.t', e.name, e.legend ? h('span.chip', 'Legend') : null, e.boss ? h('span.chip', 'Boss') : null),
          h('div.s', countText(p.id, e)),
          h('div.marks', ...e.marks.map((m) => h('span.mark' + (m.got ? '.on' : ''), m.got ? `✓ ${m.label}` : m.label))),
        ),
        e.done || !e.go ? null : h('button.btn.small.green', { on: { click: () => act.go(e.go) } }, glyph('compass'), 'Go'),
      ),
    );
  }
}
