import { TerrainGen, VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, GameDefinition, PlayerAccount } from '../api/types';
import { Content } from '../content';
import { loadEngineSync } from '../engine/wasm';
import { FrameWriter } from '../net/delta';
import { IDLE_INPUT, type ClientCommand, type DevReply, type HostBatch, type HostEvent, type PlayerInput } from '../net/protocol';
import type { PlayerSim } from '../sim/player';
import { Sim, type SimFrame } from '../sim/sim';
import type { WorldHost } from '../sim/world';
import { applyWorldConfig, worldGenConfig } from '../workers/config';
import type { WorldGenConfig } from '../workers/protocol';
import { firstGameBlock, gameBlocks, remapEdits, useGameBlocks, type GameBlocks } from '../world/blocks';
import { blockIdOf, destructibleIds, loadRegistry, type Registry } from '../world/registry';
import { replayable, Replays } from './replay';
import { groundSpawn, startSpawn } from './spawn';
import { PresentState } from './state';
import { MemoryStore, type SavedPlayer, type Store } from './store';

/** Columns generated straight away around the spawn, before the first tick. */
const CORE = 4;
/** Columns always kept past the radius (so walking back and forth is free). */
const SLACK = 2;
/**
 * Columns kept once made, however far everyone goes, before the farthest are dropped (about 10 to
 * 25 KB each). Generating is most of what a room costs, and fliers cross a battle's whole sky
 * again and again: kept, a bounded map is made once (Starfighter's is about 4000).
 */
const KEEP = 4096;

/**
 * The simulation's own copy of the world: columns generated on the spot around the players (no
 * workers, no meshes), nearest first and a few per tick, and kept until there are too many, when
 * the farthest from everyone go. Edits survive dropping (the engine keeps them per column).
 */
export class GeneratedWorld {
  readonly world = new VoxelWorld();
  private gen: TerrainGen;
  private loaded = new Map<string, [number, number]>();
  private settled = '';
  private sweep = 0;

  constructor(seed: number, cfg: WorldGenConfig) {
    this.gen = new TerrainGen(seed);
    applyWorldConfig(this.gen, cfg);
  }

  /** Give the engine its memory back (the world, its entities, the generator). */
  dispose() {
    this.world.free();
    this.gen.free();
  }

  /**
   * Generate up to `budget` missing columns within `radius` of the given points, nearest first,
   * and now and then, if there are more than `keep`, drop the farthest beyond reach. Returns how
   * many were generated.
   */
  update(points: { x: number; z: number }[], radius: number, budget: number, keep = KEEP): number {
    const centres = points.map((p) => [Math.floor(p.x / 16), Math.floor(p.z / 16)] as const);
    const key = `${radius}|${centres.join(';')}`;
    let n = 0;
    if (key !== this.settled) {
      let missing = false;
      for (let r = 0; r <= radius && n < budget; r++) {
        for (const [cx, cz] of centres) {
          for (let dz = -r; dz <= r && n < budget; dz++) {
            for (let dx = -r; dx <= r && n < budget; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              if (this.world.has_column(cx + dx, cz + dz)) continue;
              this.world.insert_column(cx + dx, cz + dz, this.gen.generate(cx + dx, cz + dz));
              this.loaded.set(`${cx + dx},${cz + dz}`, [cx + dx, cz + dz]);
              n++;
            }
          }
        }
      }
      for (const [cx, cz] of centres) {
        for (let dz = -radius; dz <= radius && !missing; dz++) {
          for (let dx = -radius; dx <= radius && !missing; dx++) missing = !this.world.has_column(cx + dx, cz + dz);
        }
      }
      if (!missing) this.settled = key;
    }
    if (++this.sweep >= 120 && this.loaded.size > keep) {
      this.sweep = 0;
      const far = [...this.loaded]
        .map(([k, [cx, cz]]) => ({ k, cx, cz, d: Math.min(...centres.map(([px, pz]) => Math.max(Math.abs(cx - px), Math.abs(cz - pz)))) }))
        .filter((c) => c.d > radius + SLACK)
        .sort((a, b) => b.d - a.d);
      for (const c of far.slice(0, this.loaded.size - keep)) {
        this.world.remove_column(c.cx, c.cz);
        this.loaded.delete(c.k);
      }
    }
    return n;
  }
}

