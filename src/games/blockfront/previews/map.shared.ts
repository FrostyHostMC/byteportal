import { defineShared } from '@platform';
import { BLOCKS } from '../blocks';
import { MAPS, WORLD } from '../map';
import meta from './map.meta';

/**
 * Dev preview: the maps on their own, to fly round (double-tap Space, or F), in their world, at
 * their time of day, from where the home page looks at the first.
 */
export const shared = defineShared({
  ...meta,
  blocks: BLOCKS,
  world: {
    seed: WORLD.seed,
    terrain: 'void',
    ground: { y: WORLD.floorY - 1, top: WORLD.ground.top, fill: WORLD.ground.fill, depth: 6 },
    maxViewDistance: 11,
    structures: WORLD.structures,
    terraform: WORLD.terraform,
    spawn: { x: MAPS[0].home.x, y: MAPS[0].home.y, z: MAPS[0].home.z },
    spawnYaw: MAPS[0].home.yaw,
    time: WORLD.time,
    freezeTime: true,
  },
  player: { health: false, fly: true, hotbar: 'items' },
});
