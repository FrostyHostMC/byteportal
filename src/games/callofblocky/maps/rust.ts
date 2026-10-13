import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import * as kit from './kit';
import { FONT, hash, layout, Place, slab, spawnAt, stairs, yawTo, type Canvas, type Fill, type MapSpec, type SpawnPoint } from './kit';

/**
 * Rust: an oil yard in the desert, 512 blocks north of Jackrabbit Lane. A drilling tower stands in
 * the middle of it, two steel decks one over the other and a little crow's nest on top, all open
 * on every side: the best view of the yard, and the most shot at. Round it, inside walls of
 * corrugated iron and concrete: the pipe lane down the west side between two storage tanks (the
 * north one with a catwalk round it), a pumpjack nodding in the middle of the lane; the pump
 * house on the east side, two storeys of tin with the office upstairs; shipping containers in the
 * north-east corner; a broken-down tanker truck by the south wall, and a third tank south of the
 * pump house. Pipelines cross the yard at every height: on the ground to hop, at head height to
 * duck under, and up on supports to walk beneath.
 *
 * Lanes: the pipe lane (west), under and round the tower (the middle), and the pump house side
 * (east). The tower's decks are reached by stairs (both ends of the first, then up its sides), the
 * pump house's office by the stairs inside or the ones up its north wall, the tank's catwalk by
 * its own.
 *
 * The Briefcase: the attackers come in from the truck at the south wall, the defenders hold the
 * north end; A is the pump house's floor, B the pumpjack in the pipe lane.
 */

// ---------------------------------------------------------------------------------------------
// Layout, in the map's own coordinates (+x east, +z south; the world's z is OZ + z). Players stand
// at FLOOR on the ground; the ground blocks are at G.
//
//   |x|, |z| <= 8       the tower: decks for players at DECK1 (17 x 17), DECK2 (11 x 11) and CROW
//                       (5 x 5), legs to the ground, stairs up its north and south faces to the
//                       first deck (out to |z| = 13), up its west side to the second, its east
//                       side to the top
//   x = -31 .. -14      the pipe lane: tank A (centre (-22, -20), the catwalk round it), tank B
//                       (centre (-22, 21)), the pumpjack between them, low pipes along the wall
//   x = -13 .. -12      the big pipeline, up on supports, from the north pipe rack (z = -17 .. -16,
//                       right across the yard to the east wall) south to tank B
//   x = 19 .. 31        the pump house: z = -9 .. 9, two floors (players at 64 and 69), its
//                       stairs inside along the south wall, outside up the north wall to a landing
//   x = 12 .. 31        z <= -20: the container yard; z >= 20: tank C (centre (24, 24))
//   z = 16, z = 22      the south pipes: one on the ground, one at head height on posts
//   z = 24 .. 26        the tanker truck, broken down by the south wall
//   |x|, |z| = 32       the walls: corrugated iron north and west, concrete south and east, sand
//                       banked up against them outside
// ---------------------------------------------------------------------------------------------

/** Where the map's middle is in the world: as far north of Jackrabbit Lane as Nukeblock is south. */
const OZ = -512;
const FLOOR = 64;
const G = FLOOR - 1;
/** The tower's decks (players stand on them). */
const DECK1 = FLOOR + 5;
const DECK2 = DECK1 + 5;
/** The crow's nest on top of the tower. */
const CROW = DECK2 + 5;
/** The pump house's upper floor, and the catwalk round tank A (players stand here). */
const UP = FLOOR + 5;
/** Air is carved up to here over the play area; the highest block written (the billboard) is under it. */
const SKY = 94;
const TOP = 94;

const WEST = -32;
const EAST = 32;
const NORTH = -32;
const SOUTH = 32;
/**
 * The walls' top blocks: nine high, so that from the highest place anyone stands near them (the
 * catwalk, at UP) the top is still out of reach of a jump and a mantle.
 */
const WALL = FLOOR + 8;

const bp = new Blueprint({ x: WEST - 24, y: 54, z: OZ + NORTH - 24 }, { x: EAST - WEST + 49, y: TOP - 54 + 1, z: SOUTH - NORTH + 49 });
/** The map in its own coordinates: what's built here lands at OZ. */
const L = new Place(bp, 0, OZ);

const box = (c: Canvas, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => c.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);

/** Every column within `r` of (cx, cz) on the map, with its distance and angle (as `Blueprint.columns`). */
function columns(cx: number, cz: number, r: number, fn: (x: number, z: number, d: number, a: number) => void) {
  const n = Math.ceil(r);
  for (let z = cz - n; z <= cz + n; z++)
    for (let x = cx - n; x <= cx + n; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= r) fn(x, z, d, Math.atan2(z - cz, x - cx));
    }
}

// The steel: galvanised legs, orange-painted beams, grey gratings with the rust coming through.
const STEEL: BlockRef = 'iron_block';
const BEAM: BlockRef = 'orange_concrete';
const RUSTY: BlockRef = 'brown_concrete';
const grating = (x: number, z: number): BlockRef => (hash(x, z, 21) < 0.12 ? RUSTY : (x + z) & 1 ? 'gray_concrete' : 'light_gray_concrete');

// ---------------------------------------------------------------------------------------------
// Ground: sand and grit in the yard, concrete under the tower, oil spilt about; sand banked up
// outside the walls.
// ---------------------------------------------------------------------------------------------