export interface GameHostOptions {
  /** The engine: its compiled module (a room's worker gets the server's) or the `.wasm` bytes. */
  engine: WebAssembly.Module | BufferSource;
  seed: number;
  /** Chat commands like `/give`. */
  cheats?: boolean;
  /**
   * Development mode (`npm run dev`): clients' `dev` commands run here (`__game.dev(js)` in the
   * browser: any code, with the game's context). Never on a public server. A production build
   * of the server refuses them whatever this says.
   */
  dev?: boolean;
  /** Columns kept around each player (the client's view distance). */
  radius?: number;
  /** Columns generated per tick past the first few (`Infinity`: all at once, for tests). */
  budget?: number;
  /** Seconds per in-game day (the player's setting), unless the game freezes time. */
  dayLength?: number | null;
  /** Field of view a game-driven camera starts with (the player's setting). */
  fov?: number;
  /**
   * Clients connect and leave (`connect`, `disconnect`) and the host keeps its own clock
   * (`step`): a server. Otherwise one client, the first player, is there from the start and its
   * ticks drive the clock (`handle`): a test.
   */
  remote?: boolean;
  /** The first player's id and name (default 'local', 'Player'). */
  player?: { id: string; name: string };
  /** Which room this is (`game.room`): 'public' (the default), or a private room's code. */
  room?: string;
  /**
   * What's kept across restarts: `game.store`, and for games that keep their world
   * (`world.persist`) its edits and each player's place, by name. Default: memory only.
   */
  store?: Store;
  /**
   * Game code threw: where the details go. By default the clients get the whole error (stack and
   * all, handy in development); a public server logs it here and tells players only the message.
   */
  onError?: (err: unknown) => void;
  /** A signed-in player earned one of the game's achievements: keep it for their account. */
  onAchieve?: (account: string, id: string) => void;
  /** A signed-in player was given one of the game's cosmetics (`game:id`): theirs. */
  onGrant?: (account: string, id: string) => void;
}

/** Who a connection is, as the server found them (their cookie): signed in, or a guest. */
export interface Who {
  account: PlayerAccount | null;
  /** The game's achievements their account has. */
  achieved?: string[];
  /** What their account wears: its avatar (null: none chosen) and the cosmetics it has on. */
  look?: { avatar: string | null; wear: string[] };
  /** The game's cosmetics their account has (`game:id`). */
  owned?: string[];
}

/** A connected client: watching (no player yet), or playing. */
interface Client {
  player: PlayerSim | null;
  /** Their account, if they're signed in: they play as its name, and what's kept for them is kept by it. */
  account: PlayerAccount | null;
  /** The game's achievements their account has (as they connected). */
  achieved: string[];
  /** What their account wears, and the game's cosmetics it has. */
  look: { avatar: string | null; wear: string[] } | null;
  owned: string[];
  /** Their controls since the last step: held keys as they are now, presses and clicks added up. */
  input: PlayerInput;
  radius: number;
  /** Numbered inputs from a client predicting its own movement, waiting for the next step. */
  moves: { input: PlayerInput; dt: number; seq: number }[] | null;
  /** Seconds of movement the client may still spend: it earns the server's time, so it can't run faster. */
  bank: number;
  /** Its inputs have started playing (after a cushion's worth came in). */
  playing?: boolean;
}

/** Most movement time a client can save up (catching up after a hiccup). */
const MAX_BANK = 0.25;
/** Inputs kept in hand past this (seconds' worth) are played a little faster until it's worn down. */
const CUSHION = 0.05;
/** Inputs held back before a client's first is played: the cushion it starts with. */
const PRIME = 0.04;

/**
 * Hosts one game: its simulation, on a world of its own, driven by `ClientCommand`s and
 * answering with `HostBatch`es. A server runs one per room (`RoomCore`); tests run one in Node.
 */
