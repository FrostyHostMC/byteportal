/**
 * The course's scale. A block is not a metre here: the course is built at `S` blocks a metre, so a
 * 280-yard drive is about 150 blocks and 18 holes fit in a square kilometre of world. Time is real
 * (a drive hangs six seconds), so the ball flies by real golf-ball physics worked in metres
 * (`physics.ts`), and positions go to the world through `S`. The player is still a person of 1.8
 * blocks: the course is simply a little smaller than life around them.
 */
export const S = 0.6;

/** Blocks in a yard, and yards in a block. */
export const YARD = 0.9144 * S;
export const yards = (blocks: number) => blocks / YARD;
/** Feet on the green, as a putt's length is read. */
export const feet = (blocks: number) => blocks / S / 0.3048;

/** Gravity, metres a second a second. */
export const G = 9.81;

/**
 * The level of the plain the course stands on: the void world's ground has its top face here
 * (`ground.y` is the block under it). Heights on the course are measured from it.
 */
export const BASE = 64;
/** The top of the ponds' and creeks' water (their water blocks fill up to the one under it). */
export const WATER = 62.9;
/** How far down the world's ground goes (room for ponds and bunkers under the plain). */
export const GROUND_DEPTH = 9;

/** The ball as drawn (its diameter in blocks: larger than life, so it can be seen). */
export const BALL_SIZE = 0.15;
/**
 * The cup's radius in blocks: a little over twice the ball's, as a real cup is to a real ball
 * (drawn a touch larger than life, like the ball).
 */
export const CUP_R = 0.18;
/** How deep the cup is drawn, and the flagstick's height over the green. */
export const CUP_DEPTH = 0.36;
export const PIN_HEIGHT = 2.8;

/** The course's ground in blocks you walk on: whole blocks topped with a layer in eighths. */
export const LAYERS = 8;
/** The course is drawn in squares of this many blocks (`client/terrain.ts`). */
export const CHUNK = 64;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A yaw (0 looks toward -z, as the player's) from a direction on the ground, and back. */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
export const dirOf = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/** A small, fast, seeded random source (the course's trees, a shot's luck): the same everywhere. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise (0 mean, about -1..1), for the land's roll and the edges of things. */
export function noise2(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
  };
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