const inside = (x: number, z: number) => x > WEST && x < EAST && z > NORTH && z < SOUTH;

/** Puddles of crude: (x, z, radius). */
const OIL: [number, number, number][] = [
  [0, 1, 3.4],
  [-19, 8, 2.2],
  [9, 21, 2.6],
  [17, -23, 1.8],
  [-7, -24, 2],
  [27, 14, 1.6],
  [-27, -5, 1.4],
];
const oily = (x: number, z: number) => OIL.some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r + (hash(x, z, 4) - 0.5) * 1.2);

function ground() {
  const [x0, x1, z0, z1] = [WEST - 24, EAST + 24, NORTH - 24, SOUTH + 24];
  box(L, x0, 54, z0, x1, G - 1, z1, (_x, y) => (y >= G - 3 ? 'sandstone' : 'stone'));
  box(L, x0, FLOOR, z0, x1, SKY, z1, 'air');
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      let b: BlockRef = 'sand';
      const speck = hash(x, z, 5);
      if (!inside(x, z)) {
        // The desert: a bank of sand blown up against the walls, falling away into the plain.
        const out = Math.max(WEST - x, x - EAST, NORTH - z, z - SOUTH);
        const h = Math.floor(8.5 - out * 1.3 + hash(x, z, 6) * 2);
        if (out > 0 && h > 0) box(L, x, FLOOR, z, x, FLOOR + h - 1, z, 'sand');
        else if (out > 0 && speck < 0.03) L.set(x, FLOOR, z, 'dead_bush');
        else if (out > 6 && speck > 0.996) box(L, x, FLOOR, z, x, FLOOR + 1 + Math.floor(hash(x, z, 9) * 2), z, 'cactus');
        b = hash(x, z, 7) * 24 < 24 - out + 4 ? 'sand' : 'grass_block';
      } else if (oily(x, z)) b = 'black_concrete';
      else if (Math.abs(x) <= 9 && Math.abs(z) <= 9) b = (x & 3) === 0 || (z & 3) === 0 ? 'light_gray_concrete' : 'gray_concrete';
      else if (x >= 12 && x <= 18 && z >= -2 && z <= 1) b = 'gravel';
      else b = speck < 0.16 ? 'sandstone' : speck < 0.24 ? 'gravel' : 'sand';
      L.set(x, G, z, b);
    }
  // A few dead bushes in the yard's corners.
  for (const [x, z] of [[-30, -30], [30, 30], [-30, 30], [13, 30], [-14, -30], [30, -12]]) L.set(x, FLOOR, z, 'dead_bush');
}

/**
 * The yard's walls: corrugated iron on the north and west, its ribs rusting from the foot up;
 * precast concrete slabs between posts on the south and east. All nine high and nothing on the
 * inside to climb them by.
 */
function walls() {
  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++) {
      if (inside(x, z)) continue;
      const iron = z === NORTH || x === WEST;
      const along = z === NORTH || z === SOUTH ? x : z;
      box(L, x, FLOOR, z, x, WALL, z, (_x, y) => {
        if (iron) {
          if (y === WALL) return STEEL;
          const rust = hash(along, y, 12) < 0.55 - (y - FLOOR) * 0.08;
          if (rust) return RUSTY;
          return (along & 1) === 0 ? 'light_gray_concrete' : 'gray_concrete';
        }
        if (y === WALL) return 'stone_bricks';
        if (((along % 6) + 6) % 6 === 0) return 'stone_bricks';
        return hash(along, y, 13) < 0.08 ? 'white_concrete' : 'light_gray_concrete';
      });
    }
  // Floodlights on poles along the walls, facing in.
  for (const [x, z] of [[-31, -10], [-31, 10], [-6, -31], [10, -31], [-10, 31], [14, 31], [31, 14], [31, -14]]) {
    box(L, x, FLOOR, z, x, WALL + 2, z, STEEL);
    L.set(x, WALL + 3, z, 'sea_lantern');
  }
}

// ---------------------------------------------------------------------------------------------
// The tower
// ---------------------------------------------------------------------------------------------

/**
 * The drilling tower in the middle of the yard: two decks of steel grating and the crow's nest on
 * legs, each smaller than the one under it, railed round (rails stop bodies, not bullets), the
 * derrick's mast over the top. Every flight of stairs is two wide and climbs one block a step, so bots can take them
 * as easily as anyone: up both ends of the first deck from the ground, then up the west side of
 * the first deck to the second, and up the east side of the second to the crow's nest. Under the
 * first deck the ground is open, round the wellhead in the middle.
 */
