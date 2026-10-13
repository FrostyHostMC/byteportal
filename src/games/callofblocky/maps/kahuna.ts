import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import * as kit from './kit';
import { FONT, hash, layout, outlined, Place, slab, spawnAt, stairs, torch, type Facing, type Fill, type MapSpec, type SpawnPoint } from './kit';

/**
 * Big Kahuna Burger: the Hawaiian burger joint off the boulevard, 512 blocks east of Jackrabbit
 * Lane. The restaurant stands in the middle (a tiki A-frame over the door, the dining room and
 * the kitchen, the walk-in freezer, a giant burger on the roof); its parking lot runs south to
 * the boulevard, with the carhop canopy along its west side; the tiki lanai (a thatched bar,
 * picnic tables, torches) is west of it, the drive-thru lane wraps round its east side into the
 * back alley (the Big Kahuna truck at the loading dock), and the Aloha Motor Lodge fills the east:
 * two storeys of rooms on a balcony round a drained pool, the office's roof joining the balcony.
 *
 * Lanes: the alley (north), through the restaurant, and the lot (south); the lanai and the carhop
 * roof on the west; the courtyard, the pool and the balcony on the east. Up top: the restaurant's
 * roof (stairs from the lanai and from the alley), the carhop roof, and the motel's balcony and
 * office roof (stairs from the alley and from the lot). Everything above the ground layer can be
 * shot through, the motel's walls between rooms included.
 *
 * The Briefcase's sites: A in the kitchen, B at the bottom of the drained pool; the attackers
 * come up from the boulevard, the defenders hold the alley and the motel office.
 */

/** Where the map's middle is in the world: far enough from Jackrabbit Lane that neither is ever drawn from the other. */
const OX = 512;
const FLOOR = 64;
const G = FLOOR - 1;
/** Roofs, the balcony and the motel's upper floor: players stand here. */
const UP = FLOOR + 5;
const SKY = 96;
/** The highest block written (the burger on the pylon sign). */
const TOP = 106;

const WEST = -44;
const EAST = 44;
const NORTH = -34;
const SOUTH = 31;

// The restaurant: its walls, the partition between the kitchen and the east rooms, the counter.
const RX0 = -16;
const RX1 = 10;
const RZ0 = -22;
const RZ1 = -6;
// The drained pool: its inside (the shallow end south, the deep end north), and the floors.
const PX0 = 22;
const PX1 = 27;
const PZ0 = -21;
const PZ1 = -7;
const SHALLOW = 62;
const DEEP = 60;
// The motel: its rooms (x 34..43, z -26..4, two storeys), the walkway and balcony in front.
const MX0 = 34;
const MX1 = 43;
const MZ0 = -26;
const MZ1 = 4;

// From the pool's floor (the world's own ground is under the rest) up past the pylon sign's burger.
const bp = new Blueprint({ x: OX + WEST - 18, y: DEEP - 2, z: NORTH - 14 }, { x: EAST - WEST + 37, y: TOP - (DEEP - 2) + 1, z: SOUTH - NORTH + 34 });
/** The map in its own coordinates (x from its middle): what's built here lands at OX. */
const L = new Place(bp, OX, 0);
const set = (x: number, y: number, z: number, b: BlockRef) => L.set(x, y, z, b);
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => L.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);
/** A prop built facing -x, put at (x, z) turned `turns` quarter turns. */
const at = (x: number, z: number, turns = 0) => new Place(L, x, z, turns);
const sprite = (rows: string[], colors: Record<string, BlockRef>, to: (u: number, v: number) => Vec3, scale = 1) => kit.sprite(L, rows, colors, to, scale);

// ---------------------------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------------------------

function ground() {
  // Clear sky over the whole play area (the world's ground is under it; the pool is dug into that).
  fill(WEST - 8, G, NORTH - 8, EAST + 8, G, SOUTH + 12, 'grass_block');
  fill(WEST, FLOOR, NORTH, EAST, SKY, SOUTH, 'air');
  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++) {
      let b: BlockRef = 'gray_concrete';
      const speck = hash(x, z, 5);
      if (x >= -43 && x <= -19 && z >= -22 && z <= -4) {
        // The lanai's deck: planks, a darker border.
        b = x === -43 || x === -19 || z === -22 || z === -4 ? 'spruce_planks' : 'birch_planks';
      } else if (x >= 19 && x <= 30 && z >= -26 && z <= 4) {
        // The motel's courtyard: pale tiles.
        b = (x + z) % 2 === 0 ? 'white_concrete' : 'sandstone';
      } else if (x >= 31 && x <= 33 && z >= -26 && z <= 9) b = 'light_gray_concrete';
      else if (z >= -5 && z <= -3 && x >= -18 && x <= 10) b = (x % 4 === 0 ? 'white_concrete' : 'light_gray_concrete');
      else if (z >= 28) b = 'light_gray_concrete';
      else b = speck < 0.04 ? 'black_concrete' : speck < 0.07 ? 'light_gray_concrete' : 'gray_concrete';
      set(x, G, z, b);
    }
  // The lot's stalls (white lines) and the drive-thru's arrows (yellow).
  for (const [z0, z1] of [[0, 5], [11, 16], [19, 24]]) for (let x = -17; x <= 29; x += 3) fill(x, G, z0, x, G, z1, 'white_concrete');
  fill(-17, G, 17, 29, G, 18, 'yellow_concrete');
  for (const z of [-20, -12, -4]) {
    fill(13, G, z, 14, G, z + 2, 'yellow_concrete');
    set(12, G, z, 'yellow_concrete');
    set(15, G, z, 'yellow_concrete');
  }
  // The alley's no-parking hatching by the loading dock.
  fill(-18, G, -28, -9, G, -27, (x, _y, z) => ((x + z) % 3 === 0 ? 'yellow_concrete' : undefined));
}

// ---------------------------------------------------------------------------------------------
// The restaurant
// ---------------------------------------------------------------------------------------------

