import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Worker } from 'node:worker_threads';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameDefinition, PlayerAccount } from '../api/types';
import { decode, encode } from '../net/codec';
import { CLOSE_FULL, CLOSE_LIMIT, CLOSE_UNKNOWN, ROOM_CODE, type ClientCommand, type WireBatch } from '../net/protocol';
import { sanitizeCommand } from '../net/validate';
import { ADOPTED, PLAYER_DATA } from '../sim/sim';
import type { Account, Accounts } from './accounts';
import { Auth, type DiscordApp } from './auth';
import { cosmeticCatalog, type Cosmetic } from '../cosmetics';
import type { GameHost, Who } from './game';
import { PrivateStore, RoomCore, type RoomSpec } from './room';
import type { FromRoom, RoomWorkerData, SmokeWorkerData, ToRoom } from './room-worker';
import type { Store } from './store';
import type { PackageEntry } from '../package/link';
import type { GameLibrary } from './library';
import type { ErrorLog, ErrorSource } from './errors';
import type { Stats } from './stats';
import { gameFiles, type SandboxLink } from './sandbox-link';
import type { StoreSnapshot } from '../sandbox/protocol';
import { Uploads, type UploadLimits, type UploadTerms } from './uploads';

/** Seconds a room's thread may go without a word (it says it's alive every 2) before it's stopped as stuck. */
const STUCK = 30;
/** Seconds a room's thread may take to start (build its world). */
const STARTING = 120;

export interface ServeOptions {
  /**
   * The games on offer. A client joins a game's public room at `/<id>` (with a single game, also
   * at `/`), and a room of their own, for a game with `instances`, at `/<id>/<code>`. When the
   * public room's full, a game with `instances` starts another copy of it (`/<id>?shard=2` asks
   * for that one: an invite link).
   */
  games: GameDefinition[];
  /**
   * Games hosted when a client names one (`/<id>`), but not listed (`GET /games`): development
   * games, on a development server.
   */
  hidden?: GameDefinition[];
  /**
   * Games that aren't compiled in (uploaded, or built from a folder: see host/library.ts), hosted
   * like the others (listed once their owners say so). A room of one runs the version that was
   * current when it started, in its worker (`worker` is needed). The server serves their screens'
   * code and files, and takes uploads (see host/uploads.ts).
   */
  library?: GameLibrary;
  /** Accounts that may upload games (their ids or Discord ids; a development server: anyone). */
  uploaders?: string[];
  /** Accounts that may manage every game (approve for the home page, ban…): their ids or Discord ids. */
  admins?: string[];
  /** What uploaders may do (games, room on disk, uploads an hour…; see `UPLOAD_LIMITS`). */
  uploadLimits?: Partial<UploadLimits>;
  /** The terms uploaders accept before their first upload (none: not asked). */
  uploadTerms?: UploadTerms | null;
  /** Error tracking (host/errors.ts): rooms' errors are kept there, and screens report theirs (`POST /errors`). */
  errors?: ErrorLog;
  /** Stats (host/stats.ts): each play of each game, for its makers and the admin. */
  stats?: Stats;
  /** The server's address as players reach it (players' avatars are given by it); default the library's, or localhost. */
  publicUrl?: string;
  /**
   * The sandbox (see sandbox/protocol.ts): uploaded games' rooms run there, not in this machine's
   * threads. Without it they run in worker threads like the others (trusted uploaders only).
   */
  sandbox?: SandboxLink;
  port: number;
  /** The engine's compiled `.wasm`. */
  wasm: BufferSource;
  /** Seed for a game's world when it has none kept (default: random). */
  seed?: number;
  /** Steps per second (default 30). */
  tickRate?: number;
  /**
   * Developer tools: cheat commands (`/give`, `/tp`, a game's `cheat` commands), and clients may
   * restart the game or change the time of day. Off on a public server.
   */
  cheats?: boolean;
  /**
   * Development mode (`npm run dev`, never a public server): clients' `dev` commands
   * (`__game.dev(js)`) run in their room, with the game's context. Without it they're refused.
   */
  dev?: boolean;
  /**
   * Start a room's worker thread: the app's room worker, which calls `serveRoomWorker`. Games keep
   * state in their modules, so two rooms of one game can only run side by side in threads of
   * their own (and one room's crash or runaway loop stays in its thread). Without it, rooms run
   * in this thread, and each game has only its public room (tests).
   */
  worker?: (data: RoomWorkerData | SmokeWorkerData) => Worker;
  /**
   * Where a game's world, players and data are kept: rooms in this thread use `store` (a
   * `SqliteStore` per game), and a room's worker opens `storeFile` itself. With a world in it, the
   * public room carries on that world. Saved every `saveEvery` seconds (default 30), when a room
   * stops and when the server closes. Rooms of players' own share the game's data (all-time
   * numbers) but keep no world or places.
   */
  store?: (game: string) => Store;
  storeFile?: (game: string) => string;
  saveEvery?: number;
  /** Seconds a room's thread may go quiet before it's stopped as stuck (default 30). */
  stuckAfter?: number;
  /** Seconds a public room runs with nobody in it before it's saved and stopped (default 300). */
  idleStop?: number;
  /** And a room of a player's own, or a copy of a public one, which then goes (default 60). */
  idleStopOwn?: number;
  limits?: Partial<Limits>;
  log?: (line: string) => void;
  /**
   * Accounts (Sign in with Discord, `/auth/discord`): a signed-in player plays as their account's
   * name, and what games keep for them (`player.store`) is kept by it; a guest can't take a name an
   * account holds. Without, everyone's a guest.
   */
  accounts?: Accounts;
  /** Discord's application, to sign in with (a development server also has `/auth/dev`). */
  discord?: DiscordApp | null;
  /** The site's addresses: the only pages that may use a player's sign-in (see `AuthOptions.sites`). */
  sites?: string[];
  /** Sign in with just a typed name (see `AuthOptions.nameSignIn`). */
  nameSignIn?: boolean;
}

