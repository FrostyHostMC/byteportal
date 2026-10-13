import type { HeroId } from './defs';

/**
 * The heroes' numbers, in one place: the saber, the guard, the Force powers, how heroes move.
 * Plain data: the server's rules read it (`saber.ts`, `powers.ts`, `rules.ts`) and so does the
 * movement ability every screen runs (`abilities.ts`).
 *
 * Troopers have 100 health (a heavy 140); heroes 600 to 800 (`defs.ts`). A hero should cut
 * through a few troopers, and fall to fire from several sides, or to detonators.
 */

/** The saber: a three-swing combo, each a slash one way, cleaving everyone in a wide arc ahead. */
export const SABER = {
  /** Each swing of the combo, seconds (a third, heavier one to finish). */
  swings: [0.36, 0.34, 0.46],
  /** How far into a swing its blade crosses (the hit), as a part of it. */
  strike: 0.42,
  /** After a swing ends, the next still follows on in the combo if it starts within this (seconds). */
  follow: 0.38,
  /** A press this long before the saber's ready still counts. */
  buffer: 0.45,
  /** A pause after the combo's last swing. */
  recover: 0.12,
  /** Damage to a trooper: two cuts kill a 100-health one. */
  damage: 55,
  /** The finisher hits harder. */
  finisher: 1.2,
  /** Heroes take this much of it. */
  heroes: 0.42,
  /** Reach from the eye (blocks, level), and the arc ahead it cleaves (degrees each side). */
  reach: 3.2,
  arc: 72,
  /** Up and down: how far above or below the feet a target can be. */
  height: 2.2,
  /** Anyone this near is cut whichever way they are. */
  close: 1.1,
  knockback: 0.35,
};

/** Each swing's whoosh, pitched (the swinger's own screen plays it too: `client/predict.ts`). */
export const SWING_PITCH = [1, 1.12, 0.86];

/**
 * How long a swing of the combo takes (seconds), at a pace (a rage quickens it): as the server
 * times it (`saber.ts`) and as the swinger's own screen predicts it (`client/predict.ts`).
 */
export const swingLength = (n: number, pace: number) => SABER.swings[n] * pace + (n === 2 ? SABER.recover : 0);

/** Holding the guard up (RMB): what it stops, what it costs, how it breaks. */
export const GUARD = {
  /** Degrees each side of where they look that it covers (a 150° front). */
  arc: 75,
  /** The meter, and what each thing blocked costs. */
  meter: 100,
  bolt: 5,
  parry: 20,
  /** Lightning into the guard, a second. */
  lightning: 30,
  /** It refills this fast, once the guard's been down (or quiet) this long. */
  refill: 28,
  refillAfter: 0.7,
  /** Emptied: the guard breaks for this long (no blocking; a stagger). */
  broken: 1.8,
  /** A bolt blocked goes back at whoever fired it this often (else off somewhere), doing this much. */
  reflect: 0.35,
  reflectDamage: 22,
  /** A parried swing: what gets through, and how long the one who swung is staggered. */
  parried: 0.15,
  stagger: 0.55,
  /** Lightning into the guard: what gets through. */
  lightningThrough: 0.25,
};

/** What gets through to a hero: blaster bolts (they shrug off much of it); explosions whole. */
export const TOUGH = { blaster: 0.6 };

/** How heroes move (the movement ability, `abilities.ts`, and the server's `player.speed`). */
export const MOVE = {
  /** Times a trooper's speeds. */
  speed: 1.2,
  /** The guard up: times their speed (walking; sprinting it's slower still). */
  block: 0.55,
  blockSprint: 0.42,
  /** Each swing steps them forward this fast (blocks a second), at most this often. */
  lunge: 6.5,
  lungeEvery: 0.28,
};

/**
 * A hero's jump (the movement ability, `abilities.ts`), as Battlefront's heroes jump: a big, floaty
 * arc while Space is held, a short hop when it's tapped. Troopers fall at 30 blocks a second a
 * second (`shared.ts`); a hero's gravity is that times:
 * - `up` on the way up with Space held, `cut` once it's let go (the rise cut short);
 * - `hang` near the top (upward or downward speed under `band`), with Space held: they linger;
 * - `fall` coming down with Space held, no faster than `maxFall` (a slow, controlled descent),
 *   `drop` once it's let go.
 * `v0`: the launch (blocks a second); `air`: steering in the air, times a trooper's; `double`: a
 * second press in the air, the upward speed it gives (0: none), `push` along the way they steer;
 * `flip`: what their figure does with it. After landing they keep their way a moment (`soft`
 * seconds, a soft landing, not a dead stop).
 *
 * Luke Skyblocker, Ben Kenoblock and Emperor Palpablock float (Luke most); Darth Voxel launches
 * hard and comes down heavy; Chewblocca jumps strong with no Force in it; Boba Fetch's second
 * press is a kick of his jetpack. (A full held jump, measured in `tests/headless/blockfront-heroes.ts`.)
 */
