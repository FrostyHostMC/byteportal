import type { PowerId } from './defs';

/**
 * What the heroes' server code tells every screen (`game.clients.send('all', name, data)`, heard
 * with `client.on(name)`), so figures, effects and sounds show what heroes do. Players are named by
 * id (a figure's `player`); points are `[x, y, z]`, rounded to centimetres.
 *
 * Their own screen also reads their movement ability's state (`client.me.abilities.hero`: the
 * cooldowns, the block meter), which every frame carries.
 */
export type P3 = [number, number, number];

export const MSG = {
  /** A swing of the saber's combo began (`Swing`). */
  swing: 'bfh.swing',
  /** The guard went up or down, or broke (`Guard`). */
  guard: 'bfh.guard',
  /** Bolts blocked this step (`Deflects`). */
  deflect: 'bfh.deflect',
  /** Two sabers met: a parry (`Clash`). */
  clash: 'bfh.clash',
  /** A saber (or a power) cut someone (`Cut`). */
  cut: 'bfh.cut',
  /** A power was used, or one that lasts ended (`Power`). */
  power: 'bfh.power',
  /** Lightning under way: who it's striking now (`Zap`). */
  zap: 'bfh.zap',
  /** A rocket in flight: where it is now (`Rocket`). */
  rocket: 'bfh.rocket',
  /** Ground set burning (the flamethrower's): where, for how long (`Burn`). */
  burn: 'bfh.burn',
  /** Bowcaster quarrels burst this step: where (`Burn`, `t` 0). */
  burst: 'bfh.burst',
} as const;

/** A swing: who, which of the combo (0, 1, 2), how long it takes (seconds). */
export interface Swing {
  p: string;
  n: number;
  d: number;
}

/** The guard: up or down (`on`); `broke`: it broke (a stagger); `st`: they're staggered (parried) for this long. */
export interface Guard {
  p: string;
  on: boolean;
  broke?: boolean;
  st?: number;
}

/** Bolts a hero's blade turned this step: each from the blade to where it went (`r`: back at whoever fired it), in the bolt's colour (the gun's item). */
export interface Deflects {
  list: { p: string; w: string; to: P3; r: boolean }[];
}

/** Two blades met at `at`: the parrying hero `p` and the one parried `by`. */
export interface Clash {
  p: string;
  by: string;
  at: P3;
}

/** Someone cut (`at` their chest) by hero `p`'s blade, or thrown by a power. */
export interface Cut {
  p: string;
  at: P3;
}

/**
 * A power: `k` which, `p` whose; `on` false when one that lasts ends (early or on time).
 * - `push`: `hits` those thrown back; `dir` the way (level, unit).
 * - `pull`, `choke`: `target` the one taken; `t` how long (a choke's hold).
 * - `throw`: the saber flies from `from` along `dir` for `dist` blocks and back, `t` seconds in all.
 * - `lightning`: on (held) and off; `zap` messages name who it strikes.
 * - `chain`: `path` the ones it leapt between, in order.
 * - `soresu`, `rage`, `aura`: on for `t` seconds, and off.
 * - `rush`, `leap`: the move began; `land`: a leap came down at `at`, `hits` thrown.
 * - `scatter`: quarrels from `p`, bursting at `path` (each "x,y,z").
 * - `charge`: the bull rush began; `knock`: `target` flattened for `t` seconds.
 * - `roar`: on (enraged for `t` seconds, `hits` staggered) and off.
 * - `rocket`: launched from `from` along `dir`, seeking `target`, numbered `t`; off (`on: false`,
 *   `t` its number) where it went off, `at`.
 * - `flame`: on (held) and off. `jetpack`: lit for `t` seconds of fuel, and out.
 * - `djump`: a second jump in the air (a flip, a spin, a kick of the jetpack: `JUMP`).
 */
export interface Power {
  p: string;
  k: PowerId | 'land' | 'knock' | 'djump';
  on?: boolean;
  t?: number;
  target?: string;
  hits?: string[];
  path?: string[];
  dir?: P3;
  from?: P3;
  dist?: number;
  at?: P3;
}

/** A rocket (numbered `n`) in flight: where it is and which way it's going. */
export interface Rocket {
  n: number;
  at: P3;
  dir: P3;
}

/** Places: burning ground (for `t` seconds), or quarrels that burst (`t` 0). */
export interface Burn {
  list: P3[];
  t: number;
}

/** Lightning from `p`'s hands: who it's striking now (none: into the air ahead). */
export interface Zap {
  p: string;
  hits: string[];
}

/** A point for a message: centimetres. */
export const p3 = (v: { x: number; y: number; z: number }): P3 => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
