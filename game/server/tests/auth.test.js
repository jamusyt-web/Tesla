import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';
import { Auth } from '../auth.js';

test('the host can always get a working invite code (npm run invite)', () => {
  const db = openDb(':memory:');
  const auth = new Auth(db);
  // Fresh save: the founder code, and the same one every time until it's used.
  const founder = auth.bootstrap();
  assert.equal(auth.hostInvite(), founder);
  assert.equal(auth.bootstrap(), founder);
  auth.signup({ username: 'alice', password: 'secret1', invite: founder });
  // Once someone has signed up there's no founder code any more...
  assert.equal(auth.bootstrap(), null);
  // ...but the host can still make one, and it is reused until spent.
  const next = auth.hostInvite();
  assert.notEqual(next, founder);
  assert.equal(auth.hostInvite(), next);
  auth.signup({ username: 'bob', password: 'secret1', invite: next });
  assert.throws(() => auth.signup({ username: 'carol', password: 'secret1', invite: next }), /already used/);
  assert.notEqual(auth.hostInvite(), next);
  // Host codes don't use up anyone's personal allowance of 5.
  const alice = db.prepare("SELECT id FROM accounts WHERE username = 'alice'").get().id;
  assert.equal(auth.myInvites(alice).length, 0);
});
