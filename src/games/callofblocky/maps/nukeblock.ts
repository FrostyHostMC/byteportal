import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import * as kit from './kit';
import { FONT, hash, layout, Place, slab, spawnAt, stairs, torch, type Canvas, type Facing, type Fill, type MapSpec, type SpawnPoint } from './kit';

/**
 * Nukeblock: a model town on an atomic test range, 512 blocks south of Jackrabbit Lane. Two
 * two-storey houses face each other across one short street, the mint-green one on the west and
 * the butter-yellow one on the east, each with an attached garage, a back balcony with stairs down
 * to the garden, and a backyard behind it (where the teams start). A school bus is parked across
 * the south end of the street, by the closed gate under the town's sign; at the north end, in
 * the turning circle, a pickup has towed in a camper. Mannequins stand about everywhere: on the
 * lawns, at the windows, round the kitchen tables.
 *
 * The two houses and their yards are the same plan turned half round about the middle of the
 * street, so neither side has the better of it: the green house's garage is toward the bus, the
 * yellow one's toward the camper. Lanes: the street (the station wagon and the convertible in it),
 * through the houses (front door, kitchen, back door; upstairs windows over the street), and the
 * side yards round both ends of each house.
 *
 * The Briefcase: the attackers come in from the bus end, the defenders hold the camper end, and
 * the case goes down in either living room.
 */

// ---------------------------------------------------------------------------------------------
// Layout, in the map's own coordinates (+x east, +z south; the world's z is OZ + z). Players stand
// at FLOOR on the street; the ground blocks are at G.
//
//   x = -40 .. -32     the green house's backyard (garden, shed, the balcony stairs)
//   x = -31 .. -18     the green house: z = -12 .. 4, two floors (players at 64 and 69), the
//                      kitchen at the back, the living room at the front, the stairs along its
//                      south wall; its garage at z = 5 .. 12 (x = -29 .. -19)
//   x = -17 .. -9      its front lawn and driveway; sidewalk to |x| = 7, kerb at |x| = 7
//   |x| <= 6           the street, from the turning circle (centre (0, -20)) to the bus (z = 18 .. 22)
//   x = 18 .. 40       the yellow house and its yard: the green ones turned half round
//   |z| = 13 .. 29     side yards; z = ±30 the boundary: chain-link across the street ends, board
//                      fences backed by tall hedges round the yards
// ---------------------------------------------------------------------------------------------

/** Where the map's middle is in the world: far enough from the other maps that none is drawn from another. */
const OZ = 512;
const FLOOR = 64;
const G = FLOOR - 1;
/** The houses' upper floors (players stand here). */
const UP = FLOOR + 5;
/** Air is carved up to here over the play area. */
const SKY = 94;
/** The highest block written (the town sign). */
const TOP = 96;

const WEST = -40;
const EAST = 40;
const NORTH = -30;
const SOUTH = 30;
/** The turning circle at the north end of the street. */
const CUL = { x: 0, z: -20, r: 10.5 };

const bp = new Blueprint({ x: WEST - 22, y: 54, z: OZ + NORTH - 22 }, { x: EAST - WEST + 45, y: TOP - 54 + 1, z: SOUTH - NORTH + 45 });
/** The map in its own coordinates: what's built here lands at OZ. */
const L = new Place(bp, 0, OZ);
/** The east side: the west side's plan, turned half round about the middle of the street. */
const EAST_SIDE = new Place(L, 0, 0, 2);

const box = (c: Canvas, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => c.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);

// ---------------------------------------------------------------------------------------------
// Ground: the street, its sidewalks and kerbs, lawns inside the fences and desert sand outside.
// ---------------------------------------------------------------------------------------------

const inStreet = (x: number, z: number) => (Math.abs(x) <= 6 && z >= CUL.z && z <= SOUTH) || Math.hypot(x - CUL.x, z - CUL.z) <= CUL.r;
const inSidewalk = (x: number, z: number) => !inStreet(x, z) && ((Math.abs(x) <= 8 && z >= CUL.z && z <= SOUTH) || Math.hypot(x - CUL.x, z - CUL.z) <= CUL.r + 2);
const inside = (x: number, z: number) => x >= WEST && x <= EAST && z >= NORTH && z <= SOUTH;

