import type { GameContext, IconRef } from '@platform';
import type { GunItem } from '@platform/items';

/**
 * Two guns, and both are slow: every shot counts.
 *
 * - The Peacemaker: six rounds, one pull a shot (no holding the trigger down), loaded a round at
 *   a time, the hammer thumbed back after each (`action: 'hammer'`). Heads take double.
 * - The Yellowboy: a lever-action (`action: 'lever'`), seven in the tube, loaded a round at a
 *   time, harder hitting and steadier aimed, slower to work.
 *
 * No auto-reload in Dry Gulch (`guns.autoReload: false` in the game): an empty gun clicks until
 * you press R.
 *
 * This is what they do. How they look and sound (their models and icons, how they're held in first
 * person and by a figure, each one's reload pose, tracers, their voices) is each screen's:
 * `client/looks.ts`.
 */

export const REVOLVER: GunItem = {
  kind: 'gun',
  name: 'Peacemaker',
  rpm: 170,
  damage: [45, 30],
  falloff: [14, 40],
  headshot: 2,
  magazine: 6,
  reserve: 30,
  reload: 0.42,
  shells: true,
  range: 120,
  spread: { hip: 1.4, aim: 0.15, move: 1.6, air: 3.5, bloom: 0.9 },
  recoil: { up: 2.6, side: 0.6, recover: 0.8 },
  aim: { zoom: 1.25, time: 0.16, move: 0.8, sight: 'iron' },
  action: 'hammer',
  mobility: 1.05,
};

export const RIFLE: GunItem = {
  kind: 'gun',
  name: 'Yellowboy',
  rpm: 70,
  damage: [62, 48],
  falloff: [30, 80],
  headshot: 1.75,
  magazine: 7,
  reserve: 21,
  reload: 0.55,
  shells: true,
  range: 200,
  spread: { hip: 2.4, aim: 0.05, move: 1.8, air: 4, bloom: 0 },
  recoil: { up: 3.6, side: 0.5, recover: 0.7 },
  aim: { zoom: 1.6, time: 0.26, move: 0.6, sight: 'iron' },
  action: 'lever',
  mobility: 0.92,
};

export const WEAPONS: Record<string, GunItem> = { revolver: REVOLVER, rifle: RIFLE };

export function defineWeapons(game: GameContext) {
  for (const [id, def] of Object.entries(WEAPONS)) game.items.define(id, def);
}

/** A gun's picture for the kill feed, by name (each screen draws it as it has it), side on. */
export const feedIcon = (id: string): IconRef | null => (WEAPONS[id] ? { item: id, view: 'side' } : null);