export class GameHost {
  readonly sim: Sim;
  readonly world: GeneratedWorld;
  /** The world's seed (the game's own, if it fixes one). */
  readonly seed: number;
  radius: number;
  readonly store: Store;
  /** The game's own blocks (`def.blocks`): their ids, by key, are what saves and joining players get. */
  readonly blocks: GameBlocks;
  /**
   * Each step's frame, rounded once, and its patch on the step before's worked out once: what a
   * server sends (`RoomCore`), and what the replays' history keeps.
   */
  readonly frames = new FrameWriter<SimFrame>();
  /** The room's last few seconds, and the replays playing on players' screens (`game.replay`). */
  readonly replays: Replays;
  private readonly registry: Registry;
  private onError?: (err: unknown) => void;
  private dev: boolean;
  private budget: number;
  private events: HostEvent[] = [];
  private clients = new Map<string, Client>();
  /** What's on screen, to skip calls that change nothing and to catch late joiners up. */
  private state = new PresentState();
  /** Every content definition so far, for clients that join later. */
  private contentLog: HostEvent[] = [];
  /** The client whose command is running (a button they pressed may call `game.exit()`). */
  private acting: string | undefined;
  private nextClient = 1;

  constructor(
    readonly def: GameDefinition,
    o: GameHostOptions,
  ) {
    loadEngineSync(o.engine);
    // The game's own blocks, before anything is made that needs to know them.
    const blocks = (this.blocks = gameBlocks(def));
    useGameBlocks(blocks);
    const registry = (this.registry = loadRegistry(blocks));
    const seed = (this.seed = (def.world?.seed ?? o.seed) >>> 0);
    const store = (this.store = o.store ?? new MemoryStore());
    this.onError = o.onError;
    this.dev = o.dev ?? false;
    this.radius = o.radius ?? 8;
    this.budget = o.budget ?? 4;
    const blockId = (b: BlockRef) => blockIdOf(registry, b);
    const cfg = worldGenConfig(def, blockId);
    const gw = (this.world = new GeneratedWorld(seed, cfg));
    const w = gw.world;
    const destructible = def.world?.destructible;
    if (destructible) w.set_destructible(destructible.above ?? -1, destructibleIds(registry, destructible));
    const edited = (cells: [number, number, number, number][]) => this.events.push({ t: 'edits', cells });
    const host: WorldHost = {
      world: w,
      edit: (x, y, z, id) => {
        if (!w.set_block(x, y, z, id)) return false;
        edited([[x, y, z, id]]);
        return true;
      },
      editMany: (cells) => {
        const done = cells.filter(([x, y, z, id]) => w.set_block(x, y, z, id));
        if (done.length) edited(done);
        return done.length;
      },
      revert: () => {
        this.events.push({ t: 'revert' });
        return w.revert_edits().length / 2;
      },
      carve: (o, d, radius, depth) => carved(w.carve(o[0], o[1], o[2], d[0], d[1], d[2], radius, depth)),
      blast: (c, radius, roughness, seed, cells) => carved(w.blast(c[0], c[1], c[2], radius, roughness, seed, cells)),
    };
    /**
     * What a carve or a blast changed (see `VoxelWorld.carve`): what's left of the blocks it
     * chipped, as changes every client takes from its own copy (a tick's carves go together);
     * the blocks it carved away, as edits.
     */
    const carved = (out: Uint8Array): { removed: number; emptied: [number, number, number, number][] } => {
      const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
      const n = v.getUint32(4, true);
      const emptied: [number, number, number, number][] = [];
      for (let i = 0, at = 8; i < n; i++, at += 16) emptied.push([v.getInt32(at, true), v.getInt32(at + 4, true), v.getInt32(at + 8, true), v.getInt32(at + 12, true)]);
      const changes = out.subarray(8 + n * 16);
      if (changes.length) {
        const last = this.events[this.events.length - 1];
        if (last?.t === 'damage') {
          const both = new Uint8Array(last.data.length + changes.length);
          both.set(last.data);
          both.set(changes, last.data.length);
          last.data = both;
        } else this.events.push({ t: 'damage', data: changes.slice() });
      }
      if (emptied.length) edited(emptied.map(([x, y, z]) => [x, y, z, 0]));
      return { removed: v.getUint32(0, true), emptied };
    };
    this.replays = new Replays({ now: () => this.sim.time, push: (e) => this.events.push(e), guard: (fn) => this.guard(fn) });
    const content = new Content();
    content.forward = (def) => {
      const e: HostEvent = { t: 'content', def };
      this.events.push(e);
      this.contentLog.push(e);
    };
    this.sim = new Sim({
      def,
      seed,
      registry,
      world: host,
      content,
      sink: (call) => {
        if (this.state.admit(call)) this.events.push({ t: 'call', call });
      },
      exit: () => this.events.push({ t: 'exit', client: this.acting }),
      cheats: o.cheats ?? false,
      player: o.player,
      room: o.room,
      store,
      replay: this.replays,
      achieve: o.onAchieve,
      grant: o.onGrant,
      error: (err) => this.report(err),
    });
    if (o.dayLength && !def.world?.freezeTime) this.sim.env.dayLength = o.dayLength;
    this.sim.setup();

    // A kept world picks up where it was: its builds (the game's own blocks by name), its time of day.
    const kept = this.keeps ? store.world() : null;
    if (kept?.edits) {
      w.import_edits(remapEdits(kept.edits, kept.blocks ?? undefined, blocks));
      this.sim.env.time = kept.time;
    }

    // Where players start: the game's spawn, or open ground near the generator's pick.
    const me = this.sim.local;
    const { fixed, ...sp } = startSpawn(def, seed, cfg);
    gw.update([sp], CORE, Infinity);
    const ground = fixed ? null : groundSpawn(w, registry, (x, z) => this.sim.surfaceY(x, z), sp.x, sp.z);
    this.sim.spawn = { ...sp, ...ground };
    me.place(this.sim.spawn.x, this.sim.spawn.y, this.sim.spawn.z, sp.yaw);
    if (o.fov) me.cam.fov = o.fov;
    w.set_frozen(me.slot, true);
    this.events.push({ t: 'ready' });
    // One client from the start, or none yet: the first to connect takes the first player's place.
    if (o.remote) this.sim.leave(me.id);
    else this.clients.set(me.id, { player: me, account: null, achieved: [], look: null, owned: [], input: { ...IDLE_INPUT }, radius: this.radius, moves: null, bank: 0 });
  }