function ground() {
  const [x0, x1, z0, z1] = [WEST - 22, EAST + 22, NORTH - 22, SOUTH + 22];
  box(L, x0, 54, z0, x1, G - 1, z1, (_x, y) => (y >= G - 3 ? 'dirt' : 'stone'));
  box(L, x0, FLOOR, z0, x1, SKY, z1, 'air');
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      let b: BlockRef = 'grass_block';
      if (!inside(x, z)) {
        // The range: sand, thinning into the plain's grass toward the edge of what's built.
        const out = Math.max(WEST - x, x - EAST, NORTH - z, z - SOUTH);
        b = hash(x, z, 7) * 22 < 22 - out + 6 ? 'sand' : 'grass_block';
        if (b === 'sand' && hash(x, z, 8) < 0.025) L.set(x, FLOOR, z, 'dead_bush');
      } else if (inStreet(x, z)) {
        b = hash(x, z, 3) < 0.035 ? 'black_concrete' : 'gray_concrete';
        // The centre line's dashes.
        if (x === 0 && z > -10 && z < 17 && ((z % 6) + 6) % 6 < 3) b = 'yellow_concrete';
      } else if (inSidewalk(x, z)) {
        b = ((z % 5) + 5) % 5 === 0 && Math.abs(x) <= 8 && z >= CUL.z ? 'white_concrete' : 'light_gray_concrete';
        // A slab-high kerb where the sidewalk meets the road.
        if (inStreet(x + 1, z) || inStreet(x - 1, z) || inStreet(x, z + 1) || inStreet(x, z - 1)) {
          b = 'white_concrete';
          L.set(x, FLOOR, z, slab('stone'));
        }
      }
      L.set(x, G, z, b);
    }
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** A mannequin standing on y, looking `f` (two blocks: blocks.ts). */
function mannequin(c: Canvas, x: number, y: number, z: number, f: Facing) {
  c.set(x, y, z, 'mannequin_legs');
  c.set(x, y + 1, z, `mannequin_torso[facing=${f}]`);
}

/** A little shade tree: a trunk, and a round crown starting high enough to walk under. */
function tree(c: Canvas, x: number, z: number, h = 4) {
  box(c, x - 2, FLOOR + h - 1, z - 2, x + 2, FLOOR + h + 1, z + 2, (xx, y, zz) => {
    const d = Math.abs(xx - x) + Math.abs(zz - z);
    const top = y === FLOOR + h + 1;
    return d <= (top ? 1 : 3) && !(Math.abs(xx - x) === 2 && Math.abs(zz - z) === 2) ? 'oak_leaves' : undefined;
  });
  box(c, x, FLOOR, z, x, FLOOR + h, z, 'oak_log');
}

/** A white picket fence along a line, 1.5 high to bodies (nobody jumps it). */
function picket(c: Canvas, x0: number, z0: number, x1: number, z1: number) {
  box(c, x0, FLOOR, z0, x1, FLOOR, z1, 'picket');
}

/**
 * A yellow school bus standing on y, nose toward -x: the hood, then the body, its floor a step up,
 * open windows down both sides at head height (shoot through them), the door on its -z side by
 * the driver, the emergency door open at the back, seats down both sides of the aisle.
 */
function bus(c: Canvas, x0: number, y: number, z0: number) {
  const x1 = x0 + 12;
  const z1 = z0 + 4;
  // The hood and the grille, the bumper, the headlamps.
  box(c, x0, y, z0 + 1, x0 + 1, y + 1, z1 - 1, 'yellow_concrete');
  box(c, x0 - 1, y, z0 + 1, x0 - 1, y, z1 - 1, 'black_concrete');
  c.set(x0, y + 1, z0 + 1, 'sea_lantern');
  c.set(x0, y + 1, z1 - 1, 'sea_lantern');
  box(c, x0, y, z0 + 2, x0, y + 1, z0 + 2, 'gray_concrete');
  // The body.
  box(c, x0 + 2, y, z0, x1, y + 4, z1, (x, yy, z) => {
    const side = z === z0 || z === z1;
    const end = x === x0 + 2 || x === x1;
    if (yy === y + 4) return x === x0 + 2 || x === x1 ? 'white_concrete' : 'yellow_concrete';
    if (yy === y) return side && (x === x0 + 3 || x === x1 - 2) ? 'black_concrete' : side || end ? 'yellow_concrete' : 'gray_concrete';
    if (!side && !end) return 'air';
    if (yy === y + 1) return 'black_concrete';
    // Windows between the pillars (the windscreen and the back windows too).
    if (end) return side ? 'yellow_concrete' : 'air';
    return (x - x0) % 2 === 0 ? 'yellow_concrete' : 'air';
  });
  // The door, open, a step up to it; the emergency door.
  box(c, x0 + 3, y + 1, z0, x0 + 4, y + 3, z0, 'air');
  box(c, x0 + 3, y, z0 - 1, x0 + 4, y, z0 - 1, stairs('stone_brick', 'south'));
  box(c, x1, y + 1, z0 + 2, x1, y + 3, z0 + 2, 'air');
  // The driver's seat, the passengers' rows; the stop arm folded on the door side, its lamps.
  c.set(x0 + 3, y + 1, z1 - 1, stairs('spruce', 'east'));
  for (let x = x0 + 6; x < x1 - 1; x += 2) {
    c.set(x, y + 1, z0 + 1, stairs('spruce', 'east'));
    c.set(x, y + 1, z1 - 1, stairs('spruce', 'east'));
  }
  c.set(x0 + 5, y + 2, z0 - 1, 'red_concrete');
  for (const z of [z0, z1]) {
    c.set(x0 + 2, y + 4, z, 'neon_red');
    c.set(x1, y + 4, z, 'neon_red');
  }
}

/**
 * A camper trailer standing on y, its hitch toward -x: white with a turquoise band, the top corners
 * rounded off, windows, the door open on its +z side, a dinette inside.
 */
