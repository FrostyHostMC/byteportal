import { Blueprint, type BlockRef, type Vec3 } from '@platform';

/**
 * Dry Gulch: one dusty street in the desert. North side, west to east: the general store, the
 * Silver Spur saloon (two floors, a balcony over the boardwalk) and the bank (a flat roof, stairs
 * up the side). South side: the sheriff's office and jail, the livery stable (a hayloft under a
 * pitched roof), the water tower and a corral. Wagons, barrels, troughs and hay on the street;
 * mesa rock piled at both ends. Built in the town's own coordinates (x east, z south, the street
 * along x) and moved onto a desert this seed puts at (80, 48).
 *
 * Contract: `MAP.floorY` (players stand here on the street), `MAP.bounds` (the playable box, for
 * the bots' walking grid), `MAP.spawns`, `MAP.hotspots`, and `structures` / `terraform` / `seed`
 * / `time` for the game's `world`.
 */
export interface SpawnPoint extends Vec3 {
  yaw: number;
}

/** Where the desert is (seed 72: sand dunes for 90 blocks round here). */
const OX = 80;
const OZ = 48;
const SEED = 72;
const FLOOR = 72;
const G = FLOOR - 1;
const SKY = 96;
/** The town's extent (local). */
const W = -40;
const E = 40;
const N = -27;
const S = 27;

type Fill = BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined);
const bp = new Blueprint({ x: W - 2, y: G - 3, z: N - 2 }, { x: E - W + 5, y: SKY - G + 4, z: S - N + 5 });
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => bp.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);
const set = (x: number, y: number, z: number, b: BlockRef) => bp.set(x, y, z, b);
const rnd = (x: number, z: number, s = 0) => {
  let v = Math.imul((x * 73856093) ^ (z * 19349663) ^ (s * 83492791), 2654435761);
  v ^= v >>> 15;
  return ((v >>> 0) % 10000) / 10000;
};

/** Hollow walls round a box (inclusive), optionally with a floor block under it. */
function walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, b: Fill) {
  fill(x0, y0, z0, x1, y1, z0, b);
  fill(x0, y0, z1, x1, y1, z1, b);
  fill(x0, y0, z0, x0, y1, z1, b);
  fill(x1, y0, z0, x1, y1, z1, b);
}
const air = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => fill(x0, y0, z0, x1, y1, z1, 'air');
/** A saguaro: a trunk and an arm or two. */
function saguaro(x: number, z: number, tall: number, arms: number) {
  fill(x, FLOOR, z, x, FLOOR + tall - 1, z, 'saguaro');
  if (arms > 0) {
    set(x + 1, FLOOR + 2, z, 'saguaro');
    fill(x + 2, FLOOR + 2, z, x + 2, FLOOR + 4, z, 'saguaro');
  }
  if (arms > 1) {
    set(x - 1, FLOOR + 3, z, 'saguaro');
    fill(x - 2, FLOOR + 3, z, x - 2, FLOOR + 4, z, 'saguaro');
  }
}
/** A barrel or crate stack. */
const stack = (x: number, z: number, b: BlockRef, n = 1) => fill(x, FLOOR, z, x, FLOOR + n - 1, z, b);
/** A window of glass framed by the wall (w wide, 2 high). */
const windowX = (x0: number, x1: number, y: number, z: number) => fill(x0, y, z, x1, y + 1, z, 'glass');
const windowZ = (x: number, y: number, z0: number, z1: number) => fill(x, y, z0, x, y + 1, z1, 'glass');

// ---------------------------------------------------------------------------------------------

function ground() {
  // Clear the air over the town and lay the ground: packed dust on the street, sand elsewhere.
  air(W, FLOOR, N, E, SKY, S);
  fill(W, G - 2, N, E, G - 1, S, 'sandstone');
  fill(W, G, N, E, G, S, (x, _y, z) => (Math.abs(z) <= 6 && Math.abs(x) <= 36 ? 'dust' : rnd(x, z) < 0.12 ? 'dust' : 'sand'));
  // Boardwalks along both fronts (a half step up).
  fill(-30, FLOOR, -8, 22, FLOOR, -6, 'boardwalk');
  fill(-28, FLOOR, 6, 12, FLOOR, 8, 'boardwalk');
}

