import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { VehicleWorld } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import type { AbilityCamera, AbilityClip } from '../sim/abilities';
import { copyMemory, DEFAULT_TUNE, freshMemory, NO_MODS, stepMovement, type MoveControls, type MoveMemory, type MoveMods, type MoveResult, type MoveTune } from '../sim/movement';
import type { PlayerFrame } from '../sim/player';

/** A `PlayerInput` read the way movement reads controls (as the host's `SimInput` reads it: idle while inactive). */
class Controls implements MoveControls {
  constructor(private i: PlayerInput) {}
  get active() {
    return this.i.active;
  }
  get move() {
    return this.i.active ? (this.i.move ?? null) : null;
  }
  isDown(code: string) {
    return this.i.active && this.i.down.includes(code);
  }
  pressed(code: string) {
    return this.i.active && this.i.pressed.includes(code);
  }
  button(b: number) {
    return this.i.active && (this.i.buttons & (1 << b)) !== 0;
  }
  buttonPressed(b: number) {
    return this.i.active && (this.i.clicked & (1 << b)) !== 0;
  }
  get mouseX() {
    return this.i.active ? this.i.mouseX : 0;
  }
  get mouseY() {
    return this.i.active ? this.i.mouseY : 0;
  }
  get wheel() {
    return this.i.active ? this.i.wheel : 0;
  }
}

/** Where this client shows its own player: predicted, with any correction easing away. */
export interface Predicted {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
  eyesInWater: boolean;
  inLava: boolean;
  flying: boolean;
  bob: number;
  sneaking: boolean;
  sprinting: boolean;
  sliding: boolean;
  /** How far their head leans out sideways (`PlayerFrame.lean`). */
  lean: number;
  /** On a solid prop: which, and where their feet are on it (show them where it's drawn). */
  ride: { prop: number; p: [number, number, number] } | null;
}

/**
 * Client-side prediction of this client's own player on a game server. Each frame's controls
 * move a body in this client's copy of the world at once, with the same step the server will
 * take (`stepMovement`), and go to the server numbered. When the server's frame says which input
 * it applied last, the body starts again from the server's state and replays the rest: the
 * same code on the same blocks, so it lands where it was, and any difference (a knockback, a
 * teleport, a block someone placed) is eased in over a few frames.
 */
export class Predictor {
  private slot: number;
  private pending: { seq: number; input: PlayerInput; dt: number }[] = [];
  private memory: MoveMemory = freshMemory();
  private ready = false;
  private allowFlight = false;
  private sneak = false;
  private sprint = false;
  private slide = false;
  private lean = 0;
  /**
   * Shown minus predicted, fading: corrections ease in instead of snapping. Riding a prop, it's
   * on the prop (`errorRide`), since the prop moves on between the server's frames.
   */
  private error = [0, 0, 0];
  private errorRide = 0;
  /** How far the last server frame moved the prediction (blocks): ~0 when prediction holds. */
  lastCorrection = 0;
  /** The camera their movement abilities ask for now ([roll, pitch, dip], `AbilityBody.camera`). */
  tilt: AbilityCamera | null = null;
  /** Clips their abilities asked their figure to play, on new inputs (not replays), until taken. */
  private clips: AbilityClip[] = [];

  constructor(
    private world: VoxelWorld,
    /** The game's movement (`player.movement`), as the server moves them. */
    private tune: MoveTune = DEFAULT_TUNE,
    /** What their held item and buttons do to their movement for an input (a gun's weight, aiming). */
    private mods: (input: PlayerInput) => MoveMods = () => NO_MODS,
    /** This client's copy of the world, as the game's movement abilities ask about it (as on the host). */
    private query: VehicleWorld | null = null,
  ) {
    this.slot = world.player_add(0, 300, 0);
    world.set_frozen(this.slot, true);
    world.player_tune(this.slot, new Float64Array(tune.params));
  }

  /** This frame's controls (numbered `seq` for the server): move now. */
  step(input: PlayerInput, dt: number, seq: number) {
    const d = Math.max(0, Math.min(0.1, dt));
    this.pending.push({ seq, input, dt: d });
    if (this.pending.length > 120) this.pending.shift();
    if (this.ready) {
      // (A clip an ability starts plays at once here; replays of this input start nothing again.)
      const r = this.run(input, d);
      for (const [, , clip] of r.events) if (clip) this.clips.push(clip);
      if (this.clips.length > 4) this.clips.shift();
    }
    const k = Math.exp(-dt * 12);
    for (let i = 0; i < 3; i++) this.error[i] *= k;
  }