function camper(c: Canvas, x0: number, y: number, z0: number) {
  const x1 = x0 + 8;
  const z1 = z0 + 3;
  box(c, x0, y, z0, x1, y + 3, z1, (x, yy, z) => {
    const side = z === z0 || z === z1;
    const end = x === x0 || x === x1;
    if (side && end && yy === y + 3) return undefined;
    if (yy === y + 3) return 'white_concrete';
    if (!side && !end) return 'air';
    if (yy === y) return side && x === x0 + 4 ? 'black_concrete' : 'white_concrete';
    if (yy === y + 1) return 'cyan_concrete';
    return (side && (x === x0 + 2 || x === x1 - 2)) || (end && !side) ? 'glass' : 'white_concrete';
  });
  box(c, x0 + 5, y, z1, x0 + 6, y + 2, z1, 'air');
  // The dinette at the hitch end, a bunk at the back, a lamp.
  c.set(x0 + 1, y, z0 + 1, stairs('oak', 'west'));
  c.set(x0 + 2, y, z0 + 1, slab('birch', true));
  c.set(x0 + 3, y, z0 + 1, stairs('oak', 'east'));
  box(c, x1 - 1, y, z0 + 1, x1 - 1, y, z1 - 1, slab('birch'));
  c.set(x0 + 4, y + 2, z0 + 1, 'glowstone');
  // The hitch and its jack.
  c.set(x0 - 1, y, z0 + 1, 'iron_block');
  c.set(x0 - 1, y, z0 + 2, 'iron_block');
}

// ---------------------------------------------------------------------------------------------
// A house, its garage and its yards (written for the west side; the east side is it turned round)
// ---------------------------------------------------------------------------------------------

interface HouseStyle {
  wall: BlockRef;
  trim: BlockRef;
  frame: BlockRef;
  floor: BlockRef;
  upFloor: BlockRef;
  checker: [BlockRef, BlockRef];
  rug: [BlockRef, BlockRef];
  bed: 'red' | 'blue' | 'green' | 'yellow';
  kidBed: 'red' | 'blue' | 'green' | 'yellow';
  mailbox: BlockRef;
}

const HX0 = -31; // back wall
const HX1 = -18; // front wall (faces the street)
const HZ0 = -12; // north wall
const HZ1 = 4; // south wall (shared with the garage)
/** The partition between the kitchen (behind) and the living room (in front), on both floors. */
const PX = -25;
/** The garage: its back wall, its front (the door), its south wall. */
const GX0 = -29;
const GX1 = -19;
const GZ1 = 12;

interface Opening {
  wall: 'front' | 'back' | 'north' | 'south';
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  door?: boolean;
}

const OPENINGS: Opening[] = [
  // The street side: the front door, the big windows on both floors.
  { wall: 'front', a0: -4, a1: -3, y0: FLOOR, y1: FLOOR + 2, door: true },
  { wall: 'front', a0: -10, a1: -7, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'front', a0: 0, a1: 2, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'front', a0: -10, a1: -6, y0: UP + 1, y1: UP + 2 },
  { wall: 'front', a0: -2, a1: 1, y0: UP + 1, y1: UP + 2 },
  // The garden side: the kitchen door, the balcony door upstairs.
  { wall: 'back', a0: -1, a1: 0, y0: FLOOR, y1: FLOOR + 2, door: true },
  { wall: 'back', a0: -9, a1: -7, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'back', a0: -8, a1: -7, y0: UP, y1: UP + 2, door: true },
  { wall: 'back', a0: -2, a1: 0, y0: UP + 1, y1: UP + 2 },
  // The side yard: a side door into the living room, windows.
  { wall: 'north', a0: -22, a1: -21, y0: FLOOR, y1: FLOOR + 2, door: true },
  { wall: 'north', a0: -29, a1: -27, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'north', a0: -23, a1: -20, y0: UP + 1, y1: UP + 2 },
  { wall: 'north', a0: -29, a1: -27, y0: UP + 1, y1: UP + 2 },
  // The kitchen into the garage.
  { wall: 'south', a0: -28, a1: -27, y0: FLOOR, y1: FLOOR + 2, door: true },
];

/** An opening's cells: its own (air) and, for a window, the white sill under it. */
function openingCells(o: Opening, fn: (x: number, y: number, z: number, edge: boolean) => void) {
  for (let a = o.a0; a <= o.a1; a++)
    for (let y = o.door ? o.y0 : o.y0 - 1; y <= o.y1; y++) {
      const [x, z] = o.wall === 'front' ? [HX1, a] : o.wall === 'back' ? [HX0, a] : o.wall === 'north' ? [a, HZ0] : [a, HZ1];
      fn(x, y, z, y < o.y0);
    }
}