  // -----------------------------------------------------------------------------------------------
  // One client driving the clock (tests)
  // -----------------------------------------------------------------------------------------------

  /**
   * Run one command from the only client; a tick answers with everything that happened since
   * the last batch. If the game throws, the error goes to the client as an event and the host
   * carries on (a tick still answers, so the client never waits on it).
   */
  handle(c: ClientCommand): HostBatch | null {
    const me = this.sim.local.id;
    if (c.t !== 'tick') {
      this.command(me, c);
      return null;
    }
    const client = this.clients.get(me);
    if (client) client.input = c.input ?? { ...IDLE_INPUT };
    return this.step(c.dt, c.running).get(me) ?? null;
  }

  // -----------------------------------------------------------------------------------------------
  // Many clients, the host's own clock (a server)
  // -----------------------------------------------------------------------------------------------

  /**
   * A client connects, watching: they get the batch that catches them up (the game's content, the
   * world's edits, what's on everyone's screen) and then every step's, but aren't in the game
   * until their `start` (with a name). With `name`, they join straight away. The id is theirs
   * for `command`, `step`'s batches and `disconnect`.
   */
  connect(name?: string, who?: Who): { id: string; player: string | null; batch: HostBatch } {
    useGameBlocks(this.blocks);
    const client: Client = { player: null, account: who?.account ?? null, achieved: who?.achieved ?? [], look: who?.look ?? null, owned: who?.owned ?? [], input: { ...IDLE_INPUT }, radius: this.radius, moves: null, bank: 0 };
    let id = `c${this.nextClient++}`;
    if (name !== undefined) {
      // Straight in: known by their player's id.
      this.join(id, client, name);
      const joined = this.events.find((e) => e.t === 'joined' && e.client === id);
      if (joined?.t === 'joined') joined.client = id = client.player!.id;
    }
    this.clients.set(id, client);
    // Ready (the game's defaults applied) before what's on screen, which may change them (a skin).
    const w = this.world.world;
    const events: HostEvent[] = [...this.contentLog, { t: 'edits', cells: decodeEdits(w.export_edits()) }];
    // Blocks shot into so far: everything missing from each.
    if (w.damage_count()) events.push({ t: 'damage', data: w.export_damage() });
    events.push({ t: 'ready' }, ...this.flushFor(id));
    for (const call of this.state.snapshot(client.player?.id ?? '')) events.push({ t: 'call', call });
    return { id, player: client.player?.id ?? null, batch: { events, frame: this.sim.frame() } };
  }

