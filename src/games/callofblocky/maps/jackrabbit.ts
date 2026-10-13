import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import * as kit from './kit';
import { FONT, FONT7, hash, layout, outlined, slab, spawnAt as spawn, stairs, torch, type Fill, type MapSpec } from './kit';

/**
 * Jackrabbit Lane: a pop-art cul-de-sac in the hills. Two houses face each other across a street
 * with a Big Kahuna Burger truck parked in the middle, fenced backyards behind them, Jack Rabbit
 * Slim's diner at the turning circle, and a storm drain under the street linking both garages and
 * the diner's back room. (What a map gives the game: `MapSpec`, in kit.ts.)
 */

// ---------------------------------------------------------------------------------------------
// Layout (+x east, +z south). Players stand at FLOOR on the street; the ground blocks are at G.
//
//   x = -40            the Big Kahuna Burger billboard (west boundary), z = -22 .. 22
//   x = -27 .. -10     the houses (north: mustard, pitched roof; south: teal, flat roof), two
//                      floors (players at 64 and 69), big windows on the street, stairs inside
//   x = -10 .. -2      their garages; storm-drain stairs down at x = -9 .. -7
//   x = -23 .. -14     the Big Kahuna Burger truck, mid-street (z = -2 .. 1)
//   centre (17, 0)     the cul-de-sac turning circle, r = 11.5, with a flower island
//   x = 31 .. 41       Jack Rabbit Slim's (z = -12 .. 12); its back wall is the east boundary;
//                      roof perch at 69 (outside stairs on the south side), SLIMS sign on posts
//   |z| <= 5           asphalt; kerbs at |z| = 6; sidewalks to |z| = 9; front lawns to |z| = 12
//   |z| = 13 .. 23     houses; |z| = 24 .. 33 backyards; |z| = 34 boundary hedges (6 high)
//   |z| = 17           the cul-de-sac's side hedges (x >= 4; 10 high near the diner)
//   y = 57 .. 61       the storm drain (floor 57, players at 58, ceiling 61): x = -9 .. -7 from
//                      garage to garage, a branch east along z = -1 .. 1 (chamber under the
//                      cul-de-sac) and up into the diner's back room at x = 32 .. 34
// ---------------------------------------------------------------------------------------------

const FLOOR = 64;
const G = FLOOR - 1;
/** Upper floors of the houses (players stand here). */
const UP = FLOOR + 5;
/** Air is carved up to here over the play area. */
const SKY = 94;

const WEST = -40;
const EAST = 41;
const NORTH = -34;
const SOUTH = 34;
/** The backyards' east fence. */
const LOT_EAST = 4;
/** The cul-de-sac zone's side hedges (|z|). */
const SIDE = 17;
const CUL = { x: 17, z: 0, r: 11.5 };

/** The storm drain: floor block, players' feet, ceiling block. */
const DRAIN_FLOOR = 57;
const DRAIN_FEET = DRAIN_FLOOR + 1;
const DRAIN_CEIL = DRAIN_FEET + 3;

// ---------------------------------------------------------------------------------------------
// The one big Blueprint, and a z-mirrored view of it (the south side is the north side flipped).
// ---------------------------------------------------------------------------------------------

const bp = new Blueprint({ x: -60, y: 50, z: -54 }, { x: 121, y: SKY - 50 + 1, z: 109 });

class Side {
  constructor(readonly s: 1 | -1) {}
  z(z: number): number {
    return z * this.s;
  }
  b(block: BlockRef): BlockRef {
    if (this.s === 1 || typeof block !== 'string') return block;
    return block.replace(/facing=(north|south)/, (_, f: string) => `facing=${f === 'north' ? 'south' : 'north'}`);
  }
  set(x: number, y: number, z: number, block: BlockRef) {
    bp.set(x, y, this.z(z), this.b(block));
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: Fill) {
    const f =
      typeof block === 'function'
        ? (x: number, y: number, z: number) => {
            const v = block(x, y, this.z(z));
            return v === undefined ? undefined : this.b(v);
          }
        : this.b(block);
    bp.fill({ x: x0, y: y0, z: this.z(z0) }, { x: x1, y: y1, z: this.z(z1) }, f);
  }
}
const N = new Side(1);
const S = new Side(-1);
const W = N; // unmirrored world view

// The kit's sprites and props, on this map's Blueprint.
const sprite = (rows: string[], colors: Record<string, BlockRef>, at: (u: number, v: number) => Vec3, scale = 1) => kit.sprite(bp, rows, colors, at, scale);
const palm = (x: number, z: number, height: number, lean: [number, number] = [1, 0], y0 = FLOOR) => kit.palm(bp, x, z, height, lean, y0);
const hydrant = (x: number, z: number) => kit.hydrant(bp, x, FLOOR, z);

// ---------------------------------------------------------------------------------------------
// Ground: carve the play area, lay the street, sidewalks, lawns.
// ---------------------------------------------------------------------------------------------

const inStreet = (x: number, z: number) => (x <= CUL.x - 8 && Math.abs(z) <= 5) || Math.hypot(x - CUL.x, z - CUL.z) <= CUL.r;
const inSidewalk = (x: number, z: number) => !inStreet(x, z) && ((x <= CUL.x - 8 && Math.abs(z) <= 9) || Math.hypot(x - CUL.x, z - CUL.z) <= CUL.r + 3);
const inIsland = (x: number, z: number) => Math.hypot(x - CUL.x, z - CUL.z) <= 2.6;

function ground() {
  // Solid underground (the drain is cut from it) and clear sky over the whole play area.
  W.fill(WEST - 6, 52, NORTH - 6, EAST + 6, G - 1, SOUTH + 6, (_x, y) => (y >= G - 3 ? 'dirt' : 'stone'));
  W.fill(WEST - 6, G, NORTH - 6, EAST + 6, G, SOUTH + 6, 'grass_block');
  W.fill(WEST, FLOOR, NORTH, EAST, SKY, SOUTH, 'air');

  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++) {
      let b: BlockRef = 'grass_block';
      if (inStreet(x, z)) {
        // Asphalt with worn patches, and the yellow centre dashes.
        b = hash(x, z, 3) < 0.035 ? 'black_concrete' : 'gray_concrete';
        if (inIsland(x, z)) b = 'grass_block';
        else if (Math.hypot(x - CUL.x, z - CUL.z) <= 3.6) b = 'white_concrete';
        if (z === 0 && x <= CUL.x - 12 && ((x % 6) + 6) % 6 < 3) b = 'yellow_concrete';
      } else if (inSidewalk(x, z)) {
        b = 'light_gray_concrete';
        // Expansion joints.
        if (x <= CUL.x - 8 && ((x % 5) + 5) % 5 === 0) b = 'white_concrete';
      }
      bp.set(x, G, z, b);
      // Kerb: a slab-high lip where the sidewalk meets the road.
      if (inSidewalk(x, z) && (inStreet(x + 1, z) || inStreet(x - 1, z) || inStreet(x, z + 1) || inStreet(x, z - 1))) {
        bp.set(x, G, z, 'white_concrete');
        bp.set(x, FLOOR, z, slab('stone'));
      }
      // The island's kerb ring.
      const d = Math.hypot(x - CUL.x, z - CUL.z);
      if (d > 2.6 && d <= 3.6) bp.set(x, FLOOR, z, slab('stone'));
    }
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/** A white picket fence along a line (1.5 high: posts and slab rails). */
function picket(x0: number, z0: number, x1: number, z1: number, side: Side = W) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const dx = Math.sign(x1 - x0);
  const dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i;
    const z = z0 + dz * i;
    const post = i % 3 === 0 || i === n;
    side.set(x, FLOOR, z, 'white_concrete');
    side.set(x, FLOOR + 1, z, post ? slab('birch') : 'air');
  }
}

