import type { AbilityBody, AbilityControls, MovementAbility } from '@platform';
import { FLOOR, RIM_HEIGHT, rim, type Side } from './court';

/**
 * How a baller moves, a movement ability (pure: it runs on the server and, predicted, on the
 * player's own screen, so it answers the moment a key goes down). The game sets what it needs to
 * know in the state (which basket they attack, whether they have the ball, on fire, knocked down)
 * and hears what they did (`trigger`): a jump shot, its release, a dunk and its slam, a leap.
 *
 * - **Steering is the screen's**, not the view's: the camera watches from the near sideline, so W
 *   is up the screen (away from it, -z), D to the right (+x), whichever way they face.
 * - **Turbo** (sprint, Shift) runs faster while the meter lasts; it fills again off it. On fire,
 *   it never runs out.
 * - **Shoot** (Space, or the left button) on the ground with the ball jumps for a shot, released
 *   by letting go (best at the top); with turbo held near the basket it's a dunk: a flight to the
 *   rim, a slam, a moment hanging on it. Without the ball it's a leap (to block, to rebound),
 *   higher with turbo.
 * - **Knocked down** (`stun`): flat, then up again; no controls meanwhile.
 */

/** Speeds (blocks a second) and heights (blocks). */
export const RUN = 6.4;
export const TURBO = 9.6;
const SHOT_JUMP = 1.05;
const LEAP = 1.45;
const TURBO_LEAP = 2.05;
/** Gravity the movement uses (the shared definition's): the jumps' speeds come from it. */
export const BODY_GRAVITY = 30;
/** How far out a dunk can start (blocks from the rim, on the floor), with turbo; on fire, further. */
export const DUNK_RANGE = 6.2;
export const FIRE_DUNK_RANGE = 9;
/** How long turbo lasts from full, and refills from empty (seconds). */
const TURBO_DRAIN = 3.2;
const TURBO_FILL = 4.5;
/** How long a dunker hangs on the rim (seconds). */
export const HANG = 0.32;
/** How many dunk styles there are (the screens pose each: see `client/poses.ts`). */
export const DUNK_STYLES = 7;

/** The state: what the game tells the move (and reads back), plain numbers and flags. */
export interface JamState {
  /** The basket they attack (+1 right, -1 left). Set by the game. */
  side: number;
  /** They have the ball (the game's: 1 or 0). */
  ball: number;
  /** On fire (unlimited turbo, further dunks). The game's. */
  fire: number;
  /** Running speed, times the usual (the game's: a bot's level slows it; people always 1). */
  pace: number;
  /** Turbo left, 0..1. */
  turbo: number;
  /**
   * In the air: 0 not, 1 a jump shot, 2 a leap, 3 a dunk's flight, 4 hanging on the rim, 5 dropping
   * from it. `t`: seconds into it.
   */
  air: number;
  t: number;
  /** A jump shot's release (1 once let go) and when (its `t`). */
  released: number;
  relT: number;
  /** A dunk: where it flew from and to, how long it takes, how high it arcs over the line, its style. */
  fx: number;
  fy: number;
  fz: number;
  tx: number;
  ty: number;
  tz: number;
  dur: number;
  lift: number;
  style: number;
  /** Knocked down: seconds left on the floor; the push it came with (once, `kick`). */
  stun: number;
  kx: number;
  kz: number;
  kick: number;
  /** Shoot was held last step (so a press is a press). */
  held: number;
}

export const JAM_STATE: JamState = {
  side: 1,
  ball: 0,
  fire: 0,
  pace: 1,
  turbo: 1,
  air: 0,
  t: 0,
  released: 0,
  relT: 0,
  fx: 0,
  fy: 0,
  fz: 0,
  tx: 0,
  ty: 0,
  tz: 0,
  dur: 0,
  lift: 0,
  style: 0,
  stun: 0,
  kx: 0,
  kz: 0,
  kick: 0,
  held: 0,
};

/** Jump speed for a height. */
const jumpSpeed = (h: number) => Math.sqrt(2 * BODY_GRAVITY * h);

/** When a jump shot of this height is at its top (seconds after leaving the floor). */
export const SHOT_APEX = jumpSpeed(SHOT_JUMP) / BODY_GRAVITY;

/** Shoot is held: Space, or the left mouse button (a controller's RT, a touch screen's shoot button). */
export const shootDown = (c: AbilityControls) => c.isDown('Space') || c.button(0);

/** Where a dunk lands them: in front of the rim, toward where they came from, feet well up. */
export function dunkTarget(side: Side, fromX: number, fromZ: number) {
  const r = rim(side);
  const dx = fromX - r.x;
  const dz = fromZ - r.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: r.x + (dx / d) * 0.5, y: FLOOR + RIM_HEIGHT - 1.7, z: r.z + (dz / d) * 0.5 };
}

/** A dunk's path at `u` (0..1): along the line, lifted in an arc, its top `lift` over the line. */
export function dunkPath(s: JamState, u: number) {
  const k = Math.min(1, Math.max(0, u));
  // Eased: a burst off the floor, slowing into the rim.
  const e = 1 - (1 - k) * (1 - k) * (1 - 0.35 * k);
  const up = s.lift * 4 * k * (1 - k);
  return { x: s.fx + (s.tx - s.fx) * e, y: s.fy + (s.ty - s.fy) * e + up, z: s.fz + (s.tz - s.fz) * e };
}

