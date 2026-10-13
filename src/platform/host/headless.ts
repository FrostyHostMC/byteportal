import type { GameContext, GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import type { ClientMessage, HostBatch, PlayerInput, PresentCall } from '../net/protocol';
import type { PlayerSim } from '../sim/player';
import type { Sim } from '../sim/sim';
import { GameHost, type GeneratedWorld } from './game';

export interface HeadlessOptions {
  /** The engine's compiled `.wasm` (engine/pkg/voxel_engine_bg.wasm). */
  wasm: BufferSource;
  seed?: number;
  /** Columns kept generated around each player (default 4: a 144 × 144 block square). */
  radius?: number;
  /** Chat commands like `/give` (default on). */
  cheats?: boolean;
  /** Which room it plays as (`game.room`): 'public' (the default), or a private room's code. */
  room?: string;
  /**
   * Put every batch through the socket encoding (JSON, typed arrays as base64), the strictest way
   * to a client: a definition, call or frame that can't cross fails or shows here, in Node.
   */
  wire?: boolean;
}

/** What drives the local player each tick: any part of `PlayerInput` (keys held, clicks, view). */
export type Pilot = (h: Headless) => Partial<PlayerInput> | null;

/**
 * A game with no browser: a `GameHost` with no client, stepped as fast as the CPU allows. A pilot
 * plays; everything the host sends is kept (`calls`, `batches`) for the test to look at.
 */
export class Headless {
  readonly host: GameHost;
  /** Every presentation call so far, in order (banners, screens, sounds…). */
  readonly calls: PresentCall[] = [];
  /** Simulated seconds since `start`. */
  time = 0;
  /** The game called `exit()`. */
  exited = false;
  private wire: boolean;

  constructor(def: GameDefinition, o: HeadlessOptions) {
    this.host = new GameHost(def, { engine: o.wasm, seed: o.seed ?? 1, radius: o.radius ?? 4, budget: Infinity, cheats: o.cheats ?? true, room: o.room });
    this.wire = o.wire ?? false;
  }

  get sim(): Sim {
    return this.host.sim;
  }

  get world(): GeneratedWorld {
    return this.host.world;
  }

  get ctx(): GameContext {
    return this.host.sim.ctx;
  }

  get me(): PlayerSim {
    return this.host.sim.local;
  }

  /** Play begins (the browser's click on the title screen). */
  start() {
    this.host.handle({ t: 'start' });
  }

  /** One tick. `input` is the local player's controls (idle when absent). */
  step(dt: number, input?: Partial<PlayerInput> | null): HostBatch {
    const me = this.me;
    const full: PlayerInput | undefined = input
      ? { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: me.yaw, pitch: me.pitch, viewSeq: me.viewSeq, ...input }
      : undefined;
    let b = this.host.handle({ t: 'tick', dt, running: true, input: full })!;
    if (this.wire) b = decode<HostBatch>(encode(b));
    for (const e of b.events) {
      if (e.t === 'call') this.calls.push(e.call);
      else if (e.t === 'exit') this.exited = true;
      else if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
    }
    this.time += dt;
    return b;
  }

  /**
   * Run for up to `seconds` of game time at `dt` per tick with `pilot` at the controls, stopping
   * early when `until` says so. Returns the simulated seconds that passed.
   */
  run(seconds: number, opts: { pilot?: Pilot; until?: (h: Headless) => boolean; dt?: number } = {}): number {
    const dt = opts.dt ?? 1 / 60;
    const t0 = this.time;
    while (this.time - t0 < seconds) {
      this.step(dt, opts.pilot?.(this));
      if (opts.until?.(this)) break;
    }
    return this.time - t0;
  }

  /** Something the player did on their client (a menu entry, a button). */
  send(m: ClientMessage) {
    this.host.handle({ t: 'message', msg: m });
  }

  /** The calls to one `target.method` so far, newest last. */
  find(target: PresentCall['target'], method: string): PresentCall[] {
    return this.calls.filter((c) => c.target === target && c.method === method);
  }
}
