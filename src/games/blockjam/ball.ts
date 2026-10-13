import { BALL_RADIUS, BOARD_BOTTOM, BOARD_HALF_WIDTH, BOARD_THICK, BOARD_TOP, FLOOR, RIM_RADIUS, WALL_X, WALL_Z, boardX, rim, type Side } from './court';

/**
 * The ball in the air, the same on the server and every screen: a launch (where and how fast)
 * played out in fixed steps, bouncing off the floor, the walls, the backboards and the rims (a ring
 * it can rattle round), and dropping through a net. The server plays it to know where the ball is
 * (rebounds, who catches a pass, whether it went in); each screen plays the same launch to draw it,
 * so a shot's flight needs only its launch sent.
 *
 * Pure: the same launch gives the same path everywhere (fixed steps, nothing random).
 */

/** The ball as it flies: where, how fast, and what's happened lately. */
export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since the launch. */
  t: number;
  /** Seconds left in the net's grip (it slows a ball that drops through). */
  net: number;
  /** It came down through a rim this flight: which side's basket (0: not yet). */
  through: 0 | Side;
}

/** Something that happened in a step: a bounce, a clank, a swish. `speed`: how hard (blocks a second). */
export interface BallEvent {
  kind: 'floor' | 'wall' | 'board' | 'rim' | 'net';
  side?: Side;
  speed: number;
  x: number;
  y: number;
  z: number;
}

/** Gravity (blocks a second squared): a little floaty, for arcade arcs. */
export const GRAVITY = 15;
/** The steps it's played out in (seconds). */
export const STEP = 1 / 120;
/** The rim's tube: how thick the ring the ball hits is (its radius). */
const TUBE = 0.035;

export function launch(x: number, y: number, z: number, vx: number, vy: number, vz: number): BallState {
  return { x, y, z, vx, vy, vz, t: 0, net: 0, through: 0 };
}

/**
 * The ball played on to time `t` (seconds since its launch), in fixed steps; what happened on the
 * way goes to `events`. Call it with increasing times: it carries on from where it was.
 */
export function advance(s: BallState, t: number, events?: BallEvent[]) {
  while (s.t + STEP <= t + 1e-9) step(s, events);
}