/** A hedge (tinted leaves) filling a box of columns. */
function hedge(x0: number, z0: number, x1: number, z1: number, height: number, side: Side = W) {
  side.fill(x0, FLOOR, z0, x1, FLOOR + height - 1, z1, 'oak_leaves');
}

// ---------------------------------------------------------------------------------------------
// The houses (written for the north house; the south one is the same plan mirrored in z)
// ---------------------------------------------------------------------------------------------

interface HouseStyle {
  wall: BlockRef;
  trim: BlockRef;
  frame: BlockRef;
  floor: BlockRef;
  upFloor: BlockRef;
  checker: [BlockRef, BlockRef];
  sofa: BlockRef;
  rug: [BlockRef, BlockRef];
  bed: 'red' | 'blue' | 'green' | 'yellow';
  kidBed: 'red' | 'blue' | 'green' | 'yellow';
  pitched: boolean;
}

const HX0 = -27; // west wall
const HX1 = -10; // east wall (shared with the garage)
const GX1 = -2; // garage east wall
const HZF = -13; // front wall (faces the street)
const HZB = -23; // back wall
/** The garage's stairs down to the drain. */
const DX0 = -9;
const DX1 = -7;

interface Opening {
  wall: 'front' | 'back' | 'west' | 'east';
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  door?: boolean;
}

const OPENINGS: Opening[] = [
  // Street side: front door, big windows on both floors (the Nuketown sightlines).
  { wall: 'front', a0: -19, a1: -18, y0: FLOOR, y1: FLOOR + 2, door: true },
  { wall: 'front', a0: -25, a1: -22, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'front', a0: -15, a1: -12, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'front', a0: -25, a1: -21, y0: UP + 1, y1: UP + 2 },
  { wall: 'front', a0: -17, a1: -14, y0: UP + 1, y1: UP + 2 },
  // Backyard side.
  { wall: 'back', a0: -15, a1: -14, y0: FLOOR, y1: FLOOR + 2, door: true },
  { wall: 'back', a0: -25, a1: -22, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'back', a0: -25, a1: -22, y0: UP + 1, y1: UP + 2 },
  { wall: 'back', a0: -17, a1: -15, y0: UP + 1, y1: UP + 2 },
  // West side.
  { wall: 'west', a0: -20, a1: -17, y0: FLOOR + 1, y1: FLOOR + 2 },
  { wall: 'west', a0: -20, a1: -17, y0: UP + 1, y1: UP + 2 },
  // Into the garage.
  { wall: 'east', a0: -22, a1: -21, y0: FLOOR, y1: FLOOR + 2, door: true },
];

function openingCells(o: Opening, fn: (x: number, y: number, z: number, edge: boolean) => void) {
  for (let a = o.a0 - 1; a <= o.a1 + 1; a++)
    for (let y = o.y0 - 1; y <= o.y1; y++) {
      const inside = a >= o.a0 && a <= o.a1 && y >= o.y0 && y <= o.y1;
      if (o.door && y < o.y0) continue;
      const [x, z] = o.wall === 'front' ? [a, HZF] : o.wall === 'back' ? [a, HZB] : o.wall === 'west' ? [HX0, a] : [HX1, a];
      fn(x, y, z, !inside);
    }
}

