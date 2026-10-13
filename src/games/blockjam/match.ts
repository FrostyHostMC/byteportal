import type { Player } from '@platform';
import type { BallState } from './ball';
import { HALF_LENGTH, type Side } from './court';
import { easier, LEVELS, type Level, type LevelId } from './levels';
import type { JamState } from './moves';
import type { FlightKind } from './protocol';
import type { TeamDef } from './teams';

/**
 * The match as the server's parts share it (`server.ts` runs it, `bots.ts` reads it): the two
 * teams and their ballers, the ball, the clocks.
 */

export interface Baller {
  player: Player;
  team: Team;
  /** Their box score. */
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  dunks: number;
  threes: number;
  /** Baskets in a row (since the other side last scored), and baskets since catching fire. */
  streak: number;
  fireMakes: number;
  /** When they can try to steal or shove again (match clock). */
  stealAt: number;
  shoveAt: number;
  /** What their turbo meter was last sent as (undefined: not yet, on this screen of theirs). */
  turboShown?: string;
  /** When they last passed (for an assist) and to whom. */
  passedAt: number;
  passedTo: Baller | null;
}

export interface Team {
  index: 0 | 1;
  def: TeamDef;
  /** The basket they attack. */
  side: Side;
  ballers: Baller[];
  score: number;
}

export type BallMode = 'held' | 'flight' | 'dead';

export interface Ball {
  mode: BallMode;
  /** Who has it (held). */
  holder: Baller | null;
  /** Its flight (flight), and when it was launched (match clock). */
  flight: BallState | null;
  launchedAt: number;
  kind: FlightKind;
  /** Who sent it flying, and for a shot what it's worth and whether it's still live (untouched). */
  by: Baller | null;
  points: number;
  /** A pass's receiver. */
  to: Baller | null;
  /** It's touched the rim, the board or the floor since it was shot (anyone may grab it now). */
  touched: boolean;
  /** Dead until (match clock), then who gets it. */
  deadUntil: number;
  inbound: Team | null;
  /** A dunk under way: the dunker (the ball's in their hands). */
  dunker: Baller | null;
  /** Who's had their one try at blocking this shot or dunk. */
  tried: Set<Baller>;
}

export type Phase = 'tip' | 'live' | 'break' | 'over';

export interface Match {
  teams: [Team, Team];
  ball: Ball;
  phase: Phase;
  /** 1 to 4, 5+ overtime. */
  quarter: number;
  /** Seconds left in the quarter, and on the shot clock. */
  clock: number;
  shotClock: number;
  /** When the phase ends (break, tip, over: match clock). */
  phaseUntil: number;
  /** Which team gets the ball to start the next quarter. */
  nextPossession: 0 | 1;
  /** How hard the bots play against people (the room's choice, `levels.ts`). */
  level: LevelId;
}

/** The jam ability's live state for a player. */
export const jamOf = (p: Player): JamState => p.abilities.jam as JamState;

/** Everyone on the floor. */
export const allBallers = (m: Match): Baller[] => [...m.teams[0].ballers, ...m.teams[1].ballers];

/** The other team. */
export const otherTeam = (m: Match, t: Team): Team => (t === m.teams[0] ? m.teams[1] : m.teams[0]);

/** The team with the ball (holding it, or the last to shoot or pass it while it flies). */
export function offense(m: Match): Team | null {
  const b = m.ball;
  if (b.mode === 'held' && b.holder) return b.holder.team;
  if (b.mode === 'flight' && b.by && (b.kind === 'shot' || b.kind === 'pass')) return b.by.team;
  return null;
}

/** Someone on a team is a person. */
export const hasPeople = (t: Team): boolean => t.ballers.some((b) => !b.player.bot);

/**
 * How a bot plays: at the room's level in a game with people in it (teammates and opponents alike,
 * so the people make the difference; the bots facing them a step easier while they trail by a lot),
 * as an All-Star when only bots are playing (the attract mode on the home page).
 */
export function levelOf(m: Match, b: Baller): Level {
  const foe = otherTeam(m, b.team);
  if (!hasPeople(foe) && !hasPeople(b.team)) return LEVELS.allstar;
  const l = LEVELS[m.level];
  return hasPeople(foe) && b.team.score - foe.score >= l.comeback ? easier(l) : l;
}

/** Where a side takes the ball out after a basket (or a turnover): its own baseline, beside the key. */
export function inboundSpot(t: Team): { x: number; z: number } {
  return { x: -t.side * (HALF_LENGTH - 0.9), z: 3.2 };
}

/** Where the ball is now (held: about the holder's hands; flying: its flight). */
export function ballPos(m: Match): { x: number; y: number; z: number } {
  const b = m.ball;
  if (b.mode === 'held' && b.holder) {
    const p = b.holder.player.position;
    return { x: p.x, y: p.y + 1.1, z: p.z };
  }
  if (b.flight) return { x: b.flight.x, y: b.flight.y, z: b.flight.z };
  return { x: 0, y: 66, z: 0 };
}
