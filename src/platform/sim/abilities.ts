import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AbilityBody, AbilityControls, AbilityStance, AbilityTriggerOptions, ClipOptions, MovementAbility, Vec3, VehicleWorld } from '../api/types';
import { quantize } from '../net/delta';
import type { MoveControls, MoveMemory } from './movement';

/** Each movement ability's state for one player, by name: plain data. */
export type AbilityStates = Record<string, object>;

/** A game's abilities in the order it gave them (the order they step in). */
export type Abilities = [string, MovementAbility][];

/** The states, with a fresh copy of its starting state for any ability that hasn't one yet. */
export function statesFor(states: AbilityStates | undefined, abilities: Abilities): AbilityStates {
  const out = states ?? {};
  for (const [name, def] of abilities) if (!(name in out)) out[name] = structuredClone(def.state);
  return out;
}

/** Plain data's numbers rounded as a frame rounds them (`quantize`), in place. */
function roundInPlace(v: Record<string, unknown> | unknown[]) {
  const o = v as Record<string, unknown>;
  for (const k in o) {
    const x = o[k];
    if (typeof x === 'number') o[k] = quantize(x);
    else if (typeof x === 'object' && x !== null && !ArrayBuffer.isView(x)) roundInPlace(x as Record<string, unknown>);
  }
}

/**
 * Movement's memory rounded to what a frame carries (4 decimals), as each step begins, on the host
 * and in prediction alike. A predicting client starts again from the host's memory as a frame
 * brought it, so each step must start from exactly what the host's did: otherwise a timer rounded
 * on the way (a dash's, a cooldown) runs out a step later on one side than the other, and the body
 * goes differently. (Only for games with abilities: the platform's own movement is as it always was.)
 */
export function roundMemory(m: MoveMemory) {
  roundInPlace(m as unknown as Record<string, unknown>);
}

/** A clip an ability asked their figure to play (`trigger(name, { clip })`). */
export interface AbilityClip {
  name: string;
  opts: ClipOptions;
}

/** What an ability `trigger`ed: [ability, name], and the clip it asked for, if any. */
export type AbilityEvent = [string, string, AbilityClip?];

/** The camera an ability asked for this step, on the player's own screen: [roll, pitch, dip]. */
export type AbilityCamera = [number, number, number];

/** What one step of the abilities hands on to the body's step. */
export interface AbilityResult {
  wx: number;
  wz: number;
  jump: boolean;
  gravity: number;
  control: number;
  speed: number;
  /** How low the body is this step (the platform's, or what an ability made it). */
  stance: AbilityStance;
  /** How far the head leans out sideways (blocks, positive right; 0: upright). */
  lean: number;
  /** Their camera's tilt, pitch and dip this step (null: none). */
  camera: AbilityCamera | null;
  /** What they `trigger`ed. */
  events: AbilityEvent[];
}

/** What the platform's movement made of this step's controls, before the abilities have their say. */
export interface StepStart {
  yaw: number;
  pitch: number;
  wx: number;
  wz: number;
  jump: boolean;
  crouching: boolean;
  sprinting: boolean;
  sliding: boolean;
  speed: number;
}

/** The furthest a head leans out sideways (`AbilityBody.lean`), in blocks. */
export const MAX_LEAN = 0.6;