function tower() {
  // The first deck's legs, at its corners and the middles of its sides.
  for (const x of [-8, 0, 8]) for (const z of [-8, 0, 8]) if (x || z) box(L, x, FLOOR, z, x, DECK1 - 2, z, STEEL);
  // The decks.
  for (const [h, y] of [[8, DECK1 - 1], [5, DECK2 - 1], [2, CROW - 1]]) box(L, -h, y, -h, h, y, h, (x, _y, z) => (Math.abs(x) === h || Math.abs(z) === h ? BEAM : grating(x, z)));
  // The second deck's legs, from the ground up through the first; its middle legs, on the first;
  // the crow's nest's legs, on the second.
  for (const x of [-5, 5]) for (const z of [-5, 5]) box(L, x, FLOOR, z, x, DECK2 - 2, z, STEEL);
  for (const [x, z] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) box(L, x, DECK1, z, x, DECK2 - 2, z, STEEL);
  for (const x of [-2, 2]) for (const z of [-2, 2]) box(L, x, DECK2, z, x, CROW - 2, z, STEEL);
  // Lights in the gratings, over the wellhead and the first deck.
  for (const [x, z] of [[-3, -3], [3, 3], [-3, 3], [3, -3]]) L.set(x, DECK1 - 1, z, 'sea_lantern');
  L.set(0, DECK2 - 1, 0, 'sea_lantern');

  // Rails round each deck's edge, with gaps where the stairs come up.
  const rails = (h: number, y: number, open: (x: number, z: number) => boolean) =>
    box(L, -h, y, -h, h, y, h, (x, _y, z) => ((Math.abs(x) === h || Math.abs(z) === h) && !open(x, z) ? 'rail' : undefined));
  rails(8, DECK1, (x, z) => (z === 8 && (x === 2 || x === 3)) || (z === -8 && (x === -2 || x === -3)));
  rails(5, DECK2, (x, z) => x === -5 && (z === 0 || z === 1));
  rails(2, CROW, (x, z) => x === 2 && (z === -1 || z === 0));

  // From the ground: up the south face, and (the same turned half round) up the north face.
  for (const side of [L, new Place(L, 0, 0, 2)])
    for (let i = 0; i < 5; i++) box(side, 2, FLOOR, 13 - i, 3, FLOOR + i, 13 - i, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'north') : STEEL));
  // From the first deck to the second, along its west side, climbing south.
  for (let i = 0; i < 5; i++) box(L, -7, DECK1, -3 + i, -6, DECK1 + i, -3 + i, (_x, y) => (y === DECK1 + i ? stairs('stone_brick', 'south') : 'gray_concrete'));
  // From the second to the crow's nest, along its east side, climbing north.
  for (let i = 0; i < 5; i++) box(L, 3, DECK2, 3 - i, 4, DECK2 + i, 3 - i, (_x, y) => (y === DECK2 + i ? stairs('stone_brick', 'north') : 'gray_concrete'));

  // The mast over the crow's nest, its legs drawing in to the crown block, the travelling block
  // hanging out of reach over the middle, a warning lamp on top.
  for (const x of [-2, 2]) for (const z of [-2, 2]) box(L, x, CROW, z, x, CROW + 3, z, STEEL);
  for (const x of [-1, 1]) for (const z of [-1, 1]) box(L, x, CROW + 4, z, x, CROW + 6, z, BEAM);
  box(L, -1, CROW + 7, -1, 1, CROW + 7, 1, STEEL);
  box(L, 0, CROW + 5, 0, 0, CROW + 6, 0, STEEL);
  L.set(0, CROW + 4, 0, 'yellow_concrete');
  L.set(0, CROW + 8, 0, 'neon_red');

  // The wellhead under it all: the valve tree, its handwheels, a pipe out each side along the ground.
  box(L, 0, FLOOR, 0, 0, FLOOR + 1, 0, STEEL);
  L.set(0, FLOOR + 2, 0, 'red_concrete');
  L.set(1, FLOOR + 1, 0, 'red_concrete');
  L.set(-1, FLOOR + 1, 0, 'red_concrete');
  box(L, -11, FLOOR, 0, -1, FLOOR, 0, STEEL);
  box(L, -12, FLOOR, 0, -12, FLOOR + 2, 0, STEEL);
  box(L, 1, FLOOR, 2, 18, FLOOR, 2, 'gray_concrete');
  box(L, 1, FLOOR, 1, 1, FLOOR, 1, 'gray_concrete');
  // Drill pipe stacked by the north stairs, a crate of fittings by the south ones.
  box(L, -7, FLOOR, -11, -5, FLOOR, -10, STEEL);
  box(L, 5, FLOOR, 10, 6, FLOOR, 11, 'oak_planks');
}

// ---------------------------------------------------------------------------------------------
// The tanks and the pipes
// ---------------------------------------------------------------------------------------------

/**
 * A storage tank standing on the ground at (cx, cz): a shell `r` round and `h` tall, painted, with
 * a band and rust running down it, and a shallow cone of a roof. Nobody gets in or on it.
 */
function tank(cx: number, cz: number, r: number, h: number, paint: BlockRef, band: BlockRef) {
  columns(cx, cz, r, (x, z, d, a) => {
    if (d > r - 1.2)
      for (let y = FLOOR; y < FLOOR + h; y++) {
        const streak = hash(Math.round((a + Math.PI) * 6), 0, 14) < 0.35 && hash(x + z, y, 15) < 0.7 - (FLOOR + h - y) * 0.04;
        L.set(x, y, z, y === FLOOR + h - 3 ? band : streak || y === FLOOR ? RUSTY : paint);
      }
    const roof = FLOOR + h + Math.floor((r - d) * 0.4);
    for (let y = FLOOR + h; y <= roof; y++) L.set(x, y, z, y === roof && d < 1 ? STEEL : 'light_gray_concrete');
  });
}

