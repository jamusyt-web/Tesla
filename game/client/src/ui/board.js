// The town board: the town's own orders (four a day, the same for
// everyone; server/orders.js), the Big Order everyone gives to, and paid
// jobs between players (server/jobs.js).
import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS, CATEGORIES, qOf } from '../../../shared/items.js';
import { iconEl, qtyInput } from './itemui.js';
import { townName, townCount } from '../../../shared/places.js';
import { MONSTERS } from '../../../shared/monsters.js';

// Panel builders are called as fn.call(panels, c, args) (see panels.js), so
// `this` is the Panels; the helpers below are called the same way.
export const BOARD_PANELS = {
  jobs(c, args = {}) {
    this.title(c, 'Town Board', 'scroll');
    let tab = args.tab || 'orders';
    let data = null;
    let orders = null;
    let post = { item: 'oak_log', qty: 20, per: null };
    const left = (t) => {
      const ms = t - (data?.now ?? Date.now());
      const hrs = Math.max(0, Math.round(ms / 3600_000));
      return hrs >= 24 ? `${Math.round(hrs / 24)}d left` : hrs >= 1 ? `${hrs}h left` : 'ending soon';
    };
    const load = async () => {
      try {
        if (tab === 'orders') orders = await this.sock.rpc('orders.list');
        else data = await this.sock.rpc('jobs.list');
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      if (this.cur === c) render();
    };
    const act = async (m, a, ok) => {
      try {
        const r = await this.sock.rpc(m, a);
        sfx.coin();
        this.hud.toast(ok(r), 'gold');
        this.hud.goal.compass?.loadOrders();
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      load();
    };
    const render = () => {
      clear(c.body);
      const tabs = [['orders', 'Orders'], ['board', 'Jobs'], ['mine', 'My jobs'], ['post', 'Post a job']];
      c.body.append(h('div.tabs', ...tabs.map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { on: { click: () => ((tab = k), render(), load()) } }, l))));
      if (tab === 'post') return jobForm.call(this, c.body, post, () => ((tab = 'mine'), load()));
      if (tab === 'orders') return ordersTab.call(this, c.body, orders, act, left);
      if (!data) return c.body.append(h('div.empty', 'Reading the board…'));
      if (tab === 'board') {
        const many = townCount() > 1;
        c.body.append(h('p.muted', `Bring what someone asks for and get paid on the spot (4% tax). You can deliver part of a job${many ? `, in the town it was posted in. This is the ${townName(data.town)} board` : ''}.`));
        if (!data.here.length) c.body.append(h('div.empty', h('div.big', '📜'), `No jobs posted${many ? ` in ${townName(data.town)}` : ''} right now. Post one yourself!`));
        for (const j of data.here) {
          const it = ITEMS[j.item];
          const mine = j.poster === this.hud.myId;
          const have = this.me.inv[j.item] || 0;
          const n = Math.min(have, j.left);
          const q = qtyInput(Math.max(1, n), Math.max(1, n));
          const right = mine
            ? h('span.chip.on', 'Yours')
            : have > 0
              ? h('div.row', q, h('button.btn.green.small', { on: { click: () => act('jobs.deliver', { id: j.id, qty: +q.value }, (r) => `Delivered ${r.qty}× ${it.name}: +${r.paid} 🪙`) } }, 'Deliver'))
              : h('span.muted', 'You have none');
          c.body.append(
            h('div.rowcard', h('div.ic', iconEl(j.item, '40px')), h('div.grow', h('div.t', `${j.left}× ${it.name}`, j.left < j.qty ? h('span.muted', ` (of ${j.qty})`) : null), h('div.s', `${fmt(j.per)} 🪙 each · ${fmt(j.left * j.per)} 🪙 in all · by ${j.posterName} · ${left(j.expiresAt)}`)), right),
          );
        }
        // Other towns' jobs: worth the trip? Deliver them there.
        if (data.elsewhere.length) c.body.append(h('div.section-title', 'In other towns'));
        for (const j of data.elsewhere) {
          const it = ITEMS[j.item];
          c.body.append(h('div.rowcard.locked', h('div.ic', iconEl(j.item, '40px')), h('div.grow', h('div.t', `${j.left}× ${it.name}`), h('div.s', `${fmt(j.per)} 🪙 each · by ${j.posterName} · ${left(j.expiresAt)}`)), h('span.chip', townName(j.town))));
        }
        return;
      }
      // My jobs
      const mine = data.mine;
      if (!mine.length) return c.body.append(h('div.empty', h('div.big', '🪶'), "You haven't posted any jobs. Post one and others will gather or craft it for you."));
      for (const j of mine) {
        const it = ITEMS[j.item];
        const got = j.qty - j.left;
        const state = { open: left(j.expiresAt), done: 'Done!', cancelled: 'Cancelled', expired: 'Ran out' }[j.status];
        c.body.append(
          h(
            'div.rowcard' + (j.status === 'open' ? '.open' : '.locked'),
            h('div.ic', iconEl(j.item, '40px')),
            h('div.grow', h('div.t', `${it.name}: ${got} of ${j.qty} delivered`), h('div.s', `${fmt(j.per)} 🪙 each · ${state}${townCount() > 1 ? ` · ${townName(j.town)}` : ''}`)),
            j.status === 'open' ? h('button.btn.red.small', { on: { click: () => act('jobs.cancel', { id: j.id }, (r) => `Job taken down${r.refund ? `: ${r.refund} 🪙 back` : ''}.`) } }, 'Cancel') : null,
          ),
        );
      }
    };
    c.refresh = () => tab !== 'post' && render();
    render();
    load();
  },
};

