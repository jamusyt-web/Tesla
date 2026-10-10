// Runs the game server and the Vite client together for local development.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node', ['--watch', '--no-warnings', 'server/index.js'], { stdio: 'inherit', env: { ...process.env } }),
  spawn('npx', ['vite'], { stdio: 'inherit', env: { ...process.env } }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
