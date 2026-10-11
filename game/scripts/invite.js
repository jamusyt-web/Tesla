// Prints an invite code you can sign up with: `npm run invite` (Windows: `npm.cmd run invite`).
// Works whether or not the server is running, and on a brand-new or an existing save.
import { openDb } from '../server/db.js';
import { Auth } from '../server/auth.js';

const db = openDb();
const auth = new Auth(db);
const names = db.prepare('SELECT username FROM accounts ORDER BY id').all().map((r) => r.username);
const code = auth.hostInvite();
db.close();

console.log('');
console.log(`  Invite code: ${code}`);
console.log('');
console.log('  In the game choose "Join with invite", paste the code, and pick a username and password.');
if (names.length) {
  const shown = names.slice(0, 10).join(', ') + (names.length > 10 ? `, and ${names.length - 10} more` : '');
  console.log(`  Accounts already on this save: ${shown}.`);
  console.log('  If one of those is yours, use "Log in" instead. You don\'t need a code for that.');
}
console.log('');
