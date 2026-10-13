// The sandbox's supervisor (see ./protocol.ts): on the sandbox machine, it takes the game server's
// one WebSocket (with the shared token), starts a process per room (and per smoke test), and relays.
// Each process, at `full` isolation (a sandbox machine):
//
// - has no network at all: a network namespace of its own with nothing in it (`unshare --net`);
// - runs as a user of its own (a uid per room, none of them the supervisor's: `setpriv`), with no
//   way to gain privileges;
// - runs under Node's permission model: it reads only the app's code and its room's folder (its
//   game's built code, 0700, its own), writes nothing, starts no processes or threads, loads no
//   native addons;
// - has a memory ceiling, and the game server's watchdog stops one that goes quiet.
//
// The machine holds no secrets but the token, and no data: the game server sends each room its
// game's code and the data it starts from, and keeps every change it sends back.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { chmodSync, chownSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, encode } from '../net/codec';
import { RELAY_VERSION, type FromRoomProcess, type FromSandbox, type GameFiles, type Isolation, type ToRoomProcess, type ToSandbox } from './protocol';

export interface SupervisorOptions {
  port: number;
  /** The token the game server sends (`Authorization: Bearer …`). */
  token: string;
  isolation: Isolation;
  /** How to start a room's process: the program and its arguments (the bundle, run with `--room`). */
  roomCommand: { node: string; script: string; args?: string[] };
  /** What a room's process may read besides its folder (the app's code and the engine). */
  readable: string[];
  /** Where rooms' folders go. */
  rooms?: string;
  /** A room's process's heap ceiling (MB). */
  memory?: number;
  log?(line: string): void;
}

/** The uids rooms' processes run as (`full` isolation): one per room at a time. */
const UIDS = { from: 20000, count: 1000 };

export interface Supervisor {
  port: number;
  /** Rooms' processes running (smoke tests included). */
  readonly running: number;
  close(): Promise<void>;
}