/** North side, west: the general store (weathered boards, a false front with its name). */
function store() {
  const [x0, x1, z0, z1] = [-28, -18, -19, -9];
  fill(x0, G, z0, x1, G, z1, 'floorboards');
  walls(x0, z0, x1, z1, FLOOR, FLOOR + 4, 'weathered_planks');
  fill(x0, FLOOR + 5, z0, x1, FLOOR + 5, z1, 'shingle_slab');
  // The false front, up past the roof, with the sign.
  fill(x0, FLOOR + 5, z1, x1, FLOOR + 8, z1, 'weathered_planks');
  set(-24, FLOOR + 6, z1, 'sign_st');
  set(-23, FLOOR + 6, z1, 'sign_or');
  set(-22, FLOOR + 6, z1, 'sign_e');
  air(-23, FLOOR, z1, -22, FLOOR + 2, z1);
  windowX(-27, -25, FLOOR + 1, z1);
  windowX(-20, -19, FLOOR + 1, z1);
  windowZ(x0, FLOOR + 1, -16, -13);
  // A back door to the alley.
  air(-20, FLOOR, z0, -20, FLOOR + 2, z0);
  // Counter and goods.
  fill(-27, FLOOR, -14, -24, FLOOR, -14, 'floorboards');
  stack(-27, -18, 'crate', 2);
  stack(-26, -18, 'crate');
  stack(-19, -18, 'barrel', 2);
  stack(-19, -17, 'barrel');
  set(-24, FLOOR + 3, -18, 'lantern');
}

/** North side, middle: the Silver Spur saloon. */
function saloon() {
  const [x0, x1, z0, z1] = [-12, 6, -21, -9];
  const UP = FLOOR + 5;
  fill(x0, G, z0, x1, G, z1, 'floorboards');
  walls(x0, z0, x1, z1, FLOOR, FLOOR + 9, 'weathered_planks');
  // The upper floor, with a well for the stairs, and the roof.
  fill(x0 + 1, UP - 1, z0 + 1, x1 - 1, UP - 1, z1 - 1, 'floorboards');
  air(x0 + 1, UP - 1, -14, x0 + 2, UP - 1, -12);
  fill(x0, FLOOR + 10, z0, x1, FLOOR + 10, z1, 'shingle_slab');
  // False front with the name, and a lantern either side.
  fill(x0, FLOOR + 10, z1, x1, FLOOR + 13, z1, 'weathered_planks');
  set(-4, FLOOR + 11, z1, 'sign_sa');
  set(-3, FLOOR + 11, z1, 'sign_lo');
  set(-2, FLOOR + 11, z1, 'sign_on');
  // Batwing doors (an opening), street windows down and up, a door onto the balcony.
  air(-4, FLOOR, z1, -2, FLOOR + 2, z1);
  windowX(-10, -7, FLOOR + 1, z1);
  windowX(1, 4, FLOOR + 1, z1);
  windowX(-10, -8, UP + 1, z1);
  windowX(2, 4, UP + 1, z1);
  air(-4, UP, z1, -3, UP + 2, z1);
  windowZ(x1, FLOOR + 1, -18, -12);
  windowZ(x0, UP + 1, -19, -17);
  // Side door to the alley between the saloon and the bank.
  air(x1, FLOOR, -15, x1, FLOOR + 2, -15);
  // The balcony over the boardwalk on posts, a half-height rail.
  fill(x0, UP - 1, -8, x1, UP - 1, -6, 'floorboards');
  fill(x0, UP, -6, x1, UP, -6, 'boardwalk');
  fill(x0, UP, -8, x0, UP, -6, 'boardwalk');
  fill(x1, UP, -8, x1, UP, -6, 'boardwalk');
  for (const x of [x0, -3, x1]) fill(x, FLOOR, -6, x, UP - 2, -6, 'spruce_log');
  // Stairs up the west wall, climbing north.
  for (let k = 0; k < 5; k++) {
    fill(x0 + 1, FLOOR + k, -11 - k, x0 + 2, FLOOR + k, -11 - k, 'spruce_stairs[facing=north]');
    if (k > 0) fill(x0 + 1, FLOOR, -11 - k, x0 + 2, FLOOR + k - 1, -11 - k, 'floorboards');
  }
  fill(x0 + 3, UP, -14, x0 + 3, UP, -11, 'boardwalk');
  // The bar along the back, a mirror of bottles (bookshelf), tables and a piano.
  fill(-8, FLOOR, -18, 3, FLOOR, -18, 'floorboards');
  fill(-8, FLOOR, -18, -8, FLOOR, -16, 'floorboards');
  fill(-8, FLOOR + 1, -18, 3, FLOOR + 1, -18, 'boardwalk');
  fill(-7, FLOOR + 1, z0 + 1, 2, FLOOR + 2, z0 + 1, 'bookshelf');
  for (const [x, z] of [
    [-6, -13],
    [-1, -13],
    [2, -12],
  ]) {
    set(x, FLOOR, z, 'barrel');
    set(x, FLOOR + 1, z, 'spruce_slab');
  }
  fill(4, FLOOR, -19, 5, FLOOR + 1, -19, 'floorboards');
  set(-4, FLOOR + 3, -14, 'lantern');
  set(1, FLOOR + 3, -14, 'lantern');
  // Upstairs: two rooms off a hall (a bed and a chair in each: crates), cover by the windows.
  fill(-3, UP, -20, -3, UP + 3, -13, 'weathered_planks');
  air(-3, UP, -15, -3, UP + 2, -14);
  stack(-6, -19, 'crate');
  stack(3, -19, 'crate');
  set(-9, UP, -19, 'barrel');
  set(-1, UP + 3, -12, 'lantern');
}

