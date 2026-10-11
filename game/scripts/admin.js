// Make an account a server owner (can use the world editor), or take it away:
//   npm run admin -- <username>        (Windows: npm.cmd run admin -- <username>)
//   npm run admin -- <username> off
// With no username it lists the owners.
import { openDb } from '../server/db.js';
import { Auth } from '../server/auth.js';

const [name, off] = process.argv.slice(2);
const db = openDb();
const auth = new Auth(db);
if (!name) {
  const owners = db.prepare('SELECT username FROM accounts WHERE is_admin = 1 ORDER BY id').all().map((r) => r.username);
  console.log(owners.length ? `Server owners: ${owners.join(', ')}` : 'No owners yet. The first account to sign up becomes one.');
} else {
  const a = db.prepare('SELECT id FROM accounts WHERE username = ?').get(name);
  if (!a) {
    console.log(`No account called "${name}".`);
    process.exitCode = 1;
  } else {
    auth.setAdmin(a.id, off !== 'off');
    console.log(off === 'off' ? `${name} is no longer a server owner.` : `${name} is now a server owner and can edit the world (Town Hall → Edit the world).`);
  }
}
db.close();
