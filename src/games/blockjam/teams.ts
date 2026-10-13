import type { CharacterLook, Uniform } from '@platform';

/**
 * The teams (all made up), their colours and their benches of bots. A game is two of them: the
 * home side in its colours, the visitors in theirs, each sent out in tank tops and shorts.
 */
export interface TeamDef {
  id: string;
  city: string;
  name: string;
  /** Short, for the scoreboard. */
  abbr: string;
  /** The jersey, its trim, the shorts, the shoes. */
  color: string;
  trim: string;
  shorts: string;
  shoes: string;
  /** The bots who play for them (names and looks). */
  bench: { name: string; look: CharacterLook }[];
}

const dude = (skin: string, hair: CharacterLook['hair'], hairColor: string, extra: Partial<CharacterLook> = {}): CharacterLook => ({ build: 'broad', skin, hair, hairColor, ...extra });

export const TEAMS: TeamDef[] = [
  {
    id: 'blaze',
    city: 'Blocktown',
    name: 'Blaze',
    abbr: 'BLZ',
    color: '#ff6b1a',
    trim: '#ffffff',
    shorts: '#ff6b1a',
    shoes: '#f5f5f5',
    bench: [
      { name: 'Dez "Torch" Parker', look: dude('#6e4a30', 'buzz', '#1a1a1a', { facialHair: 'goatee' }) },
      { name: 'Ricky Flint', look: dude('#e0a882', 'swept', '#c9a46a', { build: 'slim' }) },
      { name: 'Big Moe Okafo', look: dude('#4a3020', 'bald', '#1a1a1a', { build: 'heavy', facialHair: 'beard' }) },
      { name: 'Tash Rivera', look: dude('#c68c62', 'pony', '#2a1c14', { build: 'slim', curvy: true, face: 'lashes' }) },
    ],
  },
  {
    id: 'cubes',
    city: 'Cobalt City',
    name: 'Cubes',
    abbr: 'CCC',
    color: '#2f6fe0',
    trim: '#ffd23f',
    shorts: '#1d4fb8',
    shoes: '#1c1c22',
    bench: [
      { name: 'Jalen "Ice" Brooks', look: dude('#6e4a30', 'afro', '#1a1a1a', { build: 'slim' }) },
      { name: 'Vinnie Sato', look: dude('#f1c9a5', 'slick', '#1a1a1a', { face: 'shades' }) },
      { name: 'Hank Dobbs', look: dude('#e0a882', 'crew', '#6b4423', { build: 'heavy', facialHair: 'moustache' }) },
      { name: 'Nia Kamau', look: dude('#4a3020', 'bun', '#1a1a1a', { build: 'slim', curvy: true }) },
    ],
  },
  {
    id: 'rockets',
    city: 'Redstone',
    name: 'Rockets',
    abbr: 'RSR',
    color: '#e0303a',
    trim: '#1c1c22',
    shorts: '#1c1c22',
    shoes: '#e0303a',
    bench: [
      { name: 'Marcus Vane', look: dude('#9b6a46', 'mohawk', '#1a1a1a') },
      { name: 'Sly Kowalski', look: dude('#f1c9a5', 'short', '#a33a1c', { facialHair: 'stubble' }) },
    ],
  },
  {
    id: 'gators',
    city: 'Swamp Lake',
    name: 'Gators',
    abbr: 'SLG',
    color: '#2bb673',
    trim: '#f2f2f2',
    shorts: '#1b7a4b',
    shoes: '#f2f2f2',
    bench: [
      { name: 'Otis "Chomp" Bell', look: dude('#6e4a30', 'crew', '#1a1a1a', { build: 'heavy' }) },
      { name: 'Lena Voss', look: dude('#e0a882', 'bob', '#c9a46a', { curvy: true, build: 'slim' }) },
    ],
  },
];

/** A team's kit, over a player's own look. */
export function uniformOf(t: TeamDef): Uniform {
  return { top: 'tank', topColor: t.color, accent: t.trim, bottom: 'shorts', bottomColor: t.shorts, shoes: 'sneakers', shoeColor: t.shoes };
}

/** A bot's whole look: theirs, in the team's kit. */
export function botLook(t: TeamDef, look: CharacterLook): CharacterLook {
  return { ...look, ...uniformOf(t) };
}
