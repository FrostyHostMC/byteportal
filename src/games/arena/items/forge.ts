import type { GameContext, Player } from '@platform';
import { bus } from '../run/bus';
import { ARMS } from './arms';
import { baseOf, hasRarities, nextRarity, RARITY, rarityOf, variant, type RareBase, type Rarity } from './rarity';

/**
 * The forge: a weapon taken up to its next rarity (common to rare to epic to legendary), for gold.
 * The run's shop shows it and takes the gold (`forgePrice`, then `forge` once it's paid); this is
 * the price and the swap.
 */

/** Each step's price, times the weapon's own (`ARMS[base].price`). */
const STEP: Record<Exclude<Rarity, 'common'>, number> = { rare: 1, epic: 2, legendary: 3.5 };

/** What forging `id` up costs, or null: it doesn't come in rarities, or it's legendary already. */
export function forgePrice(id: string): number | null {
  if (!hasRarities(id)) return null;
  const next = nextRarity(rarityOf(id));
  if (!next || next === 'common') return null;
  return Math.round((ARMS[baseOf(id) as RareBase].price * STEP[next]) / 5) * 5;
}

/** The forge's offer for `id`: what it becomes and the gold, or null (no rarities, or legendary already). */
export function forgeNext(id: string): { item: string; price: number } | null {
  const item = forged(id);
  const price = forgePrice(id);
  return item && price !== null ? { item, price } : null;
}

/** What `id` becomes at the forge (null: nothing). */
export function forged(id: string): string | null {
  const next = hasRarities(id) ? nextRarity(rarityOf(id)) : null;
  return next ? variant(baseOf(id), next) : null;
}

/**
 * Forge one of theirs (paid for already): `id` taken, the next rarity given in its place (and in
 * hand, if that's where it was), with sparks and the anvil's ring. The new item's id, or null if
 * they don't carry one or it can't go further.
 */
export function forge(game: GameContext, p: Player, id: string): string | null {
  const next = forged(id);
  const inv = p.inventory;
  if (!next || inv.count(id) <= 0) return null;
  const inHand = inv.held?.item === id;
  inv.take(id, 1);
  inv.give(next);
  if (inHand) {
    const at = inv.slots.findIndex((s) => s?.item === next);
    if (at >= 0) inv.select(at);
  }
  const r = RARITY[rarityOf(next)];
  const q = p.position;
  game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: r.color, count: 40, speed: 4, size: 0.12, glow: 1.5, gravity: 4, life: 0.8 });
  game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: '#ffb347', count: 20, speed: 6, size: 0.06, glow: 2, gravity: 14, life: 0.5 });
  game.audio.play('arena_forge', { at: q });
  const name = game.items.get(next)?.name ?? next;
  // (The announcer has it from the bus.)
  bus.emit('feat', { player: p, name: 'forge', text: `Forged ${name}` });
  return next;
}
