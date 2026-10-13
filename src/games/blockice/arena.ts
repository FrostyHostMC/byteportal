import { Blueprint } from '@platform';
import { FAN_BLOCKS } from './blocks';
import { boards, HALF_LENGTH, HALF_WIDTH, ICE } from './rink';

/**
 * The arena, as a Blueprint in a void world: the ice sheet, the rubber walkway round the boards,
 * a low wall of glowing ad boards round that, and stands of fans rising on three sides (the
 * camera's side stays open, so it sees over). The boards and glass, the lines and the goals are
 * models drawn over the ice on each screen (`client/scene.ts`); an invisible wall just outside the
 * boards keeps everyone in.
 */

const F = ICE - 1;
/** The walkway's outer edge (|x|, |z|): the arena wall stands just past it. */
const WX = HALF_LENGTH + 3;
const WZ = Math.ceil(HALF_WIDTH) + 2;
/** How many rows the stands rise. */
const ROWS = 14;

function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fan = (x: number, y: number, z: number) => FAN_BLOCKS[Math.floor(rnd(x * 7 + z, y, 3) * FAN_BLOCKS.length) % FAN_BLOCKS.length];

export function buildArena(): Blueprint {
  const minX = -WX - 2 - ROWS - 2;
  const maxX = WX + 1 + ROWS + 2;
  const minZ = -WZ - 2 - ROWS - 2;
  const maxZ = WZ + 4;
  const bp = new Blueprint({ x: minX, y: F - 2, z: minZ }, { x: maxX - minX + 1, y: ROWS + 12, z: maxZ - minZ + 1 });

  // The floor: concrete under everything, the walkway's mats, the ice inside the boards.
  bp.fill({ x: minX, y: F - 1, z: minZ }, { x: maxX, y: F, z: maxZ }, 'ice_concrete');
  bp.fill({ x: -WX, y: F, z: -WZ }, { x: WX - 1, y: F, z: WZ - 1 }, 'ice_mat');
  for (let x = -HALF_LENGTH - 1; x <= HALF_LENGTH; x++) {
    for (let z = -Math.ceil(HALF_WIDTH) - 1; z <= Math.ceil(HALF_WIDTH); z++) {
      const b = boards(x + 0.5, z + 0.5);
      // Ice under every cell the boards' model doesn't cover; outside it, wholly, the invisible wall.
      if (b.d > -0.8) bp.set(x, F, z, 'ice_sheet');
      else for (let y = ICE; y <= ICE + 4; y++) bp.set(x, y, z, 'ice_barrier');
    }
  }
  // Round the ice's bounding box, the wall goes all the way (the corners' cells above are outside it).
  for (let x = -HALF_LENGTH - 2; x <= HALF_LENGTH + 1; x++) {
    for (const z of [-Math.ceil(HALF_WIDTH) - 2, Math.ceil(HALF_WIDTH) + 1]) for (let y = ICE; y <= ICE + 4; y++) bp.set(x, y, z, 'ice_barrier');
  }
  for (let z = -Math.ceil(HALF_WIDTH) - 2; z <= Math.ceil(HALF_WIDTH) + 1; z++) {
    for (const x of [-HALF_LENGTH - 2, HALF_LENGTH + 1]) for (let y = ICE; y <= ICE + 4; y++) bp.set(x, y, z, 'ice_barrier');
  }

  // The arena wall round the walkway: ad boards at the bottom, padding over them (the camera's side only the ads).
  const ads = ['ice_ad_blue', 'ice_ad_red', 'ice_ad_gold'];
  const ad = (i: number) => ads[Math.floor(i / 7) % ads.length];
  for (let x = -WX - 1; x <= WX; x++) {
    bp.set(x, ICE, -WZ - 1, ad(x + 40));
    bp.set(x, ICE + 1, -WZ - 1, 'ice_wall');
    bp.set(x, ICE, WZ, ad(x + 43));
  }
  for (let z = -WZ - 1; z <= WZ; z++) {
    for (const x of [-WX - 1, WX]) {
      bp.set(x, ICE, z, ad(z + 50));
      bp.set(x, ICE + 1, z, 'ice_wall');
    }
  }

  // The far stands (behind -z): rows stepping up and back, a fan in every seat but the aisles.
  for (let r = 0; r < ROWS; r++) {
    const z = -WZ - 2 - r;
    const top = ICE + 2 + r;
    for (let x = minX + 2; x <= maxX - 2; x++) {
      bp.fill({ x, y: F, z }, { x, y: top - 1, z }, 'ice_concrete');
      const aisle = (x + 200) % 12 === 0;
      bp.set(x, top, z, aisle ? 'ice_concrete' : fan(x, r, z));
    }
  }
  // The end stands (behind each goal), rising outward along x.
  for (const sx of [-1, 1]) {
    for (let r = 0; r < ROWS; r++) {
      const x = sx > 0 ? WX + 1 + r : -WX - 2 - r;
      const top = ICE + 2 + r;
      for (let z = -WZ - 2 - ROWS; z <= WZ + 2; z++) {
        bp.fill({ x, y: F, z }, { x, y: top - 1, z }, 'ice_concrete');
        const aisle = (z + 200) % 9 === 0;
        bp.set(x, top, z, aisle ? 'ice_concrete' : fan(z, r, x));
      }
    }
  }
  return bp;
}
