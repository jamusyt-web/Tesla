import crypto from 'node:crypto';
import { fail } from './db.js';

const USER_RE = /^[A-Za-z0-9_]{3,20}$/;
export const INVITES_PER_PLAYER = 5;

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const newCode = () =>
  Array.from(crypto.randomBytes(8))
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32])
    .join('')
    .replace(/(.{4})/, '$1-');

export class Auth {
  constructor(db) {
    this.db = db;
    this.openSignup = process.env.OPEN_SIGNUP === '1';
  }

  accountCount() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  }

  // First boot: make sure there is a way in.
  bootstrap() {
    return this.accountCount() > 0 ? null : this.hostInvite();
  }

  // An unused invite from whoever runs the server (not from any hero), made if
  // needed. The same code comes back until someone uses it.
  hostInvite() {
    const existing = this.db.prepare('SELECT code FROM invites WHERE created_by IS NULL AND used_by IS NULL ORDER BY created_at').get();
    if (existing) return existing.code;
    const code = (!this.accountCount() && process.env.FOUNDER_INVITE) || newCode();
    this.db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, NULL, ?)').run(code, Date.now());
    return code;
  }

  signup({ username, password, invite }) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!USER_RE.test(username)) fail('Username must be 3–20 letters, numbers or _.');
    if (password.length < 6) fail('Password must be at least 6 characters.');
    if (this.db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) fail('That username is taken.');
    const code = String(invite || '').trim().toUpperCase();
    let inv = null;
    if (!this.openSignup) {
      inv = this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
      if (!inv) fail('That invite code is not valid.');
      if (inv.used_by) fail('That invite code was already used.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const r = this.db
      .prepare('INSERT INTO accounts (username, pass_hash, salt, invited_by, created_at) VALUES (?,?,?,?,?)')
      .run(username, hash(password, salt), salt, inv?.created_by ?? null, Date.now());
    const id = Number(r.lastInsertRowid);
    if (inv) this.db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(id, code);
    if (this.accountCount() === 1) this.setAdmin(id, true); // whoever starts the server owns it
    return this.issue(id);
  }

  // Server owners can edit the world. The first account is one; `npm run admin` adds more.
  isAdmin(accountId) {
    return !!this.db.prepare('SELECT is_admin FROM accounts WHERE id = ?').get(accountId)?.is_admin;
  }
  setAdmin(accountId, on) {
    this.db.prepare('UPDATE accounts SET is_admin = ? WHERE id = ?').run(on ? 1 : 0, accountId);
  }

  login({ username, password }) {
    const a = this.db.prepare('SELECT * FROM accounts WHERE username = ?').get(String(username || '').trim());
    if (!a) fail('Wrong username or password.');
    const h = hash(String(password || ''), a.salt);
    if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(a.pass_hash, 'hex'))) fail('Wrong username or password.');
    return this.issue(a.id);
  }

  issue(accountId) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO sessions (token, account_id, created_at) VALUES (?,?,?)').run(token, accountId, Date.now());
    return { token, accountId };
  }

  verify(token) {
    if (!token) return null;
    return this.db.prepare('SELECT account_id FROM sessions WHERE token = ?').get(String(token))?.account_id ?? null;
  }

  logout(token) {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
  }

  // Every player is equal: anyone can invite a few friends.
  myInvites(accountId) {
    return this.db
      .prepare(`SELECT i.code, i.used_by, h.name AS used_name FROM invites i LEFT JOIN heroes h ON h.account_id = i.used_by WHERE i.created_by = ? ORDER BY i.created_at`)
      .all(accountId);
  }
  createInvite(accountId) {
    const n = this.db.prepare('SELECT COUNT(*) AS n FROM invites WHERE created_by = ?').get(accountId).n;
    if (n >= INVITES_PER_PLAYER) fail(`You can create up to ${INVITES_PER_PLAYER} invites.`);
    const code = newCode();
    this.db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?,?,?)').run(code, accountId, Date.now());
    return code;
  }
}