function house(c: Canvas, st: HouseStyle) {
  // Floors: planks, the kitchen's checks.
  box(c, HX0, G, HZ0, HX1, G, HZ1, st.floor);
  box(c, HX0 + 1, G, HZ0 + 1, PX - 1, G, HZ1 - 1, (x, _y, z) => ((x + z) % 2 === 0 ? st.checker[0] : st.checker[1]));
  // The shell: siding, white corners, a band where the upper floor is.
  box(c, HX0, FLOOR, HZ0, HX1, UP + 3, HZ1, (x, y, z) => {
    const ex = x === HX0 || x === HX1;
    const ez = z === HZ0 || z === HZ1;
    if (!ex && !ez) return y === UP - 1 ? st.upFloor : 'air';
    if ((ex && ez) || y === UP - 1) return st.trim;
    return st.wall;
  });
  box(c, HX0, UP + 4, HZ0, HX1, UP + 4, HZ1, (x, _y, z) => (x === HX0 || x === HX1 || z === HZ0 || z === HZ1 ? st.trim : 'white_concrete'));
  // The partition, on both floors, with its doorways.
  box(c, PX, FLOOR, HZ0 + 1, PX, UP - 2, HZ1 - 1, 'white_concrete');
  box(c, PX, UP, HZ0 + 1, PX, UP + 3, HZ1 - 1, 'white_concrete');
  for (const [z0, z1] of [[-9, -8], [0, 1]]) box(c, PX, FLOOR, z0, PX, FLOOR + 2, z1, 'air');
  for (const [z0, z1] of [[-9, -8], [2, 3]]) box(c, PX, UP, z0, PX, UP + 2, z1, 'air');
  for (const o of OPENINGS) openingCells(o, (x, y, z, edge) => c.set(x, y, z, edge ? st.frame : 'air'));

  // The gable roof: dark shingles down to the street and down to the garden, a chimney, the ridge capped.
  for (let k = 0; k <= 7; k++) {
    const y = UP + 4 + k;
    box(c, HX1 + 1 - k, y, HZ0 - 1, HX1 + 1 - k, y, HZ1 + 1, stairs('spruce', 'west'));
    box(c, HX0 - 1 + k, y, HZ0 - 1, HX0 - 1 + k, y, HZ1 + 1, stairs('spruce', 'east'));
    if (k > 0 && HX0 + k <= HX1 - k) {
      box(c, HX0 + k, y, HZ0, HX1 - k, y, HZ0, st.wall);
      box(c, HX0 + k, y, HZ1, HX1 - k, y, HZ1, st.wall);
    }
  }
  box(c, -25, UP + 12, HZ0 - 1, -24, UP + 12, HZ1 + 1, slab('spruce'));
  for (const z of [HZ0, HZ1]) box(c, -25, UP + 7, z, -24, UP + 8, z, 'white_concrete');
  box(c, -29, UP + 4, -9, -28, UP + 11, -8, 'bricks');

  // ----- Downstairs: the living room in front, the kitchen behind, the stairs along the south wall.
  box(c, -24, G, -8, -20, G, -2, (x, _y, z) => (Math.abs(x + 22) <= 1 && Math.abs(z + 5) <= 2 ? st.rug[0] : st.rug[1]));
  box(c, -24, FLOOR, -6, -24, FLOOR, -3, 'sofa[facing=east]');
  box(c, -22, FLOOR, -5, -22, FLOOR, -4, slab('spruce', true));
  c.set(-19, FLOOR, -6, 'black_concrete'); // the television
  c.set(-19, FLOOR + 1, -6, 'neon_cyan');
  box(c, -24, FLOOR, -11, -24, FLOOR + 1, -11, 'bookshelf');
  mannequin(c, -20, FLOOR, -10, 'east');
  mannequin(c, -23, FLOOR, -8, 'south');
  // The kitchen: a fridge, the counter and stove under the window, a table laid for a family of dummies.
  box(c, -30, FLOOR, -11, -30, FLOOR + 1, -11, 'white_concrete');
  box(c, -29, FLOOR, -11, -26, FLOOR, -11, (x) => (x === -28 ? 'iron_block' : 'white_concrete'));
  box(c, -29, FLOOR, -6, -28, FLOOR, -5, slab('birch', true));
  mannequin(c, -30, FLOOR, -6, 'east');
  mannequin(c, -27, FLOOR, -5, 'west');
  box(c, -30, FLOOR, 3, -29, FLOOR, 3, 'white_concrete');
  // The stairs up, climbing toward the back, the railing round the stairwell upstairs.
  for (let i = 0; i < 5; i++) {
    const x = -20 - i;
    box(c, x, FLOOR, 2, x, FLOOR + i, 3, (_x, y) => (y === FLOOR + i ? stairs('oak', 'west') : 'white_concrete'));
    box(c, x, FLOOR + i + 1, 2, x, FLOOR + i + 4, 3, 'air');
  }
  box(c, -23, UP, 1, -20, UP, 1, slab('oak'));
  box(c, -19, UP, 2, -19, UP, 3, slab('oak'));
  // Lights under the upper floor's furniture.
  for (const [x, z] of [[-22, -5], [-28, -8], [-28, 0]]) c.set(x, UP - 1, z, 'sea_lantern');
  c.set(HX1 + 1, FLOOR + 2, -5, torch('east'));
  c.set(HX1 + 1, FLOOR + 2, -2, torch('east'));

  // ----- Upstairs: the bedroom over the street, the study behind, its door out to the balcony.
  for (const z of [-6, -5]) {
    c.set(-24, UP, z, `${st.bed}_bed[facing=west,part=head]`);
    c.set(-23, UP, z, `${st.bed}_bed[facing=west,part=foot]`);
  }
  c.set(-24, UP, -7, 'spruce_planks');
  c.set(-24, UP + 1, -7, 'glowstone');
  box(c, -21, UP, -11, -20, UP, -11, slab('spruce', true));
  mannequin(c, -19, UP, -9, 'east');
  box(c, -30, UP, -11, -29, UP + 1, -11, 'bookshelf');
  box(c, -27, UP, -11, -26, UP, -11, slab('birch', true));
  c.set(-30, UP, 3, `${st.kidBed}_bed[facing=west,part=head]`);
  c.set(-29, UP, 3, `${st.kidBed}_bed[facing=west,part=foot]`);
  for (const [x, z] of [[-22, -5], [-28, -4]]) c.set(x, UP + 4, z, 'sea_lantern');

  // ----- The balcony off the study, on posts, and its stairs down to the garden.
  box(c, -34, UP - 1, -10, -32, UP - 1, -5, 'spruce_planks');
  for (const x of [-34, -32]) box(c, x, FLOOR, -10, x, UP - 2, -10, 'spruce_log');
  box(c, -34, UP, -10, -32, UP, -10, 'picket');
  box(c, -34, UP, -9, -34, UP, -6, 'picket');
  c.set(-32, UP, -5, 'picket');
  for (let i = 0; i < 5; i++) box(c, -34, FLOOR, -i, -33, FLOOR + i, -i, (_x, y) => (y === FLOOR + i ? stairs('spruce', 'north') : 'spruce_planks'));
  c.set(HX0 - 1, UP + 2, -6, torch('west'));
}

