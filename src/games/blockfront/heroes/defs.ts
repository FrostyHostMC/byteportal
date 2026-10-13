import type { Team } from '../teams';

/**
 * The heroes: who they are, whose side they fight on, and their three powers (Q, E, F). Plain data
 * both sides read (the spawn menu, the hero HUD). What they do is the server's (`rules.ts`,
 * `saber.ts`, `powers.ts`; the numbers in `tuning.ts`); how they look is the screens' (`client/`).
 */

export type HeroId = 'luke' | 'ben' | 'chewie' | 'vader' | 'emperor' | 'boba';

/**
 * What a power does (`powers.ts`; Saber Rush, Force Leap, the Wookiee Charge and the jetpack are
 * movement abilities: `abilities.ts`).
 */
export type PowerId = 'push' | 'rush' | 'leap' | 'pull' | 'soresu' | 'throw' | 'choke' | 'rage' | 'lightning' | 'chain' | 'aura' | 'scatter' | 'charge' | 'roar' | 'rocket' | 'flame' | 'jetpack';

export interface PowerInfo {
  id: PowerId;
  /** The key that uses it. */
  key: 'KeyQ' | 'KeyE' | 'KeyF';
  name: string;
  /** Seconds before it can be used again (from when it's used; a held one, from when it's let go). */
  cooldown: number;
  /** Seconds it lasts, for one that lasts (a stance, an aura; the longest a held one is held). */
  lasts?: number;
  /** Held down to use (Force Lightning). */
  hold?: boolean;
  /** One line for the HUD and the spawn menu. */
  blurb: string;
}

export interface HeroInfo {
  id: HeroId;
  name: string;
  /** Who they are, in a few words. */
  title: string;
  team: Team;
  health: number;
  /** Their colour: a saber's (the blade, its glow), or the HUD's accent for a hero with a gun. */
  blade: string;
  /** What they fight with: their saber (`saber_<id>`), or a blaster of their own (`guns.ts`). */
  weapon: string;
  /** Battle points it costs to play them. */
  cost: number;
  powers: [PowerInfo, PowerInfo, PowerInfo];
}

