// Runs the game server and the Vite client together for local development.
// Vite is launched through node directly (not `npx`) so this works on Windows too.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const opts = { stdio: 'inherit', cwd: root, env: { ...process.env } };

const procs = [
  spawn(process.execPath, ['--watch', '--no-warnings', 'server/index.js'], opts),
  spawn(process.execPath, [vite], opts),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