  /**
   * A watching client joins the game as a player, named `asked` (a number added if someone here
   * has it), back where they left off if the world is kept.
   */
  private join(id: string, client: Client, typed: string, avatar?: string) {
    const taken = new Set(this.sim.players.filter((p) => !p.vacant).map((p) => p.name));
    // Signed in, they're their account's name, whatever was typed.
    const asked = client.account?.name ?? typed;
    let name = asked || 'Player';
    for (let n = 2; taken.has(name); n++) name = `${asked} ${n}`;
    // Taking the first player's place: a new screen, whatever was shown to the last one there
    // (else a widget up there before gets only changes, and a stat set the same again nothing).
    const local = this.sim.local;
    if (local.vacant) {
      this.state.forget(local.id);
      this.sim.presentation.forget(local.id);
    }
    // Their client learns who it is before anything the game does as they join (`playerJoin`
    // putting a widget up on their screen, a toast): a screen drops calls for a player it
    // doesn't know it is yet.
    const at = this.events.length;
    // Their avatar: their account's, else the one they came with (a guest's).
    const look = { avatar: client.look?.avatar ?? avatar ?? null, wear: client.look?.wear ?? [], owned: client.owned };
    const player = this.sim.join(name, client.account, client.achieved, look);
    const was = this.keeps ? this.keptPlace(player) : null;
    if (was) {
      this.world.update([was], 4, Infinity);
      this.world.world.set_flying(player.slot, was.flying && player.allowFlight);
      player.place(was.x, was.y, was.z, was.yaw, was.pitch);
      if (was.hotbar && player.creative) player.creative.hotbar.splice(0, was.hotbar.length, ...was.hotbar.map((b) => this.hotbarId(b)));
    }
    client.player = player;
    this.events.splice(at, 0, { t: 'joined', player: player.id, client: id });
  }

  /** Events so far that concern only this client (its `joined`), taken out of the queue. */
  private flushFor(id: string): HostEvent[] {
    const mine = this.events.filter((e) => e.t === 'joined' && e.client === id);
    this.events = this.events.filter((e) => !(e.t === 'joined' && e.client === id));
    return mine;
  }

  disconnect(id: string) {
    const c = this.clients.get(id);
    if (!c) return;
    useGameBlocks(this.blocks);
    this.clients.delete(id);
    const p = c.player;
    if (!p) return;
    this.replays.left(p.id);
    this.guard(() => this.keepPlayer(p));
    this.guard(() => this.sim.leave(p.id));
    if (p !== this.sim.local) {
      this.state.forget(p.id);
      this.sim.presentation.forget(p.id);
    }
  }

  /** Whether this game keeps its world (and players' places) across restarts. */
  private get keeps(): boolean {
    return !!this.def.world?.persist;
  }

  /**
   * Where a player left off, in a game that keeps its world: kept for their account (or, their
   * first time since claiming their name, where that name left off). A guest's isn't kept.
   */
  private keptPlace(p: PlayerSim): SavedPlayer | null {
    if (!p.account) return null;
    return this.store.player(placeKey(p.account.id)) ?? (p.adopted ? this.store.player(p.adopted) : null);
  }

  private keepPlayer(p: PlayerSim) {
    if (!this.keeps || p.vacant || !p.account) return;
    const s = p.state;
    // The game's own blocks in the hotbar are kept by name: their ids follow the definitions.
    const first = firstGameBlock();
    const hotbar = p.creative?.hotbar.map((id) => (id >= first ? (this.registry.blocks[id]?.key ?? id) : id));
    const saved: SavedPlayer = { x: s.x, y: s.y, z: s.z, yaw: p.yaw, pitch: p.pitch, flying: s.flying, hotbar };
    this.store.savePlayer(placeKey(p.account.id), saved);
    // Where their name left off (from before accounts) is theirs now: kept by their name no longer.
    if (p.adopted) this.store.forgetPlayer(p.adopted);
  }