function house(s: Side, st: HouseStyle) {
  // Floors and the shell.
  s.fill(HX0, G, HZB, GX1, G, HZF, st.floor);
  s.fill(HX0, FLOOR, HZB, HX1, UP + 3, HZF, (x, y, z) => {
    const edgeX = x === HX0 || x === HX1;
    const edgeZ = z === HZB || z === HZF;
    if (!edgeX && !edgeZ) return y === UP - 1 ? st.upFloor : 'air';
    if (edgeX && edgeZ) return st.trim;
    if (y === UP - 1) return st.trim;
    return st.wall;
  });
  // Ceiling / roof deck (white inside) and the eave band.
  s.fill(HX0, UP + 4, HZB, HX1, UP + 4, HZF, (x, _y, z) => (x === HX0 || x === HX1 || z === HZB || z === HZF ? st.trim : 'white_concrete'));

  // Openings with white frames.
  for (const o of OPENINGS) openingCells(o, (x, y, z, edge) => s.set(x, y, z, edge ? st.frame : 'air'));

  // Roof.
  if (st.pitched) {
    for (let k = 0; k <= 5; k++) {
      const y = UP + 4 + k;
      s.fill(HX0 - 1, y, HZF + 1 - k, HX1 + 1, y, HZF + 1 - k, stairs('brick', 'north'));
      s.fill(HX0 - 1, y, HZB - 1 + k, HX1 + 1, y, HZB - 1 + k, stairs('brick', 'south'));
      // Gable ends filled in under the slopes.
      if (k > 0) {
        s.fill(HX0, y, HZB + k, HX0, y, HZF - k, (_x, _yy, z) => (z === HZB + k || z === HZF - k ? undefined : st.wall));
        s.fill(HX1, y, HZB + k, HX1, y, HZF - k, (_x, _yy, z) => (z === HZB + k || z === HZF - k ? undefined : st.wall));
      }
    }
    s.fill(HX0 - 1, UP + 10, HZF - 5, HX1 + 1, UP + 10, HZF - 5, 'bricks');
    s.fill(HX0 - 1, UP + 11, HZF - 5, HX1 + 1, UP + 11, HZF - 5, slab('brick'));
    // Gable-end round window (a neon porthole).
    s.set(HX0, UP + 7, HZF - 5, 'neon_yellow');
    s.set(HX1, UP + 7, HZF - 5, 'neon_yellow');
  } else {
    // Mid-century flat roof: a cantilevered deck with a thick fascia.
    s.fill(HX0 - 1, UP + 4, HZB - 1, HX1 + 1, UP + 5, HZF + 1, (x, y, z) => {
      const edge = x === HX0 - 1 || x === HX1 + 1 || z === HZB - 1 || z === HZF + 1;
      if (y === UP + 5) return 'white_concrete';
      return edge ? st.trim : 'white_concrete';
    });
    // Pop-art polka dots on the roof.
    s.fill(HX0, UP + 5, HZB, HX1, UP + 5, HZF, (x, _y, z) => {
      const u = x + 27;
      const v = z + 23 + (Math.floor(u / 3) % 2) * 1.5;
      return u % 3 === 1 && Math.round(v) % 3 === 1 ? st.trim : undefined;
    });
  }

  // ----- Ground floor: living room (west), kitchen (east), stairs up along the east wall.
  // Rug.
  s.fill(-26, G, -21, -20, G, -15, (x, _y, z) => {
    const d = Math.hypot(x + 23, z + 18);
    return d <= 1.5 ? st.rug[0] : d <= 2.6 ? st.rug[1] : d <= 3.3 ? st.rug[0] : undefined;
  });
  // TV on the west wall: black cabinet, neon screen.
  s.fill(-26, FLOOR, -20, -26, FLOOR, -19, 'black_concrete');
  s.fill(-26, FLOOR + 1, -20, -26, FLOOR + 1, -19, 'neon_cyan');
  // Sofa facing the TV, armrests at both ends.
  s.fill(-22, FLOOR, -21, -22, FLOOR, -18, stairs('oak', 'east'));
  s.set(-22, FLOOR, -22, st.sofa);
  s.set(-22, FLOOR, -17, st.sofa);
  s.fill(-24, FLOOR, -20, -24, FLOOR, -19, slab('spruce', true)); // coffee table
  // Bookshelves by the front window.
  s.fill(-26, FLOOR, -15, -26, FLOOR + 2, -14, 'bookshelf');
  // Kitchen: checker floor, counters, fridge, island.
  s.fill(-17, G, -22, -13, G, -14, (x, _y, z) => ((x + z) % 2 === 0 ? st.checker[0] : st.checker[1]));
  s.fill(-17, FLOOR, -22, -16, FLOOR, -22, 'white_concrete');
  s.set(-17, FLOOR, -21, 'white_concrete');
  s.set(-17, FLOOR, -20, 'iron_block'); // stove
  s.fill(-13, FLOOR, -22, -13, FLOOR + 1, -22, 'white_concrete'); // fridge
  s.fill(-16, FLOOR, -18, -14, FLOOR, -18, st.trim); // island
  s.set(-15, FLOOR + 1, -18, slab('birch'));
  // Stairs up along the east wall, climbing north (toward the back).
  for (let i = 0; i < 5; i++) {
    const z = -15 - i;
    s.fill(-12, FLOOR, z, -11, FLOOR + i, z, (_x, y) => (y === FLOOR + i ? stairs('oak', 'north') : st.wall));
    s.fill(-12, FLOOR + i + 1, z, -11, FLOOR + i + 4, z, 'air');
  }
  // Railings round the stairwell upstairs.
  s.fill(-13, UP, -18, -13, UP, -15, slab('oak'));
  s.fill(-12, UP, -14, -11, UP, -14, slab('oak'));
  // Lights: under the upstairs furniture.
  s.set(-23, UP - 1, -21, 'sea_lantern');
  s.set(-15, UP - 1, -21, 'sea_lantern');
  s.set(-23, UP - 1, -15, 'sea_lantern');
  s.set(-15, UP - 1, -15, 'sea_lantern');

  // ----- Upper floor: master bedroom (west), kid's room (east).
  s.fill(-19, UP, -22, -19, UP + 3, -14, st.wall);
  s.fill(-19, UP, -18, -19, UP + 2, -17, 'air'); // door
  // Double bed against the back wall, bedside lamps.
  for (const x of [-24, -23]) {
    s.set(x, UP, -22, `${st.bed}_bed[facing=north,part=head]`);
    s.set(x, UP, -21, `${st.bed}_bed[facing=north,part=foot]`);
  }
  s.set(-25, UP, -22, 'spruce_planks');
  s.set(-25, UP + 1, -22, 'glowstone');
  s.set(-22, UP, -22, 'spruce_planks');
  // Wardrobe and a dresser.
  s.fill(-26, UP, -16, -26, UP + 2, -14, 'spruce_planks');
  s.fill(-21, UP, -16, -20, UP, -16, slab('spruce', true));
  // Kid's room: bed, desk with a computer, bookshelf.
  s.set(-18, UP, -22, `${st.kidBed}_bed[facing=east,part=foot]`);
  s.set(-17, UP, -22, `${st.kidBed}_bed[facing=east,part=head]`);
  s.fill(-18, UP, -15, -16, UP, -15, slab('birch', true));
  s.set(-17, UP + 1, -15, 'black_concrete');
  s.set(-16, UP + 1, -15, 'neon_pink');
  s.fill(-14, UP, -22, -14, UP + 1, -22, 'bookshelf');
  // Ceiling lights.
  for (const [x, z] of [[-23, -18], [-15, -19]]) s.set(x, UP + 4, z, 'sea_lantern');
  // Porch light by the front door.
  s.set(-20, FLOOR + 2, HZF + 1, torch('south'));
  s.set(-17, FLOOR + 2, HZF + 1, torch('south'));

  // ----- Garage: flat roof, open door on the street, side door, stairs down to the drain.
  s.fill(HX1, FLOOR, HZB, GX1, FLOOR + 4, HZF, (x, y, z) => {
    const edge = x === HX1 || x === GX1 || z === HZB || z === HZF;
    if (x === HX1) return undefined; // the house wall
    if (y === FLOOR + 4) return z === HZF || z === HZB || x === GX1 ? st.trim : 'white_concrete';
    if (!edge) return 'air';
    if ((x === GX1 && (z === HZB || z === HZF))) return st.trim;
    return st.wall;
  });
  s.fill(HX1 + 1, G, HZB + 1, GX1 - 1, G, HZF - 1, 'light_gray_concrete');
  // Garage door: open, with the raised door panel showing at the top.
  s.fill(-8, FLOOR, HZF, -4, FLOOR + 2, HZF, 'air');
  s.fill(-8, FLOOR + 3, HZF, -4, FLOOR + 3, HZF, st.frame);
  s.fill(-9, FLOOR, HZF, -9, FLOOR + 3, HZF, st.trim);
  s.fill(-3, FLOOR, HZF, -3, FLOOR + 3, HZF, st.trim);
  // Side door to the side yard.
  s.fill(GX1, FLOOR, -20, GX1, FLOOR + 2, -19, 'air');
  // Workbench and boxes.
  s.fill(-3, FLOOR, -22, -3, FLOOR, -19, 'spruce_planks');
  s.fill(-3, FLOOR + 1, -22, -3, FLOOR + 1, -22, 'oak_planks');
  s.fill(-5, FLOOR, -15, -4, FLOOR, -15, 'oak_planks');
  s.set(-5, FLOOR + 1, -15, 'oak_planks');
  // Lights.
  s.set(-5, FLOOR + 4, -20, 'glowstone');
  s.set(-5, FLOOR + 4, -16, 'glowstone');
  // The drain stairs: down from the back of the garage toward the street.
  for (let i = 0; i < 5; i++) {
    const z = -20 + i;
    const y = G - 1 - i;
    s.fill(DX0, DRAIN_FLOOR, z, DX1, y, z, (_x, yy) => (yy === y ? stairs('stone_brick', 'north') : 'light_gray_concrete'));
    s.fill(DX0, y + 1, z, DX1, y + 4, z, 'air');
  }
  // Railings.
  s.fill(DX1 + 1, FLOOR, -20, DX1 + 1, FLOOR, -17, 'white_concrete');
  s.fill(DX0, FLOOR, -16, DX1 + 1, FLOOR, -16, 'white_concrete');
  s.fill(DX1 + 1, FLOOR + 1, -20, DX1 + 1, FLOOR + 1, -17, slab('stone'));
  s.fill(DX0, FLOOR + 1, -16, DX1 + 1, FLOOR + 1, -16, slab('stone'));

  // ----- Front yard: path, driveway, flower beds.
  s.fill(-19, G, -12, -18, G, -10, 'white_concrete');
  s.fill(-8, G, -12, -4, G, -10, 'light_gray_concrete');
  s.fill(-26, G, -12, -21, G, -12, 'podzol');
  s.fill(-15, G, -12, -11, G, -12, 'podzol');
  for (let x = -26; x <= -21; x++) s.set(x, FLOOR, -12, x % 2 === 0 ? 'poppy' : 'dandelion');
  for (let x = -15; x <= -11; x++) s.set(x, FLOOR, -12, x % 2 === 0 ? 'dandelion' : 'poppy');
}

function mailbox(s: Side, x: number, z: number, color: BlockRef) {
  s.set(x, FLOOR, z, 'white_concrete');
  s.set(x, FLOOR + 1, z, color);
}

// ---------------------------------------------------------------------------------------------
// Backyards
// ---------------------------------------------------------------------------------------------

function backyardFence(s: Side) {
  // Boundary: a tall hedge with a white picket fence in front of it.
  hedge(WEST, NORTH, LOT_EAST, NORTH, 6, s);
  picket(WEST + 1, NORTH + 1, LOT_EAST - 1, NORTH + 1, s);
  hedge(LOT_EAST, NORTH, LOT_EAST, -SIDE, 6, s);
  // Low picket fences between the side yards and the front lawns (with gates).
  picket(WEST + 1, HZF, HX0 - 1, HZF, s);
  s.fill(-34, FLOOR, HZF, -33, FLOOR + 1, HZF, 'air');
  picket(GX1 + 1, HZF, LOT_EAST - 1, HZF, s);
  s.fill(1, FLOOR, HZF, 2, FLOOR + 1, HZF, 'air');
}

