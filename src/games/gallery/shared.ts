import { Blueprint, defineShared, Models, type BlockDefinition, type BlockTexture } from '@platform';
import meta from './meta';
import blocky from './models/blocky.gltf?url';

/** Standing height: the floor's blocks are just below. */
export const FLOOR = 64;

/** A casino floor in the void: black tiles, red carpet aisles, lights set in the floor. */
function casinoFloor(): Blueprint {
  const bp = new Blueprint({ x: -16, y: FLOOR - 2, z: -32 }, { x: 33, y: 2, z: 48 });
  bp.fill({ x: -16, y: FLOOR - 2, z: -32 }, { x: 16, y: FLOOR - 2, z: 15 }, 'black_concrete');
  bp.fill({ x: -16, y: FLOOR - 1, z: -32 }, { x: 16, y: FLOOR - 1, z: 15 }, 'black_concrete');
  for (const x of [-3, 3]) bp.fill({ x: x - 1, y: FLOOR - 1, z: -32 }, { x: x + 1, y: FLOOR - 1, z: 15 }, 'red_wool');
  for (let x = -14; x <= 14; x += 7) for (let z = -30; z <= 12; z += 7) bp.set(x, FLOOR - 1, z, 'glowstone');
  return bp;
}
/** Rungs on two rails, the rest clear (a ladder's texture). */
const LADDER: BlockTexture = {
  paint: (x, y) => (x === 2 || x === 3 || x === 12 || x === 13 ? (x % 2 ? '#6b4a2b' : '#7d5733') : x > 1 && x < 14 && y % 4 < 2 ? (y % 4 ? '#7a5530' : '#8a6238') : null),
};

/** A picture of a sun over hills, framed (a poster's front). */
const POSTER: BlockTexture = {
  paint: (x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return '#5a3a1e';
    if ((x - 10) ** 2 + (y - 4) ** 2 < 7) return '#ffd84a';
    if (y > 10 + 2 * Math.sin(x * 0.45)) return '#3b7a2c';
    if (y > 8 + 2.5 * Math.sin(x * 0.35 + 2)) return '#5aa845';
    return y < 4 ? '#7cc6f2' : '#9ad6f7';
  },
};

/** Lines of writing on a board (a sign's front; the board is the texture's upper half). */
const SIGN: BlockTexture = {
  paint: (x, y) => ((y === 2 || y === 4 || y === 6) && x > 1 && x < 14 && (x * 7 + y * 3) % 5 !== 0 ? '#3a2412' : (x + y) % 5 ? '#b08a55' : '#a27d4a'),
};

/** Stone with a fire behind a grate (a stove's front). */
const STOVE: BlockTexture = {
  paint: (x, y) => {
    if (x > 2 && x < 13 && y > 6 && y < 14) return y > 10 ? (x % 2 ? '#ff9d2e' : '#ffcf4a') : y === 7 || x % 3 === 0 ? '#2a2a2a' : '#121212';
    return (x * 5 + y * 3) % 7 ? '#8b8b8b' : '#6f6f6f';
  },
};

/** Leaves hanging down a stem, mostly clear (a vine). */
const VINE: BlockTexture = {
  paint: (x, y) => (x === 8 || (x * 13 + y * 7) % 5 < 2 ? ((x + y) % 3 ? '#3f8f2f' : '#2f7324') : null),
};

/** Iron bars: uprights and two crossbars, the rest clear. */
const BARS: BlockTexture = { paint: (x, y) => (x % 4 === 1 || y === 2 || y === 13 ? (y % 2 ? '#5b6168' : '#4a4f55') : null) };

/**
 * Blocks of shapes of the game's own, a yard of them to the east of the casino floor: a fence
 * (joins fences and solid blocks, 1.5 high to bodies), panes (thin walls that join), beams (a post
 * with an axis), a ladder you climb, a poster and a sign that face a way, a stove with a front, a
 * vine, and a table and chairs made of boxes.
 */
