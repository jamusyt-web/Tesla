import { openDb } from './db.js';

// Extra content packs (e.g. HV_PACKS=testvale with MAP_FILE=maps/fixtures/
// twotown.json, to play-test two towns): installed before the map loads.
for (const id of (process.env.HV_PACKS ?? '').split(',').filter(Boolean)) {
  const { installPack } = await import('../shared/content/install.js');
  installPack((await import(`../shared/content/${id}.js`)).default);
  console.log(`📦 Content pack: ${id}`);
}
const { createServer } = await import('./app.js');

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
