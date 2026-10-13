// Rooms' worker threads for development (scripts/dev.mjs, scripts/server.mjs and the headless
// tests): each runs `room-worker-dev.mjs`, whose modules this thread's Vite compiles, asked over a
// message channel (Vite's module runner). A worker then loads no bundler of its own: it starts
// faster, and a room stuck in a loop can be stopped (terminating a thread that holds Vite's native
// bundler takes the whole process down).
import { MessageChannel, Worker } from 'node:worker_threads';

const url = new URL('./room-worker-dev.mjs', import.meta.url);

/** A room worker factory (`ServeOptions.worker`) whose workers' modules `vite` (a dev server) compiles. */
export function devWorker(vite) {
  return (workerData) => {
    const { port1, port2 } = new MessageChannel();
    port1.on('message', async ({ id, payload }) => {
      const answer = await vite.environments.ssr.hot.handleInvoke(payload).catch((err) => ({ error: { message: err?.message ?? String(err), stack: err?.stack } }));
      port1.postMessage({ id, answer });
    });
    // (The channel doesn't keep this process going: the server or the test does.)
    port1.unref();
    const worker = new Worker(url, { workerData: { ...workerData, vite: port2 }, transferList: [port2] });
    worker.on('exit', () => port1.close());
    return worker;
  };
}
