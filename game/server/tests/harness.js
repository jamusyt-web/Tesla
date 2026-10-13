// A game with heroes connected without sockets, for tests that call RPCs
// and game code directly.
import { openDb } from '../db.js';
import { Game } from '../game.js';
import { dispatch } from '../rpc.js';

export function harness() {
  const db = openDb(':memory:');
  const game = new Game(db, { shopSim: false });
  let n = 0;
  const hero = (name) => {
    const id = Number(db.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at) VALUES (?,?,?,?)').run(`${name.toLowerCase()}${++n}`, 'x', 'y', Date.now()).lastInsertRowid);
    game.heroes.create(id, name, {});
    const sent = [];
    const c = game.connect({ readyState: 1, send: (d) => sent.push(JSON.parse(d)), on() {}, close() {} }, id);
    c.id = id;
    c.sent = sent;
    return c;
  };
  const call = (c, m, a = {}) => {
    try {
      return { ok: true, data: dispatch(game, c, m, a) };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  };
  const done = () => {
    for (const c of [...game.online.values()]) game.disconnect(c);
  };
  return { db, game, hero, call, done };
}
