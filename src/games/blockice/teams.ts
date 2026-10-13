import type { CharacterLook, Uniform } from '@platform';

/**
 * The teams (all made up), their colours, their skaters and their goalie. A game is two of them:
 * the home side in its colours, the visitors in theirs, each sent out in sweaters, breezers and
 * skates (the helmets, sticks and the goalies' pads are the screens': `client/scene.ts`).
 */
export interface TeamDef {
  id: string;
  city: string;
  name: string;
  /** Short, for the scoreboard. */
  abbr: string;
  /** The sweater, its trim, the breezers (pants), the helmet. */
  color: string;
  trim: string;
  pants: string;
  helmet: string;
  /** The bots who skate for them (names and looks), and their goalie. */
  bench: { name: string; look: CharacterLook }[];
  goalie: { name: string; look: CharacterLook };
}

const guy = (skin: string, hair: CharacterLook['hair'], hairColor: string, extra: Partial<CharacterLook> = {}): CharacterLook => ({ build: 'broad', skin, hair, hairColor, ...extra });

export const TEAMS: TeamDef[] = [
  {
    id: 'yetis',
    city: 'Iceberg Bay',
    name: 'Yetis',
    abbr: 'IBY',
    color: '#3fa9f5',
    trim: '#ffffff',
    pants: '#1d3f73',
    helmet: '#1d3f73',
    bench: [
      { name: 'Mats "Snowplow" Lindqvist', look: guy('#f1c9a5', 'swept', '#e3d08a', { facialHair: 'beard' }) },
      { name: 'Andre Belanger', look: guy('#e0a882', 'crew', '#3b2619', { build: 'slim' }) },
      { name: 'Kara Sutter', look: guy('#f1c9a5', 'pony', '#a33a1c', { build: 'slim', curvy: true, face: 'freckles' }) },
    ],
    goalie: { name: 'Big Ollie Frost', look: guy('#f1c9a5', 'long', '#c9a46a', { build: 'heavy', facialHair: 'stubble' }) },
  },
  {
    id: 'blades',
    city: 'Blocktown',
    name: 'Blades',
    abbr: 'BTB',
    color: '#ff7a1a',
    trim: '#16181f',
    pants: '#16181f',
    helmet: '#16181f',
    bench: [
      { name: 'Tommy "Two-Hand" Doyle', look: guy('#e0a882', 'buzz', '#6b4423', { facialHair: 'moustache' }) },
      { name: 'Reggie Okoro', look: guy('#6e4a30', 'short', '#1a1a1a') },
      { name: 'Vic Marchetti', look: guy('#f1c9a5', 'slick', '#1a1a1a', { build: 'heavy' }) },
    ],
    goalie: { name: 'Benny "The Wall" Pratt', look: guy('#c68c62', 'crew', '#1a1a1a', { build: 'heavy', facialHair: 'goatee' }) },
  },
  {
    id: 'rhinos',
    city: 'Redstone',
    name: 'Rhinos',
    abbr: 'RSR',
    color: '#d8262e',
    trim: '#f2f2f2',
    pants: '#2a2c33',
    helmet: '#d8262e',
    bench: [
      { name: 'Dmitri Volkov', look: guy('#f1c9a5', 'buzz', '#2a1c14', { facialHair: 'stubble' }) },
      { name: 'Jean-Luc Gagné', look: guy('#e0a882', 'mohawk', '#2a1c14', { build: 'slim' }) },
      { name: 'Bo Hanley', look: guy('#9b6a46', 'crew', '#1a1a1a', { build: 'heavy', facialHair: 'beard' }) },
    ],
    goalie: { name: 'Ivan "The Vault" Petrov', look: guy('#f1c9a5', 'bald', '#2a1c14', { build: 'heavy', facialHair: 'moustache' }) },
  },
  {
    id: 'jacks',
    city: 'Pinewood',
    name: 'Lumberjacks',
    abbr: 'PWL',
    color: '#1f8a4c',
    trim: '#ffd23f',
    pants: '#123d26',
    helmet: '#123d26',
    bench: [
      { name: 'Gus "Timber" McAllister', look: guy('#e0a882', 'long', '#8a4a1c', { facialHair: 'beard' }) },
      { name: 'Paulie Tremblay', look: guy('#f1c9a5', 'short', '#c9a46a', { build: 'slim' }) },
      { name: 'Sam Running Bear', look: guy('#9b6a46', 'pony', '#1a1a1a', { build: 'slim' }) },
    ],
    goalie: { name: 'Hank Birch', look: guy('#e0a882', 'swept', '#6b4423', { build: 'heavy', facialHair: 'beard' }) },
  },
];

/** A team's kit, over a player's own look: the sweater, the breezers, the skates, and their hair cut close under the helmet. */
export function uniformOf(t: TeamDef): Uniform {
  return { top: 'sweater', topColor: t.color, accent: t.trim, bottom: 'shorts', bottomColor: t.pants, shoes: 'boots', shoeColor: '#15161b', hatHair: true };
}

/** A bot's whole look: theirs, in the team's kit. */
export function botLook(t: TeamDef, look: CharacterLook): CharacterLook {
  return { ...look, ...uniformOf(t) };
}
