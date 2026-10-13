import type { CharacterLook, Uniform } from '@platform';
import type { TeamColor } from './map';

/** Each team's kit, over its players' own avatars: a tunic dyed the team's colour, belted. */
export const UNIFORMS: Record<TeamColor, Uniform> = {
  red: { top: 'tunic', topColor: '#c23a30', accent: '#f4efe2' },
  blue: { top: 'tunic', topColor: '#2f5fb8', accent: '#f4efe2' },
  green: { top: 'tunic', topColor: '#3c9a44', accent: '#f4efe2' },
  yellow: { top: 'tunic', topColor: '#e3b12a', accent: '#3a2a1c' },
};

/** The bots: someone for each team, in its kit (a sword in hand: `held`). */
export const BOT_LOOKS: Record<TeamColor, CharacterLook> = {
  red: { build: 'broad', skin: '#e0a882', hair: 'crew', hairColor: '#8e3b1f', facialHair: 'stubble', bottom: 'trousers', bottomColor: '#3c3028', shoes: 'boots', shoeColor: '#4a3322' },
  blue: { build: 'slim', curvy: true, skin: '#8c5a3a', hair: 'pony', hairColor: '#1c1714', face: 'lashes', bottom: 'trousers', bottomColor: '#2a2f3a', shoes: 'boots', shoeColor: '#2a2226' },
  green: { build: 'heavy', skin: '#c98d64', hair: 'bald', hairColor: '#3b2619', facialHair: 'beard', bottom: 'trousers', bottomColor: '#3a3a2a', shoes: 'boots', shoeColor: '#4a3322' },
  yellow: { build: 'slim', skin: '#f6d7c3', hair: 'swept', hairColor: '#d9b45e', bottom: 'trousers', bottomColor: '#4a3a2a', shoes: 'boots', shoeColor: '#4a3322' },
};

/** The item shop's keeper: a big shopkeeper in an apron. */
export const SHOPKEEPER: CharacterLook = {
  build: 'heavy',
  skin: '#c98d64',
  hair: 'bald',
  hairColor: '#6a4424',
  facialHair: 'moustache',
  top: 'apron',
  topColor: '#e8dcc4',
  accent: '#7a4a2a',
  bottom: 'trousers',
  bottomColor: '#3c4048',
  shoes: 'boots',
  shoeColor: '#6b4a2e',
};