function garage(c: Canvas, st: HouseStyle) {
  box(c, GX0, G, HZ1 + 1, GX1, G, GZ1, 'light_gray_concrete');
  box(c, GX0, FLOOR, HZ1 + 1, GX1, FLOOR + 4, GZ1, (x, y, z) => {
    const edge = x === GX0 || x === GX1 || z === GZ1;
    if (y === FLOOR + 4) return edge ? st.trim : 'white_concrete';
    if (!edge) return 'air';
    if ((x === GX0 || x === GX1) && z === GZ1) return st.trim;
    return st.wall;
  });
  // The big door, up (its panel showing at the top), the back door to the garden.
  box(c, GX1, FLOOR, 6, GX1, FLOOR + 2, 10, 'air');
  box(c, GX1, FLOOR + 3, 6, GX1, FLOOR + 3, 10, st.frame);
  box(c, GX0, FLOOR, 9, GX0, FLOOR + 2, 10, 'air');
  // A workbench, shelves, crates, a mannequin waiting to be dressed.
  box(c, -27, FLOOR, 11, -24, FLOOR, 11, 'spruce_planks');
  c.set(-26, FLOOR + 1, 11, 'iron_block');
  box(c, -21, FLOOR, 11, -20, FLOOR + 2, 11, 'bookshelf');
  box(c, -28, FLOOR, 7, -28, FLOOR, 8, 'oak_planks');
  c.set(-28, FLOOR + 1, 7, 'oak_planks');
  mannequin(c, -22, FLOOR, 6, 'east');
  for (const x of [-26, -22]) c.set(x, FLOOR + 4, 8, 'glowstone');
}

function frontYard(c: Canvas, st: HouseStyle) {
  // The path to the front door, the driveway, flower beds under the windows.
  box(c, HX1 + 1, G, -4, -9, G, -3, 'white_concrete');
  box(c, HX1, G, 6, -9, G, 10, 'light_gray_concrete');
  for (const [z0, z1] of [[-11, -6], [-1, 2]]) {
    box(c, HX1 + 1, G, z0, HX1 + 1, G, z1, 'podzol');
    box(c, HX1 + 1, FLOOR, z0, HX1 + 1, FLOOR, z1, (_x, _y, z) => (z % 3 === 0 ? 'poppy' : z % 3 === 1 || z % 3 === -2 ? 'cornflower' : 'dandelion'));
  }
  tree(c, -13, -9);
  // The mailbox by the sidewalk, a mannequin admiring the lawn.
  c.set(-9, FLOOR, -6, 'white_concrete');
  c.set(-9, FLOOR + 1, -6, st.mailbox);
  mannequin(c, -14, FLOOR, 1, 'east');
}

