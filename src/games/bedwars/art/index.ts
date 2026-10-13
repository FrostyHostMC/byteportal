/**
 * Bed Wars art: procedural pixel-art skins, the bots' sword and item sprites, painted into the
 * game's own 256x256 atlas.
 *
 * Atlas layout (unused texels transparent):
 * - Skins (64x64 regions, standard humanoid layout): (0,0) red, (64,0) blue, (128,0) green,
 *   (192,0) yellow, (0,64) shopkeeper.
 * - (128,64): the bots' sword, a 1x10x3 box.
 * - Items: 16x16 sprites from y = 192, sixteen to a row.
 */
import type { ModelPart } from '@platform';
import { ATLAS, Canvas } from '@platform/art';
import { player, shopkeeper } from './skins';
import { sprites } from './sprites';
import { SWORD, sword } from './sword';

export const BEDWARS_ATLAS = 'bedwars';

/** The Bed Wars texture atlas (256x256): skins, the bots' sword and item sprites. */
export function paintBedwarsAtlas(): { width: number; height: number; albedo: Uint8Array; emissive: Uint8Array } {
  const cv = new Canvas();
  player(cv, Skin.red[0], Skin.red[1], 'red');
  player(cv, Skin.blue[0], Skin.blue[1], 'blue');
  player(cv, Skin.green[0], Skin.green[1], 'green');
  player(cv, Skin.yellow[0], Skin.yellow[1], 'yellow');
  shopkeeper(cv, Skin.shopkeeper[0], Skin.shopkeeper[1]);
  sword(cv, SWORD[0], SWORD[1]);
  sprites(cv, (name) => Sprite[name]);
  const { albedo, emissive } = cv.finish();
  return { width: ATLAS, height: ATLAS, albedo, emissive };
}

/** Skin origins (standard 64x64 humanoid layout) in the Bed Wars atlas. */
export const Skin = {
  red: [0, 0],
  blue: [64, 0],
  green: [128, 0],
  yellow: [192, 0],
  shopkeeper: [0, 64],
} as const satisfies Record<string, readonly [number, number]>;

const cell = (i: number) => ({ atlas: BEDWARS_ATLAS, x: 16 * (i % 16), y: 192 + 16 * Math.floor(i / 16) });

/** 16x16 item sprites in the Bed Wars atlas (Minecraft conventions: tools on the diagonal, tip at the top right). */
export const Sprite = {
  iron_ingot: cell(0),
  gold_ingot: cell(1),
  diamond: cell(2),
  emerald: cell(3),
  shears: cell(4),
  wooden_pickaxe: cell(5),
  iron_pickaxe: cell(6),
  diamond_pickaxe: cell(7),
  golden_apple: cell(8),
  fire_charge: cell(9),
  leather_armor: cell(10),
  iron_armor: cell(11),
  diamond_armor: cell(12),
  bed: cell(13),
};

/**
 * A sword held in a bot's right hand: add to `Models.humanoid({ extras: [botSword(skin)] })`.
 * The grip sits in the fist and the blade points forward, tilted up.
 */
export function botSword(skin: readonly [number, number]): ModelPart {
  return { name: 'sword', size: [1, 10, 3], uv: [SWORD[0] - skin[0], SWORD[1] - skin[1]], pivot: [0, -9, 1], offset: [-0.5, 0, -1.5], rotation: [0.8, 0, 0], parent: 'armR' };
}
