import { HeldModels, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import { Sprite } from '../art';
import { BLOCK_ITEMS } from '../shared';

/**
 * How Bed Wars' items look on each screen (`client.items.look`): their icons (the platform's
 * sprites, the game's own from its atlas, or a block), the swords' models, and the bow's drawn
 * sprite. The server's `items.ts` has only what they do; it names them (`{ item }` icons in the
 * shop) and each screen shows them as it has them here. (The atlas the sprites are in is the
 * server's content: it paints the skins there too.)
 */

/** Swords, plain and sharpened alike: the platform's sprite, held as its model. */
const SWORDS = [
  ['wooden_sword', HeldModels.woodenSword],
  ['stone_sword', HeldModels.stoneSword],
  ['iron_sword', HeldModels.ironSword],
  ['diamond_sword', HeldModels.diamondSword],
] as const;

export const LOOKS: Record<string, ItemLook> = {
  // Currency (picked up, never carried): an ingot or a gem.
  iron: { icon: Sprite.iron_ingot },
  gold: { icon: Sprite.gold_ingot },
  diamond: { icon: Sprite.diamond },
  emerald: { icon: Sprite.emerald },
  ...Object.fromEntries(SWORDS.flatMap(([id, model]) => [id, `${id}_sharp`].map((k) => [k, { icon: id, hold: { model } } satisfies ItemLook]))),
  wooden_pickaxe: { icon: Sprite.wooden_pickaxe },
  iron_pickaxe: { icon: Sprite.iron_pickaxe },
  diamond_pickaxe: { icon: Sprite.diamond_pickaxe },
  shears: { icon: Sprite.shears },
  bow: { icon: 'bow', drawIcon: 'bow_pulling' },
  arrow: { icon: 'arrow' },
  // Blocks look like the block they place.
  ...Object.fromEntries(Object.entries(BLOCK_ITEMS).map(([id, block]) => [id, { icon: { block } } satisfies ItemLook])),
  golden_apple: { icon: Sprite.golden_apple },
  fire_charge: { icon: Sprite.fire_charge },
};

/** Every item sprite in the atlas as an item of its own name (the art preview's). */
export const SPRITE_LOOKS: Record<string, ItemLook> = Object.fromEntries(Object.entries(Sprite).map(([id, icon]) => [id, { icon }]));

/** Each item's look on this screen (in `setup`, before anything's shown). */
export function defineLooks(client: Client, looks: Record<string, ItemLook> = LOOKS) {
  for (const [id, look] of Object.entries(looks)) client.items.look(id, look);
}
