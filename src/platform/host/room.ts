import type { GameDefinition } from '../api/types';
import { encode } from '../net/codec';
import { quantize } from '../net/delta';
import type { ClientCommand, ServerWelcome, WireBatch } from '../net/protocol';
import type { SimFrame } from '../sim/sim';
import { GameHost, type Who } from './game';
import type { SavedPlayer, SavedWorld, Store } from './store';

/** Longest step a room takes (seconds): a stall longer than this is lost time. */
const MAX_STEP = 0.1;

/** Which room: a game, and its public game or one of its own ones (`instance`). */
export interface RoomSpec {
  game: string;
  /** `public` (the game everyone joins, in any of its copies), or a private room's code. */
  instance: string;
  /** A copy of the public game started while the others were full: its number (2, 3…). */
  shard?: number;
  tickRate: number;
  cheats: boolean;
  /** Development mode: clients' `dev` commands run (see `GameHostOptions.dev`). */
  dev: boolean;
  /** A new world's seed (default random); the public room carries on a kept one. */
  seed?: number;
  /** Seconds between saves. */
  saveEvery: number;
  /**
   * A built game's (not compiled into the server; see host/library.ts): the built version's
   * folder, which the room's worker imports, the server's public address its files are at, and
   * what its players' screens load (the welcome says: `ServerWelcome.package`).
   */
  package?: { dir: string; publicUrl: string } & NonNullable<ServerWelcome['package']>;
}

/** What a room says back: text for a client's socket, how many are in it, log lines. */
export interface RoomOut {
  send(client: string, text: string): void;
  counts(playing: number, watching: number): void;
  log(line: string): void;
  /** A signed-in player earned one of the game's achievements: the server keeps it for their account. */
  achieve?(account: string, id: string): void;
  /** A signed-in player was given one of the game's cosmetics (`game:id`). */
  grant?(account: string, id: string): void;
}

/**
 * A private room's store: the game's data is shared with every other room of the game (all-time
 * stats), but its world and who stood where are its own, and gone when it stops.
 */
export class PrivateStore implements Store {
  /** `owns`: closing this closes the shared store (a worker's own connection). */
  constructor(
    private shared: Store,
    private owns: boolean,
  ) {}
  world(): SavedWorld | null {
    return null;
  }
  saveWorld() {}
  player(): SavedPlayer | null {
    return null;
  }
  savePlayer() {}
  forgetPlayer() {}
  data() {
    return this.shared.data();
  }
  put(key: string, value: unknown) {
    this.shared.put(key, value);
  }
  flush() {
    this.shared.flush();
  }
  close() {
    if (this.owns) this.shared.close();
  }
}

/**
 * One running game on a server: its host, stepped on its own clock, each client's frames as
 * patches on the one it had, saved now and then. It runs in a worker thread of its own (so games'
 * module-level state, a crash or a runaway loop stay in their room) or, for tests, in the thread
 * that serves the sockets; either way it talks through `RoomOut`.
 */
export class RoomCore {
  readonly host: GameHost;
  private time = 0;
  private savedAt = 0;
  private timer: ReturnType<typeof setInterval>;
  /** The server's client ids and the host's, and the frame each client has. */
  private ids = new Map<string, string>();
  private had = new Map<string, SimFrame>();
  private lastCounts = '';

  constructor(
    readonly def: GameDefinition,
    private spec: RoomSpec,
    engine: BufferSource | WebAssembly.Module,
    private store: Store | undefined,
    private out: RoomOut,
  ) {
    const kept = store?.world();
    const seed = kept?.seed ?? spec.seed ?? Math.floor(Math.random() * 2 ** 32);
    this.host = new GameHost(def, {
      engine,
      seed,
      remote: true,
      cheats: spec.cheats,
      dev: spec.dev,
      room: spec.instance,
      player: { id: 'p1', name: 'Player' },
      radius: 8,
      store,
      onError: (err) => out.log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`),
      onAchieve: (account, id) => out.achieve?.(account, id),
      onGrant: (account, id) => out.grant?.(account, id),
    });
    if (store) this.host.persist();
    out.log(kept ? `started, carrying on the kept world (seed ${this.host.seed})` : `started a new world (seed ${this.host.seed})`);
    // Each step as long as it's been since the last: a busy machine (or a slow tick) steps less
    // often but keeps time, rather than the game slowing down while players' screens (predicting
    // their own ships and walks on the wall clock) run on ahead of it. Past MAX_STEP, it loses time.
    const dt = 1 / spec.tickRate;
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - last) / 1000;
      last = now;
      this.step(Math.min(MAX_STEP, elapsed));
    }, 1000 * dt);
  }

  /** A client watching (they join with `start`): their welcome and a batch catching them up. `who`: signed in, or not. */
  connect(client: string, who?: Who) {
    const { id, batch } = this.host.connect(undefined, who);
    this.ids.set(client, id);
    const sp = this.host.sim.spawn;
    const welcome: ServerWelcome = { t: 'welcome', game: this.def.id, room: this.spec.instance, ...(this.spec.shard ? { shard: this.spec.shard } : {}), seed: this.host.seed, player: null, spawn: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw }, tickRate: this.spec.tickRate };
    const pkg = this.spec.package;
    if (pkg) welcome.package = { version: pkg.version, client: pkg.client, modules: pkg.modules };
    if (this.host.blocks.keys.length) welcome.blocks = this.host.blocks.keys;
    this.out.send(client, encode(welcome));
    const frame = batch.frame ? quantize(batch.frame) : undefined;
    if (frame) this.had.set(client, frame);
    this.out.send(client, encode({ events: batch.events, f: frame, time: this.time } satisfies WireBatch));
    this.count();
  }

  command(client: string, cmd: ClientCommand) {
    const id = this.ids.get(client);
    if (id) this.host.command(id, cmd);
  }

  /** Who a watching client is, again (see `GameHost.identify`). */
  identify(client: string, who: Who) {
    const id = this.ids.get(client);
    if (id) this.host.identify(id, who);
  }

  disconnect(client: string) {
    const id = this.ids.get(client);
    this.ids.delete(client);
    this.had.delete(client);
    if (id) this.host.disconnect(id);
    this.count();
  }

  /** Save (if it keeps anything) and stop. */
  stop() {
    clearInterval(this.timer);
    if (this.store) this.host.persist();
    this.store?.flush();
    this.host.dispose();
  }

  private step(dt: number) {
    if (!this.ids.size) return;
    this.time += dt;
    const batches = this.host.step(dt);
    // (The host rounded the step's frame and worked out its patch once: `host.frames`.)
    const frames = this.host.frames;
    for (const [client, id] of this.ids) {
      const b = batches.get(id);
      if (!b) continue;
      let f: unknown;
      if (b.frame) {
        f = frames.patchFor(this.had.get(client));
        this.had.set(client, frames.current!);
      }
      this.out.send(client, encode({ events: b.events, f, time: this.time } satisfies WireBatch));
    }
    if (this.store && this.time - this.savedAt > this.spec.saveEvery) {
      this.savedAt = this.time;
      this.host.persist();
    }
    this.count();
  }

  private count() {
    const playing = this.host.sim.players.filter((p) => !p.vacant && !p.bot).length;
    const counts = `${playing}|${this.ids.size - playing}`;
    if (counts === this.lastCounts) return;
    this.lastCounts = counts;
    this.out.counts(playing, Math.max(0, this.ids.size - playing));
  }
}
