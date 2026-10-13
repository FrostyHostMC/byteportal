#!/usr/bin/env node
// Development: a local game server in development mode (cheats on, the development games hosted,
// `__game.dev` answered) and Vite serving the page, which connects to that server by default.
//
//   npm run dev
//   npm run dev -- --port 5173 --server-port 8787 [games…] [--seed 1234] [--data data] [--new]
//
// The server's options past the ports are `npm run server`'s (src/server.ts). Its rooms run in
// worker threads that compile their game when they start: after changing a game's server code,
// a room started afresh (a new room of one's own, or once the public one has stopped) runs it.
import { devWorker } from './dev-worker.mjs';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const pagePort = flag('port') ?? process.env.DEV_PORT;
const serverPort = flag('server-port') ?? process.env.DEV_SERVER_PORT;
// What's left is for the game server.
const rest = args.filter((a, i) => !['--port', '--server-port'].includes(a) && !['--port', '--server-port'].includes(args[i - 1]));

// The game server first (the page needs to know where it is).
const ssr = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { main } = await ssr.ssrLoadModule('/src/server.ts');
const worker = devWorker(ssr);
const start = (port) => main(['--port', String(port), ...rest], worker, { dev: true });
let server;
try {
  server = await start(serverPort ?? 8787);
} catch (err) {
  // The usual port is taken (another checkout's server, say): any free one will do.
  if (serverPort !== undefined || err?.code !== 'EADDRINUSE') throw err;
  server = await start(0);
}

// The page: it connects to ws://<the page's host>:<that port> unless told otherwise (`?server=`).
process.env.VITE_DEV_GAME_PORT = String(server.port);
const vite = await createServer({ server: pagePort ? { port: Number(pagePort), strictPort: true } : {} });
await vite.listen();
vite.printUrls();
console.log(`  game server: ws://localhost:${server.port} (development mode)`);

const stop = async () => {
  await server.close();
  await vite.close();
  await ssr.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
