import { boards, GOAL_DEPTH, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_X, BOARDS, ICE, POST, PUCK_HALF, PUCK_RADIUS, type Side } from './rink';

/**
 * The puck loose, the same on the server and every screen: a launch (where and how fast) played
 * out in fixed steps, sliding on the ice (slowing a little), flying when it's lifted (a slap shot,
 * a flip), off the boards and the glass, ringing off the posts and the crossbar, into the net (a
 * goal, once it's wholly over the line between the posts, under the bar) and caught there. The
 * server plays it to know where the puck is (who can take it, saves, goals); each screen plays the
 * same launch to draw it, so a shot's flight needs only its launch sent.
 *
 * Pure: the same launch gives the same path everywhere (fixed steps, nothing random).
 */

export interface PuckState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since the launch. */
  t: number;
  /** It's crossed a goal line into a net this flight: which side's goal (0: not yet). */
  through: 0 | Side;
  /** In a net now (it stays there): which. */
  net: 0 | Side;
}

/** Something that happened in a step: a bounce off the boards, a post's ping, the twine. `speed`: how hard. */
export interface PuckEvent {
  kind: 'boards' | 'glass' | 'post' | 'bar' | 'net' | 'ice' | 'goal';
  side?: Side;
  speed: number;
  x: number;
  y: number;
  z: number;
}

/** Gravity (blocks a second squared), and the steps the puck's played out in (seconds). */
export const GRAVITY = 20;
export const STEP = 1 / 120;
/** Its rest on the ice: the height of its middle. */
export const REST = ICE + PUCK_HALF;
/** Sliding on the ice: how quickly it loses speed (a share a second, and a little more flat). */
const SLIDE_DRAG = 0.28;
const SLIDE_FRICTION = 0.6;

export function launch(x: number, y: number, z: number, vx: number, vy: number, vz: number): PuckState {
  return { x, y, z, vx, vy, vz, t: 0, through: 0, net: 0 };
}

/**
 * The puck played on to time `t` (seconds since its launch), in fixed steps; what happened on the
 * way goes to `events`. Call it with increasing times: it carries on from where it was.
 */
export function advance(s: PuckState, t: number, events?: PuckEvent[]) {
  while (s.t + STEP <= t + 1e-9) step(s, events);
}

/** It's resting (or nearly) on the ice. */
export const onIce = (s: PuckState) => s.y <= REST + 0.02 && Math.abs(s.vy) < 0.01;

