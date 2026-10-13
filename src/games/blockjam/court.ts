/**
 * The court, in blocks (a block is a metre): where the floor is, the lines, the two baskets. Shared
 * by the server (the rules, the ball), every screen (the ball, the camera) and the players'
 * movement (a dunk flies to the rim). Nothing here but numbers and a few pure helpers.
 *
 * The court runs along x, from the left basket (x < 0) to the right (x > 0); z is across it, the
 * camera's side at +z. The floor's top is at `FLOOR`. The team going right attacks the right
 * basket (`side` +1), the other the left (-1).
 */

/** The top of the floor: where feet stand. */
export const FLOOR = 64;
/** Half the court's length (along x) and width (along z), to the outside of the lines. */
export const HALF_LENGTH = 14;
export const HALF_WIDTH = 7.5;
/** The rim's height over the floor, its radius, and the ball's radius (both a little big: arcade). */
export const RIM_HEIGHT = 3.05;
export const RIM_RADIUS = 0.34;
export const BALL_RADIUS = 0.17;
/** The rim's middle, out from the baseline; the backboard's face, out from the baseline. */
export const RIM_FROM_BASELINE = 1.75;
export const BOARD_FROM_BASELINE = 1.15;
/** The backboard: half its width (along z), its bottom and top over the floor, and how thick. */
export const BOARD_HALF_WIDTH = 0.95;
export const BOARD_BOTTOM = 2.85;
export const BOARD_TOP = 3.95;
export const BOARD_THICK = 0.08;
/** The three-point line: its radius from the rim, and where its straight corner lines run (|z|). */
export const THREE_RADIUS = 6.6;
export const THREE_CORNER = 6.7;
/** The key (the lane): half its width, and how far out the free-throw line is from the baseline. */
export const KEY_HALF_WIDTH = 2.45;
export const KEY_LENGTH = 5.8;

/** Which basket a side attacks: +1 the right (x > 0), -1 the left. */
export type Side = 1 | -1;

/** The middle of the rim a side attacks (world coordinates). */
export function rim(side: Side): { x: number; y: number; z: number } {
  return { x: side * (HALF_LENGTH - RIM_FROM_BASELINE), y: FLOOR + RIM_HEIGHT, z: 0 };
}

/** The backboard's face (x) a side attacks: the plane the ball bounces off. */
export function boardX(side: Side): number {
  return side * (HALF_LENGTH - BOARD_FROM_BASELINE);
}

/** How far a point on the floor is from the rim a side attacks (on the ground). */
export function fromRim(side: Side, x: number, z: number): number {
  const r = rim(side);
  return Math.hypot(x - r.x, z - r.z);
}

/** A shot from here, at the basket a side attacks, is a three (behind the arc or in the corners). */
export function isThree(side: Side, x: number, z: number): boolean {
  const r = rim(side);
  // The corners: a straight line out to where it meets the arc.
  if (Math.abs(z) >= THREE_CORNER && side * (x - r.x) > -2.5) return true;
  return Math.hypot(x - r.x, z - r.z) >= THREE_RADIUS;
}

/** Inside the court's lines (a little give: arcade, no out of bounds but the walls). */
export function onCourt(x: number, z: number): boolean {
  return Math.abs(x) <= HALF_LENGTH + 0.6 && Math.abs(z) <= HALF_WIDTH + 0.6;
}

/** The walls round the floor: nobody goes past these (the floor beyond the lines, then the stands). */
export const WALL_X = HALF_LENGTH + 3;
export const WALL_Z = HALF_WIDTH + 2.5;

/** Where the camera watches from: the near sideline (+z), up in the stands. */
export const CAMERA = { z: HALF_WIDTH + 9, y: FLOOR + 5.6, fov: 44 };
