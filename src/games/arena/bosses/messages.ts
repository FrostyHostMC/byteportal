/**
 * What the bosses' server side tells each screen (`game.clients.send`, `client/bosses.ts` draws it):
 * plain data, no imports, so both sides can use it.
 */

/** A boss comes in: the entrance cinematic. */
export const INTRO_MSG = 'arena.boss.intro';
/** A boss falls: the death cam. */
export const FALL_MSG = 'arena.boss.fall';
/** A boss changes phase (or enrages): a line under the boss bar. */
export const PHASE_MSG = 'arena.boss.phase';
/** A telegraph on the ground (or a lasting hazard), or one taken away. */
export const MARK_MSG = 'arena.boss.mark';
/** The `/bosscam` cheat: this screen's camera on a boss from an angle (null: back to the player's own). */
export const CAM_MSG = 'arena.boss.cam';

export interface CamMessage {
  id: number;
  /** Round it from straight ahead of it (radians, toward its left), how far, how high (blocks), looking at `look` of its height. */
  angle: number;
  dist: number;
  up: number;
  look: number;
  height: number;
}

export interface IntroMessage {
  /** The boss's entity id (its figure, to follow), its type, and where it stands facing (yaw, as entities'). */
  id: number;
  type: string;
  name: string;
  title: string;
  color: string;
  at: [number, number, number];
  yaw: number;
  /** How tall it is (blocks), for framing it. */
  height: number;
  /** Seconds the cinematic lasts, and when (seconds in) it roars. */
  time: number;
  roar: number;
}

export interface FallMessage {
  id: number;
  name: string;
  color: string;
  at: [number, number, number];
  height: number;
  /** Seconds of death throes before the last blast, and the camera's hold after it. */
  time: number;
  hold: number;
  /** Who dealt the killing blow, if anyone. */
  by: string | null;
}

export interface PhaseMessage {
  text: string;
  sub?: string;
  color: string;
}

/**
 * A mark on the ground: a ring (`r` round `at`), a sweep (`r` round `at`, from angle `a0` to `a1`,
 * radians round y from +x toward +z), a lane (from `at` to `to`, `w` wide) or a pool (a lasting
 * hazard: `t` is how long it lasts, and it's drawn until then or until cleared by `id`). The others
 * land `t` seconds from now: they fill as the moment comes. A tether is a stream of light between
 * two figures (`a` and `b`: an entity's id, or a player's), for `t` seconds or until cleared.
 */
export type Mark =
  | { k: 'ring'; id?: string; at: [number, number, number]; r: number; t: number; c: string }
  | { k: 'sweep'; id?: string; at: [number, number, number]; r: number; a0: number; a1: number; t: number; c: string }
  | { k: 'lane'; id?: string; at: [number, number, number]; to: [number, number, number]; w: number; t: number; c: string }
  | { k: 'pool'; id: string; at: [number, number, number]; r: number; t: number; c: string }
  | { k: 'tether'; id?: string; a: number | string; b: number | string; t: number; c: string }
  | { k: 'clear'; id: string };