function yards(c: Canvas) {
  // The garden behind the house: beds of vegetables and flowers (where the team starts), the shed,
  // a picnic table, a swing frame by the garage.
  for (const z0 of [-8, -2, 4]) {
    box(c, -39, G, z0, -37, G, z0 + 3, 'podzol');
    box(c, -39, FLOOR, z0, -37, FLOOR, z0 + 3, (x, _y, z) => ((x + z) % 3 === 0 ? 'fern' : (x + z) % 3 === 1 || (x + z) % 3 === -2 ? 'short_grass' : 'dandelion'));
  }
  box(c, -39, FLOOR, 15, -35, FLOOR + 3, 19, (x, y, z) => {
    const edge = x === -39 || x === -35 || z === 15 || z === 19;
    if (y === FLOOR + 3) return 'spruce_planks';
    return edge ? 'spruce_planks' : 'air';
  });
  box(c, -35, FLOOR, 17, -35, FLOOR + 2, 18, 'air');
  box(c, -37, FLOOR + 1, 15, -37, FLOOR + 1, 15, 'glass');
  c.set(-38, FLOOR, 18, 'red_concrete'); // the mower
  c.set(-37, FLOOR + 3, 17, 'glowstone');
  box(c, -38, FLOOR, -18, -36, FLOOR, -18, slab('spruce', true));
  box(c, -38, FLOOR, -19, -36, FLOOR, -19, slab('spruce'));
  box(c, -38, FLOOR, -17, -36, FLOOR, -17, slab('spruce'));
  for (const z of [22, 27]) box(c, -37, FLOOR, z, -37, FLOOR + 3, z, 'spruce_log');
  box(c, -37, FLOOR + 3, 23, -37, FLOOR + 3, 26, 'spruce_planks');
  mannequin(c, -33, FLOOR, 13, 'north');

  // The side yard toward the camper: washing on the line, a doghouse, a tree.
  for (const x of [-31, -23]) box(c, x, FLOOR, -21, x, FLOOR + 2, -21, 'spruce_log');
  box(c, -30, FLOOR + 1, -21, -24, FLOOR + 2, -21, (x, y) => (x === -27 ? undefined : y === FLOOR + 1 && x % 2 === 0 ? undefined : x % 3 === 0 ? 'light_blue_concrete' : 'white_wool'));
  box(c, -37, FLOOR, -27, -35, FLOOR + 1, -25, (x, y, z) => (y === FLOOR && x === -35 && z === -26 ? 'air' : 'red_concrete'));
  box(c, -37, FLOOR + 2, -27, -35, FLOOR + 2, -25, slab('brick'));
  tree(c, -21, -25);
  mannequin(c, -27, FLOOR, -16, 'south');

  // The side yard toward the bus: a sandbox, a tree, a dummy in a deckchair's place.
  box(c, -34, FLOOR, 23, -31, FLOOR, 26, (x, _y, z) => (x === -34 || x === -31 || z === 23 || z === 26 ? slab('spruce') : undefined));
  box(c, -33, G, 24, -32, G, 25, 'sand');
  tree(c, -24, 22);
  mannequin(c, -28, FLOOR, 18, 'east');
  picket(c, -17, 13, -17, 18);
  picket(c, -17, -13, -17, -17);

  // The boundary: a board fence with tall hedges behind it, round the yard.
  for (const [x0, z0, x1, z1] of [[WEST, NORTH, WEST, SOUTH], [WEST, NORTH, -18, NORTH], [WEST, SOUTH, -18, SOUTH]]) {
    box(c, x0, FLOOR, z0, x1, FLOOR + 2, z1, 'spruce_planks');
    const [dx, dz] = x0 === x1 ? [-1, 0] : [0, z0 < 0 ? -1 : 1];
    box(c, x0 + dx, FLOOR, z0 + dz, x1 + dx, FLOOR + 6, z1 + dz, 'oak_leaves');
  }
}

function side(c: Canvas, st: HouseStyle) {
  house(c, st);
  garage(c, st);
  frontYard(c, st);
  yards(c);
}

// ---------------------------------------------------------------------------------------------
// The street, its ends, and what's past the fences
// ---------------------------------------------------------------------------------------------

function street() {
  // The bus across the south end; the pickup and the camper in the turning circle.
  bus(L, -7, FLOOR, 18);
  kit.pickup(L, -12, FLOOR, -24, 'brown_concrete');
  camper(L, -4, FLOOR, -25);
  // In the street: a station wagon nose north, a convertible at the yellow house's kerb, and
  // a car in each driveway.
  kit.wagon(new Place(L, -2, -4, 1), 0, FLOOR, 0, 'light_blue_concrete');
  kit.convertible(new Place(L, 5, 6, 1), 0, FLOOR, 0, 'red_concrete');
  kit.convertible(L, -16, FLOOR, 7, 'lime_concrete');
  kit.pickup(new Place(L, 16, -7, 2), 0, FLOOR, 0, 'orange_concrete');
  // Dummies waiting for the bus, and one by the camper door.
  mannequin(L, -9, FLOOR, 16, 'north');
  mannequin(L, -10, FLOOR, 17, 'north');
  mannequin(L, 7, FLOOR, 16, 'west');
  mannequin(L, 3, FLOOR, -21, 'south');
  mannequin(L, 1, FLOOR, 9, 'north');
  kit.hydrant(L, -8, FLOOR, -14);
  kit.hydrant(L, 8, FLOOR, 14);
  // Street lamps.
  for (const [x, z] of [[-8, 13], [8, -13]]) {
    box(L, x, FLOOR, z, x, FLOOR + 4, z, 'iron_block');
    L.set(x, FLOOR + 5, z, 'sea_lantern');
  }

  // The street ends: chain-link across them on posts; striped barriers before the south gate.
  for (const z of [NORTH, SOUTH]) {
    box(L, -17, FLOOR, z, 17, FLOOR + 4, z, 'chain_link');
    for (let x = -17; x <= 17; x += 6) box(L, x, FLOOR, z, x, FLOOR + 5, z, 'iron_block');
    box(L, 17, FLOOR, z, 17, FLOOR + 5, z, 'iron_block');
  }
  for (const [x0, x1] of [[-6, -4], [-1, 1], [4, 6]]) box(L, x0, FLOOR, 28, x1, FLOOR, 28, (x) => ((x & 1) === 0 ? 'red_concrete' : 'white_concrete'));
}

