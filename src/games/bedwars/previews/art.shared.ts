import { defineShared } from '@platform';
import meta from './art.meta';

/** Dev preview: the Bed Wars skins (standing in a row) and item sprites (in the hotbar), on a flat world. */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 8.5 }, time: 0.42, freezeTime: true },
  player: { health: false, hotbar: 'items' },
});