/** Tank A's catwalk: a grating ring round it at UP, railed round its outside, on posts. */
const CAT = { x: -22, z: -20, r: 6 };
/** Where the catwalk's stairs come up (no rails there). */
const catStair = (x: number, z: number) => x >= -20 && x <= -14 && z >= -12 && z <= -11;

function catwalk() {
  const { x: cx, z: cz, r } = CAT;
  columns(cx, cz, r + 3, (x, z, d) => {
    if (d <= r) return;
    L.set(x, UP - 1, z, grating(x, z));
    if (d > r + 2 && !catStair(x, z)) L.set(x, UP, z, 'rail');
  });
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (Math.PI / 4);
    const x = cx + Math.round(Math.cos(a) * (r + 2.4));
    const z = cz + Math.round(Math.sin(a) * (r + 2.4));
    box(L, x, FLOOR, z, x, UP - 2, z, STEEL);
  }
  // The stairs up, along the tank's south side, climbing west to a landing on the ring.
  for (let i = 0; i < 5; i++) box(L, -14 - i, FLOOR, -12, -14 - i, FLOOR + i, -11, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'west') : 'gray_concrete'));
  box(L, -20, UP - 1, -12, -19, UP - 1, -11, grating(0, 0));
  box(L, -20, FLOOR, -11, -20, UP - 2, -11, STEEL);
}

/** A pipe's colour along its length: iron, banded orange every few blocks, rusting. */
const pipe = (along: number, k = 0): BlockRef => (((along % 7) + 7) % 7 === 0 ? BEAM : hash(along, k, 16) < 0.15 ? RUSTY : STEEL);

/**
 * The pipelines. The big one is two blocks square and up on supports (three blocks of room under
 * it): from tank A it crosses the whole yard north of the tower to the east wall, and branches
 * south down the pipe lane to tank B. In the south half one runs along the ground (hop it) and
 * one at head height on posts (walk under it); the pipe lane has two low ones along the wall and
 * one at head height across it.
 */
function pipes() {
  // The big pipeline: across the north, then down the lane, then into tank B.
  box(L, -17, FLOOR + 3, -17, EAST - 1, FLOOR + 4, -16, (x) => pipe(x));
  box(L, -13, FLOOR + 3, -17, -12, FLOOR + 4, 19, (_x, _y, z) => pipe(z, 1));
  box(L, -19, FLOOR + 3, 18, -12, FLOOR + 4, 19, (x) => pipe(x, 2));
  // Its supports: two posts and a crossbar under it.
  for (const x of [-8, 0, 8, 16, 24]) {
    for (const z of [-18, -15]) box(L, x, FLOOR, z, x, FLOOR + 2, z, BEAM);
    box(L, x, FLOOR + 2, -17, x, FLOOR + 2, -16, BEAM);
  }
  for (const z of [-10, -2, 6, 14]) {
    for (const x of [-14, -11]) box(L, x, FLOOR, z, x, FLOOR + 2, z, BEAM);
    box(L, -13, FLOOR + 2, z, -12, FLOOR + 2, z, BEAM);
  }
  for (const z of [17, 20]) box(L, -16, FLOOR, z, -16, FLOOR + 2, z, BEAM);
  box(L, -16, FLOOR + 2, 18, -16, FLOOR + 2, 19, BEAM);
  // A valve on the pipeline where it turns, with its wheel.
  box(L, -13, FLOOR + 5, -17, -12, FLOOR + 5, -16, 'red_concrete');

  // The south pipes: along the ground from the big pipeline's foot to tank C; at head height on
  // posts from tank B to tank C.
  box(L, -12, FLOOR, 16, 24, FLOOR, 16, (x) => pipe(x, 3));
  box(L, -12, FLOOR + 1, 16, -12, FLOOR + 2, 16, STEEL);
  box(L, 24, FLOOR, 17, 24, FLOOR, 20, (_x, _y, z) => pipe(z, 4));
  box(L, -18, FLOOR + 2, 22, 21, FLOOR + 2, 22, (x) => pipe(x, 5));
  for (const x of [-12, -5, 2, 9, 16]) box(L, x, FLOOR, 22, x, FLOOR + 1, 22, BEAM);
  for (const x of [-4, 8]) L.set(x, FLOOR + 1, 16, 'red_concrete');

  // The pipe lane: two low pipes along the west wall between the tanks, a gap in each to step
  // through; one at head height across the lane on posts.
  for (const x of [-28, -26]) box(L, x, FLOOR, -11, x, FLOOR, 15, (_x, _y, z) => (z === 4 || z === 5 ? undefined : pipe(z, x)));
  box(L, WEST + 1, FLOOR + 2, 9, -14, FLOOR + 2, 9, (x) => pipe(x, 6));
  for (const x of [-30, -22]) box(L, x, FLOOR, 9, x, FLOOR + 1, 9, BEAM);
}

/**
 * A pumpjack standing on y, its head toward -x (the well under it): the base, the A-frame in the
 * middle, the walking beam over it, the horse head, and the crank and counterweights at the back.
 */
