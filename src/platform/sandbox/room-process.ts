// A sandboxed room's process (see ./protocol.ts): the supervisor starts it (with no network, a
// user of its own and Node's permission model on a sandbox machine) and talks to it over IPC. It
// runs one uploaded game's room, or one smoke test, then ends.
import { readFileSync } from 'node:fs';
import { loadPackaged, smokeTest } from '../host/packaged';
import { RoomCore } from '../host/room';
import { ALIVE_EVERY, type FromRoom, type ToRoom } from '../host/room-worker';
import type { FromRoomProcess, ToRoomProcess } from './protocol';
import { RelayStore } from './relay-store';

/** Run as a room's process: `wasmPath` is the engine's compiled `.wasm`. */
export function runRoomProcess(wasmPath: string) {
  const say = (m: FromRoomProcess) => process.send?.(m);
  const post = (msg: FromRoom) => say({ t: 'room', msg });
  const wasm = readFileSync(wasmPath);
  let core: RoomCore | null = null;
  let store: RelayStore | null = null;
  // (The supervisor going away is the end of this room.)
  process.on('disconnect', () => process.exit(0));
  process.on('message', (m: ToRoomProcess) => {
    try {
      if (m.t === 'smoke') {
        void smokeTest(m.dir, wasm, { publicUrl: m.publicUrl })
          .then((result) => say({ t: 'smoked', result }))
          .finally(() => setTimeout(() => process.exit(0), 50));
        return;
      }
      if (m.t === 'start') {
        void start(m);
        return;
      }
      // (Before the room's ready, what comes waits.)
      if (!core) return void waiting.push(m.msg);
      deliver(m.msg);
    } catch (err) {
      post({ t: 'log', line: `error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
    }
  });

  const waiting: ToRoom[] = [];
  function deliver(msg: ToRoom) {
    if (!core) return;
    try {
      if (msg.t === 'connect') core.connect(msg.client, msg.who);
      else if (msg.t === 'command') core.command(msg.client, msg.cmd);
      else if (msg.t === 'identify') core.identify(msg.client, msg.who);
      else if (msg.t === 'disconnect') core.disconnect(msg.client);
      else if (msg.t === 'stop') {
        core.stop();
        store?.close();
        // Its last store changes and messages go out first.
        setTimeout(() => process.exit(0), 100);
      }
    } catch (err) {
      post({ t: 'log', line: `error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
    }
  }

  async function start(m: Extract<ToRoomProcess, { t: 'start' }>) {
    try {
      const publicUrl = m.spec.package?.publicUrl ?? 'http://localhost';
      const def = await loadPackaged(m.dir, publicUrl);
      store = new RelayStore(m.snapshot, (change) => say({ t: 'store', change }));
      core = new RoomCore(def, m.spec, wasm, store, {
        send: (client, text) => post({ t: 'send', client, text }),
        counts: (playing, watching) => post({ t: 'counts', playing, watching }),
        log: (line) => post({ t: 'log', line }),
        achieve: (account, id) => post({ t: 'achieve', account, id }),
        grant: (account, id) => post({ t: 'grant', account, id }),
      });
      for (const msg of waiting.splice(0)) deliver(msg);
      // Alive, as long as its event loop turns (the game server's watchdog listens).
      post({ t: 'alive' });
      setInterval(() => post({ t: 'alive' }), ALIVE_EVERY * 1000);
    } catch (err) {
      post({ t: 'failed', text: err instanceof Error ? (err.stack ?? err.message) : String(err) });
      setTimeout(() => process.exit(1), 50);
    }
  }
}
