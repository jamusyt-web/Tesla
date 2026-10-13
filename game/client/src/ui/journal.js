// The journal (SPEC §5.5): a page per region with how much you've
// discovered (60% from land walked, 40% from places found), what you've
// met there (places, creatures, gatherables, fish records, recipes,
// secrets), the rewards at 25/50/75/100%, and your titles.
import { h } from '../util/dom.js';
import { glyph } from './glyphs.js';
import { PAGE_STEPS, WHOLE_STEPS, pageReward, wholeReward } from '../../../shared/journal.js';
import { REGIONS } from '../../../shared/world.js';
import { levelFromXp } from '../../../shared/skills.js';
import { FISH } from '../../../shared/fishing.js';

const TABS = [
  ['places', 'Places'],
  ['creatures', 'Creatures'],
  ['gatherables', 'Gathering'],
  ['fish', 'Fish'],
  ['recipes', 'Recipes'],
  ['secrets', 'Secrets'],
];
const KIND_ICON = { vista: '🔭', ruin: '🏛️', shrine: '⛩️', cache: '🎁', secret: '🔍', curio: '✨', npc: '🧑', landmark: '🚩', stone: '🗿', door: '🚪', lake: '🎣' };
let pageTab = 'places';
let pageId = null;

// A ring showing a percentage.
const ring = (pct) => h('div.pring', { style: { '--p': `${pct}%` } }, h('span', `${pct}%`));

// Called as renderJournal.call(panels, body, data, { claim, title, go, rerender }).
export function renderJournal(body, jr, act) {
  pageId ??= jr.pages.find((p) => p.kind === 'town')?.id ?? jr.pages[0]?.id;
  const claims = new Set(jr.claims);
  body.append(
    h('div.rowcard', ring(jr.whole), h('div.grow', h('div.t', 'The Hearthlands'), h('div.s', 'Your whole journal: walk every corner, find every place.')), ...WHOLE_STEPS.map((s) => claimBtn('whole', s, jr.whole, claims, act, wholeReward(s)))),
  );
  if (jr.pages.length > 1) body.append(h('div.tabs.wrap', ...jr.pages.map((p) => h('button' + (p.id === pageId ? '.on' : ''), { on: { click: () => ((pageId = p.id), act.rerender()) } }, `${p.name} ${p.pct}%`))));
  const p = jr.pages.find((x) => x.id === pageId) ?? jr.pages[0];
  if (!p) return;
  const region = REGIONS.find((r) => r.id === p.id) ?? { name: p.name };
  body.append(
    h(
      'div.rowcard',
      ring(p.pct),
      h('div.grow', h('div.t', p.name, h('span.muted', ` · ${p.kind === 'town' ? 'Town' : 'Wilds'}, tier ${p.tier}`)), h('div.s', `Land walked ${p.walked}/${p.land} · places found ${p.found}/${p.places}`)),
    ),
    h('div.claims', ...PAGE_STEPS.map((s) => claimBtn(p.id, s, p.pct, claims, act, pageReward(region, s)))),
  );
  // The 75% cloak: wear it.
  if (claims.has(`${p.id}:75`)) {
    const tint = region.biome ?? 'meadow';
    const hud = this.hud;
    const on = hud.myAvatar?.cloakTint === tint && hud.myAvatar?.back === 'cape';
    body.append(h('button.btn.small' + (on ? '' : '.green'), { on: { click: () => this.rpc('avatar', { avatar: { ...hud.myAvatar, back: 'cape', cloakTint: on ? 'none' : tint } }).then(() => (hud.setAvatar({ ...hud.myAvatar, back: 'cape', cloakTint: on ? 'none' : tint }), act.rerender())) } }, on ? 'Take off the cloak' : `Wear the ${tint} cloak`));
  }
  body.append(h('div.tabs.wrap', ...TABS.map(([k, l]) => h('button' + (pageTab === k ? '.on' : ''), { on: { click: () => ((pageTab = k), act.rerender()) } }, l))));
  const list = p.tabs[pageTab] ?? [];
  if (!list.length) body.append(h('div.empty', 'Nothing here in this region.'));
  const fishing = levelFromXp(this?.me?.skills?.fishing || 0);
  for (const x of list) {
    if (pageTab === 'places')
      body.append(h('div.rowcard' + (x.found ? '' : '.dim'), h('div.ic', x.found || x.pinned ? KIND_ICON[x.kind] ?? '📍' : '❔'), h('div.grow', h('div.t', x.name ?? 'Undiscovered'), h('div.s', x.found ? 'Found' : x.pinned ? 'Seen from afar: on your map' : kindWord(x.kind))), x.x != null && !x.found ? h('button.btn.small.green', { on: { click: () => act.go({ kind: 'point', x: x.x, z: x.z }) } }, glyph('compass'), 'Go') : null));
    else if (pageTab === 'creatures') body.append(h('div.kv' + (x.n ? '' : '.dim'), h('span', x.name ?? '???'), h('b', x.n ? `${x.n} beaten` : 'not met')));
    else if (pageTab === 'gatherables') body.append(h('div.kv', h('span', x.name), h('b', [x.rich ? '✨ rich' : null, x.ancient ? '🌟 ancient' : null].filter(Boolean).join(' · ') || '—')));
    else if (pageTab === 'fish') {
      const win = FISH[x.id]?.legend?.window;
      body.append(h('div.kv' + (x.name ? '' : '.dim'), h('span', x.name ?? '???', x.legend ? ' 🌟' : ''), h('b', x.best ? `record ${x.best} kg` : x.legend && fishing >= 30 && win ? `bites: ${windowText(win)}` : x.legend ? 'a legend' : 'not caught')));
    } else if (pageTab === 'recipes') body.append(h('div.kv' + (x.name ? '' : '.dim'), h('span', x.name ?? '???'), h('b', x.name ? (x.best ? `best ${x.best}` : 'made') : 'not made')));
    else if (pageTab === 'secrets') body.append(h('div.kv' + (x.name ? '' : '.dim'), h('span', x.name ?? '???'), h('b', x.read ? 'read' : x.name ? 'found' : '')));
  }
  if (jr.titles?.length) {
    body.append(h('div.section-title', 'Titles'), h('div.muted', 'Shown on your name. Tap one to wear it.'));
    body.append(h('div.chips', h('button.chip' + (!jr.title ? '.on' : ''), { on: { click: () => act.title(null) } }, 'None'), ...jr.titles.map((t) => h('button.chip' + (jr.title === t ? '.on' : ''), { on: { click: () => act.title(t) } }, t))));
  }
}

