import type { MenuHandle, Player } from '@platform';
import { MAPS, type MapSpec } from './map';
import { MODES, type Mode, type Team } from './modes';
import type { Lethal, Primary, Sidearm } from './weapons';
import type { PerkId } from './perks';
import type { KillstreakId, StreakId } from './streaks/kinds';

/**
 * The match being played, as the server's parts share it (`server.ts` runs it, `briefcase.ts`
 * runs The Briefcase's rounds, `bots.ts` asks who's on whose side): the fighters, the mode, the
 * map, the teams' scores. Each room is a worker of its own, so this is that room's.
 */

export interface Fighter {
  player: Player;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  best: number;
  headshots: number;
  /** The Briefcase: cases planted and defused. */
  plants: number;
  defuses: number;
  primary: Primary;
  sidearm: Sidearm;
  /** Their lethal (thrown with G), a few a life. */
  lethal: Lethal;
  outfit: number;
  /** Their side in a team mode (null in a free-for-all). */
  team: Team | null;
  /** When they died (-1: alive). */
  diedAt: number;
  spawnedAt: number;
  lastKillAt: number;
  multi: number;
  uavUntil: number;
  /** How long the UAV they have now lasts in all (its bar drains from full). */
  uavFor: number;
  rushUntil: number;
  /** Killstreaks earned and not yet called in (5 calls in the last one): `streaks/`. */
  streaks: StreakId[];
  /** The perks and killstreaks they've picked (the loadout, L): theirs from their next life. */
  choice: { perks: PerkId[]; killstreaks: KillstreakId[] };
  /** The perks they have this life, one from each tier (`perks.ts`). */
  perks: PerkId[];
  /** The killstreaks they're on toward this life, cheapest first. */
  killstreaks: KillstreakId[];
  /** Their Counter-UAV: the other side's radar is jammed until then; how long it lasts in all. */
  jamUntil: number;
  jamFor: number;
  /** When they were last hurt (Second Wind). */
  hurtAt: number;
  /** Last shot: they show on everyone's radar for a moment. */
  firedAt: number;
  menu: MenuHandle | null;
  /** What their radar shows now (only changes go out). */
  radar: string;
  heartbeat: number;
  chose: boolean;
}

export const match = {
  fighters: new Map<string, Fighter>(),
  mode: MODES.ffa as Mode,
  map: MAPS[0] as MapSpec,
  phase: 'playing' as 'playing' | 'over',
  /** The teams' scores: kills in Team Deathmatch, rounds in The Briefcase. */
  score: [0, 0] as [number, number],
};

export const fighterOf = (p: Player): Fighter | undefined => match.fighters.get(p.id);

export const teamOf = (p: Player): Team | null => match.fighters.get(p.id)?.team ?? null;

/** Whether `a` may hurt `b` (and bots go for them): anyone else in a free-for-all, the other side in a team mode. */
export function hostile(a: Player, b: Player): boolean {
  if (a === b) return false;
  if (!match.mode.teams) return true;
  const ta = teamOf(a);
  const tb = teamOf(b);
  return ta === null || tb === null || ta !== tb;
}

/** A team's fighters. */
export const teamFighters = (t: Team): Fighter[] => [...match.fighters.values()].filter((f) => f.team === t);