function pumpjack(c: Canvas, y: number) {
  box(c, 0, y, -1, 8, y, 1, 'gray_concrete');
  // The well: the wellhead, the polished rod up to the horse head.
  c.set(-1, y, 0, STEEL);
  box(c, -1, y + 1, 0, -1, y + 2, 0, 'iron_block');
  // The A-frame and the walking beam.
  for (const z of [-1, 1]) box(c, 3, y + 1, z, 3, y + 3, z, BEAM);
  c.set(3, y + 3, 0, STEEL);
  box(c, 0, y + 4, 0, 7, y + 4, 0, BEAM);
  box(c, -1, y + 3, 0, -1, y + 5, 0, 'gray_concrete');
  c.set(0, y + 5, 0, 'gray_concrete');
  // The crank, the counterweights and the motor.
  c.set(6, y + 1, 0, 'gray_concrete');
  for (const z of [-1, 1]) box(c, 6, y + 1, z, 7, y + 2, z, 'red_concrete');
  box(c, 7, y + 2, 0, 7, y + 3, 0, STEEL);
  c.set(8, y + 1, 0, 'blue_concrete');
}

// ---------------------------------------------------------------------------------------------
// The pump house
// ---------------------------------------------------------------------------------------------

const BX0 = 19; // the west wall, toward the tower
const BX1 = 31; // the east wall, against the yard's
const BZ0 = -9;
const BZ1 = 9;

/**
 * The pump house on the east side: corrugated tin in faded teal, two storeys, the pump and the
 * workshop downstairs, the office upstairs. Doors west (toward the tower), north (under the
 * landing) and south; windows on both floors toward the tower. Stairs inside along the south wall,
 * and outside up the north wall to the office's back door. The roof is out of reach.
 */
function pumpHouse() {
  box(L, BX0, G, BZ0, BX1, G, BZ1, (x, _y, z) => (hash(x, z, 17) < 0.1 ? 'gray_concrete' : 'light_gray_concrete'));
  box(L, BX0, FLOOR, BZ0, BX1, UP + 3, BZ1, (x, y, z) => {
    const ex = x === BX0 || x === BX1;
    const ez = z === BZ0 || z === BZ1;
    if (!ex && !ez) return y === UP - 1 ? 'spruce_planks' : 'air';
    if ((ex && ez) || y === UP - 1) return 'gray_concrete';
    if (y === FLOOR && hash(x, z, 18) < 0.4) return RUSTY;
    return ((ex ? z : x) & 1) === 0 ? 'cyan_concrete' : 'light_blue_concrete';
  });
  // The roof, its eaves over the doors.
  box(L, BX0 - 1, UP + 4, BZ0 - 1, BX1, UP + 4, BZ1 + 1, (x, _y, z) => (hash(x, z, 19) < 0.15 ? RUSTY : 'light_gray_concrete'));
  for (const [x, z] of [[23, -4], [27, 4]]) L.set(x, UP + 4, z, 'sea_lantern');

  // Doors and windows (windows have a sill a block up: shoot or vault through them).
  const hole = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => box(L, x0, y0, z0, x1, y1, z1, 'air');
  hole(BX0, FLOOR, -1, BX0, FLOOR + 2, 0);
  hole(BX0, FLOOR + 1, -7, BX0, FLOOR + 2, -4);
  hole(BX0, FLOOR + 1, 3, BX0, FLOOR + 2, 5);
  hole(BX0, UP + 1, -7, BX0, UP + 2, -3);
  hole(BX0, UP + 1, 1, BX0, UP + 2, 5);
  hole(26, FLOOR, BZ0, 27, FLOOR + 2, BZ0);
  hole(29, FLOOR + 1, BZ0, 30, FLOOR + 2, BZ0);
  hole(26, UP, BZ0, 27, UP + 2, BZ0);
  hole(28, FLOOR, BZ1, 29, FLOOR + 2, BZ1);
  hole(22, FLOOR + 1, BZ1, 24, FLOOR + 2, BZ1);
  hole(27, UP + 1, BZ1, 29, UP + 2, BZ1);

  // ----- Downstairs: the pump on its plinth, the workbench, lockers, drums.
  box(L, 25, FLOOR, -6, 27, FLOOR, -4, STEEL);
  box(L, 25, FLOOR + 1, -6, 27, FLOOR + 1, -4, BEAM);
  box(L, 28, FLOOR, -5, 28, FLOOR + 1, -5, 'gray_concrete');
  box(L, 26, FLOOR, -3, 26, FLOOR, 1, 'gray_concrete');
  box(L, 30, FLOOR, -2, 30, FLOOR, 2, 'spruce_planks');
  L.set(30, FLOOR + 1, -1, STEEL);
  box(L, 30, FLOOR, 4, 30, FLOOR + 1, 6, 'gray_concrete');
  for (const [x, z, b] of [[20, -8, 'blue_concrete'], [21, -8, 'black_concrete'], [20, -7, 'red_concrete']] as const) L.set(x, FLOOR, z, b);
  for (const [x, z] of [[23, -4], [27, 2], [22, 4]]) L.set(x, UP - 1, z, 'sea_lantern');
  // The stairs up, climbing east along the south wall, the railing round the stairwell upstairs.
  for (let i = 0; i < 5; i++) {
    const x = 21 + i;
    box(L, x, FLOOR, 7, x, FLOOR + i, 8, (_x, y) => (y === FLOOR + i ? stairs('spruce', 'east') : 'gray_concrete'));
    box(L, x, FLOOR + i + 1, 7, x, FLOOR + i + 4, 8, 'air');
  }
  box(L, 21, UP, 6, 24, UP, 6, 'rail');
  box(L, 20, UP, 7, 20, UP, 8, 'rail');

  // ----- Upstairs: the office. A desk and its chair by the window, filing cabinets, the control
  // panel's lamps along the back wall, a map table.
  box(L, 22, UP, -6, 23, UP, -6, slab('spruce', true));
  L.set(24, UP, -6, stairs('spruce', 'west'));
  box(L, 30, UP, -8, 30, UP + 1, -7, STEEL);
  box(L, 30, UP, -4, 30, UP, 0, 'black_concrete');
  for (const [z, b] of [[-4, 'neon_red'], [-2, 'neon_cyan'], [0, 'neon_yellow']] as const) L.set(30, UP + 1, z, b);
  box(L, 25, UP, 2, 26, UP, 3, slab('birch', true));
  for (const [x, z] of [[24, -3], [27, 3]]) L.set(x, UP + 3, z, 'sea_lantern');

  // ----- Outside: stairs up the north wall, climbing east to the landing by the office's back door.
  for (let i = 0; i < 5; i++) box(L, 20 + i, FLOOR, -11, 20 + i, FLOOR + i, -10, (_x, y) => (y === FLOOR + i ? stairs('stone_brick', 'east') : 'gray_concrete'));
  box(L, 25, UP - 1, -12, 28, UP - 1, -10, (x, _y, z) => grating(x, z));
  for (const x of [25, 28]) box(L, x, FLOOR, -12, x, UP - 2, -12, STEEL);
  box(L, 25, UP, -12, 28, UP, -12, 'rail');
  box(L, 28, UP, -11, 28, UP, -10, 'rail');

  // The billboard on the roof, facing the tower: DUNE over OIL.
  const bx = 27;
  const y0 = UP + 5;
  for (const z of [-8, 8]) box(L, bx + 1, y0, z, bx + 1, y0 + 12, z, STEEL);
  box(L, bx, y0, -9, bx, y0 + 12, 9, (_x, y, z) => (z === -9 || z === 9 || y === y0 || y === y0 + 12 ? BEAM : 'white_concrete'));
  ([['DUNE', y0 + 6], ['OIL', y0 + 1]] as const).forEach(([word, base]) => {
    const rows = layout(word, FONT);
    const left = -Math.floor(rows[0].length / 2);
    // Looking east at it, the viewer's left is north (-z).
    kit.sprite(L, rows, { X: 'black_concrete' }, (u, v) => ({ x: bx - 1, y: base + v, z: left + u }));
  });
}

