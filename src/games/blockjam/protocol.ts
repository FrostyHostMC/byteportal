/**
 * What the server tells the screens (`game.clients.send`, heard with `client.on`), shared by both
 * sides: where the ball is, what each baller is doing, and the game's big moments.
 */

export const MSG = {
  /** The ball: held, or launched (`BallMsg`). Sent whenever it changes hands or flies. */
  ball: 'jam.ball',
  /** What every baller is doing, a few times a second (`BallersMsg`): for their figures. */
  ballers: 'jam.ballers',
  /** A moment (`MomentMsg`): a basket, a block, a steal, a shove, catching fire, the buzzer. */
  moment: 'jam.moment',
  /** A callout across the screen (`CallMsg`): the announcer's line. */
  call: 'jam.call',
} as const;

/**
 * The ball. `h`: the player holding it (dribbling, or up in their hands for a shot or a dunk).
 * `f`: in flight from a launch, `[x, y, z, vx, vy, vz]`, played out on each screen from when it
 * arrives (`ball.ts`); `k` what kind of flight; `by` who sent it on its way.
 */
export type BallMsg = { h: string; dunk?: boolean } | { f: [number, number, number, number, number, number]; k: FlightKind; by?: string; fire?: boolean };

export type FlightKind = 'shot' | 'pass' | 'loose' | 'swat' | 'tip' | 'slam';

/**
 * Each baller: `[id, air, t, style, stun, fire, team, dur]` (the jam ability's state, as the server
 * has it: their screen has its own, predicted). `team`: 0 or 1; `dur`, a dunk's flight time.
 */
export type BallersMsg = [string, number, number, number, number, number, number, number][];

export type MomentMsg =
  | { k: 'score'; team: number; pts: number; by: string; how: 'shot' | 'three' | 'dunk' | 'oop' | 'tip'; fire: boolean; side: number }
  | { k: 'block'; by: string; at: [number, number, number] }
  | { k: 'steal'; by: string; from: string }
  | { k: 'shove'; by: string; who: string }
  | { k: 'fire'; who: string; on: boolean }
  | { k: 'slam'; by: string; side: number; style: number }
  | { k: 'buzzer'; what: 'quarter' | 'shotclock' | 'game' }
  | { k: 'tip' };

/** The announcer: a big line, a smaller one under it, a colour, and how loud the crowd goes (0..1). */
export interface CallMsg {
  text: string;
  sub?: string;
  color?: string;
  roar?: number;
}
