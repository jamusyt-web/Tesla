import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameError } from './db.js';
import { Game } from './game.js';
import { current as currentMap, saveMap } from './map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// Builds the HTTP + WebSocket server around a Game. Kept separate from
// index.js so tests can spin up a real server on a random port.
export function createServer(db, opts = {}) {
  const game = new Game(db, opts);
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

  function readBody(req, limit = 1e5) {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (d) => {
        s += d;
        if (s.length > limit) reject(new Error('too big'));
      });
      req.on('end', () => {
        try {
          resolve(s ? JSON.parse(s) : {});
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // Small login-attempt limiter per IP.
  const attempts = new Map();
  function limited(ip) {
    const now = Date.now();
    const a = attempts.get(ip) || { t: now, n: 0 };
    if (now - a.t > 60_000) Object.assign(a, { t: now, n: 0 });
    a.n++;
    attempts.set(ip, a);
    return a.n > 20;
  }

  // The world map (public: it's the same for everyone). Clients load it before
  // building the world; it's cached until the map changes (ETag).
  function sendMap(req, res) {
    const m = currentMap;
    if (req.headers['if-none-match'] === m.etag) {
      res.writeHead(304, { etag: m.etag });
      return res.end();
    }
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': 'application/json', etag: m.etag, 'cache-control': 'no-cache', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gz ? m.gzip : m.body);
  }

  async function api(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/map') return sendMap(req, res);
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      if (req.method === 'POST' && (url.pathname === '/api/signup' || url.pathname === '/api/login')) {
        if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        const body = await readBody(req);
        const r = url.pathname === '/api/signup' ? game.auth.signup(body) : game.auth.login(body);
        return json(res, 200, { token: r.token, hasHero: !!game.heroes.load(r.accountId) });
      }
      const accountId = game.auth.verify(token);
      if (!accountId) return json(res, 401, { error: 'Please log in.' });
      if (req.method === 'GET' && url.pathname === '/api/me') {
        return json(res, 200, { hero: game.heroes.load(accountId), admin: game.auth.isAdmin(accountId) });
      }
      // The world editor saves here (server owners only).
      if (req.method === 'POST' && url.pathname === '/api/map') {
        if (!game.auth.isAdmin(accountId)) return json(res, 403, { error: 'Only the server owner can edit the world.' });
        const body = await readBody(req, 8e6);
        try {
          const m = saveMap(body.map, body.base);
          game.reloadWorld();
          return json(res, 200, { ok: true, rev: m.rev, etag: currentMap.etag });
        } catch (e) {
          return json(res, e.conflict ? 409 : 400, { error: e.message, problems: e.problems });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/hero') {
        const body = await readBody(req);
        return json(res, 200, { hero: game.heroes.create(accountId, body.name, body.avatar) });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        game.auth.logout(token);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e instanceof GameError) return json(res, 400, { error: e.message });
      console.error(e);
      return json(res, 500, { error: 'Server error' });
    }
  }

  function serveStatic(req, res, url) {
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(DIST, p);
    if (!file.startsWith(DIST)) return json(res, 403, { error: 'no' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Missing files with an extension (models, images…) are real 404s; anything else is the app.
      if (path.extname(p)) return json(res, 404, { error: 'Not found' });
      file = path.join(DIST, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('Client not built. Run `npm run build` (or use `npm run dev`).');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : file.includes(`${path.sep}models${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return json(res, 200, { ok: true, online: game.online.size, channels: game.channels.length });
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    return serveStatic(req, res, url);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const accountId = game.auth.verify(url.searchParams.get('token'));
    if (!accountId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => (ws.isAlive = true));
      game.connect(ws, accountId);
    });
  });

  // Drop dead connections (phones that went to sleep) so ghosts don't linger.
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15000);

  pinger.unref();
  server.on('close', () => clearInterval(pinger));
  return { server, game, wss };
}