function restaurant() {
  // Floors: the dining room in teal and white checks, the kitchen in red quarry tiles, the rest grey.
  fill(RX0, G, RZ0, RX1, G, RZ1, (x, _y, z) => {
    if (z >= -13 && x <= 1) return (x + z) % 2 === 0 ? 'cyan_concrete' : 'white_concrete';
    if (z <= -15 && x <= 1) return (x + z) % 2 === 0 ? 'red_concrete' : 'brown_concrete';
    if (x >= 3 && z <= -17) return 'light_blue_concrete';
    return 'light_gray_concrete';
  });
  // The shell: white walls on a teal kick band, an orange stripe, bamboo corners; the roof deck.
  fill(RX0, FLOOR, RZ0, RX1, FLOOR + 4, RZ1, (x, y, z) => {
    const edgeX = x === RX0 || x === RX1;
    const edgeZ = z === RZ0 || z === RZ1;
    if (y === FLOOR + 4) return 'white_concrete';
    if (!edgeX && !edgeZ) return 'air';
    if (edgeX && edgeZ) return 'bamboo';
    if (y === FLOOR) return 'cyan_concrete';
    if (y === FLOOR + 3) return 'orange_concrete';
    return 'white_concrete';
  });
  // The storefront: big windows on the lot either side of the door, chrome mullions.
  const window = (x0: number, z0: number, x1: number, z1: number) => fill(x0, FLOOR + 1, z0, x1, FLOOR + 2, z1, (x, _y, z) => ((x0 === x1 ? z : x) % 3 === 0 ? 'iron_block' : 'air'));
  window(-15, RZ1, -6, RZ1);
  window(1, RZ1, 9, RZ1);
  // The lanai side: windows, and a side door.
  window(RX0, -12, RX0, -8);
  fill(RX0, FLOOR, -15, RX0, FLOOR + 2, -14, 'air');
  window(RX0, -20, RX0, -18);
  // The front door under the A-frame; the kitchen's back door and roll-up door on the alley.
  fill(-4, FLOOR, RZ1, -2, FLOOR + 2, RZ1, 'air');
  fill(-2, FLOOR, RZ0, -1, FLOOR + 2, RZ0, 'air');
  fill(-13, FLOOR, RZ0, -10, FLOOR + 2, RZ0, 'air');
  fill(-13, FLOOR + 3, RZ0, -10, FLOOR + 3, RZ0, 'iron_block');
  // The drive-thru window (under a little thatch awning) and the side door onto the lane.
  fill(RX1, FLOOR + 1, -12, RX1, FLOOR + 2, -11, 'air');
  fill(RX1 + 1, FLOOR + 3, -13, RX1 + 1, FLOOR + 3, -10, slab('thatch'));
  fill(RX1, FLOOR, -8, RX1, FLOOR + 2, -7, 'air');

  // ----- Inside. The partition between the kitchen and dining room and the east rooms (x = 2).
  fill(2, FLOOR, RZ0 + 1, 2, FLOOR + 3, RZ1 - 1, 'white_concrete');
  fill(2, FLOOR, -20, 2, FLOOR + 2, -19, 'air'); // kitchen <-> freezer
  fill(2, FLOOR, -10, 2, FLOOR + 2, -9, 'air'); // dining room <-> the drive-thru station
  // The counter between the dining room and the kitchen, a gap at its west end; the register.
  fill(-12, FLOOR, -14, 1, FLOOR, -14, (x) => (x % 5 === 0 ? 'orange_concrete' : 'white_concrete'));
  fill(-12, FLOOR + 1, -14, 1, FLOOR + 1, -14, slab('birch'));
  set(-6, FLOOR + 1, -14, 'black_concrete');
  set(-1, FLOOR + 1, -14, 'black_concrete');
  // Menu boards over the counter.
  for (const x of [-9, -5, -1]) set(x, FLOOR + 3, -14, 'menu_board[facing=south]');
  // Booths along the front windows, tables down the middle, tiki masks on the walls.
  const booth = (x0: number) => {
    fill(x0, FLOOR, -7, x0, FLOOR, -9, 'cyan_concrete');
    fill(x0 + 1, FLOOR, -7, x0 + 1, FLOOR, -9, slab('spruce', true));
    fill(x0 + 2, FLOOR, -7, x0 + 2, FLOOR, -9, 'cyan_concrete');
    set(x0 + 1, FLOOR + 1, -8, 'neon_yellow');
  };
  booth(-15);
  booth(-10);
  booth(-5);
  for (const [x, z] of [[-13, -12], [-8, -12], [-3, -12]]) {
    set(x, FLOOR, z, slab('spruce', true));
    set(x - 1, FLOOR, z, slab('spruce'));
    set(x + 1, FLOOR, z, slab('spruce'));
  }
  set(RX0 + 1, FLOOR + 2, -13, 'tiki[facing=east]');
  set(1, FLOOR + 2, -8, 'tiki[facing=west]');
  // The kitchen: the grill line on the back wall, fryers, the prep table, shelves.
  fill(-10, FLOOR, -21, -4, FLOOR, -21, (x) => (x % 2 === 0 ? 'iron_block' : 'black_concrete'));
  fill(-10, FLOOR + 1, -21, -4, FLOOR + 1, -21, slab('stone'));
  fill(-10, FLOOR + 3, -21, -4, FLOOR + 3, -21, 'iron_block'); // the hood
  fill(-14, FLOOR, -21, -14, FLOOR + 2, -17, 'bookshelf');
  fill(-3, FLOOR, -17, 0, FLOOR, -17, 'white_concrete');
  fill(-3, FLOOR + 1, -17, 0, FLOOR + 1, -17, slab('birch'));
  set(1, FLOOR, -21, 'yellow_concrete');
  set(0, FLOOR, -21, 'yellow_concrete');
  set(-12, FLOOR, -16, 'oak_planks'); // a crate of buns
  set(-12, FLOOR + 1, -16, slab('oak'));
  // The walk-in freezer: steel walls, frosty inside, racks of patties.
  fill(3, FLOOR, -16, 9, FLOOR + 3, -16, 'iron_block');
  fill(3, FLOOR, -16, 4, FLOOR + 2, -16, 'air');
  fill(3, FLOOR, -21, 9, FLOOR + 3, -21, (x, y) => (y === FLOOR + 3 ? 'white_concrete' : x % 2 === 0 ? 'brown_concrete' : 'snow_block'));
  fill(9, FLOOR, -20, 9, FLOOR + 1, -17, 'snow_block');
  set(6, FLOOR + 3, -18, 'sea_lantern');
  // The drive-thru station: the counter at the window, the soda fountain, cups.
  fill(9, FLOOR, -13, 9, FLOOR, -10, 'white_concrete');
  fill(9, FLOOR + 1, -13, 9, FLOOR + 1, -10, slab('birch'));
  set(5, FLOOR, -15, 'neon_pink');
  set(6, FLOOR, -15, 'neon_cyan');
  set(7, FLOOR, -15, 'white_concrete');
  // Lights.
  for (const [x, z] of [[-12, -10], [-6, -10], [-1, -10], [-10, -18], [-4, -18], [6, -12]]) set(x, FLOOR + 4, z, 'sea_lantern');

  // ----- The roof: a parapet, the stairs' landings, the giant burger, the kitchen's vents.
  fill(RX0, UP, RZ0, RX1, UP, RZ1, (x, _y, z) => (x === RX0 || x === RX1 || z === RZ0 || z === RZ1 ? slab('stone') : undefined));
  fill(RX0, UP, -21, RX0, UP, -20, 'air'); // from the lanai stairs
  fill(6, UP, RZ0, 7, UP, RZ0, 'air'); // from the alley stairs
  fill(-12, UP, -20, -11, UP, -19, 'iron_block');
  fill(5, UP, -13, 6, UP, -12, 'iron_block');
  set(-13, UP, -9, 'light_gray_concrete');
  giantBurger(-4, -16);

  // Stairs up from the lanai (climbing east along the back of the west wall) and from the alley
  // (climbing east along the north wall).
  for (let i = 0; i < 5; i++) {
    const x = -21 + i;
    fill(x, FLOOR, -21, x, FLOOR + i, -20, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'east') : 'white_concrete'));
    fill(x, FLOOR + i + 1, -21, x, FLOOR + i + 3, -20, 'air');
    set(x, FLOOR + i + 1, -22, slab('stone'));
  }
  for (let i = 0; i < 5; i++) {
    const x = 2 + i;
    fill(x, FLOOR, -24, x, FLOOR + i, -23, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'east') : 'white_concrete'));
    set(x, FLOOR + i + 1, -25, slab('stone'));
  }
  fill(7, FLOOR, -24, 7, FLOOR + 4, -23, (_x, y) => (y === FLOOR + 4 ? 'white_concrete' : 'white_concrete'));

  // ----- The tiki A-frame over the front door: thatch sloping up to a ridge, tiki poles at the
  // corners, a mask in the gable.
  const ax0 = -7;
  const ax1 = 2;
  for (let z = -5; z <= -1; z++) {
    for (let k = 0; k < 5; k++) {
      set(ax0 + k, FLOOR + 4 + k, z, stairs('thatch', 'east'));
      set(ax1 - k, FLOOR + 4 + k, z, stairs('thatch', 'west'));
    }
  }
  fill(ax0 + 4, FLOOR + 8, -5, ax1 - 4, FLOOR + 8, -1, 'thatch');
  for (const x of [ax0, ax1]) {
    set(x, FLOOR, -1, `tiki[facing=south]`);
    set(x, FLOOR + 1, -1, `tiki[facing=south]`);
    fill(x, FLOOR + 2, -1, x, FLOOR + 3, -1, 'bamboo_pole');
    set(x, FLOOR + 4, -1, 'bamboo');
  }
  // The gable, bamboo, with the Big Kahuna's face in it.
  fill(ax0 + 1, FLOOR + 5, -1, ax1 - 1, FLOOR + 7, -1, (x, y) => (Math.abs(x - (ax0 + ax1) / 2) + (y - FLOOR - 4) <= 4.5 ? 'bamboo' : undefined));
  set(-3, FLOOR + 5, -1, 'tiki[facing=south]');
  set(-2, FLOOR + 5, -1, 'tiki[facing=south]');
  set(-3, FLOOR + 6, -1, 'neon_yellow');
  set(-2, FLOOR + 6, -1, 'neon_yellow');
  // Torches either side of the door.
  set(-5, FLOOR + 2, RZ1 + 1, torch('south'));
  set(-1, FLOOR + 2, RZ1 + 1, torch('south'));
}

