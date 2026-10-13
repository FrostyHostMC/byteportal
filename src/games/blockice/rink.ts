/**
 * The rink, in blocks (a block is a metre): the ice, the boards round it (a rounded rectangle), the
 * lines, the two goals. Shared by the server (the rules, the puck), every screen (the puck, the
 * camera) and the skaters' movement (the boards and the nets stop them). Numbers and pure helpers.
 *
 * The rink runs along x, from the left goal (x < 0) to the right (x > 0); z is across it, the
 * camera's side at +z. The ice's top is at `ICE`. The team going right attacks the right goal
 * (`side` +1), the other the left (-1). Arcade-sized: shorter than a real rink, the goals and the
 * puck a little big so they read from the stands.
 */

/** The top of the ice: where skates stand. */
export const ICE = 64;
/** Half the rink's length (along x) and width (along z), to the boards' faces; the corners' radius. */
export const HALF_LENGTH = 20;
export const HALF_WIDTH = 9.5;
export const CORNER = 5;
/** How high the boards stand (the glass above them goes on up: nothing gets out). */
export const BOARDS = 1.15;

/** The goal line (|x|), the goal's mouth (half its width along z, its height) and how deep its net is (out past the line). */
export const GOAL_X = 16.6;
export const GOAL_HALF_WIDTH = 1.1;
export const GOAL_HEIGHT = 1.25;
export const GOAL_DEPTH = 1.05;
/** The posts' and the crossbar's radius. */
export const POST = 0.055;
/** The crease in front of each goal: a half circle of this radius (the goalie's). */
export const CREASE = 1.7;
/** The blue lines (|x|), the centre circle, the end zones' faceoff circles (at |x|, |z|, radius). */
export const BLUE_LINE = 6;
export const CENTER_CIRCLE = 4;
export const DOT_X = 11.4;
export const DOT_Z = 4.6;
export const DOT_CIRCLE = 3.2;

/** The puck: its radius and half its thickness (big, for arcade). Resting on the ice its middle is `ICE + PUCK_HALF`. */
export const PUCK_RADIUS = 0.15;
export const PUCK_HALF = 0.045;

/** How far a skater's body keeps off the boards and the nets (their radius on the ice). */
export const BODY = 0.38;

/** Which goal a side attacks: +1 the right (x > 0), -1 the left. */
export type Side = 1 | -1;

/** The middle of the goal line a side attacks, on the ice (world coordinates). */
export function goal(side: Side): { x: number; y: number; z: number } {
  return { x: side * GOAL_X, y: ICE, z: 0 };
}

/** How far a point on the ice is from the goal a side attacks. */
export function fromGoal(side: Side, x: number, z: number): number {
  return Math.hypot(x - side * GOAL_X, z);
}

/**
 * The boards from a point on the ice: how far in from them it is (`d`, negative outside) and which
 * way is in (`nx`, `nz`), for the rounded rectangle they make.
 */
export function boards(x: number, z: number): { d: number; nx: number; nz: number } {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const sx = x < 0 ? -1 : 1;
  const sz = z < 0 ? -1 : 1;
  const cx = HALF_LENGTH - CORNER;
  const cz = HALF_WIDTH - CORNER;
  if (ax > cx && az > cz) {
    const dx = ax - cx;
    const dz = az - cz;
    const l = Math.hypot(dx, dz) || 1e-6;
    return { d: CORNER - l, nx: (-sx * dx) / l, nz: (-sz * dz) / l };
  }
  const dX = HALF_LENGTH - ax;
  const dZ = HALF_WIDTH - az;
  return dX < dZ ? { d: dX, nx: -sx, nz: 0 } : { d: dZ, nx: 0, nz: -sz };
}

/**
 * A goal's frame and net as a box on the ice (its posts at the front corners), for keeping bodies
 * out of it: x from the goal line out to the back of the net, z across the mouth.
 */
export function netBox(side: Side): { x0: number; x1: number; z0: number; z1: number } {
  const a = side * GOAL_X;
  const b = side * (GOAL_X + GOAL_DEPTH);
  return { x0: Math.min(a, b) - POST, x1: Math.max(a, b) + POST, z0: -GOAL_HALF_WIDTH - POST, z1: GOAL_HALF_WIDTH + POST };
}

/**
 * Push a body (radius `r`) on the ice out of the boards and the two nets: where it ends up, and the
 * way it was pushed (zero if it wasn't). The skaters' movement and the bots both use it.
 */
export function keepIn(x: number, z: number, r: number): { x: number; z: number; nx: number; nz: number } {
  let nx = 0;
  let nz = 0;
  const b = boards(x, z);
  if (b.d < r) {
    x += b.nx * (r - b.d);
    z += b.nz * (r - b.d);
    nx = b.nx;
    nz = b.nz;
  }
  for (const side of [1, -1] as Side[]) {
    const n = netBox(side);
    const cx = Math.max(n.x0, Math.min(n.x1, x));
    const cz = Math.max(n.z0, Math.min(n.z1, z));
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-6) {
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
      nx = dx / d;
      nz = dz / d;
    } else {
      // Inside the box: out the nearest face.
      const out = [
        [n.x0 - r - x, 0, -1, 0],
        [n.x1 + r - x, 0, 1, 0],
        [0, n.z0 - r - z, 0, -1],
        [0, n.z1 + r - z, 0, 1],
      ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
      x += out[0];
      z += out[1];
      nx = out[2];
      nz = out[3];
    }
  }
  return { x, z, nx, nz };
}

/** Where the camera watches from: the near side (+z), up in the stands. */
export const CAMERA = { z: HALF_WIDTH + 11.5, y: ICE + 8.6, fov: 40 };
