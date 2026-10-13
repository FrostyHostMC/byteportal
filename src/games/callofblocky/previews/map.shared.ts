import { defineShared } from '@platform';
import { BLOCKS } from '../blocks';
import { MAPS, WORLD } from '../map';
import meta from './map.meta';

/**
 * Dev preview: the maps on their own, to fly round (double-tap Space, or F), in their world and
 * at their time of day. It starts on Jackrabbit Lane; `/tp 512 70 30` goes to Big Kahuna Burger,
 * `/tp -470 75 30` to Hijacked's yacht, `/tp 0 75 540` to Nukeblock, `/tp 0 75 -484` to Rust.
 */
export const shared = defineShared({
  ...meta,
  blocks: BLOCKS,
  world: {
    seed: WORLD.seed,
    terrain: 'void',
    ground: { y: WORLD.floorY - 1, top: 'grass_block', fill: 'dirt', depth: 10 },
    structures: WORLD.structures,
    terraform: WORLD.terraform,
    spawn: MAPS[0].spawns[0],
    spawnYaw: MAPS[0].spawns[0].yaw,
    time: WORLD.time,
    freezeTime: true,
  },
  player: { health: false, fly: true, hotbar: 'items' },
});
