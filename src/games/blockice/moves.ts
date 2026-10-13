import type { AbilityControls, MovementAbility } from '@platform';
import { BODY, keepIn } from './rink';

/**
 * How a skater moves, a movement ability (pure: it runs on the server and, predicted, on the
 * player's own screen, so it answers the moment a key goes down). The game sets what it needs to
 * know in the state (which goal they attack, whether they have the puck, on fire, knocked down, a
 * goalie's spot) and hears what they did (`trigger`): a shot let go, a check thrown, a stop.
 *
 * - **Steering is the screen's**, not the view's: the camera watches from the near side, so W is
 *   up the screen (away from it, -z), D to the right (+x), whichever way they face.
 * - **Skating** is ice: speed builds along the way they push and carries on when they stop pushing
 *   (a glide); turning carves the speed round; pushing hard against it is a hockey stop.
 * - **Turbo** (Shift) skates faster while the meter lasts; it fills again off it. On fire, it never
 *   runs out.
 * - **Shoot** (Space, or the left button) with the puck winds up while it's held (a tap is a wrist
 *   shot, held long it's a slap shot) and lets go on release. **Shift + E** without the puck throws
 *   a check: a lunge ahead (the game decides who it flattens).
 * - **Knocked down** (`stun`): flat on the ice, sliding, then up again; no controls meanwhile.
 * - **A goalie** (`goalie`) glides to the spot the game gives it, quick and short, in its crease.
 */

/** Speeds (blocks a second) and how they change (blocks a second, squared). */
export const SKATE = 8.4;
export const TURBO = 12.4;
const ACCEL = 15;
/** How quickly speed across the way they push carves round to it (a share a second, more at speed). */
const CARVE = 3.4;
/** Coasting: how quickly a glide slows (a share a second). */
const GLIDE = 0.55;
/** A hockey stop's braking. */
const STOP = 30;
/** A goalie's top speed. */
const GOALIE = 6.8;
/** How long turbo lasts from full, and refills from empty (seconds). */
const TURBO_DRAIN = 3.4;
const TURBO_FILL = 4.2;
/** A shot's wind-up: seconds to a full slap shot. */
export const WIND = 0.85;
/** A check's lunge: how long, how fast, and how long before another. */
const LUNGE = 0.22;
const LUNGE_SPEED = 13;
const LUNGE_COOL = 0.9;

export interface SkateState {
  /** The goal they attack (+1 right, -1 left). Set by the game. */
  side: number;
  /** They have the puck (the game's: 1 or 0). */
  puck: number;
  /** On fire (unlimited turbo). The game's. */
  fire: number;
  /** Skating speed, times the usual (the game's: a bot's level slows it; people always 1). */
  pace: number;
  /** A goalie (the game's): it glides to (`gx`, `gz`) rather than steering by keys. */
  goalie: number;
  gx: number;
  gz: number;
  /** Turbo left, 0..1. */
  turbo: number;
  /** A shot winding up (0..1, while shoot's held with the puck); the wind it was let go at. */
  wind: number;
  charge: number;
  /** Seconds since a shot was let go (its follow-through; 0: none lately). */
  shot: number;
  /** A check's lunge: seconds of it left; seconds till another can go. */
  lunge: number;
  lungeCool: number;
  /** Knocked down: seconds left on the ice; the push it came with (once, `kick`). */
  stun: number;
  kx: number;
  kz: number;
  kick: number;
  /** A hockey stop under way (seconds of spray left). */
  stop: number;
  /** Shoot held last step. */
  held: number;
}

export const SKATE_STATE: SkateState = {
  side: 1,
  puck: 0,
  fire: 0,
  pace: 1,
  goalie: 0,
  gx: 0,
  gz: 0,
  turbo: 1,
  wind: 0,
  charge: 0,
  shot: 0,
  lunge: 0,
  lungeCool: 0,
  stun: 0,
  kx: 0,
  kz: 0,
  kick: 0,
  stop: 0,
  held: 0,
};

/** Shoot is held: Space, or the left mouse button (a controller's RT, a touch screen's shoot button). */
export const shootDown = (c: AbilityControls) => c.isDown('Space') || c.button(0);

