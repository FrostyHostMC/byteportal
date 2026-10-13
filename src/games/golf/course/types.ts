/**
 * How a hole is written (`holes.ts`): in golf's own terms, yards along the line of play and across
 * it, the way a yardage book reads. `course.ts` turns each into the landscape.
 */

/** Along the line of play: yards from the tee, or (negative) yards short of the green's middle. */
export type Along = number;

export interface GreenSpec {
  /** Radii along and across the line of play, yards. */
  size: [along: number, across: number];
  /** The green's long axis turned from the line of play, degrees (right positive). */
  turn?: number;
  /**
   * Its tilt, percent: `back` is how much higher the back is than the front (a green that runs
   * toward you), `right` how much higher its right side is than its left.
   */
  slope: { back: number; right: number };
  /** Rolls in it: [along, across (yards from its middle), height (blocks, + a crown, - a hollow), radius (yards)]. */
  bumps?: [number, number, number, number][];
  /** Where the hole is cut: [along, across], yards from the middle. */
  pin: [number, number];
  /** How far above the land around it the green is built up (blocks). Default 0.6. */
  raise?: number;
}

/** A bunker or a pond: where it is, how big, turned. */
export interface HazardSpec {
  /** Along the line of play (see `Along`) and across it (yards, right positive)... */
  at?: [Along, number];
  /** ...or round the green: which side (degrees: 0 behind, 90 right, 180 in front, 270 left) and how far off its edge (yards). */
  green?: [side: number, gap: number];
  /** Radii, yards: along its own axis and across. */
  size: [number, number];
  /** Its axis turned from the line of play, degrees. */
  turn?: number;
  /** A bunker's depth (blocks, default 1.3). */
  depth?: number;
}

export interface TreeCluster {
  at: [Along, number];
  /** How many trees, and how far round (yards). */
  count: number;
  spread: number;
}

export interface HoleSpec {
  name: string;
  par: 3 | 4 | 5;
  /** Where the tee is (world blocks) and which way the hole starts, degrees (0 north, 90 east). */
  tee: [x: number, z: number];
  heading: number;
  /** The line of play's length, tee to the green's middle, yards. */
  yards: number;
  /** Doglegs: at this share of the way, the line turns this many degrees (right positive). */
  bends?: [at: number, degrees: number][];
  /** The land's height along the hole (blocks over the plain): [share of the way, height]. */
  elevation: [number, number][];
  /** The fairway: from this far off the tee (yards; none for most par 3s), its width along the way ([share, yards]). */
  fairway?: { from: number; widths: [number, number][]; shift?: [number, number][] };
  green: GreenSpec;
  bunkers?: HazardSpec[];
  ponds?: HazardSpec[];
  /** A creek across the hole: this far along (see `Along`), this wide (yards), angled (degrees). */
  creek?: { at: Along; width: number; turn?: number };
  /** Which side the cart path runs (1 right, -1 left). */
  path: 1 | -1;
  /** Trees where the architect wanted them, beyond the lines along the rough. */
  trees?: TreeCluster[];
  /** How thick the woods along the hole are (0..1, default 0.7). */
  woods?: number;
}

/**
 * What the ground is at a point: what the ball does there, and what it's made of. `Out` is the
 * plain round the course (it plays as heavy rough); `Deep` the rough beyond, among the trees.
 */
export const Surf = { Out: 0, Rough: 1, Deep: 2, Fairway: 3, Fringe: 4, Green: 5, Tee: 6, Sand: 7, Water: 8, Path: 9 } as const;
export type Surf = (typeof Surf)[keyof typeof Surf];

export const SURF_NAMES = ['out', 'rough', 'deep rough', 'fairway', 'fringe', 'green', 'tee', 'bunker', 'water', 'cart path'] as const;
export type SurfName = (typeof SURF_NAMES)[number];

export interface Tree {
  x: number;
  z: number;
  /** The ground under it (the top of its column). */
  base: number;
  kind: 'oak' | 'birch' | 'spruce';
  /** Trunk height (blocks), and the canopy: its middle's height above the base, its radius and half-height. */
  trunk: number;
  cy: number;
  r: number;
  h: number;
}