/** The giant burger on the roof: buns, cheese hanging over the patty, lettuce, sesame seeds. */
function giantBurger(cx: number, cz: number) {
  fill(cx - 1, UP, cz - 1, cx + 1, UP, cz + 1, 'iron_block');
  const layers: [number, number, BlockRef][] = [
    [1, 3.6, 'orange_concrete'],
    [2, 4.2, 'brown_concrete'],
    [3, 4.6, 'yellow_concrete'],
    [4, 4.4, 'lime_concrete'],
    [5, 4.2, 'orange_concrete'],
    [6, 3.9, 'orange_concrete'],
    [7, 3.1, 'orange_concrete'],
    [8, 1.8, 'orange_concrete'],
  ];
  for (const [dy, r, b] of layers) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > r) continue;
        // The cheese is square, its corners hanging down.
        if (b === 'yellow_concrete' && d > 3.9 && (x + z) % 2 === 0) continue;
        const seed = dy >= 6 && hash(x, z, dy) < 0.12;
        set(x, UP + dy, z, seed ? 'white_concrete' : b);
      }
  }
}

// ---------------------------------------------------------------------------------------------
// The lanai: the tiki bar, picnic tables, torches, the totems
// ---------------------------------------------------------------------------------------------

function umbrella(x: number, z: number) {
  set(x, FLOOR, z, slab('spruce', true));
  set(x - 1, FLOOR, z, stairs('spruce', 'west'));
  set(x + 1, FLOOR, z, stairs('spruce', 'east'));
  fill(x, FLOOR + 1, z, x, FLOOR + 2, z, 'bamboo_pole');
  fill(x - 2, FLOOR + 3, z - 2, x + 2, FLOOR + 3, z + 2, (xx, _y, zz) => (Math.abs(xx - x) + Math.abs(zz - z) <= 3 ? (xx === x && zz === z ? 'thatch' : slab('thatch')) : undefined));
}

function tikiTorch(x: number, z: number) {
  fill(x, FLOOR, z, x, FLOOR + 1, z, 'bamboo_pole');
  set(x, FLOOR + 2, z, 'torch');
}

function totem(x: number, z: number, facing: Facing) {
  fill(x, FLOOR, z, x, FLOOR + 2, z, `tiki[facing=${facing}]`);
  set(x, FLOOR + 3, z, 'thatch');
}

