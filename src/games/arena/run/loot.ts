import type { GameContext, Player } from '@platform';
import { baseOf, hasRarities, RARE_BASES, RARITIES, RARITY, rarityOf, variant } from '../items/rarity';
import { rollChest } from '../items/loot';
import { forge, forgeNext, forgePrice } from '../items/forge';
import { WARES } from '../items/catalog';

export { ALL_VARIANTS, baseOf, hasRarities, RARITIES, RARITY, rarityOf } from '../items/rarity';
export { describe, dropWeapon } from '../items/loot';
export { deliver, WARES, type Ware } from '../items/catalog';
export { forgeNext } from '../items/forge';

/**
 * Weapons as the run deals in them, in one place: what the mystery chest gives (the armory's
 * roll, `items/loot.ts`: rarer later in the run), the forge (a weapon to its next rarity,
 * `items/forge.ts`), wares handed over (`items/catalog.ts`), and a weapon's plain self and rarity
 * (`items/rarity.ts`). The shop and the chest ask here, never the armory's files themselves.
 */

/** Forge one of theirs, paid for already: taken up a rarity (with the anvil's sparks). Whether it was. */
export const forgeWeapon = (game: GameContext, p: Player, item: string): boolean => forgeNext(item) !== null && forge(game, p, item) !== null;

/** From this wave on, the mystery chest gives nothing plainer than a rare. */
const RARE_FROM = 10;

/** A roll of the mystery chest on wave `n`: a weapon, of some rarity. */
export function rollWeapon(game: GameContext, n: number): string {
  const item = rollChest(() => game.rng.next(), n);
  return n >= RARE_FROM && rarityOf(item) === 'common' ? variant(baseOf(item), 'rare') : item;
}

/** What spins above the chest while it rolls: the arsenal, each of some rarity. */
export const chestSpin = (game: GameContext, n: number): string[] =>
  Array.from({ length: n }, () => variant(game.rng.pick(RARE_BASES), game.rng.pick(['common', 'common', 'rare', 'rare', 'epic', 'legendary'] as const)));

/**
 * What `count` of an item is worth at the merchant's prices, all told: a weapon its price and the
 * forge's up to its rarity, supplies their price each (0: he doesn't deal in it).
 */
export function worth(item: string, count = 1): number {
  if (hasRarities(item)) {
    const base = baseOf(item);
    let gold = WARES.find((w) => w.item === base)?.price ?? 0;
    for (const r of RARITIES.slice(0, RARITIES.indexOf(rarityOf(item)))) gold += forgePrice(variant(base, r)) ?? 0;
    return gold * count;
  }
  const w = WARES.find((x) => x.item === item);
  return w ? (w.price / (w.count ?? 1)) * count : 0;
}

/** A weapon's rarity colour (its beam, its name). */
export const rarityColor = (item: string): string => RARITY[rarityOf(item)].color;