function northYard() {
  const s = N;
  // Pool: 2 deep, light blue lining, white coping, steps at the east end.
  const [px0, px1, pz0, pz1] = [-31, -21, -31, -27];
  s.fill(px0 - 1, G - 3, pz0 - 1, px1 + 1, G, pz1 + 1, (x, y, z) => {
    const rim = x === px0 - 1 || x === px1 + 1 || z === pz0 - 1 || z === pz1 + 1;
    if (y === G && rim) return 'white_concrete';
    if (y === G - 3 || rim) return 'light_blue_concrete';
    return 'water';
  });
  s.fill(px0, G - 2, pz0, px1, G - 2, pz1, (x, _y, z) => ((x + z) % 4 === 0 ? 'blue_concrete' : undefined));
  s.fill(px1, G - 1, pz0 + 1, px1, G - 1, pz1 - 1, stairs('birch', 'east'));
  // Pool lights.
  s.set(px0 - 1, G - 1, -29, 'sea_lantern');
  s.set(px1 + 1, G - 2, -29, 'sea_lantern');
  // Diving board at the west end.
  s.set(px0 - 2, FLOOR, -29, 'white_concrete');
  s.fill(px0 - 1, FLOOR, -29, px0 + 1, FLOOR, -29, slab('birch'));
  // Loungers along the house side.
  for (const x of [-30, -27, -24]) {
    s.set(x, FLOOR, -25, stairs('birch', 'north'));
    s.set(x, FLOOR, -24, slab('birch'));
  }
  // The pink flamingo (a big one), east of the pool.
  const flamingo = ['.KPP......', 'K..P......', '...P......', '....P.....', '....P.....', '...PPPPP..', '..PPPPPPPP', '...PPPPPP.', '.....L....', '.....LL...', '.....L.L..', '.....L....'];
  sprite(flamingo, { P: 'pink_concrete', K: 'black_concrete', L: 'pink_concrete' }, (u, v) => ({ x: -21 + u, y: FLOOR + v, z: -32 }));
  s.fill(-18, FLOOR + 4, -31, -14, FLOOR + 6, -31, (x, y) => (y === FLOOR + 5 || (x > -18 && x < -14) ? 'pink_concrete' : undefined));
  // Patio behind the back door: orange tiles, a barbecue, a table under an umbrella.
  s.fill(-18, G, -27, -10, G, -24, (x, _y, z) => ((x + z) % 2 === 0 ? 'orange_concrete' : 'white_concrete'));
  s.set(-11, FLOOR, -26, 'black_concrete');
  s.set(-11, FLOOR + 1, -26, 'torch');
  s.set(-10, FLOOR, -26, 'iron_block');
  s.fill(-17, FLOOR, -26, -15, FLOOR, -25, slab('spruce', true));
  s.fill(-16, FLOOR, -26, -16, FLOOR + 2, -26, 'white_concrete');
  s.fill(-18, FLOOR + 3, -28, -14, FLOOR + 3, -24, (x, _y, z) =>
    Math.abs(x + 16) + Math.abs(z + 26) <= 3 ? ((x + z) % 2 === 0 ? 'red_wool' : 'white_wool') : undefined,
  );
  // Shed in the west corner.
  s.fill(-38, FLOOR, -33, -34, FLOOR + 4, -28, (x, y, z) => {
    const edge = x === -38 || x === -34 || z === -33 || z === -28;
    if (y === FLOOR + 4) return 'white_concrete';
    if (!edge) return 'air';
    if (y === FLOOR + 3) return 'white_concrete';
    return 'lime_concrete';
  });
  s.fill(-34, FLOOR, -31, -34, FLOOR + 2, -30, 'air');
  s.fill(-38, FLOOR + 1, -31, -38, FLOOR + 2, -30, 'air');
  s.fill(-37, FLOOR, -32, -36, FLOOR, -32, 'spruce_log');
  s.set(-37, FLOOR, -29, 'red_concrete'); // lawnmower
  s.set(-36, FLOOR + 4, -30, 'glowstone');
  // Hedges for cover.
  hedge(-37, -26, -34, -25, 2);
  hedge(-7, -30, -3, -30, 2);
  hedge(-3, -29, -3, -27, 2);
  palm(-9, -32, 10, [0, 1]);
  palm(1, -25, 9, [-1, 0]);
}

function southYard() {
  const s = S;
  // Patio with a barbecue and a table (mirror of the north one's position).
  s.fill(-18, G, -27, -10, G, -24, (x, _y, z) => ((x + z) % 2 === 0 ? 'pink_concrete' : 'white_concrete'));
  s.set(-11, FLOOR, -26, 'black_concrete');
  s.set(-11, FLOOR + 1, -26, 'torch');
  s.set(-10, FLOOR, -26, 'iron_block');
  s.fill(-17, FLOOR, -26, -15, FLOOR, -25, slab('spruce', true));
  s.fill(-16, FLOOR, -26, -16, FLOOR + 2, -26, 'white_concrete');
  s.fill(-18, FLOOR + 3, -28, -14, FLOOR + 3, -24, (x, _y, z) =>
    Math.abs(x + 16) + Math.abs(-z - 26) <= 3 ? ((x + z) % 2 === 0 ? 'yellow_wool' : 'white_wool') : undefined,
  );
  // Hot tub: a raised wooden tub with water.
  s.fill(-25, FLOOR, -31, -21, FLOOR, -27, (x, _y, z) => (x === -25 || x === -21 || z === -31 || z === -27 ? 'spruce_planks' : 'water'));
  s.fill(-24, G, -30, -22, G, -28, 'cyan_concrete');
  s.set(-23, G, -29, 'sea_lantern');
  // Greenhouse in the west corner: white frame, glass roof, open sides, planters.
  s.fill(-38, FLOOR, -33, -32, FLOOR + 4, -28, (x, y, z) => {
    const corner = (x === -38 || x === -32) && (z === -33 || z === -28);
    const edge = x === -38 || x === -32 || z === -33 || z === -28;
    if (y === FLOOR + 4) return edge ? 'white_concrete' : 'glass';
    if (corner) return 'white_concrete';
    if (y === FLOOR + 3 && edge) return 'white_concrete';
    return 'air';
  });
  s.fill(-37, FLOOR, -32, -33, FLOOR, -32, 'spruce_planks');
  s.fill(-37, FLOOR + 1, -32, -33, FLOOR + 1, -32, (x) => (x % 2 === 0 ? 'oak_leaves' : 'poppy'));
  s.fill(-37, FLOOR, -29, -35, FLOOR, -29, 'spruce_planks');
  s.fill(-37, FLOOR + 1, -29, -35, FLOOR + 1, -29, (x) => (x % 2 === 0 ? 'dandelion' : 'oak_leaves'));
  // Hedge rows for cover.
  hedge(-30, -25, -26, -25, 2, s);
  hedge(-7, -31, -3, -31, 2, s);
  hedge(-3, -30, -3, -28, 2, s);
  // Kiddie playhouse: a little pink box to duck behind.
  s.fill(-29, FLOOR, -33, -27, FLOOR, -32, 'magenta_concrete');
  s.fill(-29, FLOOR + 1, -33, -27, FLOOR + 1, -32, slab('birch'));
  palm(-9, 32, 11, [0, -1]);
  palm(1, 24, 9, [-1, 0]);
}

// ---------------------------------------------------------------------------------------------
// Jack Rabbit Slim's
// ---------------------------------------------------------------------------------------------

const DX_FRONT = 31;
const DX_BACK = EAST;
const DZ = 12;

