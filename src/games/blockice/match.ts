import type { Player } from '@platform';
import { easier, LEVELS, type Level, type LevelId } from './levels';
import type { SkateState } from './moves';
import type { FlightKind } from './protocol';
import type { PuckState } from './puck';
import { ICE, PUCK_HALF, type Side } from './rink';
import type { TeamDef } from './teams';

/**
 * The match as the server's parts share it (`server.ts` runs it, `bots.ts` and `goalies.ts` read
 * it): the two teams, their skaters and goalies, the puck, the clock.
 */

export interface Skater {
  player: Player;
  team: Team;
  /** In net (a bot, always: the game moves it). */
  goalie: boolean;
  /** Their box score: goals, assists, shots on goal, hits, steals; a goalie's saves. */
  g: number;
  a: number;
  sog: number;
  hits: number;
  stl: number;
  saves: number;
  /** Goals in a row (since the other side last scored), and goals since catching fire. */
  streak: number;
  fireMakes: number;
  /** When they can poke or check again (match clock). */
  pokeAt: number;
  checkAt: number;
  /** When they last passed (for an assist) and to whom. */
  passedAt: number;
  passedTo: Skater | null;
  /** A goalie's save (its pose: 1 pad, 2 glove, 3 blocker, 4 a sprawl) and when it was made. */
  save: number;
  saveAt: number;
  /** What their turbo meter was last sent as (undefined: not yet, on this screen of theirs). */
  turboShown?: string;
}

export interface Team {
  index: 0 | 1;
  def: TeamDef;
  /** The goal they attack. */
  side: Side;
  skaters: Skater[];
  goalie: Skater | null;
  score: number;
  shots: number;
}

export type PuckMode = 'held' | 'loose' | 'dead';

/** A shot on its way: how hard, from where, and how the goalie's going to do with it. */
export interface Shot {
  by: Skater;
  speed: number;
  slap: boolean;
  oneTimer: boolean;
  /** How far out it was taken. */
  dist: number;
  /** It's met the goalie (saved or past them), and who's had their go at blocking it. */
  met: boolean;
  blocked: Set<Skater>;
  /** It's on target (else it's wide, high or off the iron, whatever the goalie does). */
  onNet: boolean;
  /** The goalie's chance of stopping it, if it reaches them. */
  save: number;
}

export interface Puck {
  mode: PuckMode;
  /** Who has it (held: on their stick; a goalie's: covered, in the glove). */
  holder: Skater | null;
  /** Loose: its flight, launched when (match clock), what sent it. */
  flight: PuckState | null;
  launchedAt: number;
  kind: FlightKind;
  by: Skater | null;
  /** A pass's receiver. */
  to: Skater | null;
  shot: Shot | null;
  /** When it was taken (held: the goalie lets go of it after a moment). */
  heldAt: number;
}

export type Phase = 'faceoff' | 'live' | 'goal' | 'break' | 'over';

export interface Match {
  teams: [Team, Team];
  puck: Puck;
  phase: Phase;
  /** 1 to 3, 4+ overtime (sudden death). */
  period: number;
  /** Seconds left in the period. */
  clock: number;
  /** When the phase ends (match clock). */
  phaseUntil: number;
  /** A faceoff: the two drawing it, when the puck drops, who won it (pressed first after the drop). */
  draw: { centers: [Skater, Skater]; at: number; won: Skater | null } | null;
  /** How hard the bots play against people (the room's choice, `levels.ts`). */
  level: LevelId;
}

/** The skate ability's live state for a player. */
export const skOf = (p: Player): SkateState => p.abilities.skate as SkateState;

/** Everyone skating out (not the goalies). */
export const allSkaters = (m: Match): Skater[] => [...m.teams[0].skaters, ...m.teams[1].skaters];

/** Everyone, goalies too. */
export const everyone = (m: Match): Skater[] => {
  const out = allSkaters(m);
  for (const t of m.teams) if (t.goalie) out.push(t.goalie);
  return out;
};

export const otherTeam = (m: Match, t: Team): Team => (t === m.teams[0] ? m.teams[1] : m.teams[0]);

/** Someone on a team is a person. */
export const hasPeople = (t: Team): boolean => t.skaters.some((s) => !s.player.bot);

/**
 * How a bot plays: at the room's level in a game with people in it (teammates and opponents alike,
 * so the people make the difference; the bots facing them a step easier while they trail by a lot),
 * as an All-Star when only bots are playing (the attract mode on the home page).
 */
export function levelOf(m: Match, s: Skater): Level {
  const foe = otherTeam(m, s.team);
  if (!hasPeople(foe) && !hasPeople(s.team)) return LEVELS.allstar;
  const l = LEVELS[m.level];
  return hasPeople(foe) && s.team.score - foe.score >= l.comeback ? easier(l) : l;
}

/** The team with the puck (on a stick, or a pass or shot of theirs on its way). */
export function offense(m: Match): Team | null {
  const p = m.puck;
  if (p.mode === 'held' && p.holder) return p.holder.team;
  if (p.mode === 'loose' && p.by && (p.kind === 'shot' || p.kind === 'pass')) return p.by.team;
  return null;
}

/** Which way a player faces, and to their right, on the ice (yaw 0 looks toward -z). */
export function facing(yaw: number) {
  return { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) };
}

/** Where a skater's blade is: out in front, a little to their forehand, on the ice. */
export function blade(p: Player): { x: number; y: number; z: number } {
  const f = facing(p.yaw);
  const q = p.position;
  return { x: q.x + f.fx * 0.95 + f.rx * 0.22, y: ICE + PUCK_HALF, z: q.z + f.fz * 0.95 + f.rz * 0.22 };
}

/** Where the puck is now (held: on the blade; loose: its flight). */
export function puckPos(m: Match): { x: number; y: number; z: number } {
  const p = m.puck;
  if (p.mode === 'held' && p.holder) return blade(p.holder.player);
  if (p.flight) return { x: p.flight.x, y: p.flight.y, z: p.flight.z };
  return { x: 0, y: ICE + PUCK_HALF, z: 0 };
}