  /**
   * The server's newest word on this player: start from it and replay what it hasn't applied.
   * (A predicting client's solid props are where the same frame has them: `ClientMovers.sync`.)
   */
  reconcile(me: PlayerFrame) {
    // Where the player is shown now, to keep showing them there while the difference fades.
    const p = this.raw();
    const shown = this.ready && p.ride === this.errorRide ? [p.v[0] + this.error[0], p.v[1] + this.error[1], p.v[2] + this.error[2]] : null;
    const ride = me.ride ? [me.ride.prop, ...me.ride.p] : [0, 0, 0, 0];
    // A spectator flies through anything here as on the host (set first: the restore's speed stands).
    this.world.set_ghost(this.slot, !!me.spectating);
    this.world.player_restore(this.slot, new Float64Array([me.x, me.y, me.z, me.vx, me.vy, me.vz, +me.onGround, +me.inWater, +me.eyesInWater, +me.inLava, +me.flying, me.bob, +me.frozen, ...ride]));
    this.memory = copyMemory(me.move);
    this.allowFlight = me.canFly;
    this.sneak = me.sneaking;
    this.sprint = me.sprinting;
    this.slide = me.sliding;
    this.lean = me.lean ?? 0;
    while (this.pending.length && this.pending[0].seq <= me.ack) this.pending.shift();
    for (const m of this.pending) this.run(m.input, m.dt);
    this.ready = true;
    const q = this.raw();
    this.errorRide = q.ride;
    // Stepping on or off a prop (on this side or the server's): taken at once.
    if (!shown || p.ride !== q.ride) {
      this.error = [0, 0, 0];
      return;
    }
    this.lastCorrection = Math.hypot(p.v[0] - q.v[0], p.v[1] - q.v[1], p.v[2] - q.v[2]);
    const e = [shown[0] - q.v[0], shown[1] - q.v[1], shown[2] - q.v[2]];
    // A small miss eases in; a jump (teleport, respawn) is taken at once.
    this.error = Math.hypot(e[0], e[1], e[2]) < 2 ? e : [0, 0, 0];
  }

  /** Their movement abilities' states as predicted now (after the newest input), for the HUD. */
  get abilities(): MoveMemory['abilities'] | null {
    return this.ready ? (this.memory.abilities ?? null) : null;
  }

  /** The player as this client should show them now; null until the server has spoken. */
  shown(): Predicted | null {
    if (!this.ready) return null;
    const s = this.world.player_state(this.slot);
    const ride = s[13] || 0;
    if (ride !== this.errorRide) {
      this.error = [0, 0, 0];
      this.errorRide = ride;
    }
    const e = this.error;
    const world = ride ? [0, 0, 0] : e;
    return {
      x: s[0] + world[0],
      y: s[1] + world[1],
      z: s[2] + world[2],
      vx: s[3],
      vy: s[4],
      vz: s[5],
      onGround: s[6] > 0.5,
      inWater: s[7] > 0.5,
      eyesInWater: s[8] > 0.5,
      inLava: s[9] > 0.5,
      flying: s[10] > 0.5,
      bob: s[11],
      sneaking: this.sneak,
      sprinting: this.sprint,
      sliding: this.slide,
      lean: this.lean,
      ride: ride ? { prop: ride, p: [s[14] + e[0], s[15] + e[1], s[16] + e[2]] } : null,
    };
  }

  /** Where the body is: on the prop it rides, or in the world. */
  private raw(): { ride: number; v: [number, number, number] } {
    const s = this.world.player_state(this.slot);
    return s[13] ? { ride: s[13], v: [s[14], s[15], s[16]] } : { ride: 0, v: [s[0], s[1], s[2]] };
  }

  /** The clips their abilities started since the last call (for their own figure, at once). */
  takeClips(): AbilityClip[] {
    return this.clips.length ? this.clips.splice(0) : NO_CLIPS;
  }

  private run(input: PlayerInput, dt: number): MoveResult {
    // (What abilities trigger here isn't heard by the game: the host's steps are, once each.)
    const r = stepMovement(this.world, this.slot, new Controls(input), input.yaw, this.allowFlight, this.memory, dt, this.tune, this.mods(input), input.pitch, this.query);
    this.sneak = r.sneak;
    this.slide = r.slide;
    this.lean = r.lean;
    this.tilt = r.camera;
    const s = this.world.player_state(this.slot);
    this.sprint = r.sprint && Math.hypot(s[3], s[5]) > Math.min(4.5, this.tune.params[0] * 1.02);
    return r;
  }
}

const NO_CLIPS: AbilityClip[] = [];
