import type { ItemBase, SpriteRef } from '@platform';

/** The bow kit's part both sides read. */

export interface BowItem extends ItemBase {
  kind: 'bow';
  /** Item consumed per shot (omit for infinite). */
  ammo?: string;
  /** Damage at no charge and at full charge. */
  damage: [number, number];
  /** Seconds to full draw. */
  drawTime: number;
  speed: number;
  /** Sprite shown while drawing (default: the item's icon). */
  drawIcon?: SpriteRef;
  /** What flies (default: the ammo item's icon; with no ammo, a glowing bolt). */
  projectile?: SpriteRef;
}

export const isBow = (d: { kind: string } | undefined): d is BowItem => d?.kind === 'bow';


/** Their draw (`items.bow` on their screen). */
export interface BowOwn {
  drawing: boolean;
  /** How far drawn, 0..1. */
  charge: number;
}
