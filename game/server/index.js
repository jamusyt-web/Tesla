import { openDb } from './db.js';
import { createServer } from './app.js';

const PORT = Number(process.env.PORT || 8787);
const db = openDb();
const { server, game } = createServer(db);
const founder = game.auth.bootstrap();
game.start();

server.listen(PORT, () => {
  console.log(`🏰 Hearthvale server on http://localhost:${PORT}`);
  if (founder) console.log(`🎟️  No players yet. Founder invite code: ${founder}`);
  else console.log(`🎟️  Need an invite code? In another terminal in this folder run: ${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run invite`);
  if (process.env.OPEN_SIGNUP === '1') console.log('⚠️  OPEN_SIGNUP=1 — invite codes are not required.');
});

const shutdown = () => {
  game.stop();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
