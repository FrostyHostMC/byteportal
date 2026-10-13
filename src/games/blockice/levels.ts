/**
 * How hard the bots play against people: picked on the team screen (M), for the whole room. Each
 * level sets how good the skaters are (their reads and timing), how close they
 * check and how often they poke and hit, how well they shoot, how much turbo they burn and how fast
 * they skate; how good the goalie a person shoots at is, and how much help the people's own goalie
 * gets. In a game with people in it every bot plays at it, teammates too (the people make the
 * difference); with only bots playing (the home page's attract mode) they play as All-Stars.
 */

export type LevelId = 'rookie' | 'pro' | 'allstar';

export interface Level {
  id: LevelId;
  name: string;
  blurb: string;
  /** Their skill, 0..1 (each bot somewhere in this range): timing, reads, how often they try things. */
  skill: [number, number];
  /** Seconds more between their decisions with the puck. */
  slow: number;
  /** How far off the puck carrier they play (blocks): further gives room to skate and shoot. */
  gap: number;
  /** How often they poke and throw checks (times an All-Star's), and how often a check or a poke on a person lands (times the usual). */
  poke: number;
  check: number;
  hit: number;
  pick: number;
  /** Added to the chance their shots are on target. */
  aim: number;
  /** How much they lean on turbo (0..1), and their skating speed (times the usual). */
  turbo: number;
  pace: number;
  /** Added to the bots' goalie's save chance on a person's shot (negative: easier to score), and to the people's goalie's on a bot's. */
  goalie: number;
  keeper: number;
  /** For a person shooting: added to the chance it's on target. */
  help: number;
  /** A side of people trailing by this many goals: the bots ease off a step (Infinity: never). */
  comeback: number;
}

export const LEVELS: Record<LevelId, Level> = {
  rookie: {
    id: 'rookie',
    name: 'Rookie',
    blurb: 'Wobbly skates, open nets',
    skill: [0.1, 0.3],
    slow: 0.35,
    gap: 2.4,
    poke: 0.3,
    check: 0.12,
    hit: 0.5,
    pick: 0.6,
    aim: -0.12,
    turbo: 0.3,
    pace: 0.86,
    goalie: -0.16,
    keeper: 0.1,
    help: 0.1,
    comeback: 2,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    blurb: 'A fair fight',
    skill: [0.4, 0.6],
    slow: 0.06,
    gap: 1.6,
    poke: 0.7,
    check: 0.35,
    hit: 0.75,
    pick: 0.9,
    aim: -0.03,
    turbo: 0.85,
    pace: 1,
    goalie: -0.04,
    keeper: 0.03,
    help: 0.03,
    comeback: 3,
  },
  allstar: {
    id: 'allstar',
    name: 'All-Star',
    blurb: 'They want your teeth',
    skill: [0.5, 0.8],
    slow: 0,
    gap: 1.2,
    poke: 1,
    check: 1,
    hit: 1,
    pick: 1,
    aim: 0,
    turbo: 1,
    pace: 1,
    goalie: 0,
    keeper: 0,
    help: 0,
    comeback: Infinity,
  },
};

export const LEVEL_ORDER: LevelId[] = ['rookie', 'pro', 'allstar'];

/** A step easier (a comeback). */
export function easier(l: Level): Level {
  const i = LEVEL_ORDER.indexOf(l.id);
  if (i > 0) return LEVELS[LEVEL_ORDER[i - 1]];
  return { ...l, skill: [0, 0.15], poke: l.poke * 0.6, check: l.check * 0.5, aim: l.aim - 0.05, goalie: l.goalie - 0.05 };
}
