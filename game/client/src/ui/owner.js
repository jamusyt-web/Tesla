// The server owner's tabs in the Town Hall (SPEC §6.5, §5.8): Economy
// (gold in and out, prices, merchants, alarms with the knob to turn) and
// Engagement (time played, dead air, which Compass goals people take).
import { h, fmt } from '../util/dom.js';

// Called as renderEcon.call(panels, body, report, reload).
export function renderEcon(body, r, reload) {
  body.append(h('div.muted', `The last ${r.days} days. New gold should not outrun gold leaving the game by more than 1.5×.`));
  body.append(
    h('div.kv', h('span', 'New gold (quests, loot, orders, sales to merchants…)'), h('b.gold', `${fmt(r.faucet)} 🪙`)),
    h('div.kv', h('span', 'Gold leaving (fees, travel, tolls, suppliers…)'), h('b', `${fmt(r.sink)} 🪙`)),
    h('div.kv', h('span', 'In ÷ out'), h('b' + (r.ratio > 1.5 ? '.red' : ''), r.ratio != null ? `×${r.ratio}` : '—')),
    h('div.kv', h('span', 'New gold per hour played'), h('b', r.goldPerHour != null ? `${fmt(r.goldPerHour)} 🪙` : '—')),
  );
  if (r.alarms.length) body.append(h('div.section-title', 'Alarms'));
  for (const a of r.alarms)
    body.append(h('div.rowcard', h('div.ic', '⚠️'), h('div.grow', h('div.t', a.text), h('div.s', `${a.why} Suggested: ${a.knob} = ${a.suggest}`)), h('button.btn.small', { on: { click: () => this.rpc('owner.econ.set', { key: a.knob, value: a.suggest }, 'Knob set.').then(reload) } }, 'Apply')));
  body.append(h('div.section-title', 'By reason'));
  for (const f of r.flows) body.append(h('div.kv' + (f.transfer ? '.dim' : ''), h('span', `${f.reason}${f.transfer ? ' (between heroes)' : ''}`), h('b', `${f.amount > 0 ? '+' : ''}${fmt(f.amount)}`)));
  body.append(h('div.section-title', 'Prices (this week vs last)'));
  for (const c of r.cpi) body.append(h('div.kv', h('span', c.town), h('b', c.change == null ? 'not enough trades' : `${c.change > 0 ? '+' : ''}${c.change}%`)));
  body.append(h('div.section-title', 'Merchants'));
  for (const p of r.pools) body.append(h('div.kv', h('span', p.town), h('b', `floor ${p.floorLeft}% · premium ${p.premium}%`)));
  body.append(h('div.section-title', 'Knobs'));
  const keys = Object.entries(r.overrides);
  if (!keys.length) body.append(h('div.muted', 'All at their defaults.'));
  for (const [k, v] of keys) body.append(h('div.kv', h('span', k), h('b', String(v)), h('button.btn.small', { on: { click: () => this.rpc('owner.econ.set', { key: k, value: null }, 'Back to default.').then(reload) } }, 'Reset')));
  const key = h('input', { placeholder: 'knob, e.g. supply.markup' });
  const val = h('input', { placeholder: 'value', inputMode: 'decimal', style: { width: '80px' } });
  body.append(h('div.row', key, val, h('button.btn.small.green', { on: { click: () => this.rpc('owner.econ.set', { key: key.value.trim(), value: val.value }, 'Knob set.').then(reload) } }, 'Set')));
}

export function renderEngage(body, r) {
  body.append(h('div.muted', `Dead air is time in the world with nothing happening. The goal is under ${r.target}% of time played; it's ${r.deadPct}% this week.`));
  for (const d of r.days) body.append(h('div.rowcard', h('div.grow', h('div.t', new Date(d.day * 86_400_000).toDateString()), h('div.s', `${d.players} players · ${fmt(d.minutes)} min · ${d.sessions} sessions · dead air ${d.deadPct}% · goals ${d.shown} shown, ${d.taken} taken, ${d.done} done`))));
  if (!r.days.length) body.append(h('div.empty', 'Nothing yet: numbers arrive once a minute while people play.'));
  body.append(h('div.section-title', 'Compass goals by source'));
  for (const s of r.sources) body.append(h('div.kv', h('span', s.src), h('b', `${s.shown} shown · ${s.takeRate}% taken · ${s.done} done`)));
}