function diner() {
  const x0 = DX_FRONT;
  const x1 = DX_BACK;
  // Floor: black and white checks (back room plain).
  W.fill(x0, G, -DZ, x1, G, DZ, (x, _y, z) => (z >= 6 ? 'light_gray_concrete' : (x + z) % 2 === 0 ? 'black_concrete' : 'white_concrete'));
  // Shell: white walls, red kick band, windows with chrome mullions, turquoise band, roof.
  W.fill(x0, FLOOR, -DZ, x1, FLOOR + 4, DZ, (x, y, z) => {
    const edge = x === x0 || x === x1 || z === -DZ || z === DZ;
    if (y === FLOOR + 4) return 'white_concrete';
    if (!edge) return 'air';
    if (y === FLOOR) return 'red_concrete';
    if (y === FLOOR + 3) return 'cyan_concrete';
    return 'white_concrete';
  });
  // Big windows: front (both sides of the door) and north side.
  const window = (xa: number, za: number, xb: number, zb: number) =>
    W.fill(xa, FLOOR + 1, za, xb, FLOOR + 2, zb, (x, _y, z) => ((x0 === xa ? z : x) % 3 === 0 ? 'iron_block' : 'air'));
  window(x0, -11, x0, -3);
  window(x0, 2, x0, 11);
  window(32, -DZ, 40, -DZ);
  window(32, DZ, 34, DZ);
  // Rounded front corners.
  W.fill(x0, FLOOR, -DZ, x0, FLOOR + 4, -DZ, 'air');
  W.fill(x0, FLOOR, DZ, x0, FLOOR + 4, DZ, 'air');
  // Front door, side door, back-room door.
  W.fill(x0, FLOOR, -1, x0, FLOOR + 2, 0, 'air');
  W.fill(36, FLOOR, -DZ, 37, FLOOR + 2, -DZ, 'air');
  W.fill(38, FLOOR, DZ, 39, FLOOR + 2, DZ, 'air');
  // The back wall rises past the roof (the east boundary behind the perch).
  W.fill(x1, FLOOR + 5, -DZ, x1, FLOOR + 10, DZ, (_x, y) => (y === FLOOR + 7 ? 'red_concrete' : 'white_concrete'));
  // Roof parapet (gap at the south-east for the outside stairs).
  W.fill(x0, FLOOR + 5, -DZ, x1 - 1, FLOOR + 5, DZ, (x, _y, z) => {
    const edge = x === x0 || z === -DZ || z === DZ;
    if (!edge) return undefined;
    if (z === DZ && x >= 37 && x <= 40) return undefined;
    return 'red_concrete';
  });
  W.set(x0, FLOOR + 5, -DZ, 'air');
  W.set(x0, FLOOR + 5, DZ, 'air');
  // Neon trim round the roof edge.
  W.fill(x0, FLOOR + 4, -DZ + 1, x0, FLOOR + 4, DZ - 1, (_x, _y, z) => (z % 2 === 0 ? 'neon_cyan' : undefined));

  // Interior: partition to the back room.
  W.fill(32, FLOOR, 5, 40, FLOOR + 3, 5, 'white_concrete');
  W.fill(38, FLOOR, 5, 39, FLOOR + 2, 5, 'air');
  // Counter with stools, the kitchen line behind it.
  W.fill(37, FLOOR, -9, 37, FLOOR, 1, 'white_concrete');
  W.fill(37, FLOOR + 1, -9, 37, FLOOR + 1, 1, slab('birch'));
  for (let z = -8; z <= 0; z += 2) W.set(36, FLOOR, z, slab('stone'));
  W.fill(40, FLOOR, -11, 40, FLOOR, 3, (_x, _y, z) => (z % 4 === 0 ? 'iron_block' : 'white_concrete'));
  W.set(40, FLOOR, -6, 'black_concrete');
  W.set(40, FLOOR + 1, -2, 'neon_pink'); // milkshake machine
  // Booths along the front windows.
  const booth = (za: number) => {
    W.fill(32, FLOOR, za, 33, FLOOR + 1, za, 'red_concrete');
    W.fill(32, FLOOR, za + 1, 33, FLOOR, za + 1, slab('birch', true));
    W.fill(32, FLOOR, za + 2, 33, FLOOR + 1, za + 2, 'red_concrete');
    W.set(32, FLOOR + 1, za + 1, 'neon_pink'); // table lamp
  };
  booth(-11);
  booth(2);
  // The red convertible booth.
  W.fill(32, FLOOR, -7, 34, FLOOR, -3, (x, _y, z) => (x === 33 && z > -7 && z < -3 ? 'white_concrete' : 'red_concrete'));
  W.fill(32, FLOOR + 1, -7, 34, FLOOR + 1, -3, (x, _y, z) => {
    if (z === -7) return 'iron_block';
    if (z === -3) return 'red_concrete';
    if (x === 33) return z === -5 ? slab('birch', true) : stairs('birch', z < -5 ? 'north' : 'south');
    return undefined;
  });
  // Jukebox.
  W.set(40, FLOOR, -11, 'neon_pink');
  W.set(40, FLOOR + 1, -11, 'neon_yellow');
  W.set(40, FLOOR + 2, -11, 'neon_cyan');
  // Ceiling lights.
  for (const [x, z] of [[34, -9], [34, -1], [34, 3], [38, -9], [38, -3], [38, 1], [36, 9]]) W.set(x, FLOOR + 4, z, 'sea_lantern');
  // Back room: shelves and boxes, the drain stairs come up here.
  W.fill(40, FLOOR, 7, 40, FLOOR + 2, 11, 'bookshelf');
  W.fill(37, FLOOR, 11, 38, FLOOR + 1, 11, 'spruce_planks');
  W.set(36, FLOOR, 11, 'oak_planks');

  // Outside stairs up to the roof, along the south wall, climbing east.
  for (let i = 0; i < 5; i++) {
    const x = 32 + i;
    W.fill(x, FLOOR, DZ + 1, x, FLOOR + i, DZ + 2, (_xx, y) => (y === FLOOR + i ? stairs('stone_brick', 'east') : 'white_concrete'));
    W.set(x, FLOOR + i + 1, DZ + 3, slab('stone'));
  }
  // Landing on posts over the back door.
  W.fill(37, FLOOR + 4, DZ + 1, 40, FLOOR + 4, DZ + 2, 'white_concrete');
  W.fill(37, FLOOR + 5, DZ + 3, 40, FLOOR + 5, DZ + 3, 'red_concrete');
  W.fill(40, FLOOR, DZ + 2, 40, FLOOR + 3, DZ + 2, 'iron_block');
  // Rooftop cover: AC units.
  W.fill(38, FLOOR + 5, -8, 39, FLOOR + 5, -7, 'iron_block');
  W.fill(38, FLOOR + 5, 3, 39, FLOOR + 5, 4, 'iron_block');
  W.set(35, FLOOR + 5, -3, 'light_gray_concrete');

  // The sign: a board on posts along the front edge (a slot to shoot through underneath),
  // SLIMS in red neon, and a jackrabbit on top.
  for (const z of [-11, -4, 4, 11]) W.fill(x0, FLOOR + 6, z, x0, FLOOR + 7, z, 'iron_block');
  const boardY = FLOOR + 8;
  W.fill(x0, boardY, -13, x0, boardY + 8, 13, (_x, y, z) =>
    y === boardY || y === boardY + 8 || z === -13 || z === 13 ? ((y + z) % 2 === 0 ? 'neon_yellow' : 'black_concrete') : 'black_concrete',
  );
  const letters = layout('SLIMS', FONT7);
  const lw = letters[0].length;
  sprite(letters, { X: 'neon_red' }, (u, v) => ({ x: x0, y: boardY + 1 + v, z: -Math.floor(lw / 2) + u }));
  const RABBIT = [
    '..X..X....',
    '.XX.XX....',
    '.XX.XX....',
    '.XXXXX....',
    'XKXXXXX...',
    '.XXXXXXX..',
    '..XXXXXXX.',
    '..XXXXXXXX',
    '.XX.XXXXXX',
    'XX..XXXXX.',
  ];
  // A sitting jackrabbit on the board's north end, looking up the street.
  sprite(RABBIT, { X: 'neon_cyan', K: 'black_concrete' }, (u, v) => ({ x: x0, y: boardY + 9 + v, z: -13 + u }));
  // Back of the sign.
  W.fill(x0 + 1, boardY, -13, x0 + 1, boardY + 8, 13, 'black_concrete');
}