const SHAPES: Record<string, BlockDefinition> = {
  picket_fence: { label: 'Picket Fence', texture: 'oak_planks', shape: 'fence', hardness: 1 },
  glass_pane: { texture: 'glass', shape: 'pane', transparency: 'cutout' },
  iron_bars: { texture: BARS, shape: 'pane', transparency: 'cutout' },
  beam: { label: 'Oak Beam', texture: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, shape: 'post', facing: 'axis' },
  ladder: { texture: LADDER, boxes: [[0, 0, 14, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout' },
  poster: { texture: { front: POSTER, all: 'oak_planks' }, boxes: [[1, 2, 15, 15, 14, 16]], facing: true, solid: false },
  sign: { texture: { front: SIGN, all: 'oak_planks' }, boxes: [[0, 7, 7, 16, 16, 9], [7, 0, 7, 9, 7, 9]], facing: true, solid: false },
  stove: { texture: { front: STOVE, top: 'stone', all: 'cobblestone' }, facing: true },
  vine: { texture: VINE, shape: 'cross', climbable: true },
  table: { texture: 'oak_planks', boxes: [[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]] },
  chair: {
    texture: 'spruce_planks',
    // Facing north: its back to the south.
    boxes: [[3, 0, 3, 5, 8, 5], [11, 0, 3, 13, 8, 5], [3, 0, 11, 5, 8, 13], [11, 0, 11, 13, 8, 13], [3, 8, 3, 13, 10, 13], [3, 10, 11, 13, 16, 13]],
    facing: true,
  },
};

/** The yard of block shapes, east of the casino floor: a hut with a ladder up it, a pergola, a fence round it all. */
function shapesYard(): Blueprint {
  const [x0, x1, z0, z1] = [17, 33, -10, 14];
  const bp = new Blueprint({ x: x0, y: FLOOR - 2, z: z0 }, { x: x1 - x0 + 1, y: 9, z: z1 - z0 + 1 });
  bp.fill({ x: x0, y: FLOOR - 2, z: z0 }, { x: x1, y: FLOOR - 2, z: z1 }, 'dirt');
  bp.fill({ x: x0, y: FLOOR - 1, z: z0 }, { x: x1, y: FLOOR - 1, z: z1 }, 'grass_block');
  bp.fill({ x: x0, y: FLOOR - 1, z: 0 }, { x: 21, y: FLOOR - 1, z: 0 }, 'gravel');
  // A fence round three sides, into stone brick pillars at the corners, a gap on the south.
  for (let x = x0; x <= x1; x++) {
    bp.set(x, FLOOR, z0, 'picket_fence');
    if (x < 20 || x > 22) bp.set(x, FLOOR, z1, 'picket_fence');
  }
  for (let z = z0; z <= z1; z++) bp.set(x1, FLOOR, z, 'picket_fence');
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 1, z }, 'stone_bricks');
  // The hut: plank walls on log corners, a plank roof, a door on the west.
  const [hx0, hx1, hz0, hz1] = [22, 28, -4, 2];
  bp.fill({ x: hx0, y: FLOOR - 1, z: hz0 }, { x: hx1, y: FLOOR - 1, z: hz1 }, 'oak_planks');
  bp.fill({ x: hx0, y: FLOOR, z: hz0 }, { x: hx1, y: FLOOR + 3, z: hz1 }, 'spruce_planks');
  bp.fill({ x: hx0 + 1, y: FLOOR, z: hz0 + 1 }, { x: hx1 - 1, y: FLOOR + 3, z: hz1 - 1 }, 'air');
  for (const [x, z] of [[hx0, hz0], [hx1, hz0], [hx1, hz1], [hx0, hz1]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 3, z }, 'oak_log');
  bp.fill({ x: hx0, y: FLOOR + 4, z: hz0 }, { x: hx1, y: FLOOR + 4, z: hz1 }, 'oak_planks');
  bp.set(25, FLOOR + 4, -1, 'sea_lantern');
  bp.fill({ x: hx0, y: FLOOR, z: 0 }, { x: hx0, y: FLOOR + 1, z: 0 }, 'air');
  // Windows: glass panes on the south, iron bars on the west.
  bp.fill({ x: 24, y: FLOOR + 1, z: hz1 }, { x: 26, y: FLOOR + 2, z: hz1 }, 'glass_pane');
  bp.fill({ x: hx0, y: FLOOR + 1, z: -3 }, { x: hx0, y: FLOOR + 2, z: -2 }, 'iron_bars');
  // A ladder up the east wall to the roof; a poster on the south wall; a vine down the north.
  for (let y = FLOOR; y <= FLOOR + 4; y++) bp.set(hx1 + 1, y, -1, 'ladder[facing=east]');
  bp.set(27, FLOOR + 1, hz1 + 1, 'poster[facing=south]');
  for (let y = FLOOR + 1; y <= FLOOR + 3; y++) bp.set(25, y, hz0 - 1, 'vine');
  // Inside: a stove facing the door, a table and two chairs.
  bp.set(27, FLOOR, -3, 'stove[facing=west]');
  bp.set(25, FLOOR, -1, 'table');
  bp.set(24, FLOOR, -1, 'chair[facing=east]');
  bp.set(26, FLOOR, -1, 'chair[facing=west]');
  // A pergola: upright beams, beams across the top, a table and chairs under it.
  for (const [x, z] of [[19, 5], [24, 5], [19, 10], [24, 10]]) bp.fill({ x, y: FLOOR, z }, { x, y: FLOOR + 2, z }, 'beam');
  for (let x = 19; x <= 24; x++) for (const z of [5, 10]) bp.set(x, FLOOR + 3, z, 'beam[axis=x]');
  for (let z = 6; z <= 9; z++) for (const x of [19, 24]) bp.set(x, FLOOR + 3, z, 'beam[axis=z]');
  bp.set(21, FLOOR, 7, 'table');
  bp.set(21, FLOOR, 8, 'chair[facing=north]');
  bp.set(22, FLOOR, 7, 'table');
  bp.set(22, FLOOR, 6, 'chair[facing=south]');
  bp.set(21, FLOOR, 6, 'chair[facing=south]');
  bp.set(22, FLOOR, 8, 'chair[facing=north]');
  // A sign at the gate, facing the casino.
  bp.set(18, FLOOR, 1, 'sign[facing=west]');
  return bp;
}

/** Blockyard's own player as a glTF model (`tests/headless/_export-models.ts` writes it). */
export const BLOCKY = Models.gltf(blocky, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head', hand: 'armR' });

/** The casino floor and the yard of block shapes (every screen builds them), its blocks, and the player as a glTF model. */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: [casinoFloor(), shapesYard()], spawn: { x: 0.5, y: FLOOR, z: 10 }, spawnYaw: 0, time: 0.35, freezeTime: true },
  player: { fly: true, health: false, hotbar: 'items', model: BLOCKY },
  blocks: SHAPES,
});