/** North side, east: the bank, adobe with a flat roof and a parapet; stairs up its east side. */
function bank() {
  const [x0, x1, z0, z1] = [10, 20, -19, -9];
  fill(x0, G, z0, x1, G, z1, 'floorboards');
  walls(x0, z0, x1, z1, FLOOR, FLOOR + 4, 'adobe');
  fill(x0, FLOOR + 3, z1, x1, FLOOR + 3, z1, 'adobe_trim');
  fill(x0, FLOOR + 5, z0, x1, FLOOR + 5, z1, 'adobe');
  walls(x0, z0, x1, z1, FLOOR + 6, FLOOR + 6, 'adobe_trim');
  // Gaps in the parapet to shoot through.
  for (const x of [12, 15, 18]) set(x, FLOOR + 6, z1, 'air');
  set(14, FLOOR + 4, z1, 'sign_ba');
  set(15, FLOOR + 4, z1, 'sign_nk');
  air(14, FLOOR, z1, 15, FLOOR + 2, z1);
  fill(11, FLOOR + 1, z1, 12, FLOOR + 1, z1, 'iron_bars');
  fill(17, FLOOR + 1, z1, 18, FLOOR + 1, z1, 'iron_bars');
  // The counter with bars, and the vault at the back.
  fill(x0 + 1, FLOOR, -14, x1 - 1, FLOOR, -14, 'floorboards');
  fill(x0 + 1, FLOOR + 1, -14, x1 - 1, FLOOR + 1, -14, 'iron_bars');
  air(13, FLOOR, -14, 13, FLOOR + 1, -14);
  fill(16, FLOOR, -18, 19, FLOOR + 3, -17, 'iron_block');
  set(12, FLOOR + 3, -12, 'lantern');
  // Outside stairs up the east wall to the roof (climbing north), and a hole in the parapet.
  for (let k = 0; k < 6; k++) {
    set(x1 + 1, FLOOR + k, -10 - k, 'spruce_stairs[facing=north]');
    if (k > 0) fill(x1 + 1, FLOOR, -10 - k, x1 + 1, FLOOR + k - 1, -10 - k, 'adobe');
  }
  set(x1 + 1, FLOOR + 5, -16, 'adobe');
  set(x1, FLOOR + 6, -16, 'air');
  set(x1, FLOOR + 6, -15, 'air');
}

