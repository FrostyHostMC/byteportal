import { defineShared, Blueprint } from '@platform';
import meta from './meta';

const pedestal = new Blueprint({ x: -2, y: 70, z: -2 }, { x: 5, y: 3, z: 5 })
  .fill({ x: -2, y: 70, z: -2 }, { x: 2, y: 70, z: 2 }, 'stone_bricks')
  .set(0, 71, 0, 'glowstone');

/** The world (a pedestal on levelled ground) and the player: what the server and every screen read. */
export const shared = defineShared({
  ...meta,
  world: {
    structures: [pedestal],
    terraform: [{ x: 0, z: 0, radius: 12, blend: 16, height: 69.5 }],
    spawn: { x: 0.5, y: 72, z: 3.5 },
    time: 0.55,
  },
  player: { health: 20, hotbar: 'items' },
});