function lanai() {
  // The tiki bar: bamboo walls on the back and west, counters on the other two sides, a roof of
  // thatch, bottles glowing on the shelf.
  const [x0, x1, z0, z1] = [-38, -31, -20, -14];
  fill(x0, FLOOR, z0, x1, FLOOR + 2, z1, (x, _y, z) => {
    if (x === x0 || z === z0) return 'bamboo';
    return undefined;
  });
  fill(x0 + 1, FLOOR, z1, x1, FLOOR, z1, 'bamboo');
  fill(x0 + 1, FLOOR + 1, z1, x1, FLOOR + 1, z1, slab('spruce'));
  fill(x1, FLOOR, z0 + 1, x1, FLOOR, z1 - 1, 'bamboo');
  fill(x1, FLOOR + 1, z0 + 1, x1, FLOOR + 1, z1 - 1, slab('spruce'));
  fill(x1, FLOOR, z1, x1, FLOOR + 2, z1, 'bamboo_pole');
  fill(x0, FLOOR, -17, x0, FLOOR + 1, -16, 'air'); // the bartender's door
  fill(x0 + 1, FLOOR, z0 + 1, x0 + 5, FLOOR, z0 + 1, slab('spruce', true));
  fill(x0 + 1, FLOOR + 1, z0 + 1, x0 + 5, FLOOR + 1, z0 + 1, (x) => ['neon_pink', 'neon_cyan', 'neon_yellow'][((x % 3) + 3) % 3]);
  for (let k = 0; k < 3; k++) fill(x0 - 1 + k, FLOOR + 3 + k, z0 - 1 + k, x1 + 1 - k, FLOOR + 3 + k, z1 + 1 - k, (x, _y, z) => (k < 2 && (x === x0 - 1 + k || x === x1 + 1 - k || z === z0 - 1 + k || z === z1 + 1 - k) ? slab('thatch') : 'thatch'));
  fill(-35, FLOOR + 6, -18, -34, FLOOR + 6, -16, 'thatch');
  set(-35, FLOOR + 7, -17, 'tiki[facing=east]');
  // Stools along the counters.
  for (const z of [-19, -17, -15]) set(x1 + 1, FLOOR, z, slab('spruce'));
  for (const x of [-36, -34]) set(x, FLOOR, z1 + 1, slab('spruce'));
  // Picnic tables under thatch umbrellas.
  umbrella(-25, -18);
  umbrella(-26, -9);
  umbrella(-36, -8);
  // A low bamboo rail round the deck, gaps to walk through.
  for (let x = -42; x <= -20; x++) if (x % 6 !== 0 && x !== -31 && x !== -30) set(x, FLOOR, -4, 'bamboo');
  // Torches round it, totems at its corners.
  for (const [x, z] of [[-42, -21], [-42, -5], [-20, -5], [-28, -21], [-42, -13], [-29, -5]]) tikiTorch(x, z);
  totem(-43, -9, 'east');
  totem(-21, -3, 'south');
  totem(-40, -3, 'south');
  kit.palm(L, -24, -13, 10, [1, 0], FLOOR);
  kit.palm(L, -40, -12, 11, [1, 0], FLOOR);
}

// ---------------------------------------------------------------------------------------------
// The drive-thru and the back alley
// ---------------------------------------------------------------------------------------------

function driveThru() {
  // The planter strip between the lane and the motel's courtyard: hedges, palms, two ways through.
  for (let z = -26; z <= -3; z++) {
    if ((z >= -17 && z <= -15) || z >= -5) continue;
    fill(17, FLOOR, z, 18, FLOOR, z, slab('stone'));
    fill(17, FLOOR + 1, z, 18, FLOOR + 1, z, 'oak_leaves');
  }
  kit.palm(L, 18, -24, 10, [0, 1], FLOOR + 1);
  kit.palm(L, 17, -9, 9, [-1, 0], FLOOR + 1);
  // The menu board and the speaker post, facing the cars.
  fill(17, FLOOR, -4, 17, FLOOR + 1, -4, 'bamboo_pole');
  fill(17, FLOOR, -2, 17, FLOOR + 1, -2, 'bamboo_pole');
  fill(17, FLOOR + 2, -4, 17, FLOOR + 3, -2, 'menu_board[facing=west]');
  set(16, FLOOR, -6, 'iron_block');
  set(16, FLOOR + 1, -6, 'black_concrete');
  // The clearance bar over the way in.
  fill(11, FLOOR + 4, -1, 16, FLOOR + 4, -1, (x) => (x % 2 === 0 ? 'yellow_concrete' : 'black_concrete'));
  fill(16, FLOOR, -1, 16, FLOOR + 3, -1, 'iron_block');
  // A cab waiting at the window.
  kit.taxi(at(13, -15, 1), 0, FLOOR, -1);
}

function alley() {
  // The north wall: cinder block, chain-link along its top.
  fill(WEST, FLOOR, NORTH, EAST, FLOOR + 5, NORTH, (x, y) => (y === FLOOR + 5 ? 'chain_link' : (x + y) % 2 === 0 ? 'light_gray_concrete' : 'stone_bricks'));
  // The Big Kahuna truck at the loading dock.
  kit.foodTruck(L, -31, FLOOR, -31);
  fill(-17, FLOOR, -26, -11, FLOOR, -24, 'stone_bricks');
  fill(-17, FLOOR + 1, -26, -11, FLOOR + 1, -26, slab('stone'));
  set(-18, FLOOR, -25, stairs('stone_brick', 'east'));
  set(-10, FLOOR, -25, stairs('stone_brick', 'west'));
  // Dumpsters, drums of fryer grease, crates, pallets.
  const dumpster = (x: number, z: number) => {
    fill(x, FLOOR, z, x + 1, FLOOR, z, 'green_concrete');
    fill(x, FLOOR + 1, z, x + 1, FLOOR + 1, z, slab('spruce'));
  };
  dumpster(-6, -26);
  dumpster(-3, -26);
  dumpster(24, -30);
  for (const [x, z] of [[-40, -25], [-39, -25], [-40, -24], [9, -32], [10, -32]]) {
    set(x, FLOOR, z, (x + z) % 2 === 0 ? 'orange_concrete' : 'black_concrete');
  }
  fill(0, FLOOR, -32, 2, FLOOR, -31, 'oak_planks');
  fill(1, FLOOR + 1, -32, 2, FLOOR + 1, -32, 'spruce_planks');
  fill(-24, FLOOR, -26, -22, FLOOR, -25, slab('oak'));
  fill(-44, FLOOR, -32, -42, FLOOR + 1, -30, 'oak_planks');
  set(-43, FLOOR + 2, -31, slab('oak'));
  // Lamps over the back doors.
  set(-2, FLOOR + 3, RZ0 - 1, torch('north'));
  set(-11, FLOOR + 4, RZ0 - 1, torch('north'));
}

// ---------------------------------------------------------------------------------------------
// The Aloha Motor Lodge: two storeys of rooms, a balcony, the office, the drained pool
// ---------------------------------------------------------------------------------------------