/** Start the supervisor. At `full` isolation it first checks it can isolate, and won't start if not. */
export function supervise(o: SupervisorOptions): Promise<Supervisor> {
  const log = o.log ?? (() => {});
  // Real paths: Node's permission model allows by them (a temporary folder may be under a link).
  const made = o.rooms ?? join(tmpdir(), 'blockyard-rooms');
  mkdirSync(made, { recursive: true, mode: 0o711 });
  const base = realpathSync(made);
  const readable = o.readable.map((p) => realpathSync(p));
  if (o.isolation === 'full') selfTest(o);
  const processes = new Map<string, ChildProcess>();
  let nextUid = 0;
  let link: WebSocket | null = null;
  const send = (m: FromSandbox) => link?.readyState === link?.OPEN && link?.send(encode(m));

  /** A room's folder with its game's files, readable by its process alone; and the uid it runs as. */
  function prepare(name: string, files: GameFiles): { dir: string; uid: number } {
    const uid = UIDS.from + (nextUid++ % UIDS.count);
    const dir = join(base, name.replace(/[^\w.-]/g, '_'));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) if (typeof text === 'string') writeFileSync(join(dir, file), text);
    if (o.isolation === 'full') {
      for (const file of ['', ...Object.keys(files)]) chownSync(join(dir, file), uid, uid);
      chmodSync(dir, 0o700);
    }
    return { dir, uid };
  }

  /** Start a room's process (or a smoke test's) for `name`, at the isolation set. */
  function startProcess(name: string, dir: string, uid: number): ChildProcess {
    const { node, script, args = [] } = o.roomCommand;
    const guarded = o.isolation === 'off' ? [] : ['--permission', ...[...readable, dir].map((p) => `--allow-fs-read=${p}`)];
    const nodeArgs = [...guarded, `--max-old-space-size=${o.memory ?? 256}`, '--disable-warning=ExperimentalWarning', script, ...args, '--room'];
    const [cmd, cmdArgs] =
      o.isolation === 'full' ? ['unshare', ['--net', '--', 'setpriv', `--reuid=${uid}`, `--regid=${uid}`, '--clear-groups', '--no-new-privs', '--', node, ...nodeArgs]] : [node, nodeArgs];
    // A clean environment: nothing of the supervisor's (its token) goes in.
    const child = spawn(cmd, cmdArgs, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'production' } });
    child.stdout?.on('data', (d: Buffer) => log(`[${name}] ${d.toString().trimEnd()}`));
    child.stderr?.on('data', (d: Buffer) => log(`[${name}] ${d.toString().trimEnd()}`));
    return child;
  }

  function handle(m: ToSandbox) {
    if (m.t === 'start') {
      processes.get(m.room)?.kill('SIGKILL');
      const { dir, uid } = prepare(m.room, m.files);
      const child = startProcess(m.room, dir, uid);
      processes.set(m.room, child);
      child.on('message', (r: FromRoomProcess) => {
        if (r.t === 'room') send({ t: 'room', room: m.room, msg: r.msg });
        else if (r.t === 'store') send({ t: 'store', room: m.room, change: r.change });
      });
      child.on('exit', (code) => {
        if (processes.get(m.room) === child) processes.delete(m.room);
        rmSync(dir, { recursive: true, force: true });
        send({ t: 'exit', room: m.room, code });
      });
      child.send({ t: 'start', spec: m.spec, dir, snapshot: m.snapshot } satisfies ToRoomProcess);
    } else if (m.t === 'room') {
      const child = processes.get(m.room);
      if (child?.connected) child.send({ t: 'room', msg: m.msg } satisfies ToRoomProcess);
    } else if (m.t === 'kill') {
      processes.get(m.room)?.kill('SIGKILL');
    } else if (m.t === 'smoke') {
      const name = `smoke-${m.id}`;
      const { dir, uid } = prepare(name, m.files);
      const child = startProcess(name, dir, uid);
      processes.set(name, child);
      let answered = false;
      const answer = (result: Extract<FromSandbox, { t: 'smoked' }>['result']) => {
        if (answered) return;
        answered = true;
        send({ t: 'smoked', id: m.id, result });
      };
      // Two minutes at most (a loop that never ends).
      const timer = setTimeout(() => {
        answer({ ok: false, errors: ['it took more than 120 s (a loop that never ends?)'], summary: 'the smoke test failed' });
        child.kill('SIGKILL');
      }, 120_000);
      child.on('message', (r: FromRoomProcess) => r.t === 'smoked' && answer(r.result));
      child.on('exit', (code) => {
        clearTimeout(timer);
        processes.delete(name);
        rmSync(dir, { recursive: true, force: true });
        answer({ ok: false, errors: [`its process ended (${code})`], summary: 'the smoke test failed' });
      });
      child.send({ t: 'smoke', dir, publicUrl: m.publicUrl } satisfies ToRoomProcess);
    }
  }

  const http = createServer((req, res) => {
    if (req.url === '/health') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024, perMessageDeflate: { threshold: 1024 } });
  http.on('upgrade', (req, socket, head) => {
    if (!authorized(req, o.token)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // One game server at a time: a new connection (it restarted) replaces the last, whose rooms go.
      if (link) {
        link.close(4000, 'replaced');
        for (const child of processes.values()) child.kill('SIGKILL');
      }
      link = ws;
      log(`game server connected (${o.isolation} isolation)`);
      ws.on('message', (data) => {
        let m: ToSandbox;
        try {
          m = decode<ToSandbox>(String(data));
        } catch {
          return;
        }
        if (m.t === 'hello') return send({ t: 'hello', version: RELAY_VERSION, isolation: o.isolation });
        try {
          handle(m);
        } catch (err) {
          log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        }
      });
      ws.on('close', () => {
        if (link !== ws) return;
        link = null;
        log('game server gone: its rooms stop');
        for (const child of processes.values()) child.kill('SIGKILL');
      });
    });
  });
  return new Promise((done) => {
    http.listen(o.port, () => {
      const port = (http.address() as { port: number }).port;
      log(`sandbox supervisor on port ${port}, ${o.isolation} isolation`);
      done({
        port,
        get running() {
          return processes.size;
        },
        close: async () => {
          for (const child of processes.values()) child.kill('SIGKILL');
          link?.close();
          wss.close();
          await new Promise<void>((r) => http.close(() => r()));
        },
      });
    });
  });
}

function authorized(req: IncomingMessage, token: string): boolean {
  const given = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Full isolation works here: a process with no network, as a user of its own, can't reach out or
 * read what isn't its. Throws (the supervisor won't start) if not: a sandbox that doesn't isolate is
 * worse than none.
 */
function selfTest(o: SupervisorOptions) {
  const uid = UIDS.from + UIDS.count;
  const probe = `
    const net = require('node:net');
    const fs = require('node:fs');
    let read = false;
    try { fs.readFileSync('/proc/1/environ'); read = true; } catch {}
    const s = net.connect({ host: '1.1.1.1', port: 53, timeout: 1500 });
    s.on('connect', () => { console.log(JSON.stringify({ uid: process.getuid(), net: true, read })); process.exit(0); });
    s.on('error', () => { console.log(JSON.stringify({ uid: process.getuid(), net: false, read })); process.exit(0); });
    s.on('timeout', () => { console.log(JSON.stringify({ uid: process.getuid(), net: false, read })); process.exit(0); });
  `;
  const r = spawnSync('unshare', ['--net', '--', 'setpriv', `--reuid=${uid}`, `--regid=${uid}`, '--clear-groups', '--no-new-privs', '--', o.roomCommand.node, '-e', probe], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  type Probe = { uid: number; net: boolean; read: boolean };
  let got: Probe | null = null;
  try {
    got = JSON.parse(r.stdout.trim()) as Probe;
  } catch {
    // no answer
  }
  if (!got || got.uid !== uid || got.net || got.read) {
    throw new Error(`the sandbox can't isolate rooms here (${got ? JSON.stringify(got) : (r.stderr || r.error?.message || 'no answer').trim()}): not starting`);
  }
  o.log?.(`isolation checked: a room's process runs as uid ${got.uid}, with no network, and can't read the supervisor's`);
}
