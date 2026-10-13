import { Blueprint, defineShared } from '@platform';
import meta from './meta';

const FLOOR = 64;

/** A walled court with cover: low walls and pillars to duck behind. */
function court(): Blueprint {
  const bp = new Blueprint({ x: -20, y: FLOOR - 1, z: -20 }, { x: 41, y: 7, z: 41 });
  bp.fill({ x: -20, y: FLOOR - 1, z: -20 }, { x: 20, y: FLOOR - 1, z: 20 }, 'gray_concrete');
  for (const [x0, z0, x1, z1] of [[-20, -20, 20, -20], [-20, 20, 20, 20], [-20, -20, -20, 20], [20, -20, 20, 20]]) bp.fill({ x: x0, y: FLOOR, z: z0 }, { x: x1, y: FLOOR + 3, z: z1 }, 'black_concrete');
  for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, 0]]) bp.fill({ x: x - 1, y: FLOOR, z: z - 1 }, { x: x + 1, y: FLOOR + 2, z: z + 1 }, 'cyan_concrete');
  for (const [x0, z0, x1, z1] of [[-14, -2, -12, 2], [12, -2, 14, 2], [-2, -14, 2, -12], [-2, 12, 2, 14]]) bp.fill({ x: x0, y: FLOOR, z: z0 }, { x: x1, y: FLOOR, z: z1 }, 'magenta_concrete');
  return bp;
}

/** The court and the players: what the server and every screen read. */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: [court()], spawn: { x: 0.5, y: FLOOR, z: 16.5 }, time: 0.35, freezeTime: true },
  player: { health: 60, hotbar: 'items', pvp: true },
});