/** The town's sign past the south gate, facing up the street: NUKEBLOCK over POPULATION. */
function townSign() {
  const z = SOUTH + 6;
  const [xl, xr] = [21, -21];
  const y0 = FLOOR + 4;
  for (const x of [-15, 0, 15]) box(L, x, FLOOR, z + 1, x, y0 + 13, z + 1, 'spruce_log');
  box(L, xr, y0, z, xl, y0 + 13, z, (x, y) => (x === xl || x === xr || y === y0 || y === y0 + 13 ? 'red_concrete' : 'white_concrete'));
  // Looking south, the viewer's left is +x.
  ([['NUKEBLOCK', 'blue_concrete', y0 + 7], ['POPULATION', 'red_concrete', y0 + 1]] as const).forEach(([word, color, base]) => {
    const rows = layout(word, FONT);
    const left = Math.floor(rows[0].length / 2);
    kit.sprite(L, rows, { X: color }, (u, v) => ({ x: left - u, y: base + v, z: z - 1 }));
  });
}

/** The neighbours' house past the north fence (unreachable), a rusted car on its lawn. */
function neighbour() {
  const [x0, x1, z0, z1] = [-12, 12, -44, -36];
  box(L, x0, FLOOR, z0, x1, FLOOR + 4, z1, (x, y, z) => {
    const edge = x === x0 || x === x1 || z === z0 || z === z1;
    if (y === FLOOR + 4) return 'white_concrete';
    if (!edge) return 'air';
    if (z === z1 && y >= FLOOR + 1 && y <= FLOOR + 2 && (((x % 6) + 6) % 6 < 3)) return 'black_concrete';
    return 'light_blue_concrete';
  });
  for (let k = 0; k <= 4; k++) box(L, x0 - 1 + k, FLOOR + 5 + k, z0 - 1, x1 + 1 - k, FLOOR + 5 + k, z1 + 1, (x) => (x === x0 - 1 + k ? stairs('spruce', 'east') : x === x1 + 1 - k ? stairs('spruce', 'west') : 'spruce_planks'));
  box(L, -1, FLOOR, z1, 0, FLOOR + 2, z1, 'brown_concrete');
  kit.pickup(L, 5, FLOOR, -34, 'brown_concrete');
  mannequin(L, -5, FLOOR, -34, 'south');
}

/**
 * The shot tower on the range to the north-east: a steel lattice thirty blocks tall, the cab for
 * the device on top. It's what the town was built to watch.
 */
function shotTower(): Blueprint {
  const [cx, cz, base] = [70, OZ - 85, 56];
  const top = FLOOR + 30;
  const t = new Blueprint({ x: cx - 4, y: base, z: cz - 4 }, { x: 9, y: top + 6 - base + 1, z: 9 });
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) t.fill({ x: cx + dx, y: base, z: cz + dz }, { x: cx + dx, y: top - 1, z: cz + dz }, 'iron_block');
  for (let y = FLOOR + 4; y < top; y += 5) {
    t.fill({ x: cx - 2, y, z: cz - 2 }, { x: cx + 2, y, z: cz - 2 }, 'iron_block');
    t.fill({ x: cx - 2, y, z: cz + 2 }, { x: cx + 2, y, z: cz + 2 }, 'iron_block');
    t.fill({ x: cx - 2, y, z: cz - 2 }, { x: cx - 2, y, z: cz + 2 }, 'iron_block');
    t.fill({ x: cx + 2, y, z: cz - 2 }, { x: cx + 2, y, z: cz + 2 }, 'iron_block');
  }
  t.fill({ x: cx - 3, y: top, z: cz - 3 }, { x: cx + 3, y: top + 4, z: cz + 3 }, 'light_gray_concrete');
  t.fill({ x: cx - 3, y: top + 5, z: cz - 3 }, { x: cx + 3, y: top + 5, z: cz + 3 }, 'iron_block');
  t.set(cx, top + 6, cz, 'neon_red');
  return t;
}

const GREEN: HouseStyle = {
  wall: 'siding_green',
  trim: 'white_concrete',
  frame: 'white_concrete',
  floor: 'oak_planks',
  upFloor: 'birch_planks',
  checker: ['black_concrete', 'white_concrete'],
  rug: ['orange_concrete', 'brown_concrete'],
  bed: 'green',
  kidBed: 'blue',
  mailbox: 'green_concrete',
};

const YELLOW: HouseStyle = {
  wall: 'siding_yellow',
  trim: 'white_concrete',
  frame: 'white_concrete',
  floor: 'birch_planks',
  upFloor: 'oak_planks',
  checker: ['red_concrete', 'white_concrete'],
  rug: ['light_blue_concrete', 'white_concrete'],
  bed: 'yellow',
  kidBed: 'red',
  mailbox: 'yellow_concrete',
};

function build(): Blueprint {
  ground();
  side(L, GREEN);
  side(EAST_SIDE, YELLOW);
  street();
  townSign();
  neighbour();
  return bp;
}

// ---------------------------------------------------------------------------------------------

