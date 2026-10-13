import type { GameContext, ItemBase, ItemMove, Player } from '@platform';

/** The consumable kit's part both sides read. */

export interface ConsumableItem extends ItemBase {
  kind: 'consumable';
  /**
   * Seconds the right mouse button is held to use it: eaten (or drunk) that long, slowed, the hand
   * at the mouth, then its `use`. Let go sooner and nothing's used. Omit to use it at the click.
   */
  useTime?: number;
  /** Whether they may start on one now (full health: no apple). Default: yes. */
  canUse?(game: GameContext, player: Player): boolean;
  /** Right-click to use (or once it's been held `useTime`). Return true to consume one. */
  use(game: GameContext, player: Player): boolean;
}

export const isConsumable = (d: { kind: string } | undefined): d is ConsumableItem => d?.kind === 'consumable';

/** Their eating (`items.consumable` on their screen). */
export interface ConsumableOwn {
  /** What they're eating, or null. */
  eating: string | null;
  /** How far along, 0..1. */
  progress: number;
  /** Its `useTime` (seconds). */
  time: number;
}

/** Times walking speed while eating (Minecraft's). */
export const EATING_SPEED = 0.25;

/** What holding one does to movement: eating one (the right mouse button held) slows them, no sprinting. The same on both sides. */
export function consumableMove(def: ConsumableItem, buttons: number): ItemMove | null {
  return def.useTime && buttons & 4 ? { speed: EATING_SPEED, noSprint: true } : null;
}