/** A room's furniture: a bed on the back wall, a TV, a lamp; `k` picks the colours. */
function room(z0: number, y: number, k: number) {
  const bed = (['red', 'blue', 'green', 'yellow'] as const)[k % 4];
  set(MX1 - 1, y, z0 + 2, `${bed}_bed[facing=east,part=head]`);
  set(MX1 - 2, y, z0 + 2, `${bed}_bed[facing=east,part=foot]`);
  set(MX1 - 1, y, z0 + 3, `${bed}_bed[facing=east,part=head]`);
  set(MX1 - 2, y, z0 + 3, `${bed}_bed[facing=east,part=foot]`);
  set(MX1 - 1, y, z0 + 1, 'spruce_planks');
  set(MX1 - 1, y + 1, z0 + 1, 'glowstone');
  set(MX0 + 2, y, z0 + 5, slab('spruce', true));
  set(MX0 + 2, y + 1, z0 + 5, 'black_concrete');
  set(MX0 + 3, y + 1, z0 + 5, 'neon_cyan');
  set(MX0 + 3, y, z0 + 5, slab('spruce', true));
  set(MX0 + 4, y, z0 + 1, stairs('oak', 'south'));
}

function motel() {
  const wall: BlockRef = 'pink_concrete';
  // Both storeys: pink walls, white trim, the upper floor, the roof.
  fill(MX0, FLOOR, MZ0, MX1, FLOOR + 9, MZ1, (x, y, z) => {
    const edge = x === MX0 || x === MX1 || z === MZ0 || z === MZ1;
    const party = (z - MZ0) % 6 === 0;
    if (y === FLOOR + 4 || y === FLOOR + 9) return 'white_concrete';
    if (edge || party) return y === FLOOR + 3 || y === FLOOR + 8 ? 'white_concrete' : wall;
    return 'air';
  });
  for (let r = 0; r < 5; r++) {
    const z0 = MZ0 + r * 6;
    for (const y of [FLOOR, UP]) {
      // A door (teal frame) and a window onto the walkway.
      fill(MX0, y, z0 + 2, MX0, y + 1, z0 + 2, 'air');
      set(MX0, y + 2, z0 + 2, 'cyan_concrete');
      fill(MX0, y + 1, z0 + 4, MX0, y + 1, z0 + 5, 'glass');
      room(z0, y, r + (y === UP ? 2 : 0));
    }
  }
  // Some rooms broken through into the next: ways along inside.
  fill(MX0 + 5, FLOOR, MZ0 + 6, MX0 + 5, FLOOR + 1, MZ0 + 6, 'air');
  fill(MX0 + 5, FLOOR, MZ0 + 18, MX0 + 5, FLOOR + 1, MZ0 + 18, 'air');
  fill(MX0 + 5, UP, MZ0 + 12, MX0 + 5, UP + 1, MZ0 + 12, 'air');
  fill(MX0 + 5, UP, MZ0 + 24, MX0 + 5, UP + 1, MZ0 + 24, 'air');
  // The walkway and the balcony over it: posts, the balcony's floor, its railing.
  fill(31, FLOOR + 4, MZ0, 33, FLOOR + 4, MZ1, 'white_concrete');
  for (let z = MZ0; z <= MZ1; z += 6) fill(31, FLOOR, z, 31, FLOOR + 3, z, 'white_concrete');
  fill(31, UP, MZ0, 31, UP, MZ1, (_x, _y, z) => ((z - MZ0) % 6 === 0 ? 'white_concrete' : slab('stone')));
  fill(31, FLOOR + 3, MZ0, 31, FLOOR + 3, MZ1, 'cyan_concrete');
  // Lights along the walkway.
  for (let z = MZ0 + 3; z < MZ1; z += 6) {
    set(33, FLOOR + 3, z, 'sea_lantern');
    set(MX0 - 1, UP + 2, z, torch('west'));
  }
  // Stairs down from the balcony's south end to the lot.
  for (let i = 0; i < 5; i++) {
    const z = MZ1 + 1 + i;
    fill(32, FLOOR, z, 33, FLOOR + 4 - i, z, (_x, y) => (y === FLOOR + 4 - i ? stairs('stone_brick', 'north') : 'pink_concrete'));
    set(31, FLOOR + 5 - i, z, slab('stone'));
  }

  // The office and the laundry (one storey, x 21..43 along the alley): their roof joins the
  // balcony, stairs up to it from the alley.
  const [ox0, ox1, oz0, oz1] = [21, EAST - 1, -33, -27];
  fill(ox0, G, oz0, ox1, G, oz1, (x, _y, z) => ((x + z) % 2 === 0 ? 'white_concrete' : 'light_gray_concrete'));
  fill(ox0, FLOOR, oz0, ox1, FLOOR + 4, oz1, (x, y, z) => {
    const edge = x === ox0 || x === ox1 || z === oz0 || z === oz1;
    if (y === FLOOR + 4) return 'white_concrete';
    if (!edge) return x === 30 ? (y === FLOOR + 3 ? 'white_concrete' : 'pink_concrete') : 'air';
    return y === FLOOR + 3 ? 'white_concrete' : wall;
  });
  fill(30, FLOOR, -30, 30, FLOOR + 1, -29, 'air');
  fill(24, FLOOR, oz1, 25, FLOOR + 2, oz1, 'air'); // the office door
  fill(27, FLOOR + 1, oz1, 29, FLOOR + 2, oz1, 'glass');
  fill(36, FLOOR, oz1, 37, FLOOR + 2, oz1, 'air'); // the laundry door
  fill(32, FLOOR + 1, oz1, 34, FLOOR + 1, oz1, 'glass');
  fill(ox0, FLOOR, -31, ox0, FLOOR + 2, -30, 'air'); // the office's back door onto the alley
  // The front desk, the key rack, the washers.
  fill(22, FLOOR, -30, 28, FLOOR, -30, (x) => (x === 25 ? 'air' : 'spruce_planks'));
  fill(22, FLOOR + 1, -30, 28, FLOOR + 1, -30, (x) => (x === 25 ? undefined : slab('spruce')));
  fill(23, FLOOR + 1, -32, 27, FLOOR + 2, -32, 'bookshelf');
  for (let x = 32; x <= 42; x += 2) {
    set(x, FLOOR, -32, 'white_concrete');
    set(x, FLOOR + 1, -32, 'iron_block');
  }
  for (const [x, z] of [[25, -29], [36, -30]]) set(x, FLOOR + 3, z, 'sea_lantern');
  // The roof's edge: a low wall, open where the balcony and the stairs come in.
  fill(ox0, UP, oz0, ox1, UP, oz1, (x, _y, z) => (x === ox0 || z === oz0 || x === ox1 || (z === oz1 && (x < 31 || x > 33)) ? slab('stone') : undefined));
  fill(ox0, UP, -32, ox0, UP, -31, 'air');
  for (let i = 0; i < 5; i++) {
    const x = 16 + i;
    fill(x, FLOOR, -32, x, FLOOR + i, -31, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'east') : 'pink_concrete'));
    set(x, FLOOR + i + 1, -33, slab('stone'));
  }
  // Neon over the office door.
  sprite(layout('OFFICE', FONT), { X: 'neon_cyan' }, (u, v) => ({ x: 22 + u, y: FLOOR + 5 + v, z: oz1 }));
  // Vending machines and the ice machine under the walkway.
  set(32, FLOOR, -25, 'red_concrete');
  set(32, FLOOR + 1, -25, 'neon_red');
  set(33, FLOOR, -25, 'blue_concrete');
  set(33, FLOOR + 1, -25, 'neon_cyan');
  set(32, FLOOR, 3, 'white_concrete');
  set(32, FLOOR + 1, 3, 'light_blue_concrete');

  pool();
  motelSign(27, 7);
}