// ---------------------------------------------------------------------------------------------
// Containers, the truck, and the clutter
// ---------------------------------------------------------------------------------------------

/**
 * A shipping container standing on y, along x from 0 to 8 and z from 0 to 3: ribbed sides, room
 * inside to stand. `open` swings its doors open at the +x end (1) or both ends (2), the doors
 * standing out like wings.
 */
function container(c: Canvas, y: number, paint: BlockRef, rib: BlockRef, open: 0 | 1 | 2) {
  box(c, 0, y, 0, 8, y + 3, 3, (x, yy, z) => {
    const side = z === 0 || z === 3;
    const end = x === 0 || x === 8;
    if (yy === y + 3) return paint;
    if (!side && !end) return 'air';
    if (end && !side) return (z & 1) === 0 ? paint : rib;
    return (x & 1) === 0 ? paint : rib;
  });
  for (const [x, wing] of [[8, 9], [0, -1]] as const) {
    if (open < (x === 8 ? 1 : 2)) continue;
    box(c, x, y, 1, x, y + 2, 2, 'air');
    for (const z of [0, 3]) box(c, wing, y, z, wing, y + 2, z, rib);
  }
}

/** An oil drum (or a stack of two) on the ground. */
function drums(spots: [number, number, BlockRef, number?][]) {
  for (const [x, z, b, h = 1] of spots) box(L, x, FLOOR, z, x, FLOOR + h - 1, z, b);
}

/** A sandbag wall along a line: bags a block and a half high (cover crouched, a vault standing). */
function sandbags(x0: number, z0: number, x1: number, z1: number) {
  box(L, x0, FLOOR, z0, x1, FLOOR, z1, 'sandstone');
  box(L, x0, FLOOR + 1, z0, x1, FLOOR + 1, z1, slab('sandstone'));
}

/**
 * A tanker truck standing on y, nose toward -x, broken down: a rusted red cab with its door hanging
 * open, a front wheel gone (the axle on a block), and a long rust-orange tank behind it.
 */
