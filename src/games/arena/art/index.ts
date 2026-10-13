/**
 * The Arena's art: procedural pixel-art mob skins and item sprites, painted into the game's own
 * 256x256 atlas (moved here from the engine's built-in entity atlas). (The weapons are voxel
 * models: `models/weapons`.)
 *
 * Atlas layout (unused texels transparent):
 * - Skins (64x64 regions): (0,0) zombie, (64,0) brute, (128,0) warden (with its crown),
 *   (0,64) skeleton, (64,64) spider.
 * - Items: 16x16 sprites at y = 128, in the cells they have in the built-in atlas.
 * - (128,64): the bomb.
 */
import { ATLAS, Canvas } from '@platform/art';
import { ITEM_X, ITEM_Y, items } from './items';
import { brute, BRUTE, skeleton, SKELETON, spider, SPIDER, warden, WARDEN, zombie, ZOMBIE } from './mobs';
import { bombs, BOMBS } from './bombs';

export { BOMB_MODEL } from './bombs';

export const ARENA_ATLAS = 'arena';

/** The Arena's texture atlas (256x256): mob skins and item sprites. */
export function paintArenaAtlas(): { width: number; height: number; albedo: Uint8Array; emissive: Uint8Array } {
  const cv = new Canvas();
  zombie(cv, ZOMBIE[0], ZOMBIE[1]);
  brute(cv, BRUTE[0], BRUTE[1]);
  warden(cv, WARDEN[0], WARDEN[1]);
  skeleton(cv, SKELETON[0], SKELETON[1]);
  spider(cv, SPIDER[0], SPIDER[1]);
  bombs(cv, BOMBS[0], BOMBS[1]);
  items(cv, 0, ITEM_Y);
  const { albedo, emissive } = cv.finish();
  return { width: ATLAS, height: ATLAS, albedo, emissive };
}

/** Origins of the mob skins in the Arena atlas. */
export const Skin = {
  zombie: ZOMBIE,
  brute: BRUTE,
  warden: WARDEN,
  skeleton: SKELETON,
  spider: SPIDER,
} as const satisfies Record<string, readonly [number, number]>;

const cell = (x: number) => ({ atlas: ARENA_ATLAS, x, y: ITEM_Y });

/** Item sprites in the Arena atlas. */
export const Sprite = {
  arrow_bundle: cell(ITEM_X.arrow_bundle),
  golden_trophy: cell(ITEM_X.golden_trophy),
  soul_fireball: cell(ITEM_X.soul_fireball),
  bomb: cell(ITEM_X.bomb),
} satisfies Record<string, { atlas: string; x: number; y: number }>;