/** South side, west: the sheriff's office and the jail, adobe, posters by the door. */
function jail() {
  const [x0, x1, z0, z1] = [-27, -15, 9, 19];
  fill(x0, G, z0, x1, G, z1, 'floorboards');
  walls(x0, z0, x1, z1, FLOOR, FLOOR + 4, 'adobe');
  fill(x0, FLOOR + 5, z0, x1, FLOOR + 5, z1, 'adobe');
  walls(x0, z0, x1, z1, FLOOR + 6, FLOOR + 6, 'adobe_trim');
  // Read from the street (looking south), east is on the left.
  set(-21, FLOOR + 4, z0, 'sign_ja');
  set(-22, FLOOR + 4, z0, 'sign_il');
  air(-22, FLOOR, z0, -21, FLOOR + 2, z0);
  set(-24, FLOOR + 1, z0, 'wanted_poster');
  set(-19, FLOOR + 1, z0, 'wanted_poster');
  windowX(-26, -25, FLOOR + 1, z0);
  windowX(-17, -16, FLOOR + 1, z0);
  // Two cells at the back behind bars, the sheriff's desk.
  fill(x0 + 1, FLOOR, 15, x1 - 1, FLOOR + 3, 15, 'iron_bars');
  fill(-21, FLOOR, 15, -21, FLOOR + 3, z1, 'adobe');
  air(-24, FLOOR, 15, -24, FLOOR + 2, 15);
  air(-18, FLOOR, 15, -18, FLOOR + 2, 15);
  fill(-19, FLOOR, 11, -17, FLOOR, 11, 'floorboards');
  set(-26, FLOOR, 12, 'barrel');
  set(-21, FLOOR + 3, 12, 'lantern');
  // Crates stacked up the west wall to the roof, and a gap in the parapet.
  for (let k = 0; k < 5; k++) stack(x0 - 1, 13 + k, 'crate', k + 1);
  set(x0, FLOOR + 6, 17, 'air');
}

/** South side, middle: the livery stable, red boards, open front, a hayloft under a pitched roof. */
function livery() {
  const [x0, x1, z0, z1] = [-9, 7, 9, 21];
  const LOFT = FLOOR + 4;
  fill(x0, G, z0, x1, G, z1, 'dust');
  walls(x0, z0, x1, z1, FLOOR, LOFT, 'barn_planks');
  // Gable ends up to the ridge, the roof in shingle stairs, the ridge in slabs.
  for (let k = 0; k <= 6; k++) {
    fill(x0, LOFT + 1 + k, z0 + k, x0, LOFT + 1 + k, z1 - k, 'barn_planks');
    fill(x1, LOFT + 1 + k, z0 + k, x1, LOFT + 1 + k, z1 - k, 'barn_planks');
    fill(x0 - 1, LOFT + 1 + k, z0 - 1 + k, x1 + 1, LOFT + 1 + k, z0 - 1 + k, 'shingles[facing=south]');
    fill(x0 - 1, LOFT + 1 + k, z1 + 1 - k, x1 + 1, LOFT + 1 + k, z1 + 1 - k, 'shingles[facing=north]');
  }
  fill(x0 - 1, LOFT + 7, 15, x1 + 1, LOFT + 7, 15, 'shingle_slab');
  // The big doorway, a loft door above it, stalls and hay.
  air(-3, FLOOR, z0, 1, FLOOR + 3, z0);
  fill(x0 + 1, LOFT, 14, x1 - 1, LOFT, z1 - 1, 'floorboards');
  for (const x of [-5, 3]) fill(x, FLOOR, 16, x, FLOOR + 1, z1 - 1, 'weathered_planks');
  stack(-8, 20, 'hay_bale', 2);
  stack(-7, 20, 'hay_bale', 1);
  stack(6, 20, 'hay_bale', 3);
  stack(6, 19, 'hay_bale', 2);
  // Hay bales up to the loft (a jump at a time).
  for (let k = 0; k < 4; k++) stack(-8, 10 + k, 'hay_bale', k + 1);
  fill(-6, LOFT + 1, 20, 5, LOFT + 1, 20, 'hay_bale');
  set(-1, FLOOR + 3, 18, 'lantern');
}

/** South side, east: the water tower on its legs, and a corral of log rails. */
function tower() {
  const [cx, cz] = [15, 13];
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ])
    fill(cx + dx, FLOOR, cz + dz, cx + dx, FLOOR + 8, cz + dz, 'spruce_log');
  fill(cx - 2, FLOOR + 3, cz - 2, cx + 2, FLOOR + 3, cz - 2, 'spruce_log[axis=x]');
  fill(cx - 2, FLOOR + 3, cz + 2, cx + 2, FLOOR + 3, cz + 2, 'spruce_log[axis=x]');
  fill(cx - 3, FLOOR + 9, cz - 3, cx + 3, FLOOR + 9, cz + 3, 'floorboards');
  bp.columns(cx, cz, 3.2, (x, z, d) => {
    if (d > 2.2) fill(x, FLOOR + 10, z, x, FLOOR + 14, z, 'weathered_planks');
    set(x, FLOOR + 15, z, 'shingle_slab');
  });
  set(cx, FLOOR + 16, cz, 'shingle_slab');
  // The corral: posts and two rails, a gate gap, hay and a trough inside.
  const [x0, x1, z0, z1] = [22, 33, 9, 21];
  for (let x = x0; x <= x1; x++)
    for (const z of [z0, z1]) {
      const post = (x - x0) % 3 === 0;
      if (post) fill(x, FLOOR, z, x, FLOOR + 1, z, 'spruce_log');
      else if (!(z === z0 && x >= 26 && x <= 28)) set(x, FLOOR + 1, z, 'spruce_log[axis=x]');
    }
  for (let z = z0; z <= z1; z++)
    for (const x of [x0, x1]) {
      const post = (z - z0) % 3 === 0;
      if (post) fill(x, FLOOR, z, x, FLOOR + 1, z, 'spruce_log');
      else set(x, FLOOR + 1, z, 'spruce_log[axis=z]');
    }
  stack(30, 18, 'hay_bale', 2);
  stack(31, 18, 'hay_bale', 1);
  stack(24, 12, 'hay_bale', 1);
  fill(25, FLOOR, 17, 27, FLOOR, 17, 'spruce_slab');
}

