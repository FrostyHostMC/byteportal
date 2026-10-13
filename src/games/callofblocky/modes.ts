/**
 * Call of Blocky's modes, the two teams, and the order a public room plays them in. Plain data:
 * the rules are the server's (`server.ts`, and `briefcase.ts` for The Briefcase's rounds).
 */

export type ModeId = 'ffa' | 'tdm' | 'case';

export interface Mode {
  id: ModeId;
  /** Its name on banners and the scoreboard. */
  name: string;
  /** One line: how you win. */
  goal: string;
  /** Two teams (else everyone for themselves). */
  teams: boolean;
  /** Bots fill the match up to this many fighters (people take their places). */
  fighters: number;
}

/** First to this many kills (free-for-all), or team kills (Team Deathmatch). */
export const FFA_LIMIT = 25;
export const TDM_LIMIT = 75;
/** The Briefcase: first to this many rounds; sides swap after `ROUNDS - 1` rounds. */
export const ROUNDS = 4;

export const MODES: Record<ModeId, Mode> = {
  ffa: { id: 'ffa', name: 'Free-for-all', goal: `First to ${FFA_LIMIT} kills`, teams: false, fighters: 6 },
  tdm: { id: 'tdm', name: 'Team Deathmatch', goal: `First team to ${TDM_LIMIT} kills`, teams: true, fighters: 8 },
  case: { id: 'case', name: 'The Briefcase', goal: `Plant it or stop it · first to ${ROUNDS} rounds`, teams: true, fighters: 8 },
};

export type Team = 0 | 1;

export interface TeamInfo {
  name: string;
  /** Short, in capitals, for the HUD. */
  short: string;
  color: string;
  /** The outfits its fighters wear (indexes into `OUTFITS`): each team looks like itself. */
  outfits: number[];
}

/**
 * The teams: the black suits (the Hitman, the Partner, the Wife, the Boxer, the Boss) against
 * the loud shirts (the Bride, the Bowler, the Crooner, the Kahuna, the Waitress). Their names
 * show in their colour over their heads.
 */
export const TEAMS: [TeamInfo, TeamInfo] = [
  { name: 'The Suits', short: 'SUITS', color: '#ff5c8a', outfits: [0, 1, 3, 6, 9] },
  { name: 'The Shirts', short: 'SHIRTS', color: '#2ec4b6', outfits: [2, 4, 5, 7, 8] },
];

/** A match: a mode on a map (by id). */
export interface MatchPlan {
  mode: ModeId;
  map: string;
}

/**
 * What a public room plays, match after match: every mode on every map, never the same mode or
 * map twice running (round the end to the start too). The maps go round in fives and the modes in
 * threes, so fifteen matches play each pair once. It starts where Call of Blocky always has: a
 * free-for-all on Jackrabbit Lane.
 */
export const ROTATION: MatchPlan[] = [
  { mode: 'ffa', map: 'jackrabbit' },
  { mode: 'tdm', map: 'kahuna' },
  { mode: 'case', map: 'hijacked' },
  { mode: 'ffa', map: 'nukeblock' },
  { mode: 'tdm', map: 'rust' },
  { mode: 'case', map: 'jackrabbit' },
  { mode: 'ffa', map: 'kahuna' },
  { mode: 'tdm', map: 'hijacked' },
  { mode: 'case', map: 'nukeblock' },
  { mode: 'ffa', map: 'rust' },
  { mode: 'tdm', map: 'jackrabbit' },
  { mode: 'case', map: 'kahuna' },
  { mode: 'ffa', map: 'hijacked' },
  { mode: 'tdm', map: 'nukeblock' },
  { mode: 'case', map: 'rust' },
];
