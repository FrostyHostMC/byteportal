/**
 * Blockfront's modes, and what a public room plays match after match. Plain data: the rules are
 * the server's (`server.ts`, and `conquest.ts` for the posts and the tickets).
 */

export type ModeId = 'conquest' | 'hvv';

export interface Mode {
  id: ModeId;
  name: string;
  /** One line: how you win. */
  goal: string;
  /** Fighters a side (people and bots). */
  side: number;
  /** Reinforcements a side: every death costs one. */
  tickets: number;
  /** The command posts are fought over (else they're only where each side spawns). */
  posts: boolean;
  /** Everyone fights as a hero. */
  heroes: boolean;
  /** Seconds a match lasts at most. */
  time: number;
}

export const MODES: Record<ModeId, Mode> = {
  conquest: { id: 'conquest', name: 'Conquest', goal: 'Hold the command posts and run the other side out of reinforcements', side: 10, tickets: 250, posts: true, heroes: false, time: 16 * 60 },
  hvv: { id: 'hvv', name: 'Heroes vs Villains', goal: 'Heroes only, three a side: the first side to run the other out of lives wins', side: 3, tickets: 20, posts: false, heroes: true, time: 10 * 60 },
};

/** A match: a mode on a map (by id). */
export interface MatchPlan {
  mode: ModeId;
  map: string;
}

/** What a public room plays, match after match: mostly Conquest on each map in turn, now and then the heroes' brawl. */
export const ROTATION: MatchPlan[] = [
  { mode: 'conquest', map: 'spaceport' },
  { mode: 'conquest', map: 'frostline' },
  { mode: 'hvv', map: 'spaceport' },
  { mode: 'conquest', map: 'spaceport' },
  { mode: 'conquest', map: 'frostline' },
  { mode: 'hvv', map: 'frostline' },
];
