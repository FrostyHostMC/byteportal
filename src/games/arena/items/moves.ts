import type { ItemMove, ItemMoveControls, Player } from '@platform';

/**
 * What the arsenal's weapons do to how their holders move, and what the host shows of a crossbow:
 * read alike by the host's kits and the screens' halves (`client/armory.ts`), so each screen
 * predicts its own movement as the host has it. Whether a holder is down; what a monster's
 * statuses show.
 */

/** Down on the sand, bleeding out (the run's co-op revives: a movement ability, `crawl`, that's on): no fighting, no potions. */
export const downed = (p: Player): boolean => !!(p.abilities.crawl as { on?: boolean } | undefined)?.on;

/** A melee weapon's slowing (`ArmsMelee`'s fields): behind a guard, raising a hammer, drawing back a spear, and its weight. */
export function meleeMove(def: { guard?: { slow: number }; slam?: unknown; throw?: unknown; weight?: number }, controls: ItemMoveControls): ItemMove | null {
  const w = def.weight ?? 1;
  if (def.guard && controls.buttons & 4) return { speed: w * def.guard.slow, noSprint: true };
  if (def.slam && controls.buttons & 1) return { speed: w * 0.6, noSprint: true };
  if (def.throw && controls.buttons & 4) return { speed: w * 0.8, noSprint: true };
  return w !== 1 ? { speed: w } : null;
}

/** Aiming a crossbow slows them, and a sprint stops. */
export function crossbowMove(_def: unknown, controls: ItemMoveControls): ItemMove | null {
  return controls.buttons & 4 ? { speed: 0.65, noSprint: true } : null;
}

/** What the screens see of a held crossbow: spanning (0..1, -1 not), loaded, aimed. */
export interface CrossbowShown {
  r: number;
  l: boolean;
  a: boolean;
}

/** What the screens draw on a monster for as long as it lasts (flames, dripping blood, stars round its head: `client/fx.ts`), as flags. */
export const SHOWS = { burn: 1, bleed: 2, stun: 4 } as const;