// The town's orders: four slots, each its own copy, and the Big Order.
function ordersTab(body, o, act, left) {
  if (!o) return body.append(h('div.empty', 'Reading the board…'));
  body.append(h('p.muted', `What ${o.name} needs. Four new orders every day, the same for everyone; you fill your own copy and keep it for 3 days. Orders pay well and earn you standing here.`));
  const b = o.big;
  if (b) {
    const have = this.me.inv[b.item] || 0;
    const q = qtyInput(Math.max(1, Math.min(have, b.need - b.got)), Math.max(1, Math.min(have, b.need - b.got)));
    body.append(
      h(
        'div.bigorder' + (b.done ? '.done' : ''),
        h('div.row', iconEl(b.item, '40px'), h('div.grow', h('div.t', `Big Order: ${fmt(b.need)}× ${ITEMS[b.item].name}`), h('div.s', b.done ? 'Filled! Everyone in town is Festive.' : `Everyone gives to this one. ${b.unit} 🪙 each as you give; when it fills, the whole town gets Festive (+10% xp).${b.mine ? ` You gave ${b.mine}.` : ''}`))),
        h('div.gbar', h('i', { style: { width: `${Math.round((100 * b.got) / b.need)}%` } }), h('span', `${fmt(b.got)}/${fmt(b.need)}`)),
        !b.done && have ? h('div.row', q, h('button.btn.green.small', { on: { click: () => act('big.give', { qty: +q.value }, (r) => `Gave ${r.qty}× ${ITEMS[b.item].name}: +${r.paid} 🪙`) } }, 'Give')) : null,
      ),
    );
  }
  for (const s of o.slots) {
    const done = s.state !== 'open';
    const hunt = s.kind === 'hunt';
    const have = hunt ? 0 : this.me.inv[s.item] || 0;
    const want = s.qty - s.got;
    const q = hunt ? null : qtyInput(Math.max(1, Math.min(have, want)), Math.max(1, Math.min(have, want)));
    const btn = done
      ? h('span.chip.on', s.state === 'done' ? 'Done' : 'Ran out')
      : hunt
        ? s.got >= s.qty
          ? h('button.btn.green.small', { on: { click: () => act('orders.deliver', { slot: s.slot }, (r) => `Order done: +${r.paid} 🪙, +${r.rep} standing`) } }, 'Turn in')
          : h('span.muted', `${s.got}/${s.qty} beaten`)
        : have > 0
          ? h('div.row', q, h('button.btn.green.small', { on: { click: () => act('orders.deliver', { slot: s.slot, qty: +q.value }, (r) => (r.done ? `Order done: +${r.paid} 🪙, +${r.rep} standing` : `Handed in: +${r.paid} 🪙 (${r.got}/${r.qty})`)) } }, 'Hand in'))
          : h('span.muted', 'You have none');
    const kind = { gather: 'Gather', hunt: 'Hunt', craft: 'Make', special: 'Special', import: 'Import' }[s.kind] ?? '';
    body.append(
      h(
        'div.rowcard' + (done ? '.locked' : ''),
        h('div.ic', hunt ? h('span', { style: { fontSize: '28px' } }, MONSTERS[s.monster]?.icon ?? '⚔️') : iconEl(s.item, '40px')),
        h('div.grow', h('div.t', s.text, !hunt && s.got ? h('span.muted', ` (${s.got} handed in)`) : null), h('div.s', `${kind} · ${fmt(s.pay)} 🪙 · +${s.rep} standing${s.xp ? ` · ${s.xp.n} ${s.xp.skill} xp` : ''}${done ? '' : ` · ${left(Date.now() + s.expiresIn)}`}`)),
        btn,
      ),
    );
  }
  if (!o.slots.length) body.append(h('div.empty', 'No orders here.'));
}