export interface Limits {
  /**
   * Connections in one room: players and those watching (everyone on the home page watches). A
   * full public room of a game with `instances` overflows into another copy; otherwise, and in a
   * full room of a player's own, more are turned away.
   */
  playersPerGame: number;
  /** Open connections from one address. */
  perAddress: number;
  /** Messages a connection may send each second (a browser sends one per frame). */
  messagesPerSecond: number;
  /** Largest message, in bytes. */
  maxMessage: number;
  /** Rooms running at once (each a world of its own), public ones included. */
  rooms: number;
  /** Rooms of their own that people at one address may have running at once. */
  roomsPerAddress: number;
  /**
   * Rooms of uploaded games (from the library) running at once: a pool of their own, so they never
   * crowd out the games built in. With a sandbox they run there and don't count toward `rooms`.
   */
  uploadedRooms: number;
}

/** Turned away when the server runs as many rooms as it may. */
const BUSY = { code: CLOSE_FULL, reason: 'The server is busy right now' };

const LIMITS: Limits = { playersPerGame: 16, perAddress: 6, messagesPerSecond: 300, maxMessage: 16 * 1024, rooms: 12, roomsPerAddress: 2, uploadedRooms: 8 };

/** Turned away when uploaded games' rooms are as many as may run. */
const UPLOADED_BUSY = { code: CLOSE_FULL, reason: 'Uploaded games are full right now' };

export { CLOSE_FULL, CLOSE_LIMIT, CLOSE_UNKNOWN };

export interface GameServer {
  readonly port: number;
  /** A game's public room's host, if it's running in this thread. */
  host(game: string): GameHost | null;
  /** Rooms running (public ones and players' own). */
  readonly rooms: number;
  close(): Promise<void>;
}

/** A running room, wherever it runs (here, or in a worker): what the server tells it. */
interface RoomLink {
  connect(client: string, who: Who): void;
  command(client: string, cmd: ClientCommand): void;
  /** Who a watching client is, again. */
  identify(client: string, who: Who): void;
  disconnect(client: string): void;
  /** Save (if it keeps anything) and stop. */
  stop(): Promise<void>;
  /** Its host, when it runs in this thread. */
  readonly host: GameHost | null;
}

/** One room on the server: a game's public one (or a copy of it), or one a player started of their own. */
class Room {
  readonly sockets = new Map<string, WebSocket>();
  link: RoomLink | null = null;
  /** Finishing its last run (saving): the next waits for it. */
  stopping: Promise<void> | null = null;
  playing = 0;
  watching = 0;
  emptySince = 0;

  constructor(
    /** Its game (a game from the library: the version it last started with). */
    public def: GameDefinition,
    /** `public`, `public-2` (a copy of it), or its code. */
    readonly instance: string,
    /** Who started it (a room of their own): their address. */
    readonly creator: string | null,
    readonly log: (line: string) => void,
    /** Which copy of the public game: 1 (the one that keeps its world), 2, 3…; 0 for a room of a player's own. */
    readonly shard = creator === null ? 1 : 0,
  ) {}

  /** A room a player started of their own (its players may restart it, set it up). */
  get own(): boolean {
    return this.creator !== null;
  }

  /**
   * The game's public room proper: it keeps its world and where its players stood, and waits a
   * while empty before stopping. A copy of it or a room of one's own shares only the game's data
   * (all-time numbers), and goes soon after it empties.
   */
  get keeps(): boolean {
    return this.shard === 1;
  }

  get key(): string {
    return `${this.def.id}/${this.instance}`;
  }

  send(client: string, text: string) {
    const ws = this.sockets.get(client);
    if (ws && ws.readyState === ws.OPEN) ws.send(text);
  }
}

/**
 * The game server: hosts the given games for players who connect over WebSocket
 * (`wss://host/bedwars`). Each game has a public room; a game with `instances` also lets a player
 * start one of their own (`wss://host/bedwars/k3x9f2`: just them and the bots, or whoever they
 * share its address with). A room runs its game on its own clock (in a worker thread of its own,
 * given `worker`) while anyone's in it; each client gets a welcome (game, room, world seed), a
 * batch that catches them up, then a batch per step. Also answers `GET /health` (for the hosting
 * platform) and `GET /games` (what's on, and how many are playing).
 */