// ---------------------------------------------------------------------------------------------
// The storm drain
// ---------------------------------------------------------------------------------------------

/** A drain segment: an axis-aligned run of air (3 tall) in white concrete with a cyan kick stripe. */
function drain(x0: number, z0: number, x1: number, z1: number, height = 3) {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)];
  const top = DRAIN_FEET + height;
  W.fill(xa - 1, DRAIN_FLOOR, za - 1, xb + 1, top, zb + 1, (x, y, z) => {
    const inside = x >= xa && x <= xb && z >= za && z <= zb;
    const cur = bp.get(x, y, z);
    if (inside && y > DRAIN_FLOOR && y < top) return 'air';
    if (inside && y === DRAIN_FLOOR) return 'light_gray_concrete';
    if (inside && y === top) return 'white_concrete';
    // Keep what's already there when it's air (an adjoining segment).
    if (cur === 'air') return undefined;
    if (y === DRAIN_FEET) return 'cyan_concrete';
    return 'white_concrete';
  });
}

/** Chamfer the top corners of a straight drain run (along x or z) with upper slabs. */
function haunches(x0: number, z0: number, x1: number, z1: number) {
  const alongX = z0 === z1 ? true : x0 === x1 ? false : Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const y = DRAIN_CEIL - 1;
  if (alongX) {
    const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)];
    W.fill(xa, y, za, xb, y, za, slab('stone', true));
    W.fill(xa, y, zb, xb, y, zb, slab('stone', true));
  } else {
    const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)];
    W.fill(xa, y, za, xa, y, zb, slab('stone', true));
    W.fill(xb, y, za, xb, y, zb, slab('stone', true));
  }
}

function drainLights(x0: number, z0: number, x1: number, z1: number, every = 4) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const dx = Math.sign(x1 - x0);
  const dz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) bp.set(x0 + dx * i, DRAIN_CEIL, z0 + dz * i, i % every === 0 ? 'sea_lantern' : i % every === every / 2 ? 'neon_yellow' : 'white_concrete');
}

function stormDrain() {
  // North-south run between the garages.
  drain(DX0, -15, DX1, 15);
  // Branch east under the street centre to the diner.
  drain(DX1 + 1, -1, 34, 1);
  drain(32, 2, 34, 4);
  // A chamber under the cul-de-sac.
  drain(14, -3, 20, 3, 4);
  // Walls between junctions were written as concrete by later segments: reopen them.
  W.fill(DX1 + 1, DRAIN_FEET, -1, DX1 + 1, DRAIN_FEET + 2, 1, 'air');
  W.fill(32, DRAIN_FEET, 1, 34, DRAIN_FEET + 2, 2, 'air');
  W.fill(13, DRAIN_FEET, -1, 13, DRAIN_FEET + 2, 1, 'air');
  W.fill(21, DRAIN_FEET, -1, 21, DRAIN_FEET + 2, 1, 'air');
  // Its pillar (cover), banded in neon.
  W.fill(17, DRAIN_FEET, 0, 17, DRAIN_FEET + 3, 0, 'white_concrete');
  W.set(17, DRAIN_FEET + 1, 0, 'neon_pink');
  // Chamfered corners, then lights.
  haunches(DX0, -15, DX1, -3);
  haunches(DX0, 3, DX1, 15);
  haunches(DX1 + 3, -1, 12, 1);
  haunches(22, -1, 30, 1);
  drainLights(-8, -15, -8, 15);
  drainLights(-4, 0, 12, 0);
  drainLights(22, 0, 31, 0);
  drainLights(33, 2, 33, 4);
  for (const [x, z] of [[15, -2], [19, -2], [15, 2], [19, 2]]) W.set(x, DRAIN_FEET + 4, z, 'sea_lantern');
  // Stairs up into the diner's back room (climbing south).
  for (let i = 0; i < 5; i++) {
    const z = 5 + i;
    const y = DRAIN_FLOOR + 1 + i;
    W.fill(32, DRAIN_FLOOR, z, 34, y, z, (_x, yy) => (yy === y ? stairs('stone_brick', 'south') : 'light_gray_concrete'));
    W.fill(32, y + 1, z, 34, y + 4, z, (_x, yy) => (yy >= FLOOR && z === 5 ? undefined : 'air'));
    W.fill(31, y - 1, z, 31, y + 3, z, (_x, yy) => (yy < FLOOR ? 'light_gray_concrete' : undefined));
    W.fill(35, y - 1, z, 35, y + 3, z, (_x, yy) => (yy < FLOOR ? 'light_gray_concrete' : undefined));
  }
  W.fill(32, DRAIN_FEET + 1, 10, 34, G - 1, 10, 'light_gray_concrete');
  // Railing round the hole in the back room.
  W.fill(35, FLOOR, 6, 35, FLOOR, 9, 'white_concrete');
  W.fill(35, FLOOR + 1, 6, 35, FLOOR + 1, 9, slab('stone'));
  W.set(33, G + 5, 7, 'glowstone');
  W.set(38, G + 5, 8, 'sea_lantern');
}

// ---------------------------------------------------------------------------------------------
// Boundary: the west billboard, hedges, the cul-de-sac's side hedges.
// ---------------------------------------------------------------------------------------------

function billboard() {
  const x = WEST;
  const [za, zb] = [-22, 22];
  const [ya, yb] = [FLOOR, FLOOR + 25];
  // Solid from the ground up (it's the boundary), backed by a second layer.
  W.fill(x - 1, ya, za, x - 1, yb, zb, 'black_concrete');
  // Base: a white plinth with a red stripe.
  W.fill(x, ya, za, x, ya + 2, zb, (_xx, y) => (y === ya + 2 ? 'red_concrete' : 'white_concrete'));
  // The poster: a sunburst behind a giant burger and the words BIG KAHUNA BURGER.
  const cy = FLOOR + 14;
  const u = (z: number) => -z; // viewer's right (looking west) is -z
  W.fill(x, ya + 3, za, x, yb, zb, (_xx, y, z) => {
    if (z === za || z === zb || y === ya + 3 || y === yb) return (y + z) % 2 === 0 ? 'neon_yellow' : 'black_concrete';
    const a = Math.atan2(y - cy, u(z) + 10);
    return Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2 === 0 ? 'yellow_concrete' : 'orange_concrete';
  });
  const BURGER = [
    '....OOOOOOO....',
    '..OOWOOOOOWOO..',
    '.OOOOOOWOOOOOO.',
    'OOWOOOOOOOOWOOO',
    'LLLLLLLLLLLLLLL',
    '.YYYYYYYYYYYYY.',
    'BBBBBBBBBBBBBBB',
    'BBBBBBBBBBBBBBB',
    'LLLLLLLLLLLLLLL',
    '.OOOOOOOOOOOOO.',
    '..OOOOOOOOOOO..',
  ];
  const burger = outlined(BURGER);
  const colors = { O: 'orange_concrete', W: 'white_concrete', L: 'lime_concrete', Y: 'yellow_concrete', B: 'brown_concrete', K: 'black_concrete' };
  // Burger on the left (+z), words on the right.
  sprite(burger, colors, (c, v) => ({ x, y: cy - 6 + v, z: 20 - c }));
  // The words in red on a white panel.
  const px0 = 1;
  const px1 = 21;
  W.fill(x, cy - 10, -px1, x, cy + 7, -px0, (_xx, y, z) => {
    const corner = (z === -px1 || z === -px0) && (y === cy - 10 || y === cy + 7);
    return corner ? undefined : 'white_concrete';
  });
  ['BIG', 'KAHUNA', 'BURGER'].forEach((wd, i) => {
    const rows = layout(wd, FONT);
    const w = rows[0].length;
    const left = px0 + 1 + Math.floor((px1 - px0 - 1 - w) / 2);
    const base = cy + 1 - i * 6;
    sprite(rows, { X: 'red_concrete' }, (c, v) => ({ x, y: base + v, z: -(left + c) }));
  });
}

