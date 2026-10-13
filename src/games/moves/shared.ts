import { Blueprint, defineShared } from '@platform';
import { dash, doubleJump, wallRun } from './abilities';
import meta from './meta';

/** Standing height on the first platforms; the course steps up two blocks halfway. */
export const FLOOR = 64;
export const HIGH = FLOOR + 2;

/** The course in the void: platforms of coloured concrete, walls of stone bricks, lamps in the floor. */
function course(): Blueprint {
  const bp = new Blueprint({ x: -4, y: FLOOR - 2, z: -48 }, { x: 9, y: 11, z: 62 });
  const slab = (z0: number, z1: number, top: number, block: string) => {
    bp.fill({ x: -2, y: FLOOR - 1, z: z1 }, { x: 2, y: top, z: z0 }, 'white_concrete');
    bp.fill({ x: -2, y: top, z: z1 }, { x: 2, y: top, z: z0 }, block);
    for (let z = z0 - 2; z >= z1; z -= 4) bp.set(0, top, z, 'sea_lantern');
  };
  // The start, and across a six-block gap (a running jump falls short; a dash makes it).
  slab(12, 0, FLOOR - 1, 'light_gray_concrete');
  slab(-7, -16, FLOOR - 1, 'light_blue_concrete');
  // Two blocks up (one jump can't; two can).
  slab(-17, -25, HIGH - 1, 'lime_concrete');
  // Twelve blocks of nothing between two walls, then the finish.
  slab(-38, -47, HIGH - 1, 'yellow_concrete');
  bp.fill({ x: -1, y: HIGH - 1, z: -45 }, { x: 1, y: HIGH - 1, z: -43 }, 'glowstone');
  for (const x of [-3, 3]) {
    bp.fill({ x, y: HIGH - 3, z: -40 }, { x, y: HIGH + 4, z: -22 }, 'stone_bricks');
    bp.fill({ x, y: HIGH + 4, z: -40 }, { x, y: HIGH + 4, z: -22 }, x < 0 ? 'orange_concrete' : 'cyan_concrete');
  }
  return bp;
}

/**
 * The course, and the moves: pure steps the platform runs on the host and predicts on each
 * player's own screen, so they answer at once online.
 */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: [course()], spawn: { x: 0.5, y: FLOOR, z: 9.5 }, spawnYaw: 0, time: 0.3, freezeTime: true },
  player: {
    health: false,
    movement: {
      walk: 5,
      sprint: 7.5,
      airControl: 4,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      edgeGuard: false,
      // In this order: a dash takes the body from the others; a wall-jump's Space isn't a double jump.
      abilities: { dash, wallRun, doubleJump },
    },
  },
});
