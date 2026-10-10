import { defineConfig } from 'vite';

const SERVER = process.env.GAME_SERVER || 'http://localhost:8787';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
});