export interface Jump {
  v0: number;
  up: number;
  cut: number;
  hang: number;
  band: number;
  fall: number;
  maxFall: number;
  drop: number;
  air: number;
  double: number;
  push: number;
  flip: 'flip' | 'spin' | 'jet' | null;
  soft: number;
}

const FORCE_JUMP: Jump = { v0: 8.1, up: 0.5, cut: 1.3, hang: 0.24, band: 1.5, fall: 0.45, maxFall: 4.5, drop: 1.2, air: 2.2, double: 6.8, push: 1.5, flip: 'flip', soft: 0.22 };

export const JUMP: Record<HeroId, Jump> = {
  luke: { ...FORCE_JUMP, v0: 8.3, up: 0.48, fall: 0.42, maxFall: 4.2, air: 2.5, double: 7.2, push: 2 },
  ben: FORCE_JUMP,
  emperor: { ...FORCE_JUMP, fall: 0.4, maxFall: 4, air: 2, flip: 'spin' },
  vader: { ...FORCE_JUMP, v0: 9, up: 0.62, hang: 0.55, fall: 0.8, maxFall: 8, drop: 1.25, air: 1.5, double: 6, push: 0.8, flip: null, soft: 0.14 },
  chewie: { ...FORCE_JUMP, v0: 9.5, up: 0.95, cut: 1.25, hang: 1, fall: 1, maxFall: 60, drop: 1.1, air: 1.3, double: 0, push: 0, flip: null, soft: 0.12 },
  boba: { ...FORCE_JUMP, v0: 8.8, up: 0.9, cut: 1.3, hang: 0.9, fall: 0.9, maxFall: 60, drop: 1.1, air: 1.6, double: 7.5, push: 1.5, flip: 'jet', soft: 0.15 },
};

/** A press of Space this long before landing still jumps as they land. */
export const JUMP_BUFFER = 0.15;

export const POWERS = {
  /** Heroes take this much of a power's damage (the saber's is `SABER.heroes`). */
  heroes: 0.45,
  /** How far off the crosshair a targeted power (pull, choke, chain) looks for someone (degrees). */
  aim: 16,
  push: { range: 9, arc: 55, damage: 30, out: 15, up: 7.5 },
  rush: { time: 0.32, speed: 25, exit: 8, radius: 1.6, damage: 60 },
  leap: { speed: 15, up: 12.5, gravity: 0.85, control: 0.25, radius: 4.8, damage: 45, out: 10, up2: 6 },
  pull: { range: 17, time: 0.4, stun: 1.3, heroStun: 0.5, damage: 15, lands: 1.9 },
  soresu: { speed: 0.72, reflect: 0.7, reflectDamage: 30 },
  throw: { range: 16, out: 0.5, back: 0.5, radius: 1.5, damage: 48 },
  choke: { range: 14, time: 3, dps: 42, lift: 1.1, rise: 0.45, speed: 0.35 },
  rage: { speed: 1.22, pace: 0.75, damage: 1.4 },
  lightning: { range: 11, arc: 32, dps: 62, speed: 0.5, zap: 0.12 },
  chain: { range: 18, jump: 8, jumps: 4, damage: 55, falloff: 0.78 },
  aura: { radius: 5.5, every: 0.25, drain: 8 },
  // Chewblocca's.
  /** Five quarrels in a fan (degrees across it), each hitting and bursting as the bowcaster's do. */
  scatter: { quarrels: 5, fan: 26, damage: 36 },
  /** A bull rush (a movement ability): its seconds and speed; who it meets is thrown and flattened. */
  charge: { time: 0.75, speed: 13.5, exit: 6, radius: 1.5, damage: 45, out: 11, up: 5, down: 1.3, heroDown: 0.45 },
  /** Enraged: a roar that staggers everyone near; for a while he takes less and mends fast. */
  roar: { radius: 6.5, damage: 12, out: 7, stagger: 0.8, taken: 0.5, mend: 28 },
  // Boba Fetch's.
  /** A rocket from his wrist: its speed, how hard it turns toward the one aimed at, how long it flies, its blast. */
  rocket: { speed: 30, turn: 2.4, life: 2.4, radius: 1.3, damage: [115, 25] as [number, number], reach: 3.8, knockback: 1.3, range: 45 },
  /** Fire from his wrist, held: a cone, a second's harm to all in it; the ground it reaches burns a while. */
  flame: { range: 7.5, arc: 24, dps: 58, speed: 0.6, patch: 0.35, burns: 2.6, burn: 22, burnRadius: 1.2 },
  /** The jetpack (a movement ability): lift off, then hover and strafe on its fuel; Space climbs, crouch drops. */
  jetpack: { lift: 12, climb: 6.5, drop: -6, hover: 0, control: 3.2, speed: 1.35, gravity: 0.1 },
};

/** The bowcaster's quarrels burst where they hit: a small blast, a push. */
export const QUARREL = { radius: 2.3, damage: [30, 8] as [number, number], knockback: 0.9 };

/** A hero's health doesn't come back as a trooper's does: only slowly, a while after being hurt. */
export const REGEN = {
  after: 8,
  perSecond: 4,
  /** A rise in a step under this is the game's regeneration (held back); more is a heal (it stands). */
  step: 4,
};
