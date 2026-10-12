import { h, clear, fmt } from '../util/dom.js';
import { sfx } from '../util/sfx.js';
import { ITEMS } from '../../../shared/items.js';
import { DUNGEONS, MAX_WIPES } from '../../../shared/dungeon.js';
import { glyph } from './glyphs.js';
import { iconEl } from './panels.js';

// Panels for dungeons and parties. Each builder is called as fn.call(panels, c, args).

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtIn = (ms) => {
  const hrs = Math.floor(ms / 3_600_000);
  return hrs >= 24 ? `${Math.floor(hrs / 24)}d ${hrs % 24}h` : `${hrs}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
};
const lootRow = (loot) =>
  h(
    'div.loot-row',
    ...Object.entries(loot.items || {}).map(([id, n], i) => {
      const s = h('div.slot', { 'data-r': ITEMS[id]?.rarity, title: ITEMS[id]?.name }, iconEl(id), h('span.q', fmt(n)));
      s.style.animationDelay = i * 0.12 + 's';
      return s;
    }),
  );
const partyWord = (n) => (n === 1 ? 'Solo' : n === 2 ? 'Duo' : n === 3 ? 'Trio' : 'Four');

export const DUNGEON_PANELS = {
  // The crypt door: tiers, today's twist, records, and going in.
  dungeon(c, { kind = 'hollow_crypt' } = {}) {
    const K = DUNGEONS[kind];
    this.title(c, K?.name ?? 'Dungeon', 'crypt');
    let info = null;
    let tier = null;
    let mode = 'random';
    const g = this.hud.game;
    const render = () => {
      clear(c.body);
      if (!info) return c.body.append(h('div.empty', 'Loading…'));
      const unlocked = info.tiers.filter((t) => t.unlocked);
      tier ??= unlocked[unlocked.length - 1]?.tier ?? 1;
      const T = info.tiers.find((t) => t.tier === tier);
      const p = info.party;
      const lead = p && p.leader === this.hud.myId;
      const others = p ? p.members.filter((m) => m.id !== this.hud.myId && m.online) : [];
      c.body.append(
        h('div.muted', { style: { marginBottom: '10px' } }, info.blurb),
        h('div.rowcard.dmod', h('div.ic', glyph('skull')), h('div.grow', h('div.t', `Today: ${info.mod.name}`), h('div.s', info.mod.text))),
        h('div.section-title', 'Tier'),
        h(
          'div.tabs',
          ...info.tiers.map((t) =>
            h('button' + (t.tier === tier ? '.on' : '') + (t.unlocked ? '' : '.locked'), { on: { click: () => (t.unlocked ? ((tier = t.tier), render()) : this.hud.toast(`Clear ${info.tiers[t.tier - 2].name} first.`, 'err')) } }, t.unlocked ? '' : glyph('lock'), t.name),
          ),
        ),
        h('div.kv', h('span', 'Suggested'), h('b', `Level ${T.rec.level}+ · ${T.rec.gear}`)),
        h('div.kv', h('span', 'Monsters'), h('b', T.hp === 1 ? 'Normal' : `${Math.round(T.hp * 100)}% health · ${Math.round(T.atk * 100)}% damage`)),
        h('div.kv', h('span', 'Loot'), h('b.gold', T.loot === 1 ? 'Normal' : `×${T.loot}`)),
        h('div.kv', h('span', 'First clear today'), h('b', T.firstToday ? h('span.gold', 'Bonus chest: double treasure!') : 'Done (come back tomorrow)')),
        h('div.section-title', 'Crypt'),
        h(
          'div.tabs',
          h('button' + (mode === 'random' ? '.on' : ''), { on: { click: () => ((mode = 'random'), render()) } }, 'New every time'),
          h('button' + (mode === 'weekly' ? '.on' : ''), { on: { click: () => ((mode = 'weekly'), render()) } }, 'This week’s'),
        ),
        h('div.muted', { style: { margin: '-6px 0 10px', fontSize: '13px' } }, mode === 'weekly' ? `The same crypt for everyone until it changes in ${fmtIn(info.nextWeekIn)}: race the board below.` : 'A fresh crypt each time you go in.'),
        h('div.muted', { style: { fontSize: '13px', marginBottom: '10px' } }, `Groups face more halls, tougher monsters and elites with two powers, and every hero earns more gold and treasure. Health doesn't come back on its own down there: rest at the brazier, pray at the shrine, clear rooms. ${MAX_WIPES + 1} wipes and the crypt throws you out.`),
      );
      // Going in
      const enter = (party) => (this.close(), g.enterCrypt(kind, { tier, mode, party }));
      const run = info.partyRun;
      if (g.dungeon) c.body.append(h('div.empty', 'You are in a dungeon right now.'));
      else if (run?.canJoin) c.body.append(h('button.btn.green.block.big', { on: { click: () => (this.close(), this.rpc('dungeon.join', { run: run.id })) } }, glyph('people'), `Join your party (${run.inside} inside, ${info.tiers[run.tier - 1].name})`));
      else if (run) c.body.append(h('div.empty', 'Your party is inside, but you can’t join this run.'));
      else {
        if (lead && others.length) c.body.append(h('button.btn.green.block.big', { on: { click: () => enter(true) } }, glyph('people'), `Go in with your party (${others.length + 1})`));
        if (p && !lead) c.body.append(h('div.muted', { style: { textAlign: 'center', margin: '4px 0 8px' } }, 'Your party leader starts the ready check. Or go in alone:'));
        c.body.append(h('button.btn' + (lead && others.length ? '.blue' : '.green') + '.block.big', { on: { click: () => enter(false) } }, glyph('swords'), 'Go in alone'));
        c.body.append(h('button.btn.small.plain', { style: { marginTop: '8px' }, on: { click: () => this.open('party') } }, glyph('people'), p ? 'Your party' : 'Make a party'));
      }
      // Records
      c.body.append(h('div.section-title', mode === 'weekly' ? 'This week’s fastest' : 'Best times'));
      if (mode === 'weekly') {
        if (!T.weekly.length) c.body.append(h('div.muted', 'Nobody yet. Be the first!'));
        T.weekly.forEach((r, i) => c.body.append(h('div.kv', h('span', `${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${r.heroes.join(', ')}`), h('b', fmtTime(r.seconds)))));
      } else {
        if (!T.best.length) c.body.append(h('div.muted', 'Nobody has cleared this tier yet.'));
        for (const r of T.best.sort((a, b) => a.party - b.party)) c.body.append(h('div.kv', h('span', partyWord(r.party)), h('b', fmtTime(r.seconds))));
      }
    };
    const load = async () => {
      try {
        info = await this.sock.rpc('dungeon.info', { kind });
      } catch (e) {
        this.hud.toast(e.message, 'err');
      }
      render();
    };
    c.refresh = load;
    render();
    load();
  },

  // Your party: who's in it and where, invites, leave/kick/lead.
  party(c) {
    this.title(c, 'Party', 'people');
    let online = null;
    const render = () => {
      clear(c.body);
      const p = this.hud.party;
      const me = this.hud.myId;
      if (!p) c.body.append(h('div.muted', { style: { marginBottom: '10px' } }, 'Team up with up to three friends for the crypt: invite someone below and you’ll be the leader.'));
      else {
        const lead = p.leader === me;
        for (const m of p.members) {
          const where = !m.online ? 'Offline' : m.where === 'dungeon' ? 'In a dungeon' : m.where === 'shop' ? 'In a shop' : 'In town';
          c.body.append(
            h(
              'div.rowcard',
              h('div.ic', p.leader === m.id ? '♛' : '🧑'),
              h('div.grow', h('div.t', m.name, m.id === me ? ' (you)' : ''), h('div.s', `${m.level ? `Level ${m.level} · ` : ''}${where}${m.online && m.hp != null ? ` · ${m.hp}/${m.maxHp} HP` : ''}`)),
              lead && m.id !== me ? h('button.btn.small', { on: { click: () => this.rpc('party.promote', { id: m.id }, `${m.name} leads now.`) } }, 'Lead') : null,
              lead && m.id !== me ? h('button.btn.small.red', { on: { click: () => this.rpc('party.kick', { id: m.id }) } }, 'Remove') : null,
            ),
          );
        }
        if (p.ready) c.body.append(h('div.rowcard', h('div.ic', '⏳'), h('div.grow', h('div.t', 'Ready check'), h('div.s', `${p.ready.yes.length} ready · ${Math.ceil(p.ready.endsIn / 1000)}s left`))));
        const g = this.hud.game;
        if (p.run && !g.dungeon) c.body.append(h('button.btn.green.block', { on: { click: () => (this.close(), this.rpc('dungeon.join', { run: p.run })) } }, glyph('crypt'), 'Join your party in the crypt'));
        c.body.append(h('button.btn.small.plain', { style: { marginTop: '6px' }, on: { click: () => this.rpc('party.leave', {}, 'You left the party.').then(render) } }, 'Leave the party'));
      }
      const canInvite = !p || (p.leader === me && p.members.length < 4);
      c.body.append(h('div.section-title', 'Invite'));
      if (!canInvite) return c.body.append(h('div.muted', p.members.length >= 4 ? 'Your party is full (4).' : 'Only the leader can invite.'));
      if (!online) return c.body.append(h('div.muted', 'Loading…'));
      const free = online.filter((o) => o.id !== me && !o.party);
      if (!free.length) c.body.append(h('div.muted', 'Nobody free to invite right now.'));
      for (const o of free)
        c.body.append(h('div.rowcard', h('div.ic', '🧑'), h('div.grow', h('div.t', o.name), h('div.s', `Level ${o.level}${o.dungeon ? ' · in a dungeon' : o.channel ? ` · Channel ${o.channel}` : ''}`)), h('button.btn.small.green', { on: { click: () => this.rpc('party.invite', { id: o.id }, `Invited ${o.name}.`) } }, 'Invite')));
    };
    const load = () =>
      this.sock
        .rpc('town.info')
        .then((i) => ((online = i.online), render()))
        .catch(() => render());
    c.refresh = render;
    render();
    load();
  },

  // Leaving: a word of warning before you go (you can't come back to this run).
  dleave(c) {
    const g = this.hud.game;
    this.title(c, 'Leave the crypt?', 'stairs');
    const done = g.run?.state.boss;
    c.body.append(
      h('p', done ? 'The Pale Count is dust. Back to the surface?' : 'You keep everything you’ve found, but you can’t come back into this run.'),
      h('button.btn.green.block.big', { on: { click: () => (this.close(), g.leaveRun()) } }, glyph('door'), 'Leave'),
      h('button.btn.block', { style: { marginTop: '8px' }, on: { click: () => this.close() } }, 'Stay'),
    );
  },

  // What a chest gave you.
  dloot(c, r) {
    this.title(c, r.title ?? 'Treasure', 'key');
    sfx.coin();
    c.body.append(h('div.result', h('div.big', r.title ?? 'Treasure'), h('div', { style: { fontWeight: 700, fontSize: '20px' } }, `+${fmt(r.gold)} 🪙`)), lootRow(r), h('div.muted', { style: { textAlign: 'center', margin: '8px 0' } }, 'Already in your bag. Everyone in the run got their own share.'), h('button.btn.green.block.big', { on: { click: () => this.close() } }, 'Continue'));
  },

  // The end of a run: the boss chest, the time, the record.
  drun(c, r) {
    this.title(c, 'Victory', 'trophy');
    sfx.rare();
    this.hud.confetti(50);
    const lines = [
      h('div.kv', h('span', 'Time'), h('b', fmtTime(r.seconds ?? 0))),
      h('div.kv', h('span', 'Monsters slain'), h('b', r.kills ?? '–')),
      r.firstToday ? h('div.kv', h('span', 'First clear today'), h('b.gold', 'Double treasure!')) : null,
    ];
    c.body.append(
      h('div.result', h('div.big', r.name ?? 'Conquered'), h('div', { style: { fontWeight: 700, fontSize: '20px' } }, `+${fmt(r.gold)} 🪙`)),
      lootRow(r),
      ...lines,
      r.vault ? h('div.section-title', 'From the Vault') : null,
      r.vault ? h('div.kv', h('span', 'Gold'), h('b.gold', `+${fmt(r.vault.gold)} 🪙`)) : null,
      r.vault ? lootRow(r.vault) : null,
      h('button.btn.green.block.big', { style: { marginTop: '10px' }, on: { click: () => this.close() } }, 'Continue'),
      h('button.btn.block', { style: { marginTop: '8px' }, on: { click: () => (this.close(), this.hud.game.leaveRun()) } }, glyph('stairs'), 'Back to the surface'),
    );
  },

  // The crypt as far as you've explored it. Tap a spot to walk there.
  dmap(c) {
    const g = this.hud.game;
    if (!g?.dungeon) return this.close();
    this.title(c, g.run.layout.name, 'map');
    const cv = h('canvas.dmap', { width: 640, height: 640 });
    const st = g.run.state;
    const legend = h(
      'div.dlegend',
      h('span', h('i', { style: { background: '#9fe08a' } }), 'Way out'),
      h('span', h('i', { style: { background: '#ffb347' } }), 'Brazier'),
      h('span', h('i', { style: { background: '#8fc4ff' } }), 'Shrine'),
      h('span', h('i', { style: { background: '#e2574c' } }), 'Monster'),
      h('span', h('i', { style: { background: '#ffb020' } }), 'Elite'),
      h('span', h('i', { style: { background: '#c94a3a' } }), 'Shut gate'),
    );
    const facts = h('div.muted', { style: { textAlign: 'center', margin: '6px 0' } });
    let frame = null;
    const draw = () => {
      if (!g.dungeon) return this.close();
      frame = this.hud.drawDungeonMap(cv, {});
      facts.textContent = `${st.cleared.length}/${g.run.layout.rooms.length} rooms clear · Bone Key ${st.key ? 'found' : 'not found'} · ${st.wipes ?? 0}/${MAX_WIPES} wipes${st.boss ? ' · Boss slain' : ''}`;
    };
    cv.addEventListener('click', (e) => {
      if (!frame) return;
      const b = cv.getBoundingClientRect();
      const px = ((e.clientX - b.left) / b.width) * cv.width;
      const pz = ((e.clientY - b.top) / b.height) * cv.height;
      const x = frame.cx + (px - cv.width / 2) / frame.S;
      const z = frame.cz + (pz - cv.height / 2) / frame.S;
      if (!g.dungeon.isRevealed(g.dungeon.roomOfPoint(x, z))) return;
      this.close();
      if (!g.walkTo(x, z, true)) this.hud.toast("Can't get there from here.", 'err');
    });
    c.body.append(cv, facts, legend);
    draw();
    const t = setInterval(draw, 250);
    c.onClose = () => clearInterval(t);
  },
};