  /** A kept hotbar slot's block: an id, or a game block's key (stone if it's no longer defined). */
  private hotbarId(b: number | string): number {
    if (typeof b === 'number') return b;
    try {
      return blockIdOf(this.registry, b);
    } catch {
      return 1;
    }
  }

  /**
   * Save what's kept: the world (its seed always; its edits and time of day if the game keeps its
   * world), everyone connected, and the game's data. A server calls this every so often and when
   * it stops.
   */
  persist() {
    useGameBlocks(this.blocks);
    const w = this.world.world;
    this.store.saveWorld({ game: this.def.id, seed: this.seed, edits: this.keeps ? w.export_edits() : null, blocks: this.blocks.keys, time: this.sim.env.time });
    for (const c of this.clients.values()) if (c.player) this.keepPlayer(c.player);
    this.store.flush();
  }

  /** Who a watching client is, again (their account's name changed before they joined). */
  identify(id: string, who: Who) {
    const c = this.clients.get(id);
    if (!c || c.player) return;
    c.account = who.account;
    if (who.look) c.look = who.look;
  }

  /** How many clients are connected. */
  get connected(): number {
    return this.clients.size;
  }

  /** A command from a client. Its messages act as this client's player, whatever they claim. */
  command(id: string, c: ClientCommand) {
    const client = this.clients.get(id);
    if (!client) return;
    useGameBlocks(this.blocks);
    this.acting = id;
    this.guard(() => this.run(id, client, c));
    this.acting = undefined;
  }

  /**
   * Advance the game `dt` seconds with everyone's controls; each client gets their batch: the
   * calls for everyone and for them, their replies, the rest, and the frame.
   */
  step(dt: number, running = true): Map<string, HostBatch> {
    // (Hosts sharing a thread, a test server's rooms, each run with their own blocks.)
    useGameBlocks(this.blocks);
    const sim = this.sim;
    this.guard(() => {
      // A game that starts by itself (`autoStart`) loads the ground at the spawn first, then starts.
      const waiting = !!this.def.autoStart && !sim.started;
      const points: { x: number; z: number }[] = sim.players.filter((p) => !p.vacant).map((p) => p.state);
      if (waiting) points.push(sim.spawn);
      this.world.update(points, this.radius, this.budget);
      if (waiting && this.world.world.has_column(Math.floor(sim.spawn.x / 16), Math.floor(sim.spawn.z / 16))) sim.start();
      const inputs: Record<string, PlayerInput> = {};
      const premoved = new Set<string>();
      for (const c of this.clients.values()) {
        const p = c.player;
        if (!p) continue;
        inputs[p.id] = c.input;
        if (c.moves) {
          premoved.add(p.id);
          this.moveInputs(c, p, dt);
        }
      }
      sim.tick(dt, running && sim.started, inputs, premoved);
    });
    // Replays whose time is up end (their `onEnd` is the game's code).
    this.replays.update(sim.time);
    // Presses and clicks were used; what's held stays held until the client says otherwise.
    for (const c of this.clients.values()) {
      const i = c.input;
      i.pressed = [];
      i.clicked = 0;
      i.wheel = 0;
      i.mouseX = 0;
      i.mouseY = 0;
      // (A kind this screen runs stays listed, with nothing yet.)
      if (i.acts) for (const k of Object.keys(i.acts)) i.acts[k] = [];
    }
    const events = this.flush();
    const frame = sim.frame();
    this.record(events, frame);
    const out = new Map<string, HostBatch>();
    for (const [id, c] of this.clients) {
      const me = c.player?.id;
      out.set(id, {
        events: events.filter((e) => {
          if (e.t === 'call') return e.call.to === null ? e.call.skip === undefined || e.call.skip !== me : e.call.to === me;
          if (e.t === 'reply' || e.t === 'exit') return !e.client || e.client === id;
          if (e.t === 'joined') return e.client === id;
          if (e.t === 'replay' || e.t === 'replayEnd') return e.player === me;
          return true;
        }),
        frame,
      });
    }
    return out;
  }

