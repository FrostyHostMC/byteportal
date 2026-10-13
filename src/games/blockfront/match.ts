import type { MenuHandle, Player } from '@platform';
import type { ClassId } from './classes';
import type { HeroId } from './heroes/defs';
import { MAPS, type MapSpec, type PostSpec } from './map';
import { MODES, type Mode } from './modes';
import type { Team } from './teams';

/**
 * The match being played, as the server's parts share it (`server.ts` runs it, `conquest.ts` the
 * command posts and the tickets, `bots.ts` asks who's on whose side and where to go). Each room is
 * a worker of its own, so this is that room's.
 */

export interface Fighter {
  player: Player;
  team: Team;
  /** The class they fight as (and spawn as next, unless they've picked a hero). */
  cls: ClassId;
  /** The hero they are now (null: a trooper). */
  hero: HeroId | null;
  /** The hero they've picked to spawn as next (paid for when they spawn). */
  wantHero: HeroId | null;
  /** The hero they were last (Heroes vs Villains: they come back as them). */
  lastHero: HeroId | null;
  /** The post they've picked to spawn at (null: wherever's best). */
  spawnAt: string | null;
  /** Battle points in hand: earned in the fight, spent on heroes. */
  bp: number;
  /** Battle points earned this match, spent or not (the end screen). */
  earned: number;
  /** The heroes they've played this match, in the order they first took them (the end screen). */
  heroesPlayed: HeroId[];
  score: number;
  kills: number;
  deaths: number;
  captures: number;
  /** When they died (-1: alive). */
  diedAt: number;
  spawnedAt: number;
  /** Their last shot: they show on the other side's radar for a moment. */
  firedAt: number;
  menu: MenuHandle | null;
  /** What their radar shows now (only changes go out). */
  radar: string;
  /** Seen from over their shoulder (the default), or through their eyes (V). */
  thirdPerson: boolean;
}

/** A command post as the match has it. */
export interface Post {
  spec: PostSpec;
  owner: Team | null;
  /** Who holds it how firmly: +1 the Rebels', -1 the Empire's, 0 nobody's. */
  control: number;
  /** Living fighters of each side standing in it now. */
  count: [number, number];
  /** Both sides in it: it doesn't move. */
  contested: boolean;
  /** Which way it's going (a side taking it), or null. */
  moving: Team | null;
}

export const match = {
  fighters: new Map<string, Fighter>(),
  mode: MODES.conquest as Mode,
  map: MAPS[0] as MapSpec,
  phase: 'playing' as 'playing' | 'over',
  /** Reinforcements each side has left. */
  tickets: [0, 0] as [number, number],
  posts: [] as Post[],
};

export const fighterOf = (p: Player): Fighter | undefined => match.fighters.get(p.id);

export const teamOf = (p: Player): Team | null => match.fighters.get(p.id)?.team ?? null;

/** Whether `a` may hurt `b` (and bots go for them): the other side. */
export function hostile(a: Player, b: Player): boolean {
  if (a === b) return false;
  const ta = teamOf(a);
  const tb = teamOf(b);
  return ta === null || tb === null || ta !== tb;
}

export const teamFighters = (t: Team): Fighter[] => [...match.fighters.values()].filter((f) => f.team === t);

export const postById = (id: string): Post | undefined => match.posts.find((p) => p.spec.id === id);
