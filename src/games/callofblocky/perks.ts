import type { Fighter } from './match';
import { isStreakWeapon } from './streaks/kinds';

/**
 * Perks: each fighter takes one from each of the three tiers (the loadout, L), theirs from their
 * next life. What they do is the server's, where each is checked:
 *
 * - Tier 1. **Lightweight**: a little faster on their feet (`speedOf`). **Flak Jacket**: frags
 *   and fire take much less off them (`perkDamage`). **Ghost**: they don't show on the other
 *   side's UAV (the radar, `server.ts`). **Scavenger**: an ammo bag gives their lethals back too.
 * - Tier 2. **Hardline**: every killstreak comes a kill sooner (`streakCost`). **Hardened**:
 *   their bullets hit harder through walls. **Warlord**: one more lethal a life. **Sleight of
 *   Hand**: they reload twice as fast (the gun kit's `setReloadSpeed`, their screen too).
 * - Tier 3. **Low Profile**: firing doesn't put them on anyone's radar. **Second Wind**: their
 *   health starts coming back sooner after a hit. **Danger Close**: their frags and fire hit harder.
 */
export type PerkId = 'lightweight' | 'flak' | 'ghost' | 'scavenger' | 'hardline' | 'hardened' | 'warlord' | 'sleight' | 'lowprofile' | 'secondwind' | 'dangerclose';

export interface PerkInfo {
  name: string;
  /** What it does, in a line. */
  blurb: string;
}

export const PERKS: Record<PerkId, PerkInfo> = {
  lightweight: { name: 'Lightweight', blurb: 'Move 8% faster' },
  flak: { name: 'Flak Jacket', blurb: 'Frags and fire take 60% less off you' },
  ghost: { name: 'Ghost', blurb: "You don't show on the other side's UAV" },
  scavenger: { name: 'Scavenger', blurb: 'Ammo bags give your lethals back too' },
  hardline: { name: 'Hardline', blurb: 'Every killstreak comes a kill sooner' },
  hardened: { name: 'Hardened', blurb: 'Your bullets hit 40% harder through walls' },
  warlord: { name: 'Warlord', blurb: 'One more lethal a life' },
  sleight: { name: 'Sleight of Hand', blurb: 'Reload twice as fast' },
  lowprofile: { name: 'Low Profile', blurb: "Firing doesn't put you on anyone's radar" },
  secondwind: { name: 'Second Wind', blurb: 'Health comes back after 2 seconds, not 4.5' },
  dangerclose: { name: 'Danger Close', blurb: 'Your frags and fire hit 25% harder' },
};

/** The tiers, one perk from each. */
export const PERK_TIERS: PerkId[][] = [
  ['lightweight', 'flak', 'ghost', 'scavenger'],
  ['hardline', 'hardened', 'warlord', 'sleight'],
  ['lowprofile', 'secondwind', 'dangerclose'],
];

/** What a fighter takes until they pick their own. */
export const DEFAULT_PERKS: PerkId[] = ['lightweight', 'hardened', 'secondwind'];

/** Lightweight's speed. */
const LIGHTWEIGHT = 1.08;
/** How much of a frag's or a fire's damage gets through Flak Jacket. */
const FLAK = 0.4;
/** Hardened: a wall-bang's damage. */
const HARDENED = 1.4;
/** Danger Close: a frag's or a fire's damage. */
const DANGER_CLOSE = 1.25;
/** Sleight of Hand: how fast they reload (a multiple of each gun's pace). */
export const SLEIGHT = 2;
/** Second Wind: seconds after a hit until health starts coming back (the platform's is 4.5), and how fast. */
export const SECOND_WIND = { delay: 2, perSecond: 35 };

export const hasPerk = (f: Fighter | undefined, id: PerkId) => !!f?.perks.includes(id);

/** How fast they move (before the Adrenaline Shot). */
export const speedOf = (f: Fighter) => (hasPerk(f, 'lightweight') ? LIGHTWEIGHT : 1);

/** How many kills in a row a killstreak takes them. */
export const streakCost = (f: Fighter, kills: number) => (hasPerk(f, 'hardline') ? kills - 1 : kills);

/**
 * How much of a hit lands, by the perks of who's hit (`target`) and who hit them (`by`): Flak
 * Jacket and Danger Close for frags and fire (never a killstreak's blasts), Hardened for bullets
 * through a wall.
 */
export function perkDamage(hit: { cause: string; through?: number; weapon?: string }, target: Fighter | undefined, by: Fighter | undefined): number {
  let k = 1;
  const lethal = (hit.cause === 'explosion' || hit.cause === 'fire') && !isStreakWeapon(hit.weapon);
  if (lethal && hasPerk(target, 'flak')) k *= FLAK;
  if (lethal && by !== target && hasPerk(by, 'dangerclose')) k *= DANGER_CLOSE;
  if ((hit.through ?? 0) > 0 && hasPerk(by, 'hardened')) k *= HARDENED;
  return k;
}