/** The drained pool: a shallow end and a deep end, stairs down, a diving board, and nothing in it. */
function pool() {
  fill(PX0 - 1, DEEP - 1, PZ0 - 1, PX1 + 1, G, PZ1 + 1, (x, y, z) => {
    const rim = x === PX0 - 1 || x === PX1 + 1 || z === PZ0 - 1 || z === PZ1 + 1;
    if (rim) return y === G ? 'white_concrete' : 'light_blue_concrete';
    // The floor: the deep end, the slope down to it, the shallow end.
    const floor = z <= -16 ? DEEP - 1 : z <= -14 ? DEEP - 1 + (z + 16) : SHALLOW - 1;
    if (y < floor) return 'light_blue_concrete';
    if (y === floor) return x === PX0 || x === PX1 ? 'light_blue_concrete' : (z - PZ0) % 4 === 0 ? 'blue_concrete' : 'light_blue_concrete';
    return 'air';
  });
  // The slope as steps, the lane lines down the middle, the drain.
  for (const [z, y] of [[-15, DEEP], [-14, DEEP + 1]] as [number, number][]) fill(PX0, y, z, PX1, y, z, stairs('stone_brick', 'south'));
  fill(24, DEEP - 1, PZ0, 25, DEEP - 1, -16, 'blue_concrete');
  set(24, DEEP - 1, -19, 'iron_block');
  // Steps out at the shallow end (the south).
  fill(23, SHALLOW, PZ1, 26, SHALLOW, PZ1, stairs('stone_brick', 'south'));
  // The diving board over the deep end, and the ladders' rails.
  set(25, FLOOR, PZ0 - 1, 'white_concrete');
  fill(25, FLOOR, PZ0, 25, FLOOR, PZ0 + 2, slab('birch'));
  // Loungers along the deck, umbrellas, palms.
  for (const z of [-20, -16, -12]) {
    set(30, FLOOR, z, stairs('birch', 'east'));
    set(29, FLOOR, z, slab('birch'));
  }
  umbrella(20, -12);
  kit.palm(L, 20, -24, 10, [1, 0], FLOOR);
  kit.palm(L, 29, 2, 11, [-1, 0], FLOOR);
  kit.palm(L, 20, 2, 9, [1, 0], FLOOR);
}

/**
 * The motel's pole sign over the lot, facing the boulevard: ALOHA in pink neon on a white board,
 * MOTEL in red on a black one under it, a cyan arrow pointing in.
 */
function motelSign(x: number, z: number) {
  fill(x, FLOOR, z, x, FLOOR + 13, z, 'iron_block');
  const board = (y0: number, text: string, face: BlockRef, ink: BlockRef, trim: BlockRef) => {
    const rows = layout(text, FONT);
    const w = rows[0].length;
    const x0 = x - Math.floor(w / 2) - 1;
    fill(x0, y0, z, x0 + w + 1, y0 + 6, z, (xx, y) => (xx === x0 || xx === x0 + w + 1 || y === y0 || y === y0 + 6 ? trim : face));
    sprite(rows, { X: ink }, (u, v) => ({ x: x0 + 1 + u, y: y0 + 1 + v, z: z + 1 }));
  };
  board(FLOOR + 14, 'MOTEL', 'black_concrete', 'neon_red', 'white_concrete');
  board(FLOOR + 21, 'ALOHA', 'white_concrete', 'neon_pink', 'neon_cyan');
  sprite(['XXX.', '.XXX', '..XX', '.XXX', 'XXX.'], { X: 'neon_cyan' }, (u, v) => ({ x: x + 12 + u, y: FLOOR + 15 + v, z }));
}

// ---------------------------------------------------------------------------------------------
// The parking lot and the carhop
// ---------------------------------------------------------------------------------------------

function lightPole(x: number, z: number) {
  fill(x, FLOOR, z, x, FLOOR + 7, z, 'iron_block');
  set(x, FLOOR + 8, z, 'sea_lantern');
  set(x + 1, FLOOR + 8, z, 'iron_block');
  set(x - 1, FLOOR + 8, z, 'iron_block');
}