export const jam: MovementAbility<JamState> = {
  state: JAM_STATE,
  step(s, c, body, dt) {
    const side = (s.side >= 0 ? 1 : -1) as Side;
    // Space never jumps by itself: the jumps are this move's.
    body.jump = false;
    const shoot = shootDown(c);
    const pressed = shoot && !s.held;
    s.held = shoot ? 1 : 0;

    // Steering, the screen's way (keys and the stick both press WASD).
    const right = (c.isDown('KeyD') ? 1 : 0) - (c.isDown('KeyA') ? 1 : 0);
    const down = (c.isDown('KeyS') ? 1 : 0) - (c.isDown('KeyW') ? 1 : 0);
    const len = Math.hypot(right, down);
    body.wish = len > 0 ? { x: right / len, z: down / len } : { x: 0, z: 0 };

    // Turbo: faster while it lasts, filling again off it.
    const turbo = c.isDown('ShiftLeft') || c.isDown('ShiftRight');
    if (s.fire) s.turbo = 1;
    const boosting = turbo && s.turbo > 0 && len > 0 && s.stun <= 0;
    if (boosting && !s.fire) s.turbo = Math.max(0, s.turbo - dt / TURBO_DRAIN);
    else if (!turbo) s.turbo = Math.min(1, s.turbo + dt / TURBO_FILL);
    body.speed = ((boosting ? TURBO : RUN) / RUN) * (s.pace || 1);

    // Knocked down: flat on the floor, pushed along at first, no controls.
    if (s.stun > 0) {
      s.stun = Math.max(0, s.stun - dt);
      body.stance = 'low';
      body.wish = { x: 0, z: 0 };
      if (s.kick) {
        s.kick = 0;
        body.setVelocity({ x: s.kx, y: 3.5, z: s.kz });
        body.trigger('down');
      }
      body.control = body.onGround ? 0.25 : 0;
      if (s.air) s.air = 0;
      return;
    }

    switch (s.air) {
      case 0: {
        if (!pressed || !body.onGround) break;
        const p = body.position;
        const r = rim(side);
        const dist = Math.hypot(p.x - r.x, p.z - r.z);
        const range = s.fire ? FIRE_DUNK_RANGE : DUNK_RANGE;
        if (s.ball && turbo && (s.turbo > 0.05 || s.fire) && dist <= range && dist > 0.6) {
          // A dunk: off the floor toward the rim, a flight as long as it's far.
          const to = dunkTarget(side, p.x, p.z);
          Object.assign(s, { air: 3, t: 0, fx: p.x, fy: p.y, fz: p.z, tx: to.x, ty: to.y, tz: to.z });
          s.dur = 0.5 + dist * 0.075;
          s.lift = 0.6 + dist * 0.13;
          s.style = Math.floor(Math.abs(body.time) * 997 + dist * 31) % DUNK_STYLES;
          if (!s.fire) s.turbo = Math.max(0, s.turbo - 0.18);
          body.trigger('dunk');
        } else if (s.ball) {
          Object.assign(s, { air: 1, t: 0, released: 0, relT: 0 });
          body.setVelocity({ y: jumpSpeed(SHOT_JUMP) });
          body.trigger('jumpshot');
        } else {
          Object.assign(s, { air: 2, t: 0 });
          const boost = turbo && (s.turbo > 0.05 || s.fire);
          if (boost && !s.fire) s.turbo = Math.max(0, s.turbo - 0.12);
          body.setVelocity({ y: jumpSpeed(boost ? TURBO_LEAP : LEAP) });
          body.trigger('leap');
        }
        break;
      }
      case 1: {
        // A jump shot: let go to shoot (or it goes as they land). They drift a little.
        s.t += dt;
        body.control = 0.25;
        body.speed *= 0.6;
        if (!s.released && (!shoot || (s.t > 0.12 && body.onGround))) {
          s.released = 1;
          s.relT = s.t;
          body.trigger('release');
        }
        if (s.t > 0.1 && body.onGround) s.air = 0;
        break;
      }
      case 2: {
        s.t += dt;
        body.control = 0.35;
        if (s.t > 0.1 && body.onGround) s.air = 0;
        break;
      }
      case 3: {
        // The flight: following the path exactly (no gravity, no steering), into the rim.
        s.t += dt;
        const u = s.t / s.dur;
        const at = dunkPath(s, Math.min(1, u));
        const p = body.position;
        body.gravity = 0;
        body.control = 0;
        body.setVelocity({ x: (at.x - p.x) / dt, y: (at.y - p.y) / dt, z: (at.z - p.z) / dt });
        if (u >= 1) {
          s.air = 4;
          s.t = 0;
          body.trigger('slam');
        }
        break;
      }
      case 4: {
        // Hanging on the rim.
        s.t += dt;
        body.gravity = 0;
        body.control = 0;
        const p = body.position;
        body.setVelocity({ x: (s.tx - p.x) / dt, y: (s.ty - p.y) / dt, z: (s.tz - p.z) / dt });
        if (s.t >= HANG) {
          s.air = 5;
          s.t = 0;
          // Off it, dropping back a little from the basket.
          const back = s.tx > 0 ? -1 : 1;
          body.setVelocity({ x: back * 1.4, y: 0, z: 0 });
        }
        break;
      }
      case 5: {
        s.t += dt;
        body.control = 0.2;
        if (body.onGround) s.air = 0;
        break;
      }
      default:
        s.air = 0;
    }
  },
};

/** The gap between a jump shot's release and the top of its jump (seconds; 0 is perfect). */
export function releaseError(s: Pick<JamState, 'relT'>): number {
  return s.relT - SHOT_APEX;
}

/** Plain body type the ability step uses (kept here for the tests). */
export type JamBody = AbilityBody;