function tanker(c: Canvas, y: number) {
  // The cab: the hood, the cab itself (windscreen, roof), the bumper.
  box(c, 0, y, 0, 1, y + 1, 2, (x, yy, z) => (yy === y && (z === 0 || z === 2) && x === 1 ? 'black_concrete' : hash(x, z + yy, 20) < 0.3 ? RUSTY : 'red_concrete'));
  box(c, 2, y, 0, 3, y + 3, 2, (x, yy, z) => {
    if (yy === y + 3) return 'red_concrete';
    if (yy === y + 2) return x === 2 ? 'glass' : z === 1 ? 'air' : 'glass';
    if (yy === y + 1 && z === 1) return x === 3 ? stairs('spruce', 'west') : 'air';
    return 'red_concrete';
  });
  c.set(-1, y, 1, STEEL);
  c.set(1, y, 0, 'gray_concrete'); // the missing wheel's axle, up on a block
  box(c, 2, y + 1, 2, 2, y + 2, 2, 'air'); // the door, hanging open
  c.set(2, y + 1, 3, 'red_concrete');
  // The chassis, the wheels, and the tank (round in section: its corners left off) on its saddles.
  box(c, 4, y, 1, 12, y, 1, STEEL);
  for (const x of [5, 6, 10, 11]) for (const z of [0, 2]) c.set(x, y, z, 'black_concrete');
  box(c, 4, y + 1, 0, 12, y + 3, 2, (x, yy, z) => ((z === 0 || z === 2) && yy !== y + 2 ? undefined : x === 4 || x === 12 ? STEEL : hash(x, yy + z, 22) < 0.3 ? RUSTY : BEAM));
  box(c, 4, y + 1, 0, 12, y + 1, 2, (x, _yy, z) => (z === 1 ? undefined : x % 4 === 0 ? STEEL : undefined));
}

function clutter() {
  // The container yard: one against the north wall with another stacked on it, an open one
  // (both ends) south of them, an open one in the corner end-on to the yard.
  container(new Place(L, 13, -31), FLOOR, 'red_concrete', RUSTY, 0);
  container(new Place(L, 14, -31), FLOOR + 4, 'blue_concrete', 'light_blue_concrete', 0);
  container(new Place(L, 13, -24), FLOOR, 'green_concrete', 'lime_concrete', 2);
  container(new Place(L, 30, -31, 1), FLOOR, 'orange_concrete', RUSTY, 1);
  // Inside the open ones: a crate to hide behind.
  L.set(17, FLOOR, -22, 'oak_planks');
  L.set(28, FLOOR, -27, 'oak_planks');

  // The truck by the south wall, nose west.
  tanker(new Place(L, -4, 24), FLOOR);

  // Sandbags: a line between the tower and the pipe lane, one by the pump house door, one across
  // the north, a bend by tank C, one by tank A.
  sandbags(-10, -7, -10, -4);
  sandbags(15, -5, 15, -2);
  sandbags(2, -24, 6, -24);
  sandbags(16, 12, 16, 15);
  sandbags(17, 12, 19, 12);
  sandbags(-24, -8, -21, -8);

  // Oil drums about the yard.
  drums([
    [-30, -12, 'blue_concrete'], [-30, -13, 'black_concrete', 2], [-29, -13, 'red_concrete'],
    [9, -10, 'blue_concrete'], [10, -10, 'blue_concrete'], [10, -11, 'black_concrete'],
    [-9, 11, 'red_concrete'], [-9, 12, 'black_concrete'],
    [13, 8, 'black_concrete'], [14, 8, 'green_concrete'],
    [29, 18, 'blue_concrete'], [30, 18, 'black_concrete', 2], [30, 19, 'red_concrete'],
    [-15, 28, 'black_concrete'], [-16, 29, 'blue_concrete'],
    [25, -17, 'red_concrete'], [-20, -29, 'green_concrete'], [-21, -29, 'black_concrete'],
    [10, 27, 'blue_concrete'], [11, 28, 'red_concrete'],
  ]);

  // A generator by tank C, and the pumpjack in the pipe lane (head north, over its well).
  box(L, 14, FLOOR, 18, 15, FLOOR, 19, 'yellow_concrete');
  L.set(14, FLOOR + 1, 18, 'gray_concrete');
  pumpjack(new Place(L, -20, -4, 1), FLOOR);
}

// ---------------------------------------------------------------------------------------------
// Past the walls
// ---------------------------------------------------------------------------------------------

/** An old derrick out on the flats to the north-west: a tall steel lattice, a lamp on its crown. */
function farDerrick(): Blueprint {
  const [cx, cz, base] = [-88, OZ - 74, 58];
  const top = FLOOR + 32;
  const d = new Blueprint({ x: cx - 5, y: base, z: cz - 5 }, { x: 11, y: top + 2 - base + 1, z: 11 });
  for (let y = base; y < top; y++) {
    const r = Math.max(1, Math.round(4 - ((y - FLOOR) / (top - FLOOR)) * 3));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.set(cx + sx * r, y, cz + sz * r, 'orange_concrete');
    if (y > FLOOR && (y - FLOOR) % 6 === 0)
      d.fill({ x: cx - r, y, z: cz - r }, { x: cx + r, y, z: cz + r }, (x, _y, z) => (Math.abs(x - cx) === r || Math.abs(z - cz) === r ? 'orange_concrete' : undefined));
  }
  d.fill({ x: cx - 1, y: top, z: cz - 1 }, { x: cx + 1, y: top, z: cz + 1 }, 'iron_block');
  d.set(cx, top + 1, cz, 'iron_block');
  d.set(cx, top + 2, cz, 'neon_red');
  return d;
}

function build(): Blueprint {
  ground();
  walls();
  pipes();
  tank(CAT.x, CAT.z, CAT.r, 11, 'orange_concrete', 'white_concrete');
  tank(-22, 21, 5, 9, 'brown_concrete', 'orange_concrete');
  tank(24, 24, 4, 8, 'white_concrete', 'red_concrete');
  catwalk();
  tower();
  pumpHouse();
  clutter();
  return bp;
}

// ---------------------------------------------------------------------------------------------

