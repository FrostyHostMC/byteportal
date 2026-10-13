import { parentPort, workerData } from 'node:worker_threads';
import type { GameDefinition } from '../api/types';
import type { ClientCommand } from '../net/protocol';
import type { Who } from './game';
import { loadPackaged, smokeTest, type SmokeResult } from './packaged';
import { PrivateStore, RoomCore, type RoomSpec } from './room';
import { SqliteStore } from './sqlite';
import type { Store } from './store';

/** What a room's worker is started with. */
export interface RoomWorkerData {
  spec: RoomSpec;
  /** The engine: compiled (the server's, shared) or its `.wasm` bytes. */
  wasm: WebAssembly.Module | Uint8Array;
  /** The game's database (the worker opens its own connection), or none. */
  storeFile: string | null;
  /** A room of a player's own, or a copy of a public one: shares the game's data, keeps no world or places. */
  own: boolean;
}

/** What a worker that smoke-tests a built game is started with (see host/library.ts). */
export interface SmokeWorkerData {
  smoke: { dir: string; publicUrl: string };
  wasm: WebAssembly.Module | Uint8Array;
}

/** A smoke-testing worker's one message: how it went. */
export interface SmokeWorkerResult {
  t: 'smoked';
  result: SmokeResult;
}

/** The server to a room's worker. */
export type ToRoom = { t: 'connect'; client: string; who?: Who } | { t: 'identify'; client: string; who: Who } | { t: 'command'; client: string; cmd: ClientCommand } | { t: 'disconnect'; client: string } | { t: 'stop' };

/** A room's worker to the server. */
export type FromRoom =
  | { t: 'send'; client: string; text: string }
  | { t: 'counts'; playing: number; watching: number }
  | { t: 'log'; line: string }
  | { t: 'achieve'; account: string; id: string }
  | { t: 'grant'; account: string; id: string }
  | { t: 'failed'; text: string }
  /** Still going: a room's thread says so every `ALIVE_EVERY` seconds (a room that stops saying it is stuck). */
  | { t: 'alive' };

/** How often a room's thread says it's alive (seconds). */
export const ALIVE_EVERY = 2;

/**
 * Run one room in this worker thread (the app's room worker calls this; `find` looks its game
 * up, development games too on a development server: `dev`). The server says who connected, what
 * they sent and when they left; the room says what to send each of them. Its game's module-level
 * state, and any crash or runaway loop, stay here. Told to stop, it saves, closes its store and
 * ends: the promise settles then.
 */
export async function serveRoomWorker(find: (id: string, dev: boolean) => GameDefinition | undefined | Promise<GameDefinition | undefined>): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error('serveRoomWorker: not in a worker thread');
  // Or, not a room: a built game's smoke test, in a thread of its own (the server's main thread
  // never runs a built game's code).
  if ((workerData as Partial<SmokeWorkerData>).smoke) {
    const { smoke, wasm } = workerData as SmokeWorkerData;
    const result = await smokeTest(smoke.dir, wasm, { publicUrl: smoke.publicUrl }).catch((err: unknown) => ({ ok: false, errors: [err instanceof Error ? (err.stack ?? err.message) : String(err)], summary: 'the smoke test failed' }) satisfies SmokeResult);
    port.postMessage({ t: 'smoked', result } satisfies SmokeWorkerResult);
    port.close();
    return;
  }
  const data = workerData as RoomWorkerData;
  const post = (m: FromRoom) => port.postMessage(m);
  let core: RoomCore;
  let store: Store | undefined;
  try {
    // A built game is imported from its folder; the others are compiled in.
    const pkg = data.spec.package;
    const def = pkg ? await loadPackaged(pkg.dir, pkg.publicUrl) : await find(data.spec.game, data.spec.dev);
    if (!def) throw new Error(`no game "${data.spec.game}"`);
    const own = data.storeFile ? SqliteStore.open(data.storeFile, data.spec.game) : undefined;
    store = own && data.own ? new PrivateStore(own, true) : own;
    core = new RoomCore(def, data.spec, data.wasm, store, {
      send: (client, text) => post({ t: 'send', client, text }),
      counts: (playing, watching) => post({ t: 'counts', playing, watching }),
      log: (line) => post({ t: 'log', line }),
      achieve: (account, id) => post({ t: 'achieve', account, id }),
      grant: (account, id) => post({ t: 'grant', account, id }),
    });
  } catch (err) {
    post({ t: 'failed', text: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    port.close();
    return;
  }
  const ended = new Promise<void>((done) => port.on('close', done));
  // Alive, as long as its event loop turns (a game stuck in a loop stops it: the server notices).
  post({ t: 'alive' });
  const alive = setInterval(() => post({ t: 'alive' }), ALIVE_EVERY * 1000);
  void ended.then(() => clearInterval(alive));
  port.on('message', (m: ToRoom) => {
    try {
      if (m.t === 'connect') core.connect(m.client, m.who);
      else if (m.t === 'command') core.command(m.client, m.cmd);
      else if (m.t === 'identify') core.identify(m.client, m.who);
      else if (m.t === 'disconnect') core.disconnect(m.client);
      else if (m.t === 'stop') {
        // Saved and closed: the thread ends (the server waits for that).
        core.stop();
        store?.close();
        port.close();
      }
    } catch (err) {
      post({ t: 'log', line: `error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
    }
  });
  return ended;
}