export function step(s: PuckState, events?: PuckEvent[]) {
  const dt = STEP;
  s.t += dt;
  const r = PUCK_RADIUS;
  const px = s.x;
  const flat = onIce(s);
  if (!flat) s.vy -= GRAVITY * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  // The ice: a lifted puck lands (a little hop if it's hard), and slides.
  if (s.y <= REST) {
    if (s.vy < -2.2) {
      events?.push({ kind: 'ice', speed: -s.vy, x: s.x, y: ICE, z: s.z });
      s.vy = -s.vy * 0.22;
    } else s.vy = 0;
    s.y = REST;
  }
  if (onIce(s)) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 1e-4) {
      const next = Math.max(0, sp * Math.exp(-dt * SLIDE_DRAG) - SLIDE_FRICTION * dt);
      s.vx *= next / sp;
      s.vz *= next / sp;
    }
  }

  // Into a net: across the goal line between the posts and under the bar (a goal, once), then
  // held there, slowed by the twine, kept in by its sides, back and top.
  for (const side of [1, -1] as Side[]) {
    const line = side * GOAL_X;
    const crossed = side * (px - line) < r && side * (s.x - line) >= r;
    if (!s.net && crossed && Math.abs(s.z) < GOAL_HALF_WIDTH - r * 0.6 && s.y < ICE + GOAL_HEIGHT - PUCK_HALF) {
      s.net = side;
      if (!s.through) {
        s.through = side;
        events?.push({ kind: 'goal', side, speed: Math.hypot(s.vx, s.vy, s.vz), x: s.x, y: s.y, z: s.z });
      }
    }
  }
  if (s.net) {
    const side = s.net;
    const k = Math.exp(-dt * 7);
    s.vx *= k;
    s.vz *= k;
    const back = side * (GOAL_X + GOAL_DEPTH - r);
    if (side * (s.x - back) > 0) {
      if (side * s.vx > 1) events?.push({ kind: 'net', side, speed: Math.abs(s.vx), x: s.x, y: s.y, z: s.z });
      s.x = back;
      s.vx = -s.vx * 0.1;
    }
    const front = side * (GOAL_X + r);
    if (side * (s.x - front) < 0) {
      s.x = front;
      s.vx = Math.abs(s.vx) * side * 0.1;
    }
    const zw = GOAL_HALF_WIDTH - r;
    if (Math.abs(s.z) > zw) {
      s.z = Math.sign(s.z) * zw;
      s.vz = -s.vz * 0.1;
    }
    const top = ICE + GOAL_HEIGHT - PUCK_HALF;
    if (s.y > top) {
      s.y = top;
      s.vy = Math.min(0, s.vy) * 0.1;
    }
    return;
  }

  // The goals from outside: the posts and the crossbar ring, the net's sides, back and top are a box.
  for (const side of [1, -1] as Side[]) {
    const line = side * GOAL_X;
    // The posts: upright, at the mouth's corners.
    if (s.y < ICE + GOAL_HEIGHT + r) {
      for (const pz of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) {
        const dx = s.x - line;
        const dz = s.z - pz;
        const d = Math.hypot(dx, dz);
        if (d >= r + POST || d < 1e-6) continue;
        const nx = dx / d;
        const nz = dz / d;
        s.x = line + nx * (r + POST);
        s.z = pz + nz * (r + POST);
        const vn = s.vx * nx + s.vz * nz;
        if (vn < 0) {
          s.vx -= 1.75 * vn * nx;
          s.vz -= 1.75 * vn * nz;
          events?.push({ kind: 'post', side, speed: -vn, x: line, y: s.y, z: pz });
        }
      }
    }
    // The crossbar: along z at the top of the mouth.
    if (Math.abs(s.z) <= GOAL_HALF_WIDTH) {
      const dx = s.x - line;
      const dy = s.y - (ICE + GOAL_HEIGHT);
      const d = Math.hypot(dx, dy);
      if (d < r * 0.6 + POST && d > 1e-6) {
        const nx = dx / d;
        const ny = dy / d;
        s.x = line + nx * (r * 0.6 + POST);
        s.y = ICE + GOAL_HEIGHT + ny * (r * 0.6 + POST);
        const vn = s.vx * nx + s.vy * ny;
        if (vn < 0) {
          s.vx -= 1.7 * vn * nx;
          s.vy -= 1.7 * vn * ny;
          events?.push({ kind: 'bar', side, speed: -vn, x: line, y: ICE + GOAL_HEIGHT, z: s.z });
        }
      }
    }
    // The net's box (behind the line): bounced off from outside, a dull thud.
    const x0 = Math.min(line, side * (GOAL_X + GOAL_DEPTH));
    const x1 = Math.max(line, side * (GOAL_X + GOAL_DEPTH));
    const zw = GOAL_HALF_WIDTH + POST;
    const top = ICE + GOAL_HEIGHT + POST;
    const inX = s.x > x0 - r && s.x < x1 + r;
    const inZ = Math.abs(s.z) < zw + r;
    // (A puck coming at the mouth is going in, not bouncing off the box.)
    const mouth = Math.abs(s.z) < GOAL_HALF_WIDTH - r * 0.6 && s.y < ICE + GOAL_HEIGHT - PUCK_HALF && side * (s.x - line) < r;
    if (inX && inZ && s.y < top + PUCK_HALF && !mouth) {
      // Out the face it's nearest (never the mouth: a puck there went in, or hit a post).
      const pushes: [number, number, number, number][] = [
        [x1 + r - s.x, 1, 0, 0],
        [s.x - (x0 - r), -1, 0, 0],
        [zw + r - s.z, 0, 0, 1],
        [s.z + zw + r, 0, 0, -1],
        [top + PUCK_HALF - s.y, 0, 1, 0],
      ];
      const front = side > 0 ? 1 : 0;
      const [depth, nx, ny, nz] = pushes.filter((_, i) => i !== front).sort((a, b) => a[0] - b[0])[0];
      s.x += nx * depth;
      s.y += ny * depth;
      s.z += nz * depth;
      const vn = s.vx * nx + s.vy * ny + s.vz * nz;
      if (vn < 0) {
        s.vx -= 1.3 * vn * nx;
        s.vy -= 1.3 * vn * ny;
        s.vz -= 1.3 * vn * nz;
        if (-vn > 2) events?.push({ kind: 'net', side, speed: -vn, x: s.x, y: s.y, z: s.z });
      }
    }
  }

  // The boards and the glass over them (all the way up: nothing leaves the rink).
  const b = boards(s.x, s.z);
  if (b.d < r) {
    s.x += b.nx * (r - b.d);
    s.z += b.nz * (r - b.d);
    const vn = s.vx * b.nx + s.vz * b.nz;
    if (vn < 0) {
      const glass = s.y > ICE + BOARDS;
      const e = glass ? 0.45 : 0.62;
      s.vx -= (1 + e) * vn * b.nx;
      s.vz -= (1 + e) * vn * b.nz;
      // A little of the speed along them lost too.
      const tx = -b.nz;
      const tz = b.nx;
      const vt = s.vx * tx + s.vz * tz;
      s.vx -= vt * tx * 0.08;
      s.vz -= vt * tz * 0.08;
      events?.push({ kind: glass ? 'glass' : 'boards', speed: -vn, x: s.x, y: s.y, z: s.z });
    }
  }
}

/**
 * The launch speed that carries the puck from `from` to `to` in `time` seconds: flat along the ice
 * if both are on it, else an arc under gravity (no bounces).
 */
export function aim(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, time: number) {
  const lift = to.y - from.y;
  const flat = from.y <= REST + 0.01 && Math.abs(lift) < 0.01;
  return {
    vx: (to.x - from.x) / time,
    vy: flat ? 0 : (lift + 0.5 * GRAVITY * time * time) / time,
    vz: (to.z - from.z) / time,
  };
}

/** A sliding puck's speed after `d` blocks of ice (roughly: drag and friction), for leading a pass. */
export function slideTime(speed: number, d: number): number {
  // Close enough: the average of the start and end speeds over the distance.
  const end = Math.max(1, speed * Math.exp(-SLIDE_DRAG * (d / speed)) - SLIDE_FRICTION * (d / speed));
  return d / ((speed + end) / 2);
}
