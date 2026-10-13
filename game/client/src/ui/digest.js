// The welcome-back digest (SPEC §5.6): after 12 hours away, what happened
// while you were gone (never what you "missed"), your Hearth Rest, the
// day's news and one thing to do next.
import { h, clear, fmt } from '../util/dom.js';
import { glyph } from './glyphs.js';

const ago = (ms) => (ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)} day${ms >= 1.5 * 86_400_000 ? 's' : ''}` : `${Math.round(ms / 3_600_000)} hours`);

export const DIGEST_PANELS = {
  digest(c, d) {
    this.title(c, 'Welcome back!', 'castle');
    clear(c.body);
    c.body.append(h('p.muted', `You were away ${ago(d.away)}. Here is what happened.`));
    const sec = (title, ...rows) => rows.filter(Boolean).length && c.body.append(h('div.section-title', title), ...rows.filter(Boolean));
    sec('Your shop', d.shop ? h('div.kv', h('span', `${d.shop.count} sale${d.shop.count === 1 ? '' : 's'}`), h('b.gold', `+${fmt(d.shop.net)} 🪙`)) : null);
    sec('Markets', ...d.fills.map((f) => h('div.kv', h('span', `${f.name}: orders filled`), h('b', String(f.n)))), ...d.storage.map((s) => h('div.kv', h('span', `${s.name}: waiting in storage`), h('b', `${fmt(s.n)} items`))));
    sec('News for you', ...d.lines.slice(-10).map((l) => h('div.s.dline', l.text)));
    sec('Friends', ...d.friends.map((f) => h('div.s.dline', f.text)));
    if (d.rested) sec('Hearth Rest', h('div.kv', h('span', 'Well rested: your next xp pays +50%'), h('b', `${fmt(d.rested)} xp`)));
    sec('Tonight', h('div.kv', h('span', d.today.twist.name), h('b', '')), h('div.s', d.today.twist.text), h('div.kv', h('span', 'Featured dungeon'), h('b', d.today.featured.name)));
    const top = this.hud.goal.compass?.suggest()?.[0];
    if (top) sec('Next', h('div.rowcard', h('div.ic', glyph('compass')), h('div.grow', h('div.t', top.text)), h('button.btn.small.green', { on: { click: () => (this.close(), this.hud.goal.take(top)) } }, 'Go')));
    c.onClose = () => d.upto && this.sock.rpc('digest.ack', { upto: d.upto }, { auto: true }).catch(() => {});
    c.body.append(h('button.btn.green', { style: { marginTop: '12px', width: '100%' }, on: { click: () => this.close() } }, 'Into the world'));
  },
};