function boundary() {
  backyardFence(N);
  backyardFence(S);
  // West ends of the backyards and side yards: hedges.
  for (const s of [N, S]) hedge(WEST, NORTH, WEST, -23, 6, s);
  // Cul-de-sac side hedges (tall near the diner, whose roof is a perch).
  for (const s of [N, S]) {
    s.fill(LOT_EAST, FLOOR, -SIDE, EAST, FLOOR + 5, -SIDE, 'oak_leaves');
    s.fill(22, FLOOR + 5, -SIDE, EAST, FLOOR + 9, -SIDE, 'oak_leaves');
    picket(LOT_EAST + 1, -SIDE + 1, 21, -SIDE + 1, s);
    // East end beside the diner.
    s.fill(EAST, FLOOR, -SIDE, EAST, FLOOR + 10, -DZ - 1, 'oak_leaves');
  }
  billboard();
}

// ---------------------------------------------------------------------------------------------
// Street furniture and cover
// ---------------------------------------------------------------------------------------------

function street() {
  kit.foodTruck(bp, -23, FLOOR, -2);
  kit.convertible(bp, 0, FLOOR, 2);
  kit.taxi(bp, -36, FLOOR, -4);
  mailbox(N, -20, -10, 'red_concrete');
  mailbox(S, -20, -10, 'blue_concrete');
  mailbox(N, 12, -13, 'magenta_concrete');
  hydrant(-2, -8);
  hydrant(10, 13);
  hydrant(-36, 8);
  // Palms: front lawns and round the cul-de-sac.
  palm(-30, -11, 10, [1, 0]);
  palm(-30, 11, 11, [1, 0]);
  palm(9, -14, 10, [-1, 0]);
  palm(19, -15, 11, [0, 1]);
  palm(9, 14, 11, [-1, 0]);
  palm(19, 15, 10, [0, -1]);
  // The island: flowers round a stone planter with a little hedge.
  W.fill(CUL.x - 1, FLOOR, CUL.z - 1, CUL.x + 1, FLOOR, CUL.z + 1, (x, _y, z) => (x === CUL.x && z === CUL.z ? 'oak_leaves' : (x + z) % 2 === 0 ? 'poppy' : 'dandelion'));
  W.set(CUL.x, FLOOR + 1, CUL.z, 'oak_leaves');
  // A bus bench and trash cans in the cul-de-sac.
  W.fill(12, FLOOR, 15, 15, FLOOR, 15, stairs('spruce', 'south'));
  W.set(16, FLOOR, 15, 'green_concrete');
  W.set(19, FLOOR, -15, 'green_concrete');
  W.set(20, FLOOR, -15, 'gray_concrete');
  // Road markings: a stop line at the west end.
  W.fill(-37, G, -5, -37, G, 5, 'white_concrete');
}

// ---------------------------------------------------------------------------------------------
// Scenery beyond the fences (unreachable)
// ---------------------------------------------------------------------------------------------

function scenery() {
  // Palms outside the boundary.
  for (const [x, z, h] of [
    [-46, -30, 12], [-47, -8, 14], [-46, 12, 13], [-47, 30, 11], [-20, -42, 13], [-2, -44, 11], [-32, 42, 12],
    [-12, 44, 14], [8, 40, 12], [10, -40, 12], [30, -28, 13], [46, -20, 12], [47, 2, 14], [46, 22, 11], [30, 30, 12],
  ] as [number, number, number][])
    palm(x, z, h, [hash(x, z) < 0.5 ? 1 : -1, 0], G + 1);
  // Neighbour houses past the cul-de-sac hedges.
  const neighbour = (x0: number, z0: number, x1: number, z1: number, wall: BlockRef, trim: BlockRef) => {
    W.fill(x0, FLOOR, z0, x1, FLOOR + 5, z1, (x, y, z) => {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (y === FLOOR + 5) return trim;
      if (!edge) return 'air';
      if (y >= FLOOR + 1 && y <= FLOOR + 2 && (x + z) % 4 < 2) return 'black_concrete';
      return wall;
    });
    W.fill(x0 - 1, FLOOR + 6, z0 - 1, x1 + 1, FLOOR + 6, z1 + 1, 'white_concrete');
  };
  neighbour(8, -32, 20, -22, 'purple_concrete', 'white_concrete');
  neighbour(26, -34, 38, -23, 'orange_concrete', 'white_concrete');
  neighbour(8, 22, 20, 32, 'lime_concrete', 'white_concrete');
  neighbour(26, 23, 38, 34, 'magenta_concrete', 'white_concrete');
}

/**
 * JACK RABBIT in big white letters on the hills to the north (the Hollywood sign), each letter
 * on its own ledge of the slope and propped on posts. The ledges were read off the terrain of
 * the map's seed: letter x, z and the y of its bottom row.
 */
const HILL_LETTERS: [string, number, number, number][] = [
  ['J', -40, -90, 108],
  ['A', -32, -86, 108],
  ['C', -24, -84, 109],
  ['K', -16, -91, 108],
  ['R', 12, -86, 108],
  ['A', 20, -88, 108],
  ['B', 28, -91, 108],
  ['B', 36, -92, 107],
  ['I', 44, -93, 106],
  ['T', 52, -95, 107],
];

function hillSign(): Blueprint {
  const sign = new Blueprint({ x: -44, y: 90, z: -100 }, { x: 106, y: 32, z: 20 });
  for (const [ch, x0, z, y0] of HILL_LETTERS) {
    const rows = FONT[ch];
    rows.forEach((row, r) => {
      [...row].forEach((c, col) => {
        if (c !== 'X') return;
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++) sign.set(x0 + col * 2 + a, y0 + (rows.length - 1 - r) * 2 + b, z, 'white_concrete');
      });
    });
    // Posts behind the letter, down into the hill.
    for (const dx of [1, 4]) sign.fill({ x: x0 + dx, y: y0 - 10, z: z - 1 }, { x: x0 + dx, y: y0 + 6, z: z - 1 }, 'gray_concrete');
  }
  return sign;
}

/** A water tower on the sandy ridge north-east of the diner (ground there is y 83). */
function waterTower(): Blueprint {
  const [cx, cz, base] = [60, -44, 84];
  const t = new Blueprint({ x: cx - 6, y: base - 6, z: cz - 6 }, { x: 13, y: 32, z: 13 });
  // Legs and cross braces.
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) t.fill({ x: cx + dx, y: base - 5, z: cz + dz }, { x: cx + dx, y: base + 12, z: cz + dz }, 'gray_concrete');
  for (const y of [base + 5, base + 10]) {
    t.fill({ x: cx - 3, y, z: cz - 3 }, { x: cx + 3, y, z: cz - 3 }, 'gray_concrete');
    t.fill({ x: cx - 3, y, z: cz + 3 }, { x: cx + 3, y, z: cz + 3 }, 'gray_concrete');
    t.fill({ x: cx - 3, y, z: cz - 3 }, { x: cx - 3, y, z: cz + 3 }, 'gray_concrete');
    t.fill({ x: cx + 3, y, z: cz - 3 }, { x: cx + 3, y, z: cz + 3 }, 'gray_concrete');
  }
  // The tank: white with a pink band and polka dots, a red cone roof.
  t.columns(cx, cz, 4.6, (x, z, d, a) => {
    for (let y = base + 13; y <= base + 19; y++) {
      if (d < 3.6 && y > base + 13) continue;
      const band = y === base + 16;
      const dot = d >= 3.6 && (y === base + 14 || y === base + 18) && Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12) % 2 === 0;
      t.set(x, y, z, band ? 'pink_concrete' : dot ? 'cyan_concrete' : 'white_concrete');
    }
    const roof = base + 20 + Math.floor((4.6 - d) * 0.9);
    for (let y = base + 20; y <= roof; y++) t.set(x, y, z, 'red_concrete');
  });
  t.set(cx, base + 25, cz, 'neon_red');
  return t;
}

