import type { ItemBase } from '@platform';

/** The melee kit's part both sides read. */

export interface MeleeItem extends ItemBase {
  kind: 'melee';
  damage: number;
  /** Seconds between swings. */
  cooldown: number;
  reach?: number;
  knockback?: number;
  /** Also hit other enemies near the target. */
  sweep?: boolean;
}

export const isMelee = (d: { kind: string } | undefined): d is MeleeItem => d?.kind === 'melee';


/** How ready their swing is (`items.melee` on their screen). */
export interface MeleeOwn {
  /** Readiness 0..1 (Minecraft's attack strength): 1 swings at full strength. */
  strength: number;
}
