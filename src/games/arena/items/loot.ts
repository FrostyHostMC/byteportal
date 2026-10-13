import type { GameContext, Pickup, Player, Vec3 } from '@platform';
import { ARMS } from './arms';
import { RARE_BASES, RARITY, rarityOf, rollRarity, variant, type RareBase } from './rarity';

/**
 * Weapons as loot: the mystery chest's roll (a random weapon of a random rarity) and a weapon on
 * the ground, its beam the colour of its rarity. The run's chest and rewards go through these.
 */

/** What the chest can give: the arsenal, by how often (the bow and the starter's sake). */
const CHEST: [RareBase, number][] = RARE_BASES.map((b) => [b, b === 'bow' ? 0.5 : b === 'diamond_sword' ? 0.6 : 1]);

/** A random weapon of a random rarity (`luck` 0..1 favours the rarer: a late wave, the crowd's favour); never `not` (what they hold). */
export function rollWeapon(game: GameContext, luck = 0, not?: string): string {
  const pool = CHEST.filter(([b]) => b !== not);
  const total = pool.reduce((a, [, w]) => a + w, 0);
  let t = game.rng.next() * total;
  const base = (pool.find(([, w]) => (t -= w) <= 0) ?? pool[pool.length - 1])[0];
  return variant(base, rollRarity(game.rng.next(), luck));
}

/** The mystery chest's roll on wave `wave` (of 20): later waves favour the rarer. `rng` gives numbers 0..1. */
export function rollChest(rng: () => number, wave: number): string {
  const luck = Math.min(1, Math.max(0, (wave - 1) / 19));
  const total = CHEST.reduce((a, [, w]) => a + w, 0);
  let t = rng() * total;
  const base = (CHEST.find(([, w]) => (t -= w) <= 0) ?? CHEST[CHEST.length - 1])[0];
  return variant(base, rollRarity(rng(), luck));
}

/** A weapon dropped on the ground: a beam of its rarity's colour (a legendary's brighter, and heard). */
export function dropWeapon(game: GameContext, id: string, at: Vec3, opts: { for?: Player; despawn?: number } = {}): Pickup {
  const r = rarityOf(id);
  if (r === 'legendary') game.audio.play('arena_legendary', { at });
  return game.items.spawnPickup(id, at, { beam: RARITY[r].color, despawn: opts.despawn ?? 120, for: opts.for });
}

/** A weapon's line for a menu or a reveal: what it is, and a legendary's trick. */
export function describe(id: string): string {
  const base = id.replace(/_(rare|epic|legendary)$/, '') as RareBase;
  const a = ARMS[base];
  if (!a) return '';
  return rarityOf(id) === 'legendary' ? `${a.text}. ${a.legend.text}` : a.text;
}