function lot() {
  // The median: a kerb, hedges, palms, the lot's lights.
  fill(-15, FLOOR, 17, 27, FLOOR, 18, (x) => (x === -15 || x === 27 ? slab('stone') : x % 7 === 0 ? 'grass_block' : 'oak_leaves'));
  kit.palm(L, -8, 17, 10, [0, 1], FLOOR + 1);
  kit.palm(L, 13, 18, 11, [0, -1], FLOOR + 1);
  lightPole(3, 17);
  lightPole(22, 17);
  lightPole(-4, -1);
  // Parked cars, noses to the aisles: the stalls are 3 wide, 6 deep. (A car's Place turn 1
  // points its nose north, 3 south.)
  kit.convertible(at(-15, 0, 1), 0, FLOOR, -1);
  kit.van(at(-6, 0, 1), 0, FLOOR, -1, 'orange_concrete');
  kit.wagon(at(3, 0, 1), 0, FLOOR, -1);
  kit.pickup(at(9, 0, 1), 0, FLOOR, -1, 'light_blue_concrete');
  kit.taxi(at(-12, 10, 1), 0, FLOOR, -1);
  kit.convertible(at(0, 10, 1), 0, FLOOR, -1, 'cyan_concrete');
  kit.van(at(15, 10, 1), 0, FLOOR, -1, 'pink_concrete');
  kit.pickup(at(-3, 25, 3), 0, FLOOR, -1, 'red_concrete');
  kit.wagon(at(9, 25, 3), 0, FLOOR, -1, 'yellow_concrete');
  kit.convertible(at(24, 25, 3), 0, FLOOR, -1, 'white_concrete');
  kit.taxi(at(21, 10, 1), 0, FLOOR, -1);
  // The south edge: a sidewalk, a brick wall and a hedge on it, the boulevard beyond.
  fill(WEST, FLOOR, SOUTH, EAST, FLOOR, SOUTH, 'bricks');
  fill(WEST, FLOOR + 1, SOUTH, EAST, FLOOR + 3, SOUTH, 'oak_leaves');
  // The east edge south of the motel, and the west edge: hedges.
  fill(EAST, FLOOR, MZ1 + 1, EAST, FLOOR + 4, SOUTH, 'oak_leaves');
  fill(WEST, FLOOR, NORTH + 1, WEST, FLOOR + 4, SOUTH, (_x, y, z) => (y === FLOOR + 4 && z % 4 === 0 ? 'bamboo_pole' : 'oak_leaves'));
  for (const [x, z] of [[-30, 28], [-10, 28], [10, 28], [30, 28]]) kit.hydrant(L, x, FLOOR, z);
}

/**
 * The carhop: a long flat canopy on posts over a row of stalls, a menu board at each; its roof
 * is a perch over the lot and the lanai (stairs up at its west end).
 */
function carhop() {
  const [x0, x1, z0, z1] = [-42, -20, 8, 16];
  fill(x0, FLOOR + 4, z0, x1, FLOOR + 4, z1, (x, _y, z) => (x === x0 || x === x1 || z === z0 || z === z1 ? 'orange_concrete' : 'white_concrete'));
  fill(x0, FLOOR + 3, z0, x1, FLOOR + 3, z0, (x) => (x % 2 === 0 ? 'neon_yellow' : undefined));
  fill(x0, FLOOR + 3, z1, x1, FLOOR + 3, z1, (x) => (x % 2 === 0 ? 'neon_pink' : undefined));
  for (let x = x0; x <= x1; x += 5) {
    for (const z of [z0, z1]) fill(x, FLOOR, z, x, FLOOR + 3, z, (_x, y) => (y === FLOOR ? 'red_concrete' : 'white_concrete'));
    // A menu board on its post at the head of each stall.
    if (x < x1) {
      set(x + 2, FLOOR, z0 + 1, 'iron_block');
      set(x + 2, FLOOR + 1, z0 + 1, 'menu_board[facing=south]');
    }
  }
  // The roof's edge, and its stairs.
  fill(x0, UP, z0, x1, UP, z1, (x, _y, z) => (x === x1 || z === z0 || z === z1 ? slab('stone') : undefined));
  fill(x0, UP, z1, x0 + 1, UP, z1, 'air');
  for (let i = 0; i < 5; i++) {
    const z = z1 + 5 - i;
    fill(x0, FLOOR, z, x0 + 1, FLOOR + i, z, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'north') : 'white_concrete'));
  }
  // Cover up there: the canopy's fans, a crate of napkins, a neon arrow sign pointing down at the stalls.
  fill(-26, UP, 12, -25, UP, 13, 'iron_block');
  fill(-35, UP, 11, -35, UP, 12, 'iron_block');
  set(-30, UP, 14, 'oak_planks');
  sprite(['..X..', '.XXX.', 'XXXXX', '..X..', '..X..'].reverse(), { X: 'neon_yellow' }, (u, v) => ({ x: -40 + u, y: UP + 1 + v, z: z0 + 1 }));
  fill(-40, UP, z0 + 1, -36, UP, z0 + 1, 'black_concrete');
  // Cars at the stalls: a bus and a woody.
  kit.van(at(-35, 11, 1), 0, FLOOR, -1, 'light_blue_concrete');
  kit.wagon(at(-25, 11, 1), 0, FLOOR, -1, 'red_concrete');
  kit.convertible(at(-30, 11, 1), 0, FLOOR, -1, 'magenta_concrete');
}

// ---------------------------------------------------------------------------------------------
// Beyond the fences (unreachable): the boulevard, the pylon sign, palms
// ---------------------------------------------------------------------------------------------

function boulevard() {
  fill(WEST - 18, G, SOUTH + 3, EAST + 18, G, SOUTH + 12, (x, _y, z) => (z === SOUTH + 7 && ((x % 6) + 6) % 6 < 3 ? 'yellow_concrete' : z === SOUTH + 3 || z === SOUTH + 12 ? 'light_gray_concrete' : 'gray_concrete'));
  // The pylon sign: BIG KAHUNA BURGER over a burger, on a tall pole, facing the lot.
  const [sx, sz] = [-30, SOUTH + 2];
  fill(sx, FLOOR, sz, sx + 1, FLOOR + 14, sz, 'iron_block');
  const base = FLOOR + 15;
  fill(sx - 12, base, sz, sx + 13, base + 16, sz, (x, y) => (x === sx - 12 || x === sx + 13 || y === base || y === base + 16 ? ((x + y) % 2 === 0 ? 'neon_yellow' : 'black_concrete') : 'white_concrete'));
  // Two-sided: the lot's side, and the boulevard's (a white board of its own, the words the right way round from there).
  fill(sx - 12, base, sz + 1, sx + 13, base + 16, sz + 1, (x, y) => (x === sx - 12 || x === sx + 13 || y === base || y === base + 16 ? ((x + y) % 2 === 0 ? 'neon_yellow' : 'black_concrete') : 'white_concrete'));
  ['BIG', 'KAHUNA'].forEach((w, i) => {
    const rows = layout(w, FONT);
    const width = rows[0].length;
    const pad = Math.floor((26 - width) / 2);
    sprite(rows, { X: 'red_concrete' }, (u, v) => ({ x: sx + 13 - pad - u, y: base + 10 - i * 6 + v, z: sz - 1 }));
    sprite(rows, { X: 'red_concrete' }, (u, v) => ({ x: sx - 12 + pad + u, y: base + 10 - i * 6 + v, z: sz + 2 }));
  });
  const BURGER = ['..OOOOO..', '.OOWOOOO.', 'OOOOOWOOO', 'LLLLLLLLL', 'BBBBBBBBB', '.OOOOOOO.'];
  sprite(outlined(BURGER), { O: 'orange_concrete', W: 'white_concrete', L: 'lime_concrete', B: 'brown_concrete', K: 'black_concrete' }, (u, v) => ({ x: sx + 6 - u, y: base + 17 + v, z: sz }));
  for (const [x, z, h] of [[-50, 36, 12], [-20, 44, 13], [8, 44, 11], [36, 44, 14], [52, 36, 12], [54, -10, 13], [52, -30, 11], [-54, -26, 12], [-54, 10, 14], [0, -44, 12], [30, -44, 11], [-30, -44, 13]] as [number, number, number][])
    kit.palm(L, x, z, h, [hash(x, z) < 0.5 ? 1 : -1, 0], FLOOR);
}

