/**
 * How hard the bots play against people: picked on the team screen (M), for the whole room. Each
 * level sets how good the bots are (their reads and timing), how close they guard and how often
 * they reach, shove and leap, how well they shoot, how much turbo they burn and how fast they run,
 * and how much the rules help a person's own shots. In a game with people in it every bot plays at
 * it, teammates too (the people make the difference); with only bots playing (the home page's
 * attract mode) they play as All-Stars.
 */

export type LevelId = 'rookie' | 'pro' | 'allstar';

export interface Level {
  id: LevelId;
  name: string;
  blurb: string;
  /** Their skill, 0..1 (each bot somewhere in this range): timing, reads, how often they try things. */
  skill: [number, number];
  /** Seconds more between their decisions with the ball. */
  slow: number;
  /** How far off the ball they guard it (blocks): further gives room to shoot and drive. */
  gap: number;
  /** How often they swipe, shove and leap at a shot (times an All-Star's). */
  steal: number;
  shove: number;
  leap: number;
  /** The chance a leap at a person's shot swats it (an All-Star's: 0.55), a swipe takes it (times the usual). */
  swat: number;
  pick: number;
  /** Added to the chance their own shots go in. */
  aim: number;
  /** How much they lean on turbo (0..1), and their running speed (times the usual). */
  turbo: number;
  pace: number;
  /** For a person shooting over them: added to the chance it goes in, and how much a close guard costs (times the usual). */
  help: number;
  contest: number;
  /** A side of people trailing by this much: the bots ease off a step (Infinity: never). */
  comeback: number;
}

export const LEVELS: Record<LevelId, Level> = {
  rookie: {
    id: 'rookie',
    name: 'Rookie',
    blurb: 'Slow hands, open looks',
    skill: [0.1, 0.3],
    slow: 0.35,
    gap: 2.1,
    steal: 0.25,
    shove: 0.12,
    leap: 0.3,
    swat: 0.3,
    pick: 0.6,
    aim: -0.12,
    turbo: 0.3,
    pace: 0.88,
    help: 0.08,
    contest: 0.45,
    comeback: 6,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    blurb: 'A fair fight',
    skill: [0.3, 0.5],
    slow: 0.15,
    gap: 1.6,
    steal: 0.5,
    shove: 0.35,
    leap: 0.6,
    swat: 0.42,
    pick: 0.8,
    aim: -0.05,
    turbo: 0.65,
    pace: 0.95,
    help: 0.03,
    contest: 0.7,
    comeback: 10,
  },
  allstar: {
    id: 'allstar',
    name: 'All-Star',
    blurb: 'They want your lunch',
    skill: [0.5, 0.8],
    slow: 0,
    gap: 1.1,
    steal: 1,
    shove: 1,
    leap: 1,
    swat: 0.55,
    pick: 1,
    aim: 0,
    turbo: 1,
    pace: 1,
    help: 0,
    contest: 1,
    comeback: Infinity,
  },
};

export const LEVEL_ORDER: LevelId[] = ['rookie', 'pro', 'allstar'];

/** A step easier (a comeback). */
export function easier(l: Level): Level {
  const i = LEVEL_ORDER.indexOf(l.id);
  if (i > 0) return LEVELS[LEVEL_ORDER[i - 1]];
  // Already a rookie: easier still.
  return { ...l, skill: [0, 0.15], steal: l.steal * 0.6, shove: l.shove * 0.5, aim: l.aim - 0.05 };
}
