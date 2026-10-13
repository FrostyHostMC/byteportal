import type { AbilityBody, MovementAbility } from '@platform';

/**
 * Three movement abilities, each a pure step the platform runs on the host and, ahead of it, on
 * the player's own screen. They take turns in the order the game lists them (dash, wall-run,
 * double jump), and keep out of each other's way: whoever sets `body.control` to 0 has the body
 * for the step (a dash in progress), and a wall-jump consumes the Space press that would otherwise
 * be a double jump.
 */

// -----------------------------------------------------------------------------------------------
// Dash
// -----------------------------------------------------------------------------------------------

/** A burst of speed along the way the keys push (or the look), level, then out at a run. */
export const DASH = { key: 'KeyQ', speed: 22, time: 0.2, exit: 8.5, cooldown: 1.2 };

export interface DashState {
  /** Seconds of dash left (0: not dashing), and seconds until the next. */
  left: number;
  cool: number;
  /** Which way it goes (a unit vector on the ground). */
  dx: number;
  dz: number;
}

export const dash: MovementAbility<DashState> = {
  state: { left: 0, cool: 0, dx: 0, dz: -1 },
  step(s, c, body, dt) {
    s.cool = Math.max(0, s.cool - dt);
    if (c.pressed(DASH.key) && s.cool === 0 && s.left === 0 && !body.inWater && !body.flying) {
      const w = Math.hypot(body.wish.x, body.wish.z);
      s.dx = w > 0.1 ? body.wish.x / w : -Math.sin(body.yaw);
      s.dz = w > 0.1 ? body.wish.z / w : -Math.cos(body.yaw);
      s.left = DASH.time;
      s.cool = DASH.cooldown;
      body.trigger('dash');
    }
    if (s.left <= 0) return;
    s.left = Math.max(0, s.left - dt);
    // While it lasts: level (no gravity, no jumping) and unsteerable; its last step lets them out at a run.
    const speed = s.left > 0 ? DASH.speed : DASH.exit;
    body.setVelocity({ x: s.dx * speed, y: 0, z: s.dz * speed });
    body.gravity = 0;
    body.control = 0;
    body.jump = false;
  },
};

// -----------------------------------------------------------------------------------------------
// Double jump
// -----------------------------------------------------------------------------------------------

/** Space in the air: a second jump, once until they land. */
export const DOUBLE_JUMP = { speed: 9.5 };

export interface DoubleJumpState {
  used: boolean;
}

export const doubleJump: MovementAbility<DoubleJumpState> = {
  state: { used: false },
  step(s, c, body) {
    if (body.onGround || body.inWater || body.flying) {
      s.used = false;
      return;
    }
    // Not while another move has the body (a dash).
    if (s.used || body.control === 0 || !c.pressed('Space')) return;
    s.used = true;
    c.consume('Space');
    body.setVelocity({ y: DOUBLE_JUMP.speed });
    body.trigger('jump');
  },
};

// -----------------------------------------------------------------------------------------------
// Wall-run and wall-jump
// -----------------------------------------------------------------------------------------------

/**
 * Jump alongside a wall holding forward: run along it for a while, sinking slowly, and Space
 * kicks off it (up and away, keeping the run's speed), ready to catch the next wall.
 */
export const WALL_RUN = {
  /** Longest run (seconds), its speed along the wall, and the least speed along it that catches it. */
  time: 1.4,
  speed: 8.5,
  catchSpeed: 4,
  /** Upward speed as it starts, and gravity while on the wall (times the game's). */
  lift: 2,
  gravity: 0.08,
  /** A wall-jump: up, and away from the wall. */
  jump: 9,
  kick: 9,
  /**
   * After a wall-jump, seconds of kick: it carries them (no steering, so it crosses to the next
   * wall), and no wall can be caught (not the one just left).
   */
  kickTime: 0.4,
};

export interface WallRunState {
  /** Seconds of run left (0: not on a wall). */
  left: number;
  /** The wall's normal (pointing away from it) and the way along it they run. */
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  /** Seconds of a wall-jump's kick left (see `WALL_RUN.kickTime`). */
  kick: number;
  /** They've had their run (it ran out, or they let go): no more until they land or wall-jump. */
  spent: boolean;
}

/** How far out from the body's side a wall is felt (blocks). */
const REACH = 0.15;

/**
 * A wall beside the body that they're moving along fast enough to run on: its normal (pointing
 * away from it). Walls in a block world face along the axes, so it feels those four ways.
 */
function wallBeside(body: AbilityBody, vx: number, vz: number): [number, number] | null {
  const p = body.position;
  let best: [number, number] | null = null;
  let fastest = WALL_RUN.catchSpeed;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (body.fits({ x: p.x + dx * REACH, y: p.y, z: p.z + dz * REACH })) continue;
    const along = Math.abs(dx !== 0 ? vz : vx);
    if (along > fastest) {
      fastest = along;
      best = [-dx, -dz];
    }
  }
  return best;
}

export const wallRun: MovementAbility<WallRunState> = {
  state: { left: 0, nx: 0, nz: 0, tx: 0, tz: 0, kick: 0, spent: false },
  step(s, c, body, dt) {
    if (body.onGround || body.inWater || body.flying) {
      s.left = 0;
      s.kick = 0;
      s.spent = false;
      return;
    }
    if (s.kick > 0) {
      s.kick = Math.max(0, s.kick - dt);
      body.control = 0;
      return;
    }
    const v = body.velocity;
    // Holding forward along the wall (the keys or the stick, turned by the view).
    const forward = (tx: number, tz: number) => body.wish.x * tx + body.wish.z * tz > 0.3;

    if (s.left > 0) {
      const p = body.position;
      const wall = !body.fits({ x: p.x - s.nx * REACH, y: p.y, z: p.z - s.nz * REACH });
      // A dash (or anything else that takes the body) ends it too.
      if (!wall || !forward(s.tx, s.tz) || body.control === 0) {
        s.left = 0;
        s.spent = true;
        body.trigger('end');
        return;
      }
      if (c.pressed('Space')) {
        // Kick off: up and away, still running.
        c.consume('Space');
        body.jump = false;
        body.setVelocity({ x: s.nx * WALL_RUN.kick + s.tx * WALL_RUN.speed, y: WALL_RUN.jump, z: s.nz * WALL_RUN.kick + s.tz * WALL_RUN.speed });
        s.left = 0;
        s.spent = false;
        s.kick = WALL_RUN.kickTime;
        body.trigger('jump');
        return;
      }
      s.left = Math.max(0, s.left - dt);
      if (s.left === 0) {
        // Out of run: this last step still on the wall.
        s.spent = true;
        body.trigger('end');
      }
    } else {
      if (s.spent || body.control === 0) return;
      const n = wallBeside(body, v.x, v.z);
      if (!n) return;
      // Along the wall, the way they're going.
      let tx = -n[1];
      let tz = n[0];
      if (v.x * tx + v.z * tz < 0) {
        tx = -tx;
        tz = -tz;
      }
      if (!forward(tx, tz)) return;
      s.left = WALL_RUN.time;
      [s.nx, s.nz, s.tx, s.tz] = [n[0], n[1], tx, tz];
      body.setVelocity({ y: WALL_RUN.lift });
      body.trigger('start');
    }
    // On the wall: along it at the run's speed, pressed gently into it, sinking slowly.
    body.setVelocity({ x: s.tx * WALL_RUN.speed - s.nx * 0.5, y: Math.max(body.velocity.y, -2), z: s.tz * WALL_RUN.speed - s.nz * 0.5 });
    body.gravity = WALL_RUN.gravity;
    body.control = 0;
    body.jump = false;
  },
};
