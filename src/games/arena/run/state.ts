import { MAPS, type ArenaMap } from '../maps';

/**
 * `intro`: not begun. `waiting`: everyone left, and the next to arrive begins it afresh.
 * `countdown`: choosing classes before the first wave. `victory`: the run's last wave won, the
 * result up (and, kept fighting, `intermission` again into the endless waves).
 */
export type Phase = 'intro' | 'waiting' | 'countdown' | 'fighting' | 'intermission' | 'victory' | 'defeat';

const fresh = () => ({
  phase: 'intro' as Phase,
  wave: 0,
  /** Past the run's last wave: the endless waves, for a best. */
  endless: false,
  /** Monsters still to come this wave (types), and seconds to the next. */
  queue: [] as string[],
  spawnTimer: 0,
  /** When the next wave begins (between waves), or the first (the countdown). */
  nextWaveAt: 0,
  kills: 0,
  damageDealt: 0,
  damageTaken: 0,
  startedAt: 0,
  lastBeep: 0,
  /** This wave's twist (an id of the director's), and the last one rolled. */
  twist: null as string | null,
  lastTwist: null as string | null,
  /** This wave's boss (its type), if any. */
  boss: null as string | null,
});

/** The fight as it stands (one per game: a room's server runs its own copy of this module). */
export const state = fresh();

let current: ArenaMap = MAPS[0];

/** The map this fight is on. */
export const map = (): ArenaMap => current;
export function setMap(m: ArenaMap) {
  current = m;
}

export function resetState() {
  Object.assign(state, fresh());
}

/**
 * Each fighter's own fight (by player id, from when they're armed): the wave they joined in (0:
 * from the start), whether they've fallen (or gone down), whether they've been hurt this wave, the
 * kinds of weapon they've slain with, their class, and their tallies for the end screen.
 */
export interface Run {
  from: number;
  fell: boolean;
  hurt: boolean;
  arms: Set<string>;
  cls: string;
  /** When they were armed (the match's clock): a class may be changed for a little while after. */
  armedAt: number;
  kills: number;
  /** Gold earned (not counting what they came in with), and spent. */
  gold: number;
  spent: number;
  damage: number;
  revives: number;
  downs: number;
  /** Blessings drawn again at the shop (each dearer). */
  rerolls: number;
}
export const runs = new Map<string, Run>();

export const newRun = (from: number, now: number, cls: string): Run => ({ from, fell: false, hurt: false, arms: new Set(), cls, armedAt: now, kills: 0, gold: 0, spent: 0, damage: 0, revives: 0, downs: 0, rerolls: 0 });

/** Fighting, or between waves: a fight's in progress. */
export const inFight = () => state.phase === 'countdown' || state.phase === 'fighting' || state.phase === 'intermission';
