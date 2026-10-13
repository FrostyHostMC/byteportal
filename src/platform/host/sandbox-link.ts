// The game server's end of the sandbox (see sandbox/protocol.ts): one WebSocket to the sandbox's
// supervisor, opened when an uploaded game's room (or smoke test) needs it and closed when nothing
// has for a while (so the sandbox machine can sleep), carrying every room's messages both ways.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { decode, encode } from '../net/codec';
import { RELAY_VERSION, type FromSandbox, type GameFiles, type Isolation, type StoreOp, type StoreSnapshot, type ToSandbox } from '../sandbox/protocol';
import type { SmokeResult } from './packaged';
import type { RoomSpec } from './room';
import type { FromRoom, ToRoom } from './room-worker';

export interface SandboxOptions {
  /** The supervisor's address (`ws://voxel-sandbox.flycast`). */
  url: string;
  token: string;
  /** Seconds with no rooms or smoke tests before the connection's closed (default 300). */
  idle?: number;
  /** Refuse a supervisor that doesn't isolate fully (a real server: yes). */
  requireFull?: boolean;
  log?(line: string): void;
}

/** What a sandboxed room's run tells the game server. */
export interface RemoteRoom {
  message(m: FromRoom): void;
  store(change: StoreOp): void;
  /** Its process ended (or the sandbox went away: `code` null). */
  exit(code: number | null): void;
}

/** A built version's files a sandboxed room needs (from its folder on the game server). */
export function gameFiles(dir: string): GameFiles {
  const files: GameFiles = { 'server.js': readFileSync(join(dir, 'server.js'), 'utf8'), 'game.json': readFileSync(join(dir, 'game.json'), 'utf8') };
  try {
    files['server.js.map'] = readFileSync(join(dir, 'server.js.map'), 'utf8');
  } catch {
    // (no source map: errors name the bundle's lines)
  }
  return files;
}

export class SandboxLink {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private rooms = new Map<string, RemoteRoom>();
  private smokes = new Map<number, (r: SmokeResult) => void>();
  private nextSmoke = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** How the supervisor isolates rooms (once connected). */
  isolation: Isolation | null = null;

  constructor(private o: SandboxOptions) {}

  /** Start a room's run in the sandbox: its game's files and the data it starts from. */
  async start(run: string, spec: RoomSpec, files: GameFiles, snapshot: StoreSnapshot, handlers: RemoteRoom): Promise<void> {
    this.rooms.set(run, handlers);
    this.touch();
    try {
      const ws = await this.open();
      ws.send(encode({ t: 'start', room: run, spec, files, snapshot } satisfies ToSandbox));
    } catch (err) {
      this.rooms.delete(run);
      throw err;
    }
  }

  /** A message to a room's run. */
  send(run: string, msg: ToRoom) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode({ t: 'room', room: run, msg } satisfies ToSandbox));
  }

  /** Stop a room's run at once. */
  kill(run: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode({ t: 'kill', room: run } satisfies ToSandbox));
  }

  /** Smoke-test a built version (its files) in the sandbox. */
  async smoke(files: GameFiles, publicUrl: string): Promise<SmokeResult> {
    const id = ++this.nextSmoke;
    this.touch();
    try {
      const ws = await this.open();
      return await new Promise<SmokeResult>((done) => {
        this.smokes.set(id, done);
        ws.send(encode({ t: 'smoke', id, files, publicUrl } satisfies ToSandbox));
      });
    } catch (err) {
      return { ok: false, errors: [`the sandbox couldn't be reached: ${err instanceof Error ? err.message : String(err)}`], summary: 'the smoke test failed' };
    } finally {
      this.smokes.delete(id);
      this.touch();
    }
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }

  private open(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    this.opening ??= new Promise<WebSocket>((done, fail) => {
      const ws = new WebSocket(this.o.url, { headers: { Authorization: `Bearer ${this.o.token}` }, perMessageDeflate: { threshold: 1024 }, maxPayload: 64 * 1024 * 1024 });
      const timer = setTimeout(() => (ws.terminate(), fail(new Error('timed out connecting'))), 30_000);
      ws.on('open', () => ws.send(encode({ t: 'hello', version: RELAY_VERSION } satisfies ToSandbox)));
      ws.on('message', (data) => {
        let m: FromSandbox;
        try {
          m = decode<FromSandbox>(String(data));
        } catch {
          return;
        }
        if (m.t === 'hello') {
          clearTimeout(timer);
          if (m.version !== RELAY_VERSION) return (ws.close(), fail(new Error(`the sandbox speaks version ${m.version}, this server ${RELAY_VERSION} (one is being updated)`)));
          if (this.o.requireFull && m.isolation !== 'full') return (ws.close(), fail(new Error(`the sandbox isolates rooms only "${m.isolation}"`)));
          this.isolation = m.isolation;
          this.ws = ws;
          this.o.log?.(`[sandbox] connected (${m.isolation} isolation)`);
          return done(ws);
        }
        this.dispatch(m);
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        fail(err);
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (this.ws === ws) this.ws = null;
        // Its rooms are gone with it; its smoke tests too.
        for (const [run, h] of [...this.rooms]) {
          this.rooms.delete(run);
          h.exit(null);
        }
        for (const done of this.smokes.values()) done({ ok: false, errors: ['the sandbox went away'], summary: 'the smoke test failed' });
        this.smokes.clear();
        fail(new Error('the sandbox closed the connection'));
      });
    }).finally(() => (this.opening = null));
    return this.opening;
  }

  private dispatch(m: FromSandbox) {
    if (m.t === 'room') this.rooms.get(m.room)?.message(m.msg);
    else if (m.t === 'store') this.rooms.get(m.room)?.store(m.change);
    else if (m.t === 'exit') {
      const h = this.rooms.get(m.room);
      this.rooms.delete(m.room);
      h?.exit(m.code);
      this.touch();
    } else if (m.t === 'smoked') this.smokes.get(m.id)?.(m.result);
  }

  /** Close the connection once nothing has needed it for a while (the sandbox machine then sleeps). */
  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.rooms.size && !this.smokes.size && this.ws) {
        this.o.log?.('[sandbox] idle: disconnecting');
        this.close();
      }
    }, (this.o.idle ?? 300) * 1000);
    this.idleTimer.unref?.();
  }
}