/** A spawn standing in the map's block (x, z) on the floor at y, facing (tx, tz). */
const spawn = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => spawnAt(x, y, OZ + z, tx, OZ + tz);
const spot = (x: number, y: number, z: number): Vec3 => ({ x: x + 0.5, y, z: OZ + z + 0.5 });

export const RUST: MapSpec = {
  id: 'rust',
  name: 'Rust',
  blurb: 'An oil yard in the desert, a tower in the middle',
  floorY: FLOOR,
  structures: [build(), farDerrick()],
  // The yard is level with the plain; mesas stand round the desert in the haze.
  terraform: [
    { x: 0, z: OZ, radius: 60, blend: 20, height: G + 0.5 },
    { x: 20, z: OZ - 135, radius: 30, blend: 24, height: 93.5 },
    { x: 130, z: OZ + 20, radius: 26, blend: 24, height: 89.5 },
    { x: -130, z: OZ + 40, radius: 24, blend: 22, height: 87.5 },
    { x: 55, z: OZ + 125, radius: 20, blend: 22, height: 84.5 },
    { x: -70, z: OZ + 120, radius: 18, blend: 20, height: 82.5 },
  ],
  bounds: { min: { x: WEST, y: FLOOR - 2, z: OZ + NORTH }, max: { x: EAST, y: SKY, z: OZ + SOUTH } },
  spawns: [
    // The pipe lane and the tank's catwalk.
    spawn(-30, FLOOR, -4, 0, 0),
    spawn(-20, FLOOR, -8, 0, 0),
    spawn(-29, FLOOR, 13, 0, 0),
    spawn(-22, UP, -13, 0, 0),
    // Along the north wall and in the container yard.
    spawn(-12, FLOOR, -29, 0, 0),
    spawn(0, FLOOR, -28, 0, 0),
    spawn(8, FLOOR, -27, 0, 0),
    spawn(18, FLOOR, -26, 0, 0),
    spawn(27, FLOOR, -19, 0, 0),
    // The pump house, both floors, and outside its door.
    spawn(24, FLOOR, -1, 0, 0),
    spawn(28, UP, 2, 0, 0),
    spawn(14, FLOOR, 4, 0, 0),
    // Round tank C and along the south wall.
    spawn(16, FLOOR, 27, 0, 0),
    spawn(30, FLOOR, 13, 0, 0),
    spawn(8, FLOOR, 29, 0, 0),
    spawn(-12, FLOOR, 29, 0, 0),
    spawn(-29, FLOOR, 29, 0, 0),
  ],
  // Team Deathmatch: one side along the south wall west of the truck, the other along the north
  // wall by the containers.
  teams: [
    [spawn(-12, FLOOR, 29, 0, 0), spawn(-9, FLOOR, 29, 0, 0), spawn(-15, FLOOR, 30, 0, 0), spawn(-12, FLOOR, 27, 0, 0), spawn(-9, FLOOR, 27, 0, 0), spawn(-17, FLOOR, 27, 0, 0)],
    [spawn(4, FLOOR, -29, 0, 0), spawn(7, FLOOR, -29, 0, 0), spawn(10, FLOOR, -29, 0, 0), spawn(4, FLOOR, -27, 0, 0), spawn(7, FLOOR, -27, 0, 0), spawn(10, FLOOR, -27, 0, 0)],
  ],
  // The Briefcase: in from the truck at the south wall, against the north end; A on the pump
  // house's floor, B by the pumpjack in the pipe lane.
  bomb: {
    attack: [spawn(-2, FLOOR, 29, 0, 0), spawn(2, FLOOR, 29, 0, 0), spawn(6, FLOOR, 29, 0, 0), spawn(14, FLOOR, 29, 0, 0), spawn(-6, FLOOR, 30, 0, 0), spawn(-9, FLOOR, 29, 0, 0)],
    defend: [spawn(-4, FLOOR, -29, 0, 0), spawn(0, FLOOR, -29, 0, 0), spawn(4, FLOOR, -29, 0, 0), spawn(8, FLOOR, -28, 0, 0), spawn(-8, FLOOR, -28, 0, 0), spawn(11, FLOOR, -27, 0, 0)],
    sites: [
      { name: 'A', label: 'the pump house', at: spot(23, FLOOR, 2), radius: 3 },
      { name: 'B', label: 'the pumpjack', at: spot(-23, FLOOR, 0), radius: 3 },
    ],
  },
  // From the south-east, past the pump house's corner, up at the tower.
  home: { x: 12.5, y: FLOOR + 0.05, z: OZ + 14.5, yaw: yawTo(12, 14, 0, 0) },
  overview: { position: { x: -46, y: FLOOR + 42, z: OZ + 52 }, target: { x: 0, y: FLOOR + 6, z: OZ } },
  hotspots: [
    spot(0, CROW, 0),
    spot(-2, DECK2, -3),
    spot(6, DECK1, 6),
    spot(-6, DECK1, -6),
    spot(3, FLOOR, -4),
    spot(-23, FLOOR, 0),
    spot(23, FLOOR, 2),
    spot(26, UP, -3),
    spot(-22, UP, -13),
    spot(-20, FLOOR, 8),
    spot(18, FLOOR, -26),
    spot(-1, FLOOR, 19),
    spot(17, FLOOR, 19),
  ],
};
