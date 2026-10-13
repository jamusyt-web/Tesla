// Banners across the screen: a title as you walk into a new region, a
// smaller one for named zones inside it, and any announcement (showBanner).
import { h } from '../util/dom.js';
import { placeAt } from '../../../shared/world.js';
import { tierLabel } from './worldmap.js';

export class Banners {
  constructor(hud) {
    this.hud = hud;
    this.el = h('div.region-banner.hidden');
    this.place = null;
  }

  // A few metres of slack at the edges stop it flickering when you stand on a border.
  update() {
    const g = this.hud.game;
    if (!g?.me || g.room || g.dungeon) return;
    const p = g.myPos();
    const raw = placeAt(p.x, p.z);
    // Slack only when leaving for somewhere bigger (or nowhere): a smaller area inside is announced at once.
    const keep = (old, now) => (old && old !== now && (!now || now.r >= old.r) && Math.hypot(p.x - old.x, p.z - old.z) < old.r + 3 ? old : now);
    const prev = this.place;
    const zone = keep(prev?.zone, raw.zone);
    const region = keep(prev?.region, raw.region);
    this.place = { zone, region };
    if (g.battle) return;
    if (region && region !== prev?.region) {
      const kind = { town: 'Town', wild: 'Wild lands', outpost: 'Outpost' }[region.kind];
      const page = this.hud.goal.compass?.pages.find((p) => p.id === region.id);
      this.show(region.name, [tierLabel(region.tier), kind, page ? `Discovered ${page.found}/${page.places} (${page.pct}%)` : null].filter(Boolean).join(' · '));
    } else if (zone && zone !== prev?.zone) {
      const what = { forest: 'Woodcutting', quarry: 'Mining', garden: 'Herb gathering', lake: 'Fishing', wilds: 'Monsters roam here' }[zone.kind ?? zone.id];
      this.show(zone.label, what || region?.name || '', true);
    }
  }

  show(title, sub, small = false) {
    const b = this.el;
    b.className = 'region-banner' + (small ? ' small' : '');
    b.replaceChildren(h('div.rb-rule'), h('div.rb-title', title), sub ? h('div.rb-sub', sub) : null, h('div.rb-rule'));
    void b.offsetWidth; // restart the animation
    b.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => b.classList.add('hidden'), 3600);
  }
}
