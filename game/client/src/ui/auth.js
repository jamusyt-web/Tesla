import { h } from '../util/dom.js';
import { api, setToken } from '../net/api.js';

export function openAuth(root, onAuthed) {
  const params = new URLSearchParams(location.search);
  let mode = params.get('invite') ? 'join' : 'login';
  const user = h('input', { autocomplete: 'username', placeholder: 'username', autocapitalize: 'off' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '••••••' });
  const invite = h('input', { placeholder: 'ABCD-EFGH', autocapitalize: 'characters', value: params.get('invite') || '' });
  const inviteField = h('label.field', h('span', 'Invite code'), invite);
  const err = h('div.err');
  const submit = h('button.btn.green.big.block', { type: 'submit' });
  const tabs = h('div.tabs');
  const form = h('form', { on: { submit: go } }, tabs, inviteField, h('label.field', h('span', 'Username'), user), h('label.field', h('span', 'Password'), pass), err, submit);
  const clouds = h('div.clouds', ...[0, 1, 2, 3].map((i) => h('div.cloud', { style: { top: 6 + i * 18 + '%', animationDuration: 40 + i * 13 + 's', animationDelay: -i * 11 + 's' } }, '☁️')));
  const el = h('div.splash', clouds, h('div', { style: { position: 'relative', width: 'min(420px, 100%)' } }, h('div.logo', 'Hearthvale'), h('div.tagline', '🌲 Gather · 🔨 Craft · 🏪 Trade · ⚔️ Adventure — together'), h('div.card', form)));
  root.append(el);

  function draw() {
    tabs.replaceChildren(
      h('button' + (mode === 'login' ? '.on' : ''), { type: 'button', on: { click: () => ((mode = 'login'), draw()) } }, 'Log in'),
      h('button' + (mode === 'join' ? '.on' : ''), { type: 'button', on: { click: () => ((mode = 'join'), draw()) } }, 'Join with invite'),
    );
    inviteField.classList.toggle('hidden', mode !== 'join');
    pass.autocomplete = mode === 'join' ? 'new-password' : 'current-password';
    submit.textContent = mode === 'join' ? '🎟️ Create account' : '🏰 Enter Hearthvale';
    err.textContent = '';
  }

  async function go(e) {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const r = await api(mode === 'join' ? 'signup' : 'login', { username: user.value, password: pass.value, invite: invite.value });
      setToken(r.token);
      el.remove();
      onAuthed(r);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      submit.disabled = false;
    }
  }
  draw();
}