/** The street: a wagon, barrels and troughs, hitching rails, tumbleweeds, lanterns on posts. */
function street() {
  // A wagon, its bed on four wheels, hay aboard.
  for (const [x, z] of [
    [1, -3],
    [5, -3],
    [1, 0],
    [5, 0],
  ])
    set(x, FLOOR, z, 'barrel');
  fill(1, FLOOR + 1, -3, 5, FLOOR + 1, 0, 'floorboards');
  fill(1, FLOOR + 2, -3, 5, FLOOR + 2, -3, 'boardwalk');
  fill(1, FLOOR + 2, 0, 5, FLOOR + 2, 0, 'boardwalk');
  set(3, FLOOR + 2, -2, 'hay_bale');
  set(2, FLOOR + 2, -1, 'hay_bale');
  // A second, overturned, further west.
  fill(-20, FLOOR, 1, -16, FLOOR + 1, 1, 'floorboards');
  set(-21, FLOOR, 1, 'barrel');
  // Troughs and barrels by the boardwalks.
  fill(-15, FLOOR, -5, -13, FLOOR, -5, 'spruce_slab');
  fill(8, FLOOR, 5, 10, FLOOR, 5, 'spruce_slab');
  for (const [x, z, n] of [
    [-29, -5, 2],
    [-30, -5, 1],
    [8, -5, 1],
    [-12, 5, 2],
    [-11, 5, 1],
    [13, 4, 1],
    [21, -4, 2],
    [-33, 3, 1],
    [30, -2, 1],
  ])
    stack(x, z, 'barrel', n);
  for (const [x, z, n] of [
    [-6, 4, 2],
    [-7, 4, 1],
    [18, 2, 1],
    [24, -3, 2],
    [25, -3, 1],
  ])
    stack(x, z, 'crate', n);
  // Hitching rails.
  for (const [x0, z] of [
    [-26, -5],
    [-9, -5],
    [11, -5],
    [-24, 5],
  ]) {
    fill(x0, FLOOR, z, x0, FLOOR + 1, z, 'spruce_log');
    fill(x0 + 3, FLOOR, z, x0 + 3, FLOOR + 1, z, 'spruce_log');
    fill(x0 + 1, FLOOR + 1, z, x0 + 2, FLOOR + 1, z, 'spruce_log[axis=x]');
  }
  // Lanterns on posts along the street.
  for (const [x, z] of [
    [-31, -6],
    [-13, -6],
    [8, -6],
    [23, -6],
    [-29, 6],
    [-11, 6],
    [9, 6],
  ]) {
    fill(x, FLOOR, z, x, FLOOR + 2, z, 'spruce_log');
    set(x, FLOOR + 3, z, 'lantern');
  }
  // Tumbleweeds and dead brush.
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(W + 4 + rnd(i, 1, 5) * (E - W - 8));
    const z = Math.floor(N + 2 + rnd(i, 2, 5) * (S - N - 4));
    if (bp.get(x, FLOOR, z) === 'air' && bp.get(x, G, z) !== 'floorboards') set(x, FLOOR, z, i % 3 ? 'tumbleweed' : 'dead_bush');
  }
}