export const skate: MovementAbility<SkateState> = {
  state: SKATE_STATE,
  step(s, c, body, dt) {
    body.jump = false;
    body.control = 0;
    const p = body.position;
    let vx = body.velocity.x;
    let vz = body.velocity.z;
    s.lungeCool = Math.max(0, s.lungeCool - dt);
    s.stop = Math.max(0, s.stop - dt);
    if (s.shot > 0) s.shot = s.shot > 0.6 ? 0 : s.shot + dt;

    const shoot = shootDown(c);
    const ePressed = c.pressed('KeyE') || c.buttonPressed(2);
    s.held = shoot ? 1 : 0;

    if (s.goalie) {
      // A goalie: to its spot, quick, short steps (no keys).
      const dx = s.gx - p.x;
      const dz = s.gz - p.z;
      const d = Math.hypot(dx, dz);
      const want = Math.min(GOALIE, d * 9);
      const tx = d > 1e-4 ? (dx / d) * want : 0;
      const tz = d > 1e-4 ? (dz / d) * want : 0;
      const k = 1 - Math.exp(-dt * 18);
      vx += (tx - vx) * k;
      vz += (tz - vz) * k;
      s.wind = 0;
      return place(body, p, vx, vz, dt);
    }

    // Knocked down: flat on the ice, sliding on from the hit, no controls.
    if (s.stun > 0) {
      s.stun = Math.max(0, s.stun - dt);
      s.wind = 0;
      s.lunge = 0;
      body.stance = 'low';
      if (s.kick) {
        s.kick = 0;
        vx = s.kx;
        vz = s.kz;
        body.setVelocity({ y: 3 });
        body.trigger('down');
      }
      const k = Math.exp(-dt * 1.4);
      return place(body, p, vx * k, vz * k, dt);
    }

    // Steering, the screen's way (keys and the stick both press WASD).
    const right = (c.isDown('KeyD') ? 1 : 0) - (c.isDown('KeyA') ? 1 : 0);
    const down = (c.isDown('KeyS') ? 1 : 0) - (c.isDown('KeyW') ? 1 : 0);
    const len = Math.hypot(right, down);
    const wx = len > 0 ? right / len : 0;
    const wz = len > 0 ? down / len : 0;

    // Turbo: faster while it lasts, filling again off it.
    const turbo = c.isDown('ShiftLeft') || c.isDown('ShiftRight');
    if (s.fire) s.turbo = 1;
    const boosting = turbo && s.turbo > 0 && len > 0;
    if (boosting && !s.fire) s.turbo = Math.max(0, s.turbo - dt / TURBO_DRAIN);
    else if (!turbo) s.turbo = Math.min(1, s.turbo + dt / TURBO_FILL);

    // The shot: wound up while shoot's held with the puck, let go on release.
    if (s.puck) {
      if (shoot) s.wind = Math.min(1, s.wind + dt / WIND);
      if (!shoot && s.wind > 0) {
        s.charge = s.wind;
        s.wind = 0;
        s.shot = 1e-3;
        body.trigger('shoot');
      }
    } else s.wind = 0;

    // A check: Shift + E without the puck, a lunge the way they're going (or facing).
    if (!s.puck && turbo && ePressed && s.lungeCool <= 0 && (s.turbo > 0.08 || s.fire)) {
      s.lunge = LUNGE;
      s.lungeCool = LUNGE_COOL;
      if (!s.fire) s.turbo = Math.max(0, s.turbo - 0.18);
      body.trigger('check');
    }

    const speed = Math.hypot(vx, vz);
    const top = (boosting ? TURBO : SKATE) * (s.pace || 1) * (s.puck ? 0.94 : 1);
    if (s.lunge > 0) {
      // The lunge: hard ahead, the way they're going or else facing.
      s.lunge = Math.max(0, s.lunge - dt);
      let fx = vx;
      let fz = vz;
      if (speed < 1) {
        fx = -Math.sin(body.yaw);
        fz = -Math.cos(body.yaw);
      }
      const fl = Math.hypot(fx, fz) || 1;
      const want = Math.max(speed, LUNGE_SPEED);
      vx = (fx / fl) * want;
      vz = (fz / fl) * want;
    } else if (len > 0) {
      const along = vx * wx + vz * wz;
      if (along < -2.5 && speed > 4.5) {
        // Pushing hard against the way they're going: a hockey stop, snow flying.
        const next = Math.max(0, speed - STOP * dt);
        vx *= next / speed;
        vz *= next / speed;
        if (s.stop <= 0) body.trigger('stop');
        s.stop = 0.3;
      } else {
        // Speed along the push builds (a wind-up only glides); across it carves round.
        let a = along;
        if (s.wind > 0) a *= Math.exp(-dt * GLIDE);
        else if (a < top) a = Math.min(top, a + ACCEL * dt * (a < 0 ? 2.2 : 1));
        else a = top + (a - top) * Math.exp(-dt * 2.5);
        const k = Math.exp(-dt * CARVE * (1 + speed / 10));
        const px = (vx - along * wx) * k;
        const pz = (vz - along * wz) * k;
        vx = wx * a + px;
        vz = wz * a + pz;
      }
    } else {
      // Coasting: a long glide.
      const k = Math.exp(-dt * (s.wind > 0 ? GLIDE * 1.5 : GLIDE));
      vx *= k;
      vz *= k;
    }
    return place(body, p, vx, vz, dt);
  },
};

/**
 * The step's velocity, kept off the boards and the nets: into them, they bounce off (a little),
 * and are put back clear if they're in.
 */
function place(body: Parameters<MovementAbility<SkateState>['step']>[2], p: { x: number; z: number }, vx: number, vz: number, dt: number) {
  const nx = p.x + vx * dt;
  const nz = p.z + vz * dt;
  const k = keepIn(nx, nz, BODY);
  if (k.nx || k.nz) {
    const vn = vx * k.nx + vz * k.nz;
    if (vn < 0) {
      vx -= 1.3 * vn * k.nx;
      vz -= 1.3 * vn * k.nz;
      if (-vn > 6) body.trigger('boards');
    }
    const now = keepIn(p.x, p.z, BODY);
    if (now.nx || now.nz) body.setPosition({ x: now.x, y: body.position.y, z: now.z });
  }
  body.setVelocity({ x: vx, z: vz });
}