/** A number an ability gave, or `or` if it gave nonsense (NaN would poison the body for good). */
const finite = (v: number | undefined, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

/**
 * The controls as the abilities read them this step: idle while the controls aren't active, and
 * anything an ability `consume`s reads as idle for the ones after it.
 */
class StepControls implements AbilityControls {
  private keys: Set<string> | null = null;
  private buttons = 0;

  constructor(private c: MoveControls) {}

  isDown(code: string) {
    return this.c.active && !this.keys?.has(code) && this.c.isDown(code);
  }
  pressed(code: string) {
    return this.c.active && !this.keys?.has(code) && this.c.pressed(code);
  }
  button(b: number) {
    return this.c.active && (this.buttons & (1 << b)) === 0 && this.c.button(b);
  }
  buttonPressed(b: number) {
    return this.c.active && (this.buttons & (1 << b)) === 0 && this.c.buttonPressed(b);
  }
  consume(what: number | string) {
    if (typeof what === 'number') this.buttons |= 1 << what;
    else (this.keys ??= new Set()).add(what);
  }
  get mouseX() {
    return this.c.active ? this.c.mouseX : 0;
  }
  get mouseY() {
    return this.c.active ? this.c.mouseY : 0;
  }
  get wheel() {
    return this.c.active ? this.c.wheel : 0;
  }
}

/**
 * A player's body as the abilities see it and change it: its state read from the engine, velocity
 * and position changes made there at once (so the next ability sees them), and this step's wish,
 * jump, gravity, control and speed, handed on to the body's step.
 */
class StepBody implements AbilityBody {
  wish: { x: number; z: number };
  jump: boolean;
  gravity = 1;
  control = 1;
  speed: number;
  stance: AbilityStance;
  lean = 0;
  camera = { roll: 0, pitch: 0, dip: 0 };
  readonly yaw: number;
  readonly pitch: number;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  /** The ability stepping now (what it triggers is its). */
  current = '';
  readonly events: AbilityEvent[] = [];
  private st: ArrayLike<number>;

  constructor(
    private world: VoxelWorld,
    private slot: number,
    readonly time: number,
    s: StepStart,
  ) {
    this.st = world.player_state(slot);
    this.wish = { x: s.wx, z: s.wz };
    this.jump = s.jump;
    this.speed = s.speed;
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.crouching = s.crouching;
    this.sprinting = s.sprinting;
    this.sliding = s.sliding;
    this.stance = s.sliding ? 'low' : s.crouching ? 'crouch' : 'stand';
  }

  get frozen() {
    return this.st[12] > 0.5;
  }
  get position(): Vec3 {
    return { x: this.st[0], y: this.st[1], z: this.st[2] };
  }
  get velocity(): Vec3 {
    return { x: this.st[3], y: this.st[4], z: this.st[5] };
  }
  get onGround() {
    return this.st[6] > 0.5;
  }
  get inWater() {
    return this.st[7] > 0.5;
  }
  get flying() {
    return this.st[10] > 0.5;
  }
  get look(): Vec3 {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  setVelocity(v: Partial<Vec3>) {
    const s = this.st;
    this.addVelocity({ x: finite(v.x, s[3]) - s[3], y: finite(v.y, s[4]) - s[4], z: finite(v.z, s[5]) - s[5] });
  }

  addVelocity(v: Partial<Vec3>) {
    const x = finite(v.x, 0);
    const y = finite(v.y, 0);
    const z = finite(v.z, 0);
    if (x === 0 && y === 0 && z === 0) return;
    this.world.player_impulse(this.slot, x, y, z);
    this.st = this.world.player_state(this.slot);
  }

  setPosition(p: Vec3) {
    const s = Float64Array.from(this.st);
    s[0] = finite(p.x, s[0]);
    s[1] = finite(p.y, s[1]);
    s[2] = finite(p.z, s[2]);
    // Off whatever prop they rode: the next step finds what they stand on now.
    s[13] = 0;
    this.world.player_restore(this.slot, s);
    this.st = this.world.player_state(this.slot);
  }

  fits(p: Vec3) {
    return this.world.player_fits(p.x, p.y, p.z);
  }

  trigger(name: string, opts?: AbilityTriggerOptions) {
    const clip = typeof opts?.clip === 'string' && opts.clip ? opts.clip : null;
    if (!clip) return void this.events.push([this.current, String(name)]);
    const { clip: _clip, ...o } = opts!;
    this.events.push([this.current, String(name), { name: clip, opts: o }]);
  }
}

const IDLE: AbilityResult['events'] = [];
const STANCES: readonly AbilityStance[] = ['stand', 'crouch', 'low'];

/**
 * One step of a player's movement abilities, in order, on this side (host or prediction): each
 * reads the controls and the body, changes its own state and the body's step. They rest while the
 * body is frozen (dead, a countdown). Returns what the body's step should do.
 */
export function stepAbilities(
  world: VoxelWorld,
  slot: number,
  c: MoveControls,
  abilities: Abilities,
  states: AbilityStates,
  time: number,
  dt: number,
  s: StepStart,
  query: VehicleWorld,
): AbilityResult {
  const body = new StepBody(world, slot, time, s);
  if (!body.frozen) {
    const controls = new StepControls(c);
    for (const [name, def] of abilities) {
      body.current = name;
      def.step(states[name], controls, body, dt, query);
    }
  }
  let wx = finite(body.wish?.x, 0);
  let wz = finite(body.wish?.z, 0);
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  // The camera an ability asked for, kept within reason (a quarter turn, two blocks).
  const cam = body.camera;
  const roll = Math.max(-1.6, Math.min(1.6, finite(cam?.roll, 0)));
  const pitch = Math.max(-1.6, Math.min(1.6, finite(cam?.pitch, 0)));
  const dip = Math.max(-2, Math.min(2, finite(cam?.dip, 0)));
  return {
    wx,
    wz,
    jump: !!body.jump,
    gravity: finite(body.gravity, 1),
    control: Math.max(0, finite(body.control, 1)),
    speed: Math.max(0, finite(body.speed, s.speed)),
    stance: STANCES.includes(body.stance) ? body.stance : s.sliding ? 'low' : s.crouching ? 'crouch' : 'stand',
    lean: Math.max(-MAX_LEAN, Math.min(MAX_LEAN, finite(body.lean, 0))),
    camera: roll || pitch || dip ? [roll, pitch, dip] : null,
    events: body.events.length ? body.events : IDLE,
  };
}
