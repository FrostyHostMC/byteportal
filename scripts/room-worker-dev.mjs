// A room's worker thread for the development servers (scripts/server.mjs, scripts/dev.mjs) and
// tests. Started by `dev-worker.mjs`, its modules come from the starting thread's Vite through
// Vite's module runner (`workerData.vite`, a message port); so the thread has its own copy of the
// game's modules (and a room started after a change to its game's code runs the new code), but no
// bundler of its own. Started bare (no port), it starts a Vite of its own instead.
import { workerData } from 'node:worker_threads';

if (workerData?.vite) {
  const { ModuleRunner, ESModulesEvaluator } = await import('vite/module-runner');
  const port = workerData.vite;
  const waiting = new Map();
  let next = 0;
  port.on('message', ({ id, answer }) => {
    waiting.get(id)?.(answer);
    waiting.delete(id);
  });
  const runner = new ModuleRunner(
    {
      transport: { invoke: (payload) => new Promise((done) => { const id = ++next; waiting.set(id, done); port.postMessage({ id, payload }); }) },
      hmr: false,
      sourcemapInterceptor: 'prepareStackTrace',
    },
    new ESModulesEvaluator(),
  );
  const { findGame } = await runner.import('/src/server.ts');
  const { serveRoomWorker } = await runner.import('/src/platform/host/room-worker.ts');
  await serveRoomWorker(findGame);
  port.close();
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    appType: 'custom',
    logLevel: 'warn',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { findGame } = await vite.ssrLoadModule('/src/server.ts');
  const { serveRoomWorker } = await vite.ssrLoadModule('/src/platform/host/room-worker.ts');
  await serveRoomWorker(findGame);
  await vite.close();
}