function jobForm(body, post, done) {
  const items = Object.entries(ITEMS).filter(([id, it]) => !qOf(id) && !it.bound).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const pick = h('select', ...Object.entries(CATEGORIES).map(([cat, label]) => h('optgroup', { label }, ...items.filter(([, it]) => it.cat === cat).map(([id, it]) => h('option', { value: id, selected: id === post.item }, it.name)))));
  const qty = h('input', { type: 'number', min: 1, max: 999, value: post.qty, inputMode: 'numeric' });
  const per = h('input', { type: 'number', min: 1, value: post.per ?? Math.ceil(ITEMS[post.item].value * 1.25), inputMode: 'numeric' });
  const total = h('div.t');
  const hint = h('div.s');
  const btn = h('button.btn.green', 'Post job');
  const upd = () => {
    post.item = pick.value;
    post.qty = Math.max(1, Math.floor(+qty.value || 1));
    post.per = Math.max(1, Math.floor(+per.value || 1));
    const sum = post.qty * post.per;
    total.textContent = `Pays ${fmt(sum)} 🪙 in all`;
    hint.textContent = `Base value ${ITEMS[post.item].value} 🪙 each. Paying a bit more gets it done sooner. The gold is held now and refunded for anything not delivered.`;
    btn.disabled = sum > (this.me.gold ?? 0);
  };
  pick.onchange = () => ((per.value = Math.ceil(ITEMS[pick.value].value * 1.25)), upd());
  qty.oninput = per.oninput = upd;
  btn.onclick = async () => {
    upd();
    btn.disabled = true;
    try {
      await this.sock.rpc('jobs.post', { item: post.item, qty: post.qty, per: post.per });
      sfx.coin();
      this.hud.toast('Job posted on the board!', 'gold');
      done();
    } catch (e) {
      this.hud.toast(e.message, 'err');
      upd();
    }
  };
  const field = (label, el) => h('label.jobf', h('span', label), el);
  body.append(
    h('div.jobform', field('Item wanted', pick), h('div.row', field('How many', qty), field('Pay per item 🪙', per)), h('div.rowcard', h('div.grow', total, hint))),
    h('div.row', btn, h('span.muted', 'Jobs stay up for 3 days. You can have 5 at once.')),
  );
  upd();
}