/** A spawn standing in the map's block (x, z) on the floor at y, facing (tx, tz). */
const spawn = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => spawnAt(x, y, OZ + z, tx, OZ + tz);
/** The same spot on the other side: the plan turned half round. */
const turned = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => spawn(-x, y, -z, -tx, -tz);
const spot = (x: number, y: number, z: number): Vec3 => ({ x: x + 0.5, y, z: OZ + z + 0.5 });

/** Each side's places to appear, written for the green (west) side. */
const SIDE_SPAWNS: [number, number, number, number, number][] = [
  [-28, FLOOR, -1, 0, 0], // the kitchen
  [-28, UP, -4, 0, 0], // the study
  [-23, FLOOR, 8, 0, 8], // the garage
  [-37, FLOOR, -4, 0, 0], // the garden
  [-36, FLOOR, 10, 0, 0], // behind the garage
  [-28, FLOOR, -26, 0, -20], // the side yard toward the camper
  [-26, FLOOR, 25, 0, 20], // the side yard toward the bus
];
/** Team Deathmatch: each team starts in its own garden. */
const GARDEN: [number, number, number, number, number][] = [
  [-37, FLOOR, -6, 0, 0],
  [-37, FLOOR, -2, 0, 0],
  [-37, FLOOR, 2, 0, 0],
  [-35, FLOOR, -12, 0, 0],
  [-36, FLOOR, 8, 0, 0],
  [-38, FLOOR, 11, 0, 0],
];

export const NUKEBLOCK: MapSpec = {
  id: 'nukeblock',
  name: 'Nukeblock',
  blurb: 'A model town on a test range, two houses and a bus',
  floorY: FLOOR,
  structures: [build(), shotTower()],
  // The town is level with the plain; mesas stand round the range in the haze.
  terraform: [
    { x: 0, z: OZ, radius: 60, blend: 20, height: G + 0.5 },
    { x: 0, z: OZ - 130, radius: 30, blend: 24, height: 92.5 },
    { x: 125, z: OZ - 30, radius: 24, blend: 22, height: 88.5 },
    { x: -125, z: OZ + 30, radius: 26, blend: 24, height: 90.5 },
    { x: -60, z: OZ + 125, radius: 22, blend: 22, height: 85.5 },
    { x: 70, z: OZ + 120, radius: 20, blend: 20, height: 83.5 },
  ],
  bounds: { min: { x: WEST, y: FLOOR - 2, z: OZ + NORTH }, max: { x: EAST, y: SKY, z: OZ + SOUTH } },
  spawns: [
    ...SIDE_SPAWNS.map(([x, y, z, tx, tz]) => spawn(x, y, z, tx, tz)),
    ...SIDE_SPAWNS.map(([x, y, z, tx, tz]) => turned(x, y, z, tx, tz)),
    // Both ends of the street: behind the bus, behind the camper.
    spawn(0, FLOOR, 26, 0, 0),
    spawn(-12, FLOOR, 26, 0, 0),
    spawn(0, FLOOR, -28, 0, 0),
    spawn(12, FLOOR, -27, 0, 0),
  ],
  teams: [GARDEN.map(([x, y, z, tx, tz]) => spawn(x, y, z, tx, tz)), GARDEN.map(([x, y, z, tx, tz]) => turned(x, y, z, tx, tz))],
  // The Briefcase: in through the gate past the bus, against the camper end; A in the green house's
  // living room, B in the yellow one's, both halfway up the street.
  bomb: {
    attack: [spawn(-4, FLOOR, 26, 0, 0), spawn(0, FLOOR, 26, 0, 0), spawn(4, FLOOR, 26, 0, 0), spawn(-12, FLOOR, 25, 0, 0), spawn(12, FLOOR, 25, 0, 0), spawn(-8, FLOOR, 26, 0, 0)],
    defend: [spawn(-2, FLOOR, -28, 0, 0), spawn(2, FLOOR, -28, 0, 0), spawn(6, FLOOR, -27, 0, 0), spawn(-6, FLOOR, -27, 0, 0), spawn(-14, FLOOR, -27, 0, 0), spawn(14, FLOOR, -27, 0, 0)],
    sites: [
      { name: 'A', label: 'the green house', at: spot(-22, FLOOR, 0), radius: 3 },
      { name: 'B', label: 'the yellow house', at: spot(22, FLOOR, 0), radius: 3 },
    ],
  },
  // Up the street from the bus, the houses either side, the camper at the far end.
  home: { x: 0.5, y: FLOOR + 0.05, z: OZ + 14.5, yaw: 0 },
  overview: { position: { x: 30, y: FLOOR + 38, z: OZ + 58 }, target: { x: 0, y: FLOOR + 4, z: OZ - 4 } },
  hotspots: [
    spot(0, FLOOR, 0),
    spot(-22, FLOOR, 0),
    spot(22, FLOOR, 0),
    spot(-21, UP, -6),
    spot(21, UP, 6),
    spot(-1, FLOOR + 1, 20),
    spot(0, FLOOR, -23),
    spot(-36, FLOOR, 0),
    spot(36, FLOOR, 0),
    spot(-24, FLOOR, 8),
    spot(24, FLOOR, -8),
    spot(-28, FLOOR, -24),
    spot(28, FLOOR, 24),
  ],
};