function build(): Blueprint {
  ground();
  house(N, {
    wall: 'yellow_concrete',
    trim: 'red_concrete',
    frame: 'white_concrete',
    floor: 'birch_planks',
    upFloor: 'oak_planks',
    checker: ['red_concrete', 'white_concrete'],
    sofa: 'red_concrete',
    rug: ['magenta_concrete', 'yellow_concrete'],
    bed: 'red',
    kidBed: 'blue',
    pitched: true,
  });
  house(S, {
    wall: 'cyan_concrete',
    trim: 'pink_concrete',
    frame: 'white_concrete',
    floor: 'oak_planks',
    upFloor: 'birch_planks',
    checker: ['pink_concrete', 'white_concrete'],
    sofa: 'pink_concrete',
    rug: ['orange_concrete', 'white_concrete'],
    bed: 'yellow',
    kidBed: 'green',
    pitched: false,
  });
  northYard();
  southYard();
  diner();
  stormDrain();
  street();
  boundary();
  scenery();
  return bp;
}

// ---------------------------------------------------------------------------------------------

export const JACKRABBIT: MapSpec = {
  id: 'jackrabbit',
  name: 'Jackrabbit Lane',
  blurb: 'A cul-de-sac with a burger truck in it',
  floorY: FLOOR,
  structures: [build(), hillSign(), waterTower()],
  // The lane is level with the plain; the hills around it are the backdrop: the one the sign's
  // letters stand on, the ridge under the water tower, and a few off in the haze.
  terraform: [
    { x: -22, z: 0, radius: 40, blend: 22, height: G + 0.5 },
    { x: 22, z: 0, radius: 40, blend: 22, height: G + 0.5 },
    // Gentle enough that each step up is grass on top, not a dirt cliff.
    ...HILL_LETTERS.map(([, x0, z, y0]) => ({ x: x0 + 3, z: z - 10, radius: 10, blend: 58, height: y0 - 3.5 })),
    { x: 60, z: -44, radius: 7, blend: 46, height: 83.5 },
    { x: 118, z: 30, radius: 16, blend: 40, height: 84.5 },
    { x: -120, z: 20, radius: 18, blend: 44, height: 88.5 },
    { x: -70, z: 105, radius: 20, blend: 40, height: 82.5 },
    { x: 60, z: 110, radius: 14, blend: 40, height: 79.5 },
  ],
  bounds: { min: { x: WEST, y: DRAIN_FLOOR - 1, z: NORTH }, max: { x: EAST, y: SKY, z: SOUTH } },
  spawns: [
    // Houses: living room and kitchen downstairs, the master bedroom upstairs.
    spawn(-24, FLOOR, -16, -24, 0),
    spawn(-14, FLOOR, -20, -14, 0),
    spawn(-24, UP, -17, -24, 0),
    spawn(-24, FLOOR, 16, -24, 0),
    spawn(-14, FLOOR, 20, -14, 0),
    spawn(-24, UP, 17, -24, 0),
    // Garages.
    spawn(-4, FLOOR, -18, -4, 0),
    spawn(-4, FLOOR, 18, -4, 0),
    // Backyards.
    spawn(-31, FLOOR, -24, -20, -28),
    spawn(-2, FLOOR, -32, -20, -28),
    spawn(-31, FLOOR, 24, -20, 28),
    spawn(-2, FLOOR, 32, -20, 28),
    // West end of the street, and the cul-de-sac's corners.
    spawn(-38, FLOOR, -7, 0, 0),
    spawn(-38, FLOOR, 7, 0, 0),
    spawn(6, FLOOR, -15, CUL.x, 0),
    spawn(6, FLOOR, 15, CUL.x, 0),
    // The diner (main room, back room) and both ends of the drain.
    spawn(35, FLOOR, -10, 20, 0),
    spawn(36, FLOOR, 9, 20, 0),
    spawn(-8, DRAIN_FEET, -12, -8, 0),
    spawn(33, DRAIN_FEET, 0, 0, 0),
  ],
  // Team Deathmatch: the north house and its yard against the south.
  teams: [
    [spawn(-24, FLOOR, -16, -24, 0), spawn(-14, FLOOR, -20, -14, 0), spawn(-24, UP, -17, -24, 0), spawn(-4, FLOOR, -18, -4, 0), spawn(-31, FLOOR, -24, -20, -28), spawn(-2, FLOOR, -32, -20, -28)],
    [spawn(-24, FLOOR, 16, -24, 0), spawn(-14, FLOOR, 20, -14, 0), spawn(-24, UP, 17, -24, 0), spawn(-4, FLOOR, 18, -4, 0), spawn(-31, FLOOR, 24, -20, 28), spawn(-2, FLOOR, 32, -20, 28)],
  ],
  // The Briefcase: the attackers come up the street from the billboard, the defenders hold the
  // diner, and the case goes down on a corner of the cul-de-sac.
  bomb: {
    attack: [spawn(-38, FLOOR, -7, 0, 0), spawn(-38, FLOOR, 7, 0, 0), spawn(-37, FLOOR, 0, 0, 0), spawn(-34, FLOOR, -10, 0, 0), spawn(-34, FLOOR, 10, 0, 0), spawn(-33, FLOOR, 1, 0, 0)],
    defend: [spawn(35, FLOOR, -10, 17, 0), spawn(36, FLOOR, 9, 17, 0), spawn(38, FLOOR, -4, 17, 0), spawn(34, FLOOR, 0, 17, 0), spawn(36, UP, -6, 17, 0), spawn(35, FLOOR, -1, 17, 0)],
    sites: [
      { name: 'A', label: 'the mailbox', at: { x: 14.5, y: FLOOR, z: -14.5 }, radius: 3 },
      { name: 'B', label: 'the bus stop', at: { x: 13.5, y: FLOOR, z: 13.5 }, radius: 3 },
    ],
  },
  // Down the street from the west end, toward the diner (the world's spawn: the home page's view).
  home: { x: -30.5, y: FLOOR + 0.05, z: 0.5, yaw: -Math.PI / 2 },
  overview: { position: { x: -18, y: FLOOR + 40, z: 62 }, target: { x: 2, y: FLOOR + 8, z: -30 } },
  hotspots: [
    { x: -12, y: FLOOR, z: 0 },
    { x: -18, y: FLOOR, z: 3 },
    { x: -18, y: UP, z: -18 },
    { x: -18, y: UP, z: 18 },
    { x: 35, y: FLOOR, z: -4 },
    { x: 36, y: FLOOR + 5, z: 0 },
    { x: 8, y: DRAIN_FEET, z: 0 },
    { x: CUL.x, y: FLOOR, z: 6 },
    { x: -22, y: FLOOR, z: -26 },
    { x: -22, y: FLOOR, z: 26 },
    { x: -8, y: DRAIN_FEET, z: 8 },
    { x: -33, y: FLOOR, z: 0 },
  ],
};