function build(): Blueprint {
  ground();
  restaurant();
  lanai();
  driveThru();
  alley();
  motel();
  lot();
  carhop();
  boulevard();
  return bp;
}

// ---------------------------------------------------------------------------------------------

/** A spawn standing in the map's block (x, z) on the floor at y, facing (tx, tz). */
const spawn = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => spawnAt(OX + x, y, z, OX + tx, tz);
const spot = (x: number, y: number, z: number): Vec3 => ({ x: OX + x + 0.5, y, z: z + 0.5 });

export const KAHUNA: MapSpec = {
  id: 'kahuna',
  name: 'Big Kahuna Burger',
  blurb: 'A burger joint, its lot, and the motel next door',
  floorY: FLOOR,
  structures: [build()],
  // The lot is level with the plain; hills round it in the haze.
  terraform: [
    { x: OX, z: 0, radius: 56, blend: 20, height: G + 0.5 },
    { x: OX - 20, z: -120, radius: 22, blend: 40, height: 86.5 },
    { x: OX + 125, z: -40, radius: 18, blend: 42, height: 84.5 },
    { x: OX - 130, z: 35, radius: 20, blend: 40, height: 88.5 },
    { x: OX + 60, z: 125, radius: 16, blend: 40, height: 80.5 },
  ],
  bounds: { min: { x: OX + WEST, y: DEEP - 2, z: NORTH }, max: { x: OX + EAST, y: SKY, z: SOUTH } },
  spawns: [
    // The lanai and the tiki bar.
    spawn(-34, FLOOR, -17, 0, -10),
    spawn(-41, FLOOR, -18, 0, -10),
    spawn(-30, FLOOR, -7, 0, -10),
    // The restaurant: the kitchen, the dining room, the drive-thru station.
    spawn(-9, FLOOR, -17, -9, 0),
    spawn(-12, FLOOR, -10, 0, -10),
    spawn(6, FLOOR, -9, 0, -10),
    // The alley.
    spawn(-38, FLOOR, -28, 0, -28),
    spawn(-6, FLOOR, -30, 0, -20),
    spawn(12, FLOOR, -29, 0, -28),
    // The motel: rooms down and up, the office, the laundry, the courtyard.
    spawn(40, FLOOR, -17, 20, -12),
    spawn(40, FLOOR, -5, 20, -12),
    spawn(40, UP, -23, 20, -12),
    spawn(40, UP, 1, 20, -12),
    spawn(24, FLOOR, -31, 24, 0),
    spawn(39, FLOOR, -29, 24, 0),
    spawn(21, FLOOR, -3, 0, 0),
    // The lot and the carhop.
    spawn(-38, FLOOR, 22, 0, 10),
    spawn(-12, FLOOR, 27, 0, 10),
    spawn(16, FLOOR, 27, 0, 10),
    spawn(-24, FLOOR, 4, 0, 10),
    spawn(28, FLOOR, 12, 0, 10),
    spawn(-33, UP, 13, 0, 10),
  ],
  // Team Deathmatch: the lanai and the carhop against the motel.
  teams: [
    [spawn(-34, FLOOR, -17, 0, -10), spawn(-41, FLOOR, -18, 0, -10), spawn(-30, FLOOR, -7, 0, -10), spawn(-40, FLOOR, 5, 0, 0), spawn(-38, FLOOR, 22, 0, 10), spawn(-24, FLOOR, -11, 0, -10)],
    [spawn(40, FLOOR, -17, 0, -12), spawn(40, FLOOR, -5, 0, -12), spawn(40, UP, -23, 0, -12), spawn(40, UP, 1, 0, -12), spawn(39, FLOOR, -29, 0, -12), spawn(36, FLOOR, 12, 0, 0)],
  ],
  // The Briefcase: the attackers come up from the boulevard; the defenders hold the alley and the
  // motel office. A: the kitchen. B: the bottom of the drained pool.
  bomb: {
    attack: [spawn(-24, FLOOR, 27, 0, 0), spawn(-12, FLOOR, 27, 0, 0), spawn(-2, FLOOR, 28, 0, 0), spawn(8, FLOOR, 27, 0, 0), spawn(18, FLOOR, 28, 0, 0), spawn(-34, FLOOR, 25, 0, 0)],
    defend: [spawn(-36, FLOOR, -28, 0, -18), spawn(-26, FLOOR, -29, 0, -18), spawn(-8, FLOOR, -30, 0, -18), spawn(23, FLOOR, -31, 24, -10), spawn(27, FLOOR, -29, 24, -10), spawn(39, FLOOR, -30, 24, -10)],
    sites: [
      { name: 'A', label: 'the kitchen', at: spot(-8, FLOOR, -18), radius: 3 },
      { name: 'B', label: 'the pool', at: spot(24, SHALLOW, -10), radius: 3 },
    ],
  },
  // Across the lot to the A-frame, the giant burger over it.
  home: { x: OX + 0.5, y: FLOOR + 0.05, z: 21.5, yaw: 0 },
  overview: { position: { x: OX - 10, y: FLOOR + 38, z: 62 }, target: { x: OX, y: FLOOR + 4, z: -10 } },
  hotspots: [
    spot(-8, FLOOR, -18),
    spot(-6, FLOOR, -10),
    spot(-4, UP, -10),
    spot(-30, FLOOR, -12),
    spot(-33, UP, 12),
    spot(0, FLOOR, 8),
    spot(18, FLOOR, 14),
    spot(24, SHALLOW, -10),
    spot(32, UP, -12),
    spot(26, FLOOR, -29),
    spot(-10, FLOOR, -28),
    spot(13, FLOOR, -20),
  ],
};
