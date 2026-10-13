import type { Surf } from './course/types';
import type { ShotEvent } from './physics';

/**
 * What the server and the players' screens say to each other (`game.clients.send` / `client.on`,
 * `client.send` / `clientMessage`). The server decides every shot and where every ball is; each
 * screen draws the balls, flies the shots it's told of, and runs the swing at the ball.
 */
export const MSG = {
  /** Server → everyone: one player's ball, where it lies now (or gone). */
  ball: 'golf.ball',
  /** Server → one screen: every ball on the course (joining). */
  balls: 'golf.balls',
  /** Server → everyone: a shot, played out. */
  shot: 'golf.shot',
  /** Server → one screen: step up to your ball (the swing begins on your screen). */
  address: 'golf.address',
  /** Server → one screen: away from the ball again. */
  release: 'golf.release',
  /** Server → one screen: your round (hole, strokes, the card). */
  round: 'golf.round',
  /** Screen → server: the swing. */
  swing: 'golf.swing',
} as const;

/** A hole's flagstick, an item each screen draws (and takes out while its golfer is putting there). */
export const flagItem = (hole: number) => `golf_flag_${hole + 1}`;

export interface BallMsg {
  id: string;
  name: string;
  /** Where it rests (its bottom), or null: none on the course. */
  at: { x: number; y: number; z: number } | null;
  /** Its colour (the player's). */
  color: string;
}

export interface ShotMsg {
  id: string;
  /** Positions, `hz` times a second (x, y, z each; y its bottom). */
  path: number[];
  hz: number;
  events: ShotEvent[];
  outcome: 'rest' | 'holed' | 'water' | 'ob';
  club: string;
  quality: string;
  /** Yards carried, and in all; to the pin after. */
  carry: number;
  total: number;
  /** The hole it was played on. */
  hole: number;
  color: string;
}

export interface AddressMsg {
  hole: number;
  ball: { x: number; y: number; z: number };
  lie: Surf;
  /** Strokes played on this hole so far (this is the next). */
  stroke: number;
  /** The wind here: m/s, world axes. */
  wind: { x: number; z: number };
  /** Which way to face to begin with (at the pin, or down the hole off the tee). */
  yaw: number;
  /** The club the caddie hands you. */
  club: string;
}

export interface RoundMsg {
  hole: number;
  /** Strokes on the hole being played, and each hole's score so far (null: not played). */
  strokes: number;
  card: (number | null)[];
  /** Total strokes, and against par for the holes finished. */
  total: number;
  toPar: number;
  wind: { x: number; z: number };
  /** What they're doing: walking, driving, at the ball, watching it fly, done with the hole. */
  mode: 'walk' | 'drive' | 'address' | 'flight' | 'holed' | 'done';
  /** Their ball (where to walk to). */
  ball: { x: number; y: number; z: number } | null;
  lie: Surf | null;
  /** Where their cart is parked (null: they're driving it). */
  cart: { x: number; y: number; z: number } | null;
}
