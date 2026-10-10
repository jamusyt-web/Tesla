import './style.css';
import { h } from './util/dom.js';
import { api, getToken, setToken } from './net/api.js';
import { Socket } from './net/socket.js';
import { openAuth } from './ui/auth.js';
import { openCreator } from './ui/creator.js';

const app = document.getElementById('app');

async function boot() {
  if (!getToken()) return openAuth(app, afterAuth);
  try {
    const { hero } = await api('me');
    hero ? enterGame() : createHero();
  } catch (e) {
    if (e.status === 401) {
      setToken(null);
      return openAuth(app, afterAuth);
    }
    app.append(h('div.loading', h('div', h('span.spin', '🏰'), 'Can’t reach the server. Retrying…')));
    setTimeout(() => location.reload(), 3000);
  }
}

function afterAuth(r) {
  r.hasHero ? enterGame() : createHero();
}

function createHero() {
  openCreator(app, {
    mode: 'create',
    onDone: async ({ name, avatar }) => {
      await api('hero', { name, avatar });
      enterGame();
    },
  });
}

async function enterGame() {
  const bar = h('i', { style: { width: '0%' } });
  const loading = h('div.loading', h('div', h('span.spin', '🌲'), 'Entering Hearthvale…', h('div.loadbar', bar)));
  app.append(loading);
  // three.js, the world and its 3D models are big; load them only once we're in.
  const [{ GameClient }, { Hud }, { loadAssets }, { itemIcon }] = await Promise.all([import('./game.js'), import('./ui/hud.js'), import('./scene/assets.js'), import('./ui/portrait.js')]);
  await loadAssets((p) => (bar.style.width = `${Math.round(p * 100)}%`));
  const sock = new Socket();
  const hud = new Hud(app, sock);
  const game = new GameClient(app, sock, hud);
  hud.attach(game);
  window.__hv = { game, hud, sock, itemIcon }; // handy for debugging & automated play-tests
  app.insertBefore(game.el, hud.el);
  let banner = null;
  sock.on('welcome', () => {
    loading.remove();
    banner?.remove();
    banner = null;
  });
  sock.on('_close', (ev) => {
    if (ev.code === 4001) {
      game.destroy();
      hud.el.remove();
      return createHero();
    }
    if (ev.code === 4002) {
      app.append(h('div.loading', h('div', h('span.spin', '🔁'), 'You logged in on another device.', h('br'), h('button.btn', { style: { marginTop: '14px' }, on: { click: () => location.reload() } }, 'Play here instead'))));
      return;
    }
    if (!banner) {
      banner = h('div.conn', 'Reconnecting…');
      hud.el.append(banner);
    }
  });
  hud.onCustomize = () =>
    openCreator(app, {
      mode: 'edit',
      initial: hud.myAvatar,
      onDone: async ({ avatar }) => {
        await sock.rpc('avatar', { avatar });
        hud.setAvatar(avatar);
      },
    });
  hud.logout = async () => {
    await api('logout', {}).catch(() => {});
    setToken(null);
    location.reload();
  };
  sock.connect();
}

boot();