  /**
   * This step's frame, rounded and patched once (`frames`), and kept with what was shown in the
   * step for replays. A restart forgets the past (and ends the replays playing).
   */
  private record(events: HostEvent[], frame: SimFrame) {
    this.frames.next(frame);
    if (events.some((e) => e.t === 'call' && e.call.target === 'message' && e.call.method === '$reset')) this.replays.reset();
    const h = this.replays.history;
    if (h.keep > 0) h.record(frame.t, frame.clock, this.frames.current!, this.frames.patch, replayable(events));
  }

  private run(id: string, client: Client, c: ClientCommand) {
    const sim = this.sim;
    // (Watching or playing.)
    if (c.t === 'dev') return this.devCommand(id, client, c);
    // Watching: they can join (`start`) and say how far they see, nothing else yet.
    if (c.t === 'start' && !client.player) this.join(id, client, c.name ?? 'Player', c.avatar);
    if (c.t === 'radius') {
      client.radius = c.columns;
      this.radius = Math.max(...[...this.clients.values()].map((x) => x.radius));
      return;
    }
    const me = client.player;
    if (!me) return;
    switch (c.t) {
      case 'tick':
        return;
      case 'input': {
        // Held state is the newest; presses, clicks, wheel and mouse movement add up until a step.
        const i = client.input;
        const n = c.input;
        i.active = n.active;
        i.dead = n.dead;
        i.down = n.down;
        i.move = n.move;
        i.buttons = n.buttons;
        i.yaw = n.yaw;
        i.pitch = n.pitch;
        i.viewSeq = n.viewSeq;
        for (const k of n.pressed) if (!i.pressed.includes(k)) i.pressed.push(k);
        i.clicked |= n.clicked;
        // Item kits' actions (shots, throws) add up until a step; a client that sends a kind's
        // (even none) runs that kind's own from then on.
        if (n.acts) for (const k of Object.keys(n.acts)) ((i.acts ??= Object.create(null) as Record<string, unknown[][]>)[k] ??= []).push(...n.acts[k]);
        if (n.seen !== undefined) i.seen = n.seen;
        i.wheel += n.wheel;
        i.mouseX += n.mouseX;
        i.mouseY += n.mouseY;
        if (c.seq !== undefined && c.dt !== undefined) (client.moves ??= []).push({ input: n, dt: Math.max(0, Math.min(0.1, c.dt)), seq: c.seq });
        return;
      }
      case 'message':
        // Their screen ended a replay (`client.replay.skip()`).
        if (c.msg.t === 'replaySkip') return this.replays.skip(me.id, c.msg.id);
        sim.receive({ ...c.msg, player: me.id });
        return;
      case 'start':
        sim.play(me);
        return;
      case 'restart':
        sim.restart();
        return;
      case 'env':
        if (c.time !== undefined) sim.env.time = c.time;
        if (c.dayLength !== undefined && !this.def.world?.freezeTime) sim.env.dayLength = c.dayLength;
        return;
      case 'exec':
        this.events.push({ t: 'reply', id: c.id, client: id, value: sim.exec(c.line, me) });
        return;
      case 'complete':
        this.events.push({ t: 'reply', id: c.id, client: id, value: sim.commands.complete(c.line) });
        return;
    }
  }

  /**
   * Move a predicting client's player through their inputs one by one, each for as long as it
   * lasted on the client: the same steps the client took, so its prediction holds. Movement time
   * is earned from the server's clock, so a client that sends too much waits; one that's fallen
   * far behind (a queue over 30) catches up at once rather than lagging for good.
   */
  /**
   * A predicting client's inputs, played at the pace they were made (the server's time, which
   * they can't outrun). They arrive unevenly; played as they land, the player would move in fits
   * and starts on everyone else's screen (none one step, two the next). So time without inputs
   * isn't saved up to spend in a burst: the ones that arrive late queue up instead, and that queue
   * is the cushion for the next late one (a client's first few are held back to start one). While
   * arrivals are steady it's played down a little faster, so the cushion stays small. Steps take
   * whole inputs, so a player's state trails the step by what's left over (see `lead`).
   */
  private moveInputs(c: Client, p: PlayerSim, dt: number) {
    const moves = c.moves!;
    let queued = 0;
    for (const m of moves) queued += m.dt;
    // Start with a cushion (then late arrivals are absorbed from the first).
    if (!c.playing) {
      if (queued < PRIME) return;
      c.playing = true;
    }
    c.bank = Math.min(MAX_BANK, c.bank + dt * (queued > CUSHION + dt ? 1.05 : 1));
    while (moves.length && (moves[0].dt <= c.bank + 1e-6 || moves.length > 30)) {
      const m = moves.shift()!;
      c.bank = Math.max(0, c.bank - m.dt);
      p.input.set(m.input);
      p.move(m.dt);
      p.ack = m.seq;
    }
    if (!moves.length) c.bank = Math.min(c.bank, dt * 0.5);
    // Whole inputs don't fill a step exactly: the time left over is how far their state trails
    // this step's. Other screens draw them that much further on (so steps of one input, then
    // three, still look like steady motion); their own screen predicts, and needs it as it is.
    p.lead = c.bank;
    p.aheadVehicle(c.bank);
  }

