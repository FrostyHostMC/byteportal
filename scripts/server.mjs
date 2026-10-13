#!/usr/bin/env node
// Runs the game server (src/server.ts) in Node. Vite's SSR loader compiles the TypeScript and
// resolves @platform / @engine the same way the dev server does.
//
//   npm run server -- sandbox --port 8787
//   npm run server -- --dev          development mode (what `npm run dev` runs: see src/server.ts)
import { devWorker } from './dev-worker.mjs';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const vite = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { main } = await vite.ssrLoadModule('/src/server.ts');
// Each room runs in a worker thread of its own (compiling its game there too).
const worker = devWorker(vite);
const server = await main(args, worker, { dev: args.includes('--dev') });
const stop = async () => {
  await server.close();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
