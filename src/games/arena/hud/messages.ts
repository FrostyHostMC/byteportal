import type { IconRef } from '@platform';

/**
 * What the HUD's server part (`hud/part.ts`) tells each screen (`client/hud/`), by message
 * (`game.clients.send`, heard with `client.on`). Only changes go out; a screen that joins late is
 * sent the lot. Points are `[x, y, z]`.
 */
export const MSG = {
  /** Everyone: the fight as it stands (`RunMsg`). */
  run: 'ar.run',
  /** Everyone: the crowd's hype (`HypeMsg`). */
  hype: 'ar.hype',
  /** Everyone, in a party: each fighter's state (`PartyMsg`). */
  party: 'ar.party',
  /** One fighter: their own (`MeMsg`). */
  me: 'ar.me',
  /** One fighter: their gold went up or down (`GoldMsg`). */
  gold: 'ar.gold',
  /** The announcer: one fighter, or everyone (`CallMsg`). */
  call: 'ar.call',
  /** One fighter: a hit of theirs landed (`HitMsg`). */
  hit: 'ar.hit',
  /** Everyone: a monster died (`GoreMsg`). */
  gore: 'ar.gore',
  /** Everyone: the crowd reacts (`CrowdMsg`). */
  crowd: 'ar.crowd',
  /** One fighter: a wave won, their card (`WaveCard`). */
  wave: 'ar.wave',
  /** Everyone: the run is over (`EndMsg`). */
  end: 'ar.end',
  /** One fighter: they reached a level (`LevelMsg`). */
  level: 'ar.level',
  /** Everyone: a kind of monster in for the first time this run, and how to beat it (`FoeMsg`). */
  foe: 'ar.foe',
} as const;

export type Phase = 'intro' | 'waiting' | 'countdown' | 'fighting' | 'intermission' | 'victory' | 'defeat';

export interface RunMsg {
  phase: Phase;
  /** The wave on now (or just won), and the last one before endless. */
  wave: number;
  of: number;
  /** Its name ("The Swarm"). */
  name: string;
  /** Monsters still to beat this wave, and the most there were. */
  left: number;
  total: number;
  /** Whole seconds to the next wave (the countdown, between waves). */
  next: number;
  twist: { name: string; text: string; color: string } | null;
  boss: { name: string; title: string; color: string } | null;
  /** Between waves (and before the first): the one coming, and whether it's a boss's. */
  upcoming: { wave: number; name: string; boss: boolean } | null;
  /** Between waves: how many of those fighting are ready for the next (N), of how many. */
  ready: { n: number; of: number } | null;
  /** Past the run's last wave. */
  endless: boolean;
  /** Whole seconds since the run began, and the monsters slain in it. */
  time: number;
  kills: number;
  /** The map (its id, for the crowd and the music), and its name. */
  map: string;
  mapName: string;
}

export interface HypeMsg {
  /** The crowd's hype, 0..1. */
  v: number;
  /** Seconds of the Crowd's Favour left (0: not now). */
  f: number;
}

export type FighterState = 'up' | 'down' | 'out';

export interface PartyMsg {
  /** Each fighter: their health (0..1, of `max`), whether they're up, down or out (down: `bleed` seconds left), their class. */
  list: { id: string; name: string; hp: number; max: number; state: FighterState; bleed: number; cls: string; gold: number }[];
}

export interface MeMsg {
  gold: number;
  /** Their blessings: each one's name, what it does, its icon, its rarity's colour, how many of it (Berserker II). */
  bless: { name: string; text: string; icon: IconRef; color: string; n: number }[];
  state: FighterState;
  /** Down: seconds left before they bleed out. */
  bleed: number;
}

export interface GoldMsg {
  d: number;
  at?: [number, number, number];
  /** What it was for, when it says (`wave`: the wave's bonus, `boss`, `goblin`, `gift`). */
  why?: string;
}

/**
 * A callout. `k` is what it is, which picks its size, its place and its sting on the screen:
 * `wave`, `final`, `boss`, `endless` and `twist` (a wave begins, the endless waves begin),
 * `favour` (the Crowd's Favour), `blessing` (one of theirs taken, in its
 * rarity's colour), `feat` (a multikill, a parry: `name` says which), `out` and `back` (their own
 * fall and return), `ally` (a friend's fortunes), `victory`, `defeat`.
 */
export interface CallMsg {
  k: 'wave' | 'final' | 'boss' | 'endless' | 'twist' | 'favour' | 'blessing' | 'feat' | 'out' | 'back' | 'ally' | 'victory' | 'defeat';
  /** The kicker over it, the title, the line under it, its colour. */
  q?: string;
  t: string;
  s?: string;
  c?: string;
  /** A feat's name (`double_kill`…), for its sting. */
  name?: string;
}

export interface HitMsg {
  /** The monster (its entity id: its figure's on the screen), how much it took. */
  e: number;
  n: number;
  /** It died of it; it was a boss. */
  k?: 1;
  b?: 1;
  /** How heavy a hit it was, 0..1 (against the monster's health): heavy ones stop time a moment. */
  h: number;
}

export interface GoreMsg {
  at: [number, number, number];
  /** Its blood's colour, and how big it was (its height). */
  c: string;
  s: number;
  b?: 1;
}

/** The crowd: `v` how loud (0..1), `r` how: a cheer, a roar, a gasp, a groan. */
export interface CrowdMsg {
  v: number;
  r: 'cheer' | 'roar' | 'gasp' | 'groan';
}

export interface WaveCard {
  wave: number;
  name: string;
  /** Seconds it took; your kills, gold and damage in it; the party's best (in a party). */
  time: number;
  kills: number;
  gold: number;
  damage: number;
  mvp: { name: string; kills: number; you: boolean } | null;
  /** The gold each fighter was given for winning it. */
  bonus: number;
  /** The next wave's number and name, and whether it's a boss's. */
  next: { wave: number; name: string; boss: boolean } | null;
}

export interface EndMsg {
  won: boolean;
  wave: number;
}

export interface FoeMsg {
  name: string;
  tip: string;
  /** Its colour, and what it is in a fight (`MonsterKind.role`: melee, ranged, swarm…). */
  color: string;
  role: string;
}

export interface LevelMsg {
  level: number;
  unlocks: { kind: string; name: string }[];
  /** It's landing on the end screen (which shows it): only its brass. */
  end?: true;
}