/** One step. */
export function step(s: BallState, events?: BallEvent[]) {
  const dt = STEP;
  s.t += dt;
  // The net holds a ball that's dropped through: slows it, keeps it under the rim a moment.
  if (s.net > 0) {
    s.net -= dt;
    const k = Math.exp(-dt * 9);
    s.vx *= k;
    s.vz *= k;
    if (s.vy < -2.5) s.vy = -2.5 + (s.vy + 2.5) * Math.exp(-dt * 14);
  }
  s.vy -= GRAVITY * dt;
  const py = s.y;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
  const r = BALL_RADIUS;

  // Down through a rim: a basket (the middle well inside the ring as it passes its height).
  for (const side of [1, -1] as Side[]) {
    const c = rim(side);
    if (py >= c.y && s.y < c.y && s.vy < 0 && Math.hypot(s.x - c.x, s.z - c.z) < RIM_RADIUS - r * 0.55) {
      if (!s.through) s.through = side;
      s.net = 0.35;
      events?.push({ kind: 'net', side, speed: -s.vy, x: c.x, y: c.y, z: c.z });
    }
  }

  // The rims: a ring of tube `TUBE` round its middle, at its height.
  for (const side of [1, -1] as Side[]) {
    const c = rim(side);
    const dx = s.x - c.x;
    const dz = s.z - c.z;
    const flat = Math.hypot(dx, dz);
    if (Math.abs(s.y - c.y) > r + TUBE + 0.05 || flat > RIM_RADIUS + r + TUBE + 0.05) continue;
    // The nearest point of the ring.
    const qx = flat > 1e-6 ? c.x + (dx / flat) * RIM_RADIUS : c.x + RIM_RADIUS;
    const qz = flat > 1e-6 ? c.z + (dz / flat) * RIM_RADIUS : c.z;
    const ex = s.x - qx;
    const ey = s.y - c.y;
    const ez = s.z - qz;
    const d = Math.hypot(ex, ey, ez);
    if (d >= r + TUBE || d < 1e-6) continue;
    const nx = ex / d;
    const ny = ey / d;
    const nz = ez / d;
    // Out of the ring, and the speed into it turned back (iron: lively, a little lost).
    const push = r + TUBE - d;
    s.x += nx * push;
    s.y += ny * push;
    s.z += nz * push;
    const vn = s.vx * nx + s.vy * ny + s.vz * nz;
    if (vn < 0) {
      const e = 0.62;
      s.vx -= (1 + e) * vn * nx;
      s.vy -= (1 + e) * vn * ny;
      s.vz -= (1 + e) * vn * nz;
      // A little of the speed along it lost too.
      s.vx *= 0.92;
      s.vz *= 0.92;
      events?.push({ kind: 'rim', side, speed: -vn, x: qx, y: c.y, z: qz });
    }
  }

  // The backboards: a slab facing the court.
  for (const side of [1, -1] as Side[]) {
    const face = boardX(side);
    const back = face + side * BOARD_THICK;
    const lo = FLOOR + BOARD_BOTTOM;
    const hi = FLOOR + BOARD_TOP;
    if (s.y < lo - r || s.y > hi + r || Math.abs(s.z) > BOARD_HALF_WIDTH + r) continue;
    const minX = Math.min(face, back) - r;
    const maxX = Math.max(face, back) + r;
    if (s.x <= minX || s.x >= maxX) continue;
    // Out of the face it's nearer (the court's side, almost always).
    const toFace = side > 0 ? s.x - minX : maxX - s.x;
    const toBack = side > 0 ? maxX - s.x : s.x - minX;
    const v = side * s.vx;
    if (toFace <= toBack) {
      s.x = side > 0 ? minX : maxX;
      if (v > 0) {
        s.vx = -s.vx * 0.58;
        s.vy *= 0.92;
        s.vz *= 0.85;
        events?.push({ kind: 'board', side, speed: Math.abs(v), x: face, y: s.y, z: s.z });
      }
    } else {
      s.x = side > 0 ? maxX : minX;
      if (v < 0) s.vx = -s.vx * 0.5;
    }
  }

  // The floor.
  if (s.y < FLOOR + r) {
    s.y = FLOOR + r;
    if (s.vy < 0) {
      const hit = -s.vy;
      s.vy = hit > 0.6 ? hit * 0.74 : 0;
      const k = 0.86;
      s.vx *= k;
      s.vz *= k;
      if (hit > 0.6) events?.push({ kind: 'floor', speed: hit, x: s.x, y: FLOOR, z: s.z });
    }
    // Rolling: it slows.
    if (s.vy === 0) {
      const k = Math.exp(-dt * 1.4);
      s.vx *= k;
      s.vz *= k;
    }
  }

  // The walls round the floor.
  if (Math.abs(s.x) > WALL_X - r) {
    const sx = Math.sign(s.x);
    s.x = sx * (WALL_X - r);
    if (sx * s.vx > 0) {
      events?.push({ kind: 'wall', speed: Math.abs(s.vx), x: s.x, y: s.y, z: s.z });
      s.vx = -s.vx * 0.5;
    }
  }
  if (Math.abs(s.z) > WALL_Z - r) {
    const sz = Math.sign(s.z);
    s.z = sz * (WALL_Z - r);
    if (sz * s.vz > 0) {
      events?.push({ kind: 'wall', speed: Math.abs(s.vz), x: s.x, y: s.y, z: s.z });
      s.vz = -s.vz * 0.5;
    }
  }
}

/**
 * The launch speed that carries the ball from `from` to `to` in `time` seconds under gravity (no
 * bounces: the arc itself).
 */
export function arc(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, time: number) {
  return {
    vx: (to.x - from.x) / time,
    vy: (to.y - from.y + 0.5 * GRAVITY * time * time) / time,
    vz: (to.z - from.z) / time,
  };
}

/**
 * How long a jump shot hangs in the air, by how far it's from (seconds): a higher arc the further
 * out (a lob from downtown, a flat flick from close).
 */
export function shotTime(distance: number): number {
  return 0.62 + Math.min(1.1, distance * 0.075);
}
