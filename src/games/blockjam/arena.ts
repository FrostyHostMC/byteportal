import { Blueprint } from '@platform';
import { FAN_BLOCKS } from './blocks';
import { FLOOR, WALL_X, WALL_Z } from './court';

/**
 * The arena, as a Blueprint in a void world: the maple court and its stained apron, the padded
 * walls and glowing ad boards round the floor, stands of fans rising on three sides (the camera's
 * side stays low, so it sees over), and rafters of lights over the court. The court's lines,
 * keys and logo are a model drawn over the floor on each screen (`client/court.ts`).
 */

const F = FLOOR - 1;
/** How many rows the far stands and the baseline stands rise. */
const ROWS = 15;
const STEEP = 1;

/** A steady pseudo-random number in [0, 1) for a cell. */
function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Which fans sit in a seat (a seed per seat). */
const fan = (x: number, y: number, z: number) => FAN_BLOCKS[Math.floor(rnd(x * 7 + z, y, 3) * FAN_BLOCKS.length) % FAN_BLOCKS.length];

export function buildArena(): Blueprint {
  const wx = WALL_X; // 17: the wall's blocks at x = 17 and x = -18
  const wz = WALL_Z; // 10: at z = 10 and z = -11
  const minX = -wx - 1 - ROWS - 4;
  const maxX = wx + ROWS + 4;
  const minZ = -wz - 1 - ROWS - 4;
  const maxZ = wz + 6;
  const bp = new Blueprint({ x: minX, y: F - 2, z: minZ }, { x: maxX - minX + 1, y: ROWS * STEEP + 26, z: maxZ - minZ + 1 });

  // The floor: concrete under everything, the stain inside the walls, maple on the court.
  bp.fill({ x: minX, y: F - 1, z: minZ }, { x: maxX, y: F, z: maxZ }, 'jam_concrete');
  bp.fill({ x: -wx, y: F, z: -wz }, { x: wx - 1, y: F, z: wz - 1 }, 'jam_stain');
  bp.fill({ x: -14, y: F, z: -8 }, { x: 13, y: F, z: 7 }, 'jam_maple');

  // The walls round the floor: ad boards at the bottom, padding over them on three sides; the
  // camera's side (+z) only the boards. An invisible wall over them keeps everyone in.
  const ads = ['jam_ad_orange', 'jam_ad_blue', 'jam_ad_gold'];
  const ad = (i: number) => ads[Math.floor(i / 6) % ads.length];
  for (let x = -wx - 1; x <= wx; x++) {
    bp.set(x, FLOOR, -wz - 1, ad(x + 40));
    bp.set(x, FLOOR + 1, -wz - 1, 'jam_pad');
    bp.set(x, FLOOR, wz, ad(x + 43));
    for (let y = FLOOR + 1; y <= FLOOR + 5; y++) bp.set(x, y, wz, 'jam_barrier');
    for (let y = FLOOR + 2; y <= FLOOR + 5; y++) bp.set(x, y, -wz - 1, 'jam_barrier');
  }
  for (let z = -wz - 1; z <= wz; z++) {
    for (const x of [-wx - 1, wx]) {
      bp.set(x, FLOOR, z, ad(z + 50));
      bp.set(x, FLOOR + 1, z, 'jam_pad');
      for (let y = FLOOR + 2; y <= FLOOR + 5; y++) bp.set(x, y, z, 'jam_barrier');
    }
  }

  // The far stands (behind -z): rows stepping up and back, a fan in every seat but the aisles.
  for (let r = 0; r < ROWS; r++) {
    const z = -wz - 2 - r;
    const top = FLOOR + 1 + r * STEEP;
    for (let x = minX + 4; x <= maxX - 4; x++) {
      bp.fill({ x, y: F, z }, { x, y: top - 1, z }, 'jam_concrete');
      const aisle = ((x + 200) % 11 === 0);
      bp.set(x, top, z, aisle ? 'jam_concrete' : fan(x, r, z));
    }
  }
  // The baseline stands (behind each basket), the same, rising outward along x.
  for (const sx of [-1, 1]) {
    for (let r = 0; r < ROWS; r++) {
      const x = sx > 0 ? wx + 1 + r : -wx - 2 - r;
      const top = FLOOR + 1 + r * STEEP;
      for (let z = -wz - 2 - ROWS; z <= wz + 3; z++) {
        // Behind the far stands it's already built: rise to whichever is higher.
        bp.fill({ x, y: F, z }, { x, y: top - 1, z }, 'jam_concrete');
        const aisle = ((z + 200) % 9 === 0);
        bp.set(x, top, z, aisle ? 'jam_concrete' : fan(z, r, x));
      }
    }
  }
  return bp;
}
