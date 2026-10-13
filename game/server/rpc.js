// The table of RPCs the client can call (an 'rpc' message: { m: name, a: args }).
// Each feature module registers its own, so adding an action never means
// editing the hub. inRun: the action also works inside a dungeon run.
import { fail } from './db.js';

const TABLE = new Map(); // name → { fn(game, client, args), inRun }

export function register(name, fn, { inRun = false } = {}) {
  if (TABLE.has(name)) throw new Error(`RPC "${name}" is registered twice.`);
  TABLE.set(name, { fn, inRun });
}

// Register a whole { name: fn } table with the same options.
export function registerAll(table, opts = {}) {
  for (const [name, fn] of Object.entries(table)) register(name, fn, opts);
}

export const allowedInRun = (name) => !!TABLE.get(name)?.inRun;
export const isRpc = (name) => TABLE.has(name);
export const rpcNames = () => [...TABLE.keys()];

export function dispatch(game, c, name, args) {
  const r = TABLE.get(name);
  if (!r) fail('Unknown action.');
  return r.fn(game, c, args || {});
}
