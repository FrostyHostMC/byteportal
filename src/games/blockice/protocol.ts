/**
 * What the server tells the screens (`game.clients.send`, heard with `client.on`), shared by both
 * sides: where the puck is, what each skater is doing, and the game's big moments.
 */

export const MSG = {
  /** The puck: on a stick (or in a goalie's glove), or loose (`PuckMsg`). Sent whenever it changes hands or flies. */
  puck: 'ice.puck',
  /** What every skater is doing, a few times a second (`SkatersMsg`): for their figures. */
  skaters: 'ice.skaters',
  /** A moment (`MomentMsg`): a goal, a save, a hit, a steal, a shot, catching fire, the horn. */
  moment: 'ice.moment',
  /** A callout across the screen (`CallMsg`): the announcer's line. */
  call: 'ice.call',
  /** Which teams are playing (`TeamsMsg`): the home side's id and the visitors', now and then and when they change. */
  teams: 'ice.teams',
} as const;

export type TeamsMsg = [string, string];

/**
 * The puck. `h`: the player who has it (on their stick; a goalie's, in the glove). `f`: loose, a
 * launch `[x, y, z, vx, vy, vz]`, played out on each screen from when it arrives (`puck.ts`); `k`
 * what sent it; `by` who.
 */
export type PuckMsg = { h: string } | { f: [number, number, number, number, number, number]; k: FlightKind; by?: string; fire?: boolean };

export type FlightKind = 'shot' | 'pass' | 'loose' | 'save' | 'drop' | 'block';

/**
 * Each skater (goalies too): `[id, wind, shot, stun, fire, team, stop, save, saveT, goalie]`. The
 * skate ability's state as the server has it (their own screen has its own, predicted): a shot's
 * wind-up (0..1) and follow-through (seconds), knocked down (seconds left), on fire, which team,
 * a hockey stop; a goalie's save (its kind, 0 none) and how long ago it was made.
 */
export type SkatersMsg = [string, number, number, number, number, number, number, number, number, number][];

export type GoalHow = 'wrist' | 'slap' | 'onetimer' | 'wrap' | 'own';

export type MomentMsg =
  | { k: 'goal'; team: number; by: string; how: GoalHow; fire: boolean; side: number; assist: string }
  | { k: 'save'; by: string; kind: number; at: [number, number, number] }
  | { k: 'hit'; by: string; who: string; boards: boolean; at: [number, number, number] }
  | { k: 'poke'; by: string; from: string }
  | { k: 'shot'; by: string; slap: boolean }
  | { k: 'block'; by: string; at: [number, number, number] }
  | { k: 'fire'; who: string; on: boolean }
  | { k: 'horn'; what: 'period' | 'game' }
  | { k: 'drop' };

/** The announcer: a big line, a smaller one under it, a colour, and how loud the crowd goes (0..1). */
export interface CallMsg {
  text: string;
  sub?: string;
  color?: string;
  roar?: number;
}