  /**
   * A development tool's snippet (`__game.dev(js)`): run as a function body (or, if it's one, an
   * expression) with `game` and `me` (the client's player, null while watching), and answer with
   * its result as JSON (awaited, if it's a promise), or the error. Only in development mode, and
   * never in a production build.
   */
  private devCommand(id: string, client: Client, c: { id: number; js: string }) {
    const reply = (value: DevReply) => this.events.push({ t: 'reply', id: c.id, client: id, value });
    if (!this.dev || !import.meta.env.DEV) return reply({ ok: false, error: 'refused: development commands need a development server (npm run dev)' });
    const failed = (err: unknown) => reply({ ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    let result: unknown;
    try {
      let run: (game: unknown, me: unknown) => unknown;
      try {
        run = new Function('game', 'me', `return (${c.js}\n);`) as typeof run;
      } catch {
        run = new Function('game', 'me', c.js) as typeof run;
      }
      useGameBlocks(this.blocks);
      result = run(this.sim.ctx, client.player?.api ?? null);
    } catch (err) {
      return failed(err);
    }
    if (result instanceof Promise) result.then((v: unknown) => reply({ ok: true, value: plainJson(v) }), failed);
    else reply({ ok: true, value: plainJson(result) });
  }

  /** Run game code; if it throws, the clients hear about it and the host carries on. */
  private guard(fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.report(err);
    }
  }

  private report(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (this.onError) {
      this.onError(err);
      this.events.push({ t: 'error', text: message });
    } else {
      this.events.push({ t: 'error', text: err instanceof Error ? `${message}\n${err.stack ?? ''}` : message });
    }
  }

  /** Done with this game: give the engine its memory back. The host can't be used after. */
  dispose() {
    this.world.dispose();
  }

  /** The events since the last batch (and forget them). */
  flush(): HostEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

/**
 * A value as JSON has it (what a `dev` reply can carry): functions dropped, an object met again
 * (a loop) as '[repeated]', `undefined` as null, numbers JSON can't hold as text.
 */
function plainJson(v: unknown): unknown {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(v, (_k, x: unknown) => {
    if (typeof x === 'bigint') return String(x);
    if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
    if (x instanceof Map) return Object.fromEntries(x);
    if (x instanceof Set) return [...x];
    if (typeof x === 'object' && x !== null) {
      if (seen.has(x)) return '[repeated]';
      seen.add(x);
    }
    return x;
  });
  return text === undefined ? null : JSON.parse(text);
}

/** The engine's exported edits ([cx, cz, count, (local, block)*]…) as cells. */
function decodeEdits(data: Uint8Array): [number, number, number, number][] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cells: [number, number, number, number][] = [];
  let o = 0;
  while (o + 12 <= data.byteLength) {
    const cx = v.getInt32(o, true);
    const cz = v.getInt32(o + 4, true);
    const n = v.getUint32(o + 8, true);
    o += 12;
    for (let i = 0; i < n; i++, o += 5) {
      const local = v.getUint32(o, true);
      cells.push([cx * 16 + (local & 15), local >> 8, cz * 16 + ((local >> 4) & 15), data[o + 4]]);
    }
  }
  return cells;
}

/** Where an account's place is kept among the players (by name before accounts: `#` keeps them apart). */
const placeKey = (account: string) => `#${account}`;