export const HEROES: Record<HeroId, HeroInfo> = {
  luke: {
    id: 'luke',
    name: 'Luke Skyblocker',
    title: 'Jedi Knight',
    team: 0,
    health: 650,
    blade: '#5dff6a',
    weapon: 'saber_luke',
    cost: 1200,
    powers: [
      { id: 'push', key: 'KeyQ', name: 'Force Push', cooldown: 8, blurb: 'Throws back everyone in front of him' },
      { id: 'rush', key: 'KeyE', name: 'Saber Rush', cooldown: 9, blurb: 'Dashes ahead, cutting through all in the way' },
      { id: 'leap', key: 'KeyF', name: 'Force Leap', cooldown: 11, blurb: 'A great leap, landing with a shockwave' },
    ],
  },
  ben: {
    id: 'ben',
    name: 'Ben Kenoblock',
    title: 'Jedi Master',
    team: 0,
    health: 600,
    blade: '#4db8ff',
    weapon: 'saber_ben',
    cost: 1200,
    powers: [
      { id: 'push', key: 'KeyQ', name: 'Force Push', cooldown: 8, blurb: 'Throws back everyone in front of him' },
      { id: 'pull', key: 'KeyE', name: 'Force Pull', cooldown: 11, blurb: 'Drags an enemy to his blade, stunned' },
      { id: 'soresu', key: 'KeyF', name: 'Soresu Stance', cooldown: 18, lasts: 5, blurb: 'Deflects everything, from every side, for a while' },
    ],
  },
  chewie: {
    id: 'chewie',
    name: 'Chewblocca',
    title: 'Wookiee Warrior',
    team: 0,
    health: 850,
    blade: '#e8a24a',
    weapon: 'hero_bowcaster',
    cost: 1200,
    powers: [
      { id: 'scatter', key: 'KeyQ', name: 'Scatter Shot', cooldown: 9, blurb: 'Five quarrels at once, in a fan' },
      { id: 'charge', key: 'KeyE', name: 'Wookiee Charge', cooldown: 10, blurb: 'A bull rush that flattens everyone in the way' },
      { id: 'roar', key: 'KeyF', name: 'Enraged', cooldown: 18, lasts: 6, blurb: 'A roar that staggers all near; tougher, and mending fast' },
    ],
  },
  vader: {
    id: 'vader',
    name: 'Darth Voxel',
    title: 'Dark Lord of the Sith',
    team: 1,
    health: 800,
    blade: '#ff2a2a',
    weapon: 'saber_vader',
    cost: 1200,
    powers: [
      { id: 'throw', key: 'KeyQ', name: 'Saber Throw', cooldown: 9, blurb: 'Hurls his saber out and back through the ranks' },
      { id: 'choke', key: 'KeyE', name: 'Force Choke', cooldown: 13, lasts: 3, blurb: 'Lifts one enemy by the throat' },
      { id: 'rage', key: 'KeyF', name: 'Focused Rage', cooldown: 20, lasts: 7, blurb: 'Faster, and every swing hits harder' },
    ],
  },
  emperor: {
    id: 'emperor',
    name: 'Emperor Palpablock',
    title: 'Sith Master',
    team: 1,
    health: 600,
    blade: '#ff3355',
    weapon: 'saber_emperor',
    cost: 1200,
    powers: [
      { id: 'lightning', key: 'KeyQ', name: 'Force Lightning', cooldown: 6, lasts: 3, hold: true, blurb: 'Lightning from both hands, for as long as he holds it' },
      { id: 'chain', key: 'KeyE', name: 'Chain Lightning', cooldown: 10, blurb: 'A bolt that leaps from enemy to enemy' },
      { id: 'aura', key: 'KeyF', name: 'Dark Aura', cooldown: 18, lasts: 6, blurb: 'Drains everyone close by, healing him' },
    ],
  },
  boba: {
    id: 'boba',
    name: 'Boba Fetch',
    title: 'Bounty Hunter',
    team: 1,
    health: 650,
    blade: '#7fd08a',
    weapon: 'hero_ee3',
    cost: 1200,
    powers: [
      { id: 'rocket', key: 'KeyQ', name: 'Wrist Rocket', cooldown: 8, blurb: 'A rocket that seeks whoever is under the crosshair' },
      { id: 'flame', key: 'KeyE', name: 'Flamethrower', cooldown: 8, lasts: 3, hold: true, blurb: 'A cone of fire, for as long as he holds it; the ground burns' },
      { id: 'jetpack', key: 'KeyF', name: 'Jetpack', cooldown: 13, lasts: 4.5, blurb: 'Up and away: hover, strafe and shoot from the air (Space climbs)' },
    ],
  },
};

export const HERO_IDS = Object.keys(HEROES) as HeroId[];

/** The heroes who fight with a saber (the rest carry a blaster of their own). */
export const SABER_HEROES = HERO_IDS.filter((id) => HEROES[id].weapon === `saber_${id}`);
export const usesSaber = (id: HeroId | null) => !!id && HEROES[id].weapon === `saber_${id}`;

/** The hero whose weapon an item is (their saber or their blaster), if it's one. */
export const heroOfWeapon = (item: string | null | undefined): HeroId | null => (item ? (HERO_IDS.find((id) => HEROES[id].weapon === item) ?? null) : null);

/** The item each hero's saber is (`saber_<id>`). */
export const saberOf = (id: HeroId) => `saber_${id}`;

/** The hero whose saber an item is, if it's one. */
export const heroOfSaber = (item: string | null | undefined): HeroId | null => {
  const id = item?.startsWith('saber_') ? item.slice(6) : null;
  return id && id in HEROES ? (id as HeroId) : null;
};

/** A hero as the movement ability numbers them (`HeroMove.h`): 1 and up, 0 for nobody. */
export const heroNumber = (id: HeroId | null) => (id ? HERO_IDS.indexOf(id) + 1 : 0);
export const heroByNumber = (n: number): HeroId | null => HERO_IDS[n - 1] ?? null;
