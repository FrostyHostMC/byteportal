import { Blueprint, defineShared } from '@platform';
import { GUNS } from '../models';
import meta from './guns.meta';

export const FLOOR = 64;
/** A dark gallery floor with pedestals in a row along x, one per gun. */
function room(n: number): Blueprint {
  const w = n * 4 + 8;
  const bp = new Blueprint({ x: -4, y: FLOOR - 1, z: -8 }, { x: w, y: 10, z: 14 });
  bp.fill({ x: -4, y: FLOOR - 1, z: -8 }, { x: w - 5, y: FLOOR - 1, z: 5 }, 'black_concrete');
  bp.fill({ x: -4, y: FLOOR + 8, z: -8 }, { x: w - 5, y: FLOOR + 8, z: 5 }, 'black_concrete');
  bp.fill({ x: -4, y: FLOOR, z: -8 }, { x: w - 5, y: FLOOR + 7, z: -8 }, 'white_concrete');
  for (let i = 0; i < n; i++) {
    const x = i * 4;
    bp.fill({ x, y: FLOOR, z: -1 }, { x: x + 1, y: FLOOR, z: 0 }, 'yellow_concrete');
    bp.set(x, FLOOR + 8, -2, 'sea_lantern');
    bp.set(x + 1, FLOOR + 8, 1, 'sea_lantern');
  }
  return bp;
}

/** Dev preview: a lit room in the void with a pedestal for each gun (the server puts the models on them). */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: [room(GUNS.length)], spawn: { x: 6, y: FLOOR, z: 4 }, spawnYaw: 0, time: 0.5, freezeTime: true },
  player: { health: false, fly: true, hotbar: 'items' },
});