function claimBtn(page, pct, have, claims, act, reward) {
  const done = claims.has(`${page}:${pct}`);
  const can = have >= pct && !done;
  return h('button.claim' + (done ? '.done' : can ? '.can' : ''), { title: reward?.text ?? '', disabled: !can, on: { click: () => can && act.claim(page, pct) } }, done ? `✓ ${pct}%` : `${pct}%`, h('small', reward?.text ?? ''));
}
const kindWord = (k) => ({ stone: 'A waystone', door: 'A dungeon door', lake: 'Water', cache: 'Something hidden', vista: 'A high place', shrine: 'A quiet place', ruin: 'Old stones', npc: 'Someone', curio: 'Something odd', secret: 'A secret' })[k] ?? 'Somewhere';
const windowText = (w) => [w.weather?.join?.('/') ?? w.weather, w.time].filter(Boolean).join(', ') || 'any time';

// What a landmark said or gave: a ruin's story, a secret, someone talking,
// a page of Ysolde's Atlas.
export const JOURNAL_PANELS = {
  lore(c, a) {
    this.title(c, a.name ?? 'A find', a.lines ? 'talk' : 'scroll');
    if (a.lore) c.body.append(h('p.lore', a.lore));
    for (const l of a.lines ?? []) c.body.append(h('p.lore', l));
    if (a.loot) c.body.append(h('div.rowcard', h('div.ic', '🎁'), h('div.grow', h('div.t', 'You found'), h('div.s', a.loot))));
    if (a.page) c.body.append(h('div.rowcard.atlas', h('div.ic', '📜'), h('div.grow', h('div.t', `Ysolde's Atlas, page ${a.page.n}`), h('div.s', a.page.riddle))));
    c.body.append(h('button.btn.green', { style: { marginTop: '10px', width: '100%' }, on: { click: () => this.close() } }, 'Close'));
  },
};