/** The edges: mesa rock piled across both ends of the street, saguaros behind the buildings. */
function edges() {
  const pile = (x0: number, z0: number, x1: number, z1: number, hMax: number, s: number) => {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const hgt = Math.round(1 + rnd(x, z, s) * (hMax - 1));
        fill(x, FLOOR, z, x, FLOOR + hgt - 1, z, 'mesa_rock');
      }
  };
  // West end: two boulder heaps with a gap to walk out; east end the same.
  pile(-39, -12, -37, -4, 4, 1);
  pile(-39, 4, -37, 12, 4, 2);
  pile(-35, -2, -34, 0, 2, 3);
  pile(37, -12, 39, -3, 4, 4);
  pile(37, 3, 39, 12, 4, 5);
  pile(34, 1, 35, 2, 2, 6);
  // Rocks and cacti out back, for cover in the alleys.
  pile(-8, -25, -6, -24, 3, 7);
  pile(24, -22, 26, -20, 3, 8);
  pile(-33, 22, -31, 24, 3, 9);
  for (const [x, z, t, a] of [
    [-35, -18, 4, 1],
    [-15, -24, 5, 2],
    [9, -25, 4, 1],
    [30, -15, 5, 2],
    [-35, 19, 4, 2],
    [-12, 25, 5, 1],
    [12, 25, 4, 0],
    [36, 20, 5, 1],
    [28, -24, 3, 0],
  ])
    saguaro(x, z, t, a);
  // Outhouses in the back alleys.
  for (const [x, z] of [
    [-24, -24],
    [18, 24],
  ]) {
    walls(x, z, x + 2, z + 2, FLOOR, FLOOR + 2, 'weathered_planks');
    set(x + 1, FLOOR + 3, z + 1, 'shingle_slab');
    fill(x, FLOOR + 3, z, x + 2, FLOOR + 3, z + 2, 'shingle_slab');
    air(x + 1, FLOOR, z + (z < 0 ? 2 : 0), x + 1, FLOOR + 1, z + (z < 0 ? 2 : 0));
  }
}

function build(): Blueprint {
  ground();
  store();
  saloon();
  bank();
  jail();
  livery();
  tower();
  street();
  edges();
  return bp.moved({ x: OX, y: 0, z: OZ });
}

// ---------------------------------------------------------------------------------------------

const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
/** A spawn in block (x, z) (town coordinates) with feet at y, facing (tx, tz). */
const spawn = (x: number, y: number, z: number, tx = 0, tz = 0): SpawnPoint => ({ x: OX + x + 0.5, y, z: OZ + z + 0.5, yaw: yawTo(x, z, tx, tz) });
const spot = (x: number, y: number, z: number): Vec3 => ({ x: OX + x + 0.5, y, z: OZ + z + 0.5 });

export const MAP = {
  name: 'Dry Gulch',
  seed: SEED,
  /** Late morning: the sun high, short shadows (it's nearly noon). */
  time: 0.46,
  floorY: FLOOR,
  structures: [build()],
  terraform: [{ x: OX, z: OZ, radius: 44, blend: 18, height: G + 0.5 }],
  bounds: { min: { x: OX + W, y: G, z: OZ + N }, max: { x: OX + E, y: FLOOR + 12, z: OZ + S } },
  /** Where a round's fighters start: around the town, facing the street. */
  spawns: [
    spawn(-33, FLOOR, 0, 0, 0),
    spawn(33, FLOOR, 0, 0, 0),
    spawn(-23, FLOOR, -15, -23, 0),
    spawn(-1, FLOOR, -15, -1, 0),
    spawn(-6, FLOOR + 5, -18, -3, 0),
    spawn(15, FLOOR, -12, 15, 0),
    spawn(15, FLOOR + 6, -14, 15, 0),
    spawn(-21, FLOOR, 13, -21, 0),
    spawn(-1, FLOOR, 16, -1, 0),
    spawn(27, FLOOR, 15, 20, 0),
    spawn(-20, FLOOR, -24, -20, 0),
    spawn(8, FLOOR, 24, 0, 0),
    spawn(-36, FLOOR, 18, 0, 0),
    spawn(34, FLOOR, -20, 0, 0),
  ],
  hotspots: [
    spot(0, FLOOR, 0),
    spot(-3, FLOOR + 5, -7),
    spot(15, FLOOR + 6, -14),
    spot(-1, FLOOR, 16),
    spot(27, FLOOR, 15),
    spot(-21, FLOOR, 0),
    spot(20, FLOOR, 0),
    spot(-3, FLOOR, -12),
    spot(15, FLOOR, 12),
  ],
  /** The middle of the street, for the home page's view. */
  center: { x: OX, y: FLOOR, z: OZ } as Vec3,
};