export function serve(o: ServeOptions): Promise<GameServer> {
  const log = o.log ?? (() => {});
  const limits = { ...LIMITS, ...o.limits };
  const rate = o.tickRate ?? 30;
  const defs = new Map([...(o.hidden ?? []), ...o.games].map((d) => [d.id, d]));
  /** What a screen loads for a game from the library (its current version), to list and play it. */
  const packagedEntry = (id: string): PackageEntry | undefined => {
    const v = o.library?.current(id);
    if (!v) return undefined;
    const spec = o.library!.spec(v);
    return { id, version: v.version, meta: { ...v.meta, id }, modules: spec.modules, client: spec.client };
  };
  /** A game by id: compiled in, or the library's current version of it. */
  const defOf = (id: string): GameDefinition | undefined => defs.get(id) ?? (defs.has(id) ? undefined : o.library?.definition(id));
  const rooms = new Map<string, Room>();
  /** Stores opened in this thread: one per game, shared by its rooms here. */
  const stores = new Map<string, Store>();
  const perAddress = new Map<string, number>();
  const clock = () => performance.now() / 1000;
  let nextClient = 1;
  /** Every cosmetic on the platform: the games' (the library's too) and the platform's own. Kept up to date in place. */
  const catalog = new Map<string, Cosmetic>();
  const refreshCatalog = () => {
    const all = cosmeticCatalog([...o.games, ...(o.hidden ?? []), ...(o.library?.records().flatMap((r) => (r.current ? [defOf(r.id)!] : [])) ?? [])].filter(Boolean));
    catalog.clear();
    for (const [k, v] of all) catalog.set(k, v);
  };
  refreshCatalog();
  /** Signed-in connections: their account's id. */
  const accountOf = new Map<string, { id: string; ws: WebSocket }>();
  const auth = o.accounts
    ? new Auth({ accounts: o.accounts, discord: o.discord, sites: o.sites ?? [], dev: o.dev ?? false, nameSignIn: o.nameSignIn ?? false, onDelete: (a) => forget(a), catalog, log })
    : null;
  const uploads = o.library ? new Uploads({ library: o.library, errors: o.errors, stats: o.stats, titleOf: (id) => (defs.has(id) ? defs.get(id)!.title : undefined), accounts: o.accounts, auth, uploaders: o.uploaders ?? [], admins: o.admins ?? [], limits: o.uploadLimits, terms: o.uploadTerms, sites: o.sites ?? [], dev: o.dev ?? false, log }) : null;
  // A game from the library changed (a new version, say): its cosmetics are what may be worn.
  if (o.library) o.library.onChange = () => refreshCatalog();
  // Compiled once: each room's worker gets the module (no compiling per room).
  let engine: WebAssembly.Module | null = null;

  const running = () => [...rooms.values()].filter((r) => r.link).length;
  /** A room of an uploaded game's (from the library, not built in). */
  const uploaded = (r: Room) => !defs.has(r.def.id);
  /**
   * Whether another room of `def` may start: the uploaded games' pool, and this machine's rooms (an
   * uploaded game's in the sandbox doesn't take one of those). Why not, or null.
   */
  const full = (def: GameDefinition) => {
    const live = [...rooms.values()].filter((r) => r.link);
    const isUploaded = !defs.has(def.id);
    if (isUploaded && live.filter(uploaded).length >= limits.uploadedRooms) return UPLOADED_BUSY;
    const here = live.filter((r) => !(o.sandbox && uploaded(r))).length;
    if (!(isUploaded && o.sandbox) && here >= limits.rooms) return BUSY;
    return null;
  };

  /** Start a room's game: in a worker of its own, or here. */
  function start(room: Room): RoomLink {
    const spec: RoomSpec = { game: room.def.id, instance: room.own ? room.instance : 'public', ...(room.shard > 1 ? { shard: room.shard } : {}), tickRate: rate, cheats: o.cheats ?? false, dev: o.dev ?? false, seed: o.seed, saveEvery: o.saveEvery ?? 30 };
    // A game from the library: the version current now, until this run ends.
    const version = defs.has(room.def.id) ? undefined : o.library?.current(room.def.id);
    if (version) {
      room.def = defOf(room.def.id) ?? room.def;
      spec.package = o.library!.spec(version);
    }
    // An uploaded game, on a server with a sandbox: its room runs there.
    if (version && o.sandbox) return inSandbox(room, spec, version.dir, room.stopping ?? Promise.resolve());
    if (o.worker) return inWorker(room, spec, room.stopping ?? Promise.resolve());
    let shared = stores.get(room.def.id);
    if (!shared && o.store) stores.set(room.def.id, (shared = o.store(room.def.id)));
    const core = new RoomCore(room.def, spec, o.wasm, shared && !room.keeps ? new PrivateStore(shared, false) : shared, {
      send: (client, text) => room.send(client, text),
      counts: (playing, watching) => {
        room.playing = playing;
        room.watching = watching;
      },
      log: room.log,
      achieve: (account, id) => o.accounts?.achieve(account, room.def.id, id),
      grant: (account, id) => o.accounts?.own(account, id),
    });
    return {
      host: core.host,
      connect: (c, who) => core.connect(c, who),
      command: (c, cmd) => core.command(c, cmd),
      identify: (c, who) => core.identify(c, who),
      disconnect: (c) => core.disconnect(c),
      stop: async () => core.stop(),
    };
  }

  /** A room in a worker thread, started once its last run has finished saving (`after`). */
  function inWorker(room: Room, spec: RoomSpec, after: Promise<void>): RoomLink {
    let worker: Worker | null = null;
    const queue: ToRoom[] = [];
    const post = (m: ToRoom) => (worker ? worker.postMessage(m) : queue.push(m));
    let exited = false;
    const exit = new Promise<void>((done) => {
      void after.then(() => {
        engine ??= new WebAssembly.Module(o.wasm);
        worker = o.worker!({ spec, wasm: engine, storeFile: o.storeFile?.(room.def.id) ?? null, own: !room.keeps });
        // The watchdog: a room that hasn't started in STARTING seconds, or has gone quiet for STUCK
        // (its game in a loop that never ends, say), is stopped, and its players told.
        const born = performance.now();
        let heard = 0;
        const watchdog = setInterval(() => {
          const now = performance.now();
          const quiet = heard ? (now - heard) / 1000 > (o.stuckAfter ?? STUCK) : (now - born) / 1000 > STARTING;
          if (!quiet || exited) return;
          clearInterval(watchdog);
          failed(room, link, heard ? 'it stopped responding (stuck in a loop?)' : "it didn't start in time", 'The game stopped responding');
          void worker?.terminate();
        }, 1000);
        worker.on('exit', () => clearInterval(watchdog));
        worker.on('message', (m: FromRoom) => {
          heard = performance.now();
          if (m.t === 'alive') return;
          if (m.t === 'send') room.send(m.client, m.text);
          else if (m.t === 'counts') {
            room.playing = m.playing;
            room.watching = m.watching;
          } else if (m.t === 'log') room.log(m.line);
          else if (m.t === 'achieve') o.accounts?.achieve(m.account, room.def.id, m.id);
          else if (m.t === 'grant' && m.id.startsWith(`${room.def.id}:`)) o.accounts?.own(m.account, m.id);
          else if (m.t === 'failed') failed(room, link, m.text);
        });
        worker.on('error', (err: Error) => failed(room, link, err.stack ?? err.message));
        worker.on('exit', () => {
          exited = true;
          done();
        });
        for (const m of queue) worker.postMessage(m);
        queue.length = 0;
      });
    });
    const link: RoomLink = {
      host: null,
      connect: (c, who) => post({ t: 'connect', client: c, who }),
      command: (c, cmd) => post({ t: 'command', client: c, cmd }),
      identify: (c, who) => post({ t: 'identify', client: c, who }),
      disconnect: (c) => post({ t: 'disconnect', client: c }),
      stop: () => {
        if (!exited) post({ t: 'stop' });
        // It exits once saved; one that doesn't answer is stopped anyway.
        const late = setTimeout(() => void worker?.terminate(), 10_000);
        return exit.finally(() => clearTimeout(late));
      },
    };
    return link;
  }

  /**
   * Room tickets: what a page of the site asks for (`POST /tickets {game}`, signed in) for a screen
   * of its own that can't carry the sign-in (an uploaded game's, in a sandboxed frame), to connect
   * as the player: once, to that game, within a minute.
   */
  const tickets = new Map<string, { account: string; game: string; until: number }>();
  /** The account a socket's `?ticket=` stands for (used up), if it's good for `game`. */
  function ticketed(req: IncomingMessage, game: string): Account | null {
    const ticket = new URL(req.url ?? '/', 'http://server').searchParams.get('ticket');
    if (!ticket) return null;
    const t = tickets.get(ticket);
    tickets.delete(ticket);
    if (!t || t.until < Date.now() || t.game !== game) return null;
    return o.accounts?.get(t.account) ?? null;
  }
  function newTicket(account: Account, game: string): string {
    const now = Date.now();
    for (const [k, t] of tickets) if (t.until < now) tickets.delete(k);
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { account: account.id, game, until: now + 60_000 });
    return ticket;
  }

  /** A room's log: the server's, and its errors (a game's that it carried on from, or the room failing) kept. */
  function roomLog(key: string, def: GameDefinition) {
    return (line: string) => {
      log(`[${key}] ${line}`);
      const m = /^(error|failed): ([\s\S]*)$/.exec(line);
      if (!m || !o.errors) return;
      const first = m[2].split('\n')[0];
      const version = defs.has(def.id) ? null : (o.library?.record(def.id)?.current ?? null);
      void o.errors.record({ source: 'room', game: def.id, version, message: m[1] === 'failed' ? `The room failed: ${first}` : first, stack: m[2], context: { room: key } });
    };
  }

  /** `POST /errors`: a screen's error report (any page: no sign-in needed; a few a minute from each address). */
  const reported = new Map<string, number[]>();
  async function errorRoute(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }).end();
    const done = (status: number) => res.writeHead(status, { 'Content-Type': 'text/plain' }).end();
    if (req.method !== 'POST' || !o.errors) return done(405);
    const address = addressOf(req);
    const now = Date.now();
    const recent = (reported.get(address) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 30) return done(429);
    reported.set(address, [...recent, now]);
    if (reported.size > 5000) reported.clear();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 32 * 1024) return done(413);
      chunks.push(c as Buffer);
    }
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    } catch {
      return done(400);
    }
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const source: ErrorSource = r.source === 'frame' ? 'frame' : 'page';
    const game = /^[a-z][a-z0-9-]{1,31}$/.test(text(r.game, 40)) ? text(r.game, 40) : null;
    const version = /^[0-9a-f]{12}$/.test(text(r.version, 12)) ? text(r.version, 12) : null;
    // (A frame's report names its game; only an uploaded game's own errors reach its owners.)
    void o.errors.record({ source, message: text(r.message, 500), stack: text(r.stack, 8000), game, version, context: { url: text(r.url, 300), build: text(r.build, 100), browser: String(req.headers['user-agent'] ?? '').slice(0, 200) } });
    done(204);
  }

  /** This thread's store for a game (opened the first time): what sandboxed rooms read from and write to. */
  function storeOf(game: string): Store | undefined {
    let shared = stores.get(game);
    if (!shared && o.store) stores.set(game, (shared = o.store(game)));
    return shared;
  }

  let runs = 0;

  /**
   * A room in the sandbox (an uploaded game's, see sandbox/protocol.ts), started once its last run
   * has finished saving (`after`): its game's code and the data it starts from go there; its
   * messages and the changes it makes to its store come back; the same watchdog as a worker's.
   */
  function inSandbox(room: Room, spec: RoomSpec, dir: string, after: Promise<void>): RoomLink {
    const sandbox = o.sandbox!;
    // A run of its own (the same room started again is another run).
    const run = `${room.key}#${++runs}`;
    const keeps = room.keeps;
    let exited = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const queue: ToRoom[] = [];
    let started = false;
    const post = (m: ToRoom) => (started ? sandbox.send(run, m) : queue.push(m));
    const exit = new Promise<void>((done) => {
      void after.then(async () => {
        const shared = storeOf(room.def.id);
        const snapshot: StoreSnapshot = { world: keeps ? (shared?.world() ?? null) : null, players: keeps ? (shared?.players?.() ?? {}) : {}, data: [...(shared?.data() ?? new Map())], keeps };
        const born = performance.now();
        let heard = 0;
        watchdog = setInterval(() => {
          const now = performance.now();
          const quiet = heard ? (now - heard) / 1000 > (o.stuckAfter ?? STUCK) : (now - born) / 1000 > STARTING;
          if (!quiet || exited) return;
          clearInterval(watchdog);
          failed(room, link, heard ? 'it stopped responding (stuck in a loop?)' : "it didn't start in time", 'The game stopped responding');
          sandbox.kill(run);
        }, 1000);
        try {
          await sandbox.start(run, spec, gameFiles(dir), snapshot, {
            message: (m) => {
              heard = performance.now();
              if (m.t === 'alive') return;
              if (m.t === 'send') room.send(m.client, m.text);
              else if (m.t === 'counts') {
                room.playing = m.playing;
                room.watching = m.watching;
              } else if (m.t === 'log') room.log(m.line);
              else if (m.t === 'achieve') o.accounts?.achieve(m.account, room.def.id, m.id);
              else if (m.t === 'grant' && m.id.startsWith(`${room.def.id}:`)) o.accounts?.own(m.account, m.id);
              else if (m.t === 'failed') failed(room, link, m.text);
            },
            store: (c) => {
              // What the room changed, kept here (a room that doesn't keep its world saves only the game's data).
              if (!shared) return;
              if (c.op === 'put') {
                // (A store's `put` marks a change the game made to its data map: here, it's made too.)
                const data = shared.data();
                if (c.value === undefined) data.delete(c.key);
                else data.set(c.key, c.value);
                shared.put(c.key, c.value);
              }
              else if (c.op === 'flush') shared.flush();
              else if (!keeps) return;
              else if (c.op === 'saveWorld') shared.saveWorld(c.world);
              else if (c.op === 'savePlayer') shared.savePlayer(c.name, c.player);
              else if (c.op === 'forgetPlayer') shared.forgetPlayer(c.name);
            },
            exit: (code) => {
              exited = true;
              clearInterval(watchdog);
              if (room.link === link) failed(room, link, code === null ? 'the sandbox went away' : `its process ended (${code})`);
              done();
            },
          });
          started = true;
          for (const m of queue) sandbox.send(run, m);
          queue.length = 0;
        } catch (err) {
          exited = true;
          clearInterval(watchdog);
          failed(room, link, `the sandbox couldn't start it: ${err instanceof Error ? err.message : String(err)}`, "The game couldn't start: try again in a moment");
          done();
        }
      });
    });
    const link: RoomLink = {
      host: null,
      connect: (c, who) => post({ t: 'connect', client: c, who }),
      command: (c, cmd) => post({ t: 'command', client: c, cmd }),
      identify: (c, who) => post({ t: 'identify', client: c, who }),
      disconnect: (c) => post({ t: 'disconnect', client: c }),
      stop: () => {
        if (!exited) post({ t: 'stop' });
        // It ends once saved; one that doesn't is stopped anyway.
        const late = setTimeout(() => sandbox.kill(run), 10_000);
        return exit.finally(() => clearTimeout(late));
      },
    };
    return link;
  }

  /** Something went wrong with a room itself (not a game's error, which it logs and carries on from): everyone in it is let go. */
  function failed(room: Room, link: RoomLink, reason: string, told = 'The game stopped unexpectedly') {
    room.log(`failed: ${reason}`);
    if (room.link !== link) return;
    void stop(room);
    for (const ws of room.sockets.values()) ws.close(1011, told);
  }

  /** Save and stop a room (nobody's in it, or the server is closing); a copy of the public one, or a room of a player's own, then goes. */
  async function stop(room: Room) {
    const link = room.link;
    if (!link) return room.stopping ?? undefined;
    room.link = null;
    room.playing = room.watching = 0;
    if (!room.keeps) rooms.delete(room.key);
    const done = link.stop().then(() => {
      room.log(`stopped${o.store || o.storeFile ? ' and saved' : ''}`);
      if (room.stopping === done) room.stopping = null;
    });
    room.stopping = done;
    return done;
  }

  /** The room a connection asks for (`/<game>`, `/<game>?shard=2`, or `/<game>/<code>`), made if need be; or why not. */
  function roomFor(req: IncomingMessage, address: string): Room | { code: number; reason: string } {
    const url = new URL(req.url ?? '/', 'http://server');
    const parts = url.pathname.split('/').filter(Boolean);
    // An uploaded game a platform update broke: turned away, saying so.
    if (parts.length && !defs.has(parts[0]) && o.library?.broken(parts[0])) return { code: CLOSE_UNKNOWN, reason: 'This game stopped working with an update to Blockyard: its owners have been told' };
    const def = parts.length ? defOf(parts[0]) : o.games.length === 1 ? o.games[0] : undefined;
    const code = parts[1];
    // Rooms of players' own need threads of their own (the games' module-level state).
    if (!def || parts.length > 2 || (code !== undefined && (!def.instances || !o.worker || !ROOM_CODE.test(code)))) return { code: CLOSE_UNKNOWN, reason: 'No such game on this server' };
    if (code === undefined) return publicRoom(def, Number(url.searchParams.get('shard')) || 1);
    const key = `${def.id}/${code}`;
    const room = rooms.get(key);
    if (room?.link) return room;
    if ([...rooms.values()].filter((r) => r.creator === address && r.link).length >= limits.roomsPerAddress) {
      return { code: CLOSE_LIMIT, reason: 'You have too many games of your own going: leave one first' };
    }
    const busy = full(def);
    if (busy) return busy;
    if (room) return room;
    const made = new Room(def, code, address, roomLog(key, def));
    rooms.set(key, made);
    return made;
  }

  /**
   * Where a connection to a game's public game goes: the copy it asks for (an invite link names
   * one) if that has a place, else the fullest one with a place (so games fill up rather than
   * spread thin), the first on a tie. If none has one: the public room proper if it isn't running,
   * else a new copy (a game with `instances`: a copy runs in a thread of its own); or why not.
   */
  function publicRoom(def: GameDefinition, asked: number): Room | { code: number; reason: string } {
    const copies = [...rooms.values()].filter((r) => r.def.id === def.id && !r.own);
    const open = copies.filter((r) => r.link && r.sockets.size < limits.playersPerGame);
    const pick = open.find((r) => r.shard === asked) ?? open.sort((a, b) => b.sockets.size - a.sockets.size || a.shard - b.shard)[0];
    if (pick) return pick;
    const first = copies.find((r) => r.shard === 1);
    if (first?.link && (!def.instances || !o.worker)) return { code: CLOSE_FULL, reason: 'This game is full' };
    const busy = full(def);
    if (busy) return busy;
    if (first && !first.link) return first;
    let shard = first ? 2 : 1;
    while (copies.some((r) => r.shard === shard)) shard++;
    const instance = shard === 1 ? 'public' : `public-${shard}`;
    const made = new Room(def, instance, null, roomLog(`${def.id}/${instance}`, def), shard);
    rooms.set(made.key, made);
    return made;
  }

  /**
   * An account is deleted: its connections close, and each game forgets what it kept for it (its
   * `player.store`, its place). Rooms in other threads pick that up when they next save.
   */
  /** The cosmetics of one game an account has (`game:id`). */
  const ownedIn = (account: string, game: string) => Object.keys(o.accounts?.owned(account) ?? {}).filter((id) => id.startsWith(`${game}:`));

  function forget(account: Account) {
    for (const [client, a] of accountOf) {
      if (a.id !== account.id) continue;
      accountOf.delete(client);
      a.ws.close(4003, 'Your account was deleted');
    }
    o.stats?.forgetAccount(account.id);
    if (!o.store) return;
    // Every game's data: the built-in ones' and the uploaded ones' (kept here too).
    for (const id of new Set([...defs.keys(), ...(o.library?.records().map((r) => r.id) ?? [])])) {
      let store = stores.get(id);
      if (!store) stores.set(id, (store = o.store(id)));
      const data = store.data();
      for (const key of [...data.keys()]) {
        if (!key.startsWith(`${PLAYER_DATA}${account.id}:`) && key !== `${ADOPTED}${account.id}`) continue;
        data.delete(key);
        store.put(key, undefined);
      }
      store.forgetPlayer(`#${account.id}`);
      store.flush();
    }
  }

  // Behind a proxy (Fly), the player's address is in a header.
  const addressOf = (req: IncomingMessage) => String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');

  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://server').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (path === '/tickets' && auth) return void ticketRoute(req, res);
    if (path === '/errors') return void errorRoute(req, res);
    if (path.startsWith('/avatars/')) return void avatarRoute(res, path.slice('/avatars/'.length));
    if (auth?.handle(req, res, path)) return;
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else if (path === '/games' || path === '/') {
      // The library's games approved for the home page come after the ones compiled in.
      const listed = (o.library?.records() ?? []).filter((r) => r.home === 'approved' && r.current && !defs.has(r.id) && !o.library!.broken(r.id)).flatMap((r) => defOf(r.id) ?? []);
      const games = [...o.games, ...listed].map((def) => {
        // The public game, in all its copies running.
        const pub = [...rooms.values()].filter((r) => r.def.id === def.id && !r.own && r.link);
        const own = [...rooms.values()].filter((r) => r.def.id === def.id && r.own && r.link);
        return {
          id: def.id,
          title: def.title,
          players: pub.reduce((n, r) => n + r.playing, 0),
          watching: pub.reduce((n, r) => n + r.watching, 0),
          running: pub.length > 0,
          copies: pub.length,
          instances: !!def.instances,
          // Rooms of players' own, and how many are playing in them.
          rooms: own.length,
          playingOwn: own.reduce((n, r) => n + r.playing, 0),
          // From the library: what a screen loads to list and play it (`PackageEntry`).
          ...(defs.has(def.id) ? {} : { packaged: packagedEntry(def.id) }),
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ games, rooms: running() }));
    } else if (uploads?.handle(req, res, path)) {
      // (the library's games: their code and files, uploads)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });


  /**
   * A player's account as games see it: their avatar by way of this server (`/avatars/<id>`), so
   * no game learns their Discord id from its address.
   */
  function playerAccount(a: Account): PlayerAccount {
    const base = o.publicUrl ?? o.library?.publicUrl ?? `http://localhost:${listening}`;
    return { id: a.id, name: a.name, avatar: a.avatar ? `${base}/avatars/${a.id}` : null };
  }

  /** `GET /avatars/<account>`: an account's Discord avatar, fetched (and kept a while) by the server. */
  const avatars = new Map<string, { at: number; type: string; body: Buffer }>();
  async function avatarRoute(res: ServerResponse, id: string) {
    const from = /^[\w-]{1,32}$/.test(id) ? o.accounts?.get(id)?.avatar : null;
    if (!from) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no such avatar');
    let kept = avatars.get(id);
    if (!kept || Date.now() - kept.at > 3600_000) {
      try {
        const r = await fetch(from, { signal: AbortSignal.timeout(5000) });
        const type = r.headers.get('content-type') ?? '';
        if (!r.ok || !type.startsWith('image/')) throw new Error(`${r.status} ${type}`);
        const body = Buffer.from(await r.arrayBuffer());
        if (body.length > 1024 * 1024) throw new Error('too big');
        kept = { at: Date.now(), type, body };
        if (avatars.size >= 1000) avatars.delete(avatars.keys().next().value!);
        avatars.set(id, kept);
      } catch {
        if (!kept) return res.writeHead(502, { 'Content-Type': 'text/plain' }).end('avatar unavailable');
      }
    }
    res.writeHead(200, { 'Content-Type': kept.type, 'Cache-Control': 'public, max-age=3600', 'Cross-Origin-Resource-Policy': 'cross-origin' }).end(kept.body);
  }

  /** `POST /tickets {game}`: a room ticket for the signed-in player (the site's pages only). */
  async function ticketRoute(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && auth!.allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (o.nameSignIn) {
      // A page on another site (a frame in Partytime): it carries its own bearer token.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' }).end();
    const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    if (req.method !== 'POST') return json(405, { error: 'POST it' });
    // Only a page of the site's (a sandboxed frame's `Origin: null` isn't one).
    // (`who` takes a bearer token from anywhere, and a cookie only from the site's own pages.)
    const account = auth!.who(req);
    if (!account) return json(401, { error: 'Not signed in' });
    const chunks: Buffer[] = [];
    for await (const c of req) if ((chunks.push(c as Buffer), chunks.length) > 64) return json(413, { error: 'Too big' });
    let game = '';
    try {
      game = String((JSON.parse(Buffer.concat(chunks).toString() || '{}') as { game?: unknown }).game ?? '');
    } catch {
      // no game
    }
    if (!defOf(game)) return json(404, { error: `No game "${game}" here` });
    json(200, { ticket: newTicket(account, game) });
  }

  // Compressed (permessage-deflate, which every browser speaks): one step's patch looks much like
  // the last, so keeping the compressor's window between messages shrinks them a few times over.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxMessage,
    perMessageDeflate: { threshold: 64, serverMaxWindowBits: 13, zlibDeflateOptions: { level: 3, memLevel: 7 } },
  });
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, req));
  });

  function join(ws: WebSocket, req: IncomingMessage) {
    // A bad frame (too big, malformed) is an error on that socket alone: it closes, the server
    // carries on. (Unhandled, it would take the whole process down.)
    ws.on('error', (err) => log(`socket error: ${err.message}`));
    const address = addressOf(req);
    if ((perAddress.get(address) ?? 0) >= limits.perAddress) return ws.close(CLOSE_LIMIT, 'Too many connections from your address');
    const found = roomFor(req, address);
    if (!(found instanceof Room)) return ws.close(found.code, found.reason);
    const room = found;
    if (room.sockets.size >= limits.playersPerGame) return ws.close(CLOSE_FULL, 'This game is full');
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);

    // They watch until their client says `start` (with a name): then they're in the game, as
    // their account if they're signed in.
    const id = `c${nextClient++}`;
    // Signed in: by the session cookie (a page of the site's), or by a room ticket (an uploaded
    // game's screen, in a sandboxed frame that has no cookie: see `tickets`).
    let account = ticketed(req, room.def.id) ?? auth?.who(req) ?? null;
    const who: Who = account ? { account: playerAccount(account), achieved: o.accounts!.achievedIn(account.id, room.def.id), look: o.accounts!.look(account.id), owned: ownedIn(account.id, room.def.id) } : { account: null };
    if (account) accountOf.set(id, { id: account.id, ws });
    room.sockets.set(id, ws);
    room.link ??= start(room);
    room.link.connect(id, who);
    room.log(`${id} connected (${room.sockets.size} here)`);

    let play: number | null = null;

    // A bucket of messages, refilled each second; a client far over it is disconnected.
    let allowance = limits.messagesPerSecond;
    let over = 0;
    const refill = setInterval(() => {
      allowance = limits.messagesPerSecond;
      over = Math.max(0, over - limits.messagesPerSecond);
    }, 1000);
    ws.on('message', (data, binary) => {
      if (binary) return;
      if (--allowance < 0) {
        if (++over > limits.messagesPerSecond * 3) ws.close(CLOSE_LIMIT, 'Too many messages');
        return;
      }
      let cmd;
      try {
        cmd = sanitizeCommand(decode(String(data)));
      } catch {
        return;
      }
      // The server keeps the clock (a client's ticks mean nothing here). Restarting the game and
      // changing its time of day are for a room of one's own (everyone in it came by its link),
      // and development servers: never the public game, which is everyone's.
      if (!cmd || cmd.t === 'tick' || (!o.cheats && !room.own && (cmd.t === 'restart' || cmd.t === 'env'))) return;
      // Running code in the room (development tools): only on a development server. Elsewhere
      // it goes no further than here, and the client hears why.
      if (cmd.t === 'dev' && !o.dev) {
        const refused: WireBatch = { events: [{ t: 'reply', id: cmd.id, value: { ok: false, error: 'refused: this server is not in development mode (npm run dev)' } }], time: 0 };
        if (ws.readyState === ws.OPEN) ws.send(encode(refused));
        return;
      }
      // A guest can't be a name an account holds; a signed-in player plays as their account's name.
      if (cmd.t === 'start' && !account && o.accounts?.nameHeld(cmd.name ?? 'Player')) cmd = { ...cmd, name: `${cmd.name ?? 'Player'} (guest)` };
      if (cmd.t === 'start' && account && o.accounts) {
        // (Their name and look, too, as they are now: either may have changed on the home page.)
        account = o.accounts.get(account.id) ?? account;
        room.link?.identify(id, { account: playerAccount(account), look: o.accounts.look(account.id) });
      }
      room.link?.command(id, cmd);
      // A play (for the stats): from their first start until they leave.
      if (cmd.t === 'start' && play === null) play = o.stats?.start(room.def.id, account?.id ?? null) ?? null;
      if (cmd.t === 'start') room.log(`${id} plays as ${account ? `${account.name} (${account.id})` : `${cmd.name ?? 'Player'} (a guest)`}`);
    });
    ws.on('close', () => {
      clearInterval(refill);
      if (play !== null) o.stats?.end(play);
      accountOf.delete(id);
      perAddress.set(address, (perAddress.get(address) ?? 1) - 1);
      if (!perAddress.get(address)) perAddress.delete(address);
      room.sockets.delete(id);
      room.link?.disconnect(id);
      if (!room.sockets.size) room.emptySince = clock();
      room.log(`${id} left (${room.sockets.size} here)`);
    });
  }

  // Rooms nobody's in are saved and stopped after a while (copies and players' own sooner, and they go).
  const idle = setInterval(() => {
    const now = clock();
    for (const room of [...rooms.values()]) {
      if (room.link && !room.sockets.size && now - room.emptySince > (room.keeps ? (o.idleStop ?? 300) : (o.idleStopOwn ?? 60))) void stop(room);
    }
  }, 250);

  // Hourly, what's no longer needed goes: expired sign-ins, old resolved reports. Each minute, plays
  // going on are counted so far (should the server stop without their ends).
  o.accounts?.tidy();
  const tidying = setInterval(() => o.accounts?.tidy(), 3600_000);
  const counting = setInterval(() => o.stats?.flush(), 60_000);

  let listening = o.port;
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(o.port, () => {
      const addr = http.address();
      listening = typeof addr === 'object' && addr ? addr.port : o.port;
      resolve({
        port: listening,
        host: (game) => rooms.get(`${game}/public`)?.link?.host ?? null,
        get rooms() {
          return running();
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(idle);
            clearInterval(tidying);
            clearInterval(counting);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            http.close(async () => {
              await Promise.all([...rooms.values()].map((r) => stop(r)));
              for (const s of stores.values()) s.close();
              stores.clear();
              o.stats?.flush();
              o.accounts?.close();
              done();
            });
          }),
      });
    });
  });
}

/** One game on its own server (tests, a single-game deployment). */
export function serveGame(def: GameDefinition, o: Omit<ServeOptions, 'games'>): Promise<GameServer> {
  return serve({ ...o, games: [def] });
}
