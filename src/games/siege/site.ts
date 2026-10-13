import { Blueprint } from '@platform';

/** The field's height: gravel and rubble, the war-torn ground everything round the base stands on. */
export const FLOOR = 64;
/** The base sits on a low mound a little above the field: high ground to hold. */
export const BASE = FLOOR + 3;
const B = BASE;
const F = FLOOR;

/**
 * The land: the mound under the base, rubble berms round the edge with lanes between them, a
 * flat-topped hill to the south-east (a ruined lookout stands on it) and a big bomb crater to the
 * north-west. (Heights are the ground's top, in blocks.)
 */
export const TERRAIN = [
  { x: 0, z: 0, radius: 24, blend: 6, height: BASE }, // the mound
  { x: 54, z: -8, radius: 5, blend: 14, height: FLOOR + 9 },
  { x: -48, z: -34, radius: 6, blend: 14, height: FLOOR + 10 },
  { x: -12, z: 56, radius: 5, blend: 14, height: FLOOR + 7 },
  { x: 38, z: 44, radius: 4, blend: 12, height: FLOOR + 6 },
  { x: -56, z: 18, radius: 4, blend: 12, height: FLOOR + 5 },
  { x: 4, z: -58, radius: 5, blend: 14, height: FLOOR + 8 },
  { x: 34, z: -30, radius: 4, blend: 8, height: FLOOR + 9 }, // the lookout hill
  { x: -34, z: 26, radius: 4, blend: 6, height: FLOOR - 4 }, // the bomb crater
];

const at = (x: number, y: number, z: number) => ({ x, y, z });

/** A repeatable roll from three coordinates and a salt (the same on every screen): 0 to 1. */
function rnd(x: number, y: number, z: number, salt = 0): number {
  let a = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1103515245) + Math.imul(salt, 1274126177)) | 0;
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

type Facing = 'north' | 'east' | 'south' | 'west';
/** Stairs climbing toward `f` (north is -z, south +z, east +x). */
const stairs = (m: string, f: Facing) => `${m}_stairs[facing=${f},half=bottom]`;
const slab = (m: string) => `${m}_slab[type=bottom]`;

/**
 * Where a squad can take cover on the field: ruins, wrecks, barricades, and (added as the
 * wreckage is scattered) rubble heaps and shell craters. The hostiles bound from one to the next.
 */
export const COVER: { x: number; z: number }[] = [
  { x: 34.5, z: -6 }, { x: -31.5, z: -16 }, { x: -36.5, z: 9 }, { x: 38, z: 7 }, { x: -1, z: 37 }, { x: -36, z: -13 }, { x: 24, z: -41 },
  { x: 11, z: -36.5 }, { x: -6.5, z: -36 }, { x: 38, z: 17.5 }, { x: -38.5, z: -1 },
  { x: 31, z: 6 }, { x: 34, z: 0 }, { x: -6, z: 31 }, { x: 0, z: 34 }, { x: -31, z: -6 }, { x: -34, z: 0 }, { x: 6, z: -31 }, { x: -6, z: -31 },
];

/** Walls and the like are mixed: mostly one block, some of another, the same way everywhere. */
const mix = (a: string, b: string, p: number, salt: number) => (x: number, y: number, z: number) => (rnd(x, y, z, salt) < p ? b : a);
type Pick = string | ((x: number, y: number, z: number) => string | null);

/** A solid box of blocks (inclusive corners); `block` may choose per cell (null leaves it empty). */
function box(b: Blueprint, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: Pick) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const c = typeof block === 'string' ? block : block(x, y, z);
        if (c) b.set(x, y, z, c);
      }
}

/** A building's walls: the edge of the rectangle from y0 to y1, `block` choosing per cell (null for a doorway, a window, a hole). */
function walls(b: Blueprint, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, block: (x: number, y: number, z: number) => string | null) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
      for (let y = y0; y <= y1; y++) {
        const c = block(x, y, z);
        if (c) b.set(x, y, z, c);
      }
    }
}

// -------------------------------------------------------------------------------------------------
// The base (on the mound): a perimeter wall with four gates and a bastion at each corner, the
// command post at the middle, barracks, a mess hall, an armory, a motor pool, a fuel depot and a
// helipad. Everything's built of full blocks, hollow and enterable, and every block of it can be
// shot to pieces.
// -------------------------------------------------------------------------------------------------

const base = new Blueprint(at(-17, B, -17), at(35, 18, 35));
const concrete = mix('light_gray_concrete', 'stone_bricks', 0.25, 1);
const brick = mix('bricks', 'stone_bricks', 0.3, 2);

// The floor: concrete inside the wall, a darker road through the gates, a painted helipad.
for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) base.set(x, B, z, Math.abs(x) <= 2 || Math.abs(z) <= 2 ? 'gray_concrete' : 'light_gray_concrete');
for (let x = 7; x <= 11; x++)
  for (let z = 7; z <= 11; z++) {
    const edge = x === 7 || x === 11 || z === 7 || z === 11;
    const corner = (x === 7 || x === 11) && (z === 7 || z === 11);
    const h = (x === 8 || x === 10 || z === 9) && x >= 8 && x <= 10 && z >= 8 && z <= 10;
    base.set(x, B, z, corner ? 'glowstone' : edge || h ? 'white_concrete' : 'gray_concrete');
  }

// The perimeter: a concrete wall three blocks high, a gate five wide in the middle of each side, and a
// zig-zag of concrete barriers behind each gate so nothing runs straight through.
for (let i = -11; i <= 11; i++) {
  if (Math.abs(i) <= 2) continue;
  for (const [x, z] of [[14, i], [-14, i], [i, 14], [i, -14]]) for (let y = 1; y <= 3; y++) base.set(x, B + y, z, y === 3 ? 'light_gray_concrete' : mix('gray_concrete', 'stone_bricks', 0.2, 3)(x, y, z));
}
box(base, -1, B + 1, 11, 3, B + 2, 11, 'light_gray_concrete'); // north gate
box(base, -3, B + 1, -11, 1, B + 2, -11, 'light_gray_concrete'); // south gate
box(base, 11, B + 1, -1, 11, B + 2, 3, 'light_gray_concrete'); // east gate
box(base, -11, B + 1, -3, -11, B + 2, 1, 'light_gray_concrete'); // west gate

/** A corner bastion: a hollow 5 x 5 tower with two doors in, firing slits, stairs up inside to a roof with a sandbag parapet and a floodlight. */
function bastion(cx: number, cz: number) {
  const sx = Math.sign(cx);
  const sz = Math.sign(cz);
  for (let x = cx - 2; x <= cx + 2; x++)
    for (let z = cz - 2; z <= cz + 2; z++) {
      base.set(x, B, z, 'gray_concrete');
      const edge = x === cx - 2 || x === cx + 2 || z === cz - 2 || z === cz + 2;
      if (edge) {
        for (let y = 1; y <= 3; y++) {
          const door = y <= 2 && ((x === cx - 2 * sx && z === cz) || (z === cz - 2 * sz && x === cx));
          const slit = y === 3 && (x === cx + 2 * sx || z === cz + 2 * sz) && (x + z) % 2 === 0;
          if (!door && !slit) base.set(x, B + y, z, concrete(x, y, z));
        }
        base.set(x, B + 5, z, 'sandstone'); // the parapet
      }
      // The roof, with a hatch over the stairs.
      if (!(x === cx + sx && Math.abs(z - cz) <= 1)) base.set(x, B + 4, z, 'gray_concrete');
    }
  const f: Facing = sz > 0 ? 'south' : 'north';
  const sxx = cx + sx;
  base.set(sxx, B + 1, cz - sz, stairs('cobblestone', f));
  base.set(sxx, B + 1, cz, 'cobblestone');
  base.set(sxx, B + 2, cz, stairs('cobblestone', f));
  box(base, sxx, B + 1, cz + sz, sxx, B + 2, cz + sz, 'cobblestone');
  base.set(sxx, B + 3, cz + sz, stairs('cobblestone', f));
  base.set(cx + 2 * sx, B + 6, cz + 2 * sz, 'iron_block'); // the floodlight
  base.set(cx + 2 * sx, B + 7, cz + 2 * sz, 'glowstone');
  base.set(cx - sx, B + 1, cz - sz, 'spruce_planks'); // an ammo box
}
for (const [cx, cz] of [[14, 14], [-14, 14], [14, -14], [-14, -14]]) bastion(cx, cz);

/**
 * The command post, at the middle of the base: concrete walls with a door each end and firing
 * slits, a map table, shelves, a radio set and cots inside, a sandbagged roof with a radio mast and a
 * dish, stairs up to it. The VIP is kept in here.
 */
(() => {
  walls(base, -5, -4, 5, 4, B + 1, B + 4, (x, y, z) => {
    const dy = y - B;
    const door = dy <= 3 && (x === 0 || x === 1) && (z === -4 || z === 4);
    const slit = dy === 3 && (z === -4 || z === 4 ? x % 2 === 0 && x !== 0 && x !== 1 : z % 2 === 0);
    return door || slit ? null : concrete(x, y, z);
  });
  box(base, -5, B + 5, -4, 5, B + 5, 4, (x, _y, z) => (x === 4 && z >= -2 && z <= 1 ? null : 'gray_concrete')); // the roof, a hatch over the stairs
  walls(base, -5, -4, 5, 4, B + 6, B + 6, () => 'sandstone'); // the sandbag parapet
  // The stairs up to the roof, along the east wall inside.
  base.set(4, B + 1, -2, stairs('cobblestone', 'south'));
  base.set(4, B + 1, -1, 'cobblestone');
  base.set(4, B + 2, -1, stairs('cobblestone', 'south'));
  box(base, 4, B + 1, 0, 4, B + 2, 0, 'cobblestone');
  base.set(4, B + 3, 0, stairs('cobblestone', 'south'));
  box(base, 4, B + 1, 1, 4, B + 3, 1, 'cobblestone');
  base.set(4, B + 4, 1, stairs('cobblestone', 'south'));
  // Inside: a map table with a radio on it, shelves of files, cots, crates.
  box(base, -3, B + 1, -1, -1, B + 1, 0, 'spruce_planks');
  base.set(-2, B + 2, -1, 'iron_block');
  base.set(-1, B + 2, 0, 'neon_cyan');
  box(base, -4, B + 1, -2, -4, B + 2, 2, 'bookshelf');
  base.set(2, B + 1, 3, 'red_bed[facing=east,part=foot]');
  base.set(3, B + 1, 3, 'red_bed[facing=east,part=head]');
  base.set(2, B + 1, -3, 'blue_bed[facing=east,part=foot]');
  base.set(3, B + 1, -3, 'blue_bed[facing=east,part=head]');
  box(base, -2, B + 1, 3, -1, B + 1, 3, 'spruce_planks');
  // On the roof: the floodlights at the corners, the radio mast with its cross bars, a satellite dish.
  for (const [x, z] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) {
    base.set(x, B + 7, z, 'iron_block');
    base.set(x, B + 8, z, 'glowstone');
  }
  box(base, -3, B + 6, 0, -3, B + 15, 0, 'iron_block');
  for (const y of [B + 10, B + 13]) box(base, -4, y, 0, -2, y, 0, 'iron_block');
  box(base, 2, B + 6, 1, 2, B + 7, 1, 'iron_block');
  box(base, 1, B + 8, 0, 3, B + 8, 2, 'white_concrete');
  base.set(2, B + 8, 1, 'iron_block');
})();

/** A long low hut with a door on the side toward the base, windows, bunks inside and a plank roof. `door`: the side the door's on. */
function barracks(x0: number, z0: number, x1: number, z1: number, door: 'east' | 'west') {
  walls(base, x0, z0, x1, z1, B + 1, B + 3, (x, y, z) => {
    const dy = y - B;
    const zc = Math.floor((z0 + z1) / 2);
    const isDoor = dy <= 2 && ((door === 'east' && x === x1) || (door === 'west' && x === x0)) && (z === zc || z === zc + 1);
    const window = dy === 2 && (z === z0 || z === z1) && x % 2 === 0;
    return isDoor || window ? null : brick(x, y, z);
  });
  box(base, x0, B + 4, z0, x1, B + 4, z1, 'spruce_planks');
  const bunkX = door === 'east' ? x0 + 1 : x1 - 1;
  for (let z = z0 + 1; z + 1 <= z1 - 1; z += 3) {
    base.set(bunkX, B + 1, z, 'blue_bed[facing=south,part=foot]');
    base.set(bunkX, B + 1, z + 1, 'blue_bed[facing=south,part=head]');
  }
}
barracks(-13, 3, -10, 8, 'east');
barracks(10, -8, 13, -3, 'west');

/** A hut with a door toward the base (the south side, z0, or the north, z1), windows and a plank roof. */
function hutOf(x0: number, z0: number, x1: number, z1: number, material: string, roof: string, doorX: number, doorOn: 'z0' | 'z1') {
  walls(base, x0, z0, x1, z1, B + 1, B + 3, (x, y, z) => {
    const dy = y - B;
    const isDoor = dy <= 2 && (x === doorX || x === doorX + 1) && z === (doorOn === 'z0' ? z0 : z1);
    const window = dy === 2 && (x === x0 || x === x1) && z % 2 === 0;
    return isDoor || window ? null : material;
  });
  box(base, x0, B + 4, z0, x1, B + 4, z1, roof);
}
// The mess hall: tables with benches.
hutOf(-8, 10, -3, 13, 'spruce_planks', 'oak_planks', -6, 'z0');
box(base, -7, B + 1, 12, -4, B + 1, 12, slab('spruce'));
box(base, -7, B + 1, 13 - 1, -7, B + 1, 12, slab('oak'));
// The armory: a crate and weapon racks at the back.
hutOf(3, 10, 6, 13, 'gray_concrete', 'light_gray_concrete', 4, 'z0');
box(base, 5, B + 1, 12, 5, B + 2, 12, 'iron_block');
base.set(4, B + 1, 12, 'spruce_planks');

/** The motor pool: a garage open to the north, a jeep at its door and a van inside. */
walls(base, -12, -13, -5, -9, B + 1, B + 3, (x, y, z) => {
  if (z === -9) return null; // open to the north
  if (y - B === 3 && z === -13 && x % 2 === 0) return null; // vents in the back wall
  return concrete(x, y, z);
});
box(base, -12, B + 4, -13, -5, B + 4, -9, 'gray_concrete');
for (const [x, z] of [[-11, -12], [-11, -10], [-9, -12], [-9, -10]]) base.set(x, B + 1, z, 'black_concrete'); // the van: wheels, body, canvas top
box(base, -11, B + 2, -12, -9, B + 2, -10, 'gray_concrete');
box(base, -11, B + 3, -12, -9, B + 3, -12, 'green_concrete');
box(base, -11, B + 3, -10, -9, B + 3, -10, 'green_concrete');
box(base, -11, B + 4, -12, -9, B + 4, -10, 'green_wool');
for (const [x, z] of [[-8, -10], [-8, -9], [-6, -10], [-6, -9]]) base.set(x, B + 1, z, 'black_concrete'); // the jeep: wheels, body, hood, windscreen frame
box(base, -8, B + 2, -10, -6, B + 2, -9, 'green_concrete');
box(base, -7, B + 3, -10, -6, B + 3, -9, 'green_concrete');
base.set(-8, B + 3, -10, 'black_concrete');

/** The fuel depot: two big tanks inside a low sandbag berm. */
for (const tx of [6, 9]) {
  for (let x = tx; x <= tx + 2; x++)
    for (let z = -13; z <= -11; z++) {
      const corner = (x === tx || x === tx + 2) && (z === -13 || z === -11);
      for (let y = 1; y <= 3; y++) if (!(corner && y === 3)) base.set(x, B + y, z, (x + y) % 3 === 0 ? 'gray_concrete' : 'iron_block');
      if (!corner) base.set(x, B + 4, z, 'iron_block');
    }
  base.set(tx + 1, B + 5, -12, 'red_concrete');
}
box(base, 5, B + 1, -10, 12, B + 1, -10, 'sandstone');
box(base, 5, B + 1, -13, 5, B + 1, -11, 'sandstone');
box(base, 12, B + 1, -13, 12, B + 1, -11, 'sandstone');

// The inner gates: a sandbag wall just inside each of the four gates of the team's wall ring, a few burning drums.
box(base, 7, B + 1, -2, 7, B + 1, 3, 'sandstone');
box(base, -2, B + 1, 7, 3, B + 1, 7, 'sandstone');
box(base, -2, B + 1, -7, 3, B + 1, -7, 'sandstone');
box(base, -7, B + 1, -3, -7, B + 1, 0, 'sandstone');
for (const [x, z] of [[-3, 6], [2, -6], [11, 5], [-11, -5], [6, 11]]) {
  box(base, x, B + 1, z, x, B + 2, z, 'red_concrete');
  base.set(x, B + 3, z, 'glowstone');
}

/** The quartermaster's hut, just west of the command post: three stone-brick walls and a plank roof, its open front toward the gate. */
const hut = new Blueprint(at(-8, B + 1, 1), at(3, 4, 4))
  .fill(at(-8, B + 1, 1), at(-8, B + 2, 4), 'stone_bricks')
  .fill(at(-7, B + 1, 1), at(-6, B + 2, 1), 'stone_bricks')
  .fill(at(-7, B + 1, 4), at(-6, B + 2, 4), 'stone_bricks')
  .fill(at(-8, B + 3, 1), at(-6, B + 3, 4), 'oak_planks');

// -------------------------------------------------------------------------------------------------
// The field: ruins
// -------------------------------------------------------------------------------------------------

/**
 * A shot-up building: brick and concrete walls full of holes, a doorway blown out of the south
 * wall, a corner of the top floor gone, floors with gaps in them; with a rubble ramp against the
 * west wall up to a gap in the second floor if `ramp`. `ground` is the top block it stands on.
 */
function ruinedBuilding(o: { x0: number; z0: number; w: number; d: number; floors: number; ground: number; ramp?: boolean; roof?: string }) {
  const { x0, z0, w, d, floors, ground } = o;
  const bp = new Blueprint(at(x0 - 4, ground + 1, z0), at(w + 4, floors * 4 + 1, d));
  const wall = (x: number, y: number, z: number) => (rnd(x, y, z, 1) < 0.55 ? 'bricks' : 'light_gray_concrete');
  for (let x = x0; x < x0 + w; x++) {
    for (let z = z0; z < z0 + d; z++) {
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      const corner = x >= x0 + w - 3 && z >= z0 + d - 3;
      for (let k = 1; k <= floors; k++) {
        const top = k === floors;
        if (!(top && corner) && rnd(x, ground + 4 * k, z, 2) > (top ? 0.3 : 0.12)) bp.set(x, ground + 4 * k, z, top ? o.roof ?? 'gray_concrete' : 'gray_concrete');
      }
      if (!edge) continue;
      for (let y = ground + 1; y <= ground + 4 * floors - 1; y++) {
        if ((y - ground) % 4 === 0) continue; // a floor slab
        const storey = Math.floor((y - ground - 1) / 4);
        const collapsed = corner && storey === floors - 1 && floors > 1;
        const breach = z === z0 && x >= x0 + 3 && x <= x0 + 5 && y <= ground + 3;
        const window = rnd(x, y, z, 3) < 0.18 || ((y - ground) % 4 === 2 && (x + z) % 3 === 0);
        if (!collapsed && !breach && !window) bp.set(x, y, z, wall(x, y, z));
      }
    }
  }
  if (o.ramp) {
    for (let s = 0; s < 4; s++) for (const z of [z0 + 3, z0 + 4]) bp.fill(at(x0 - 4 + s, ground + 1, z), at(x0 - 4 + s, ground + 1 + s, z), 'cobblestone');
    for (const z of [z0 + 3, z0 + 4]) {
      bp.set(x0, ground + 4, z, 'gray_concrete');
      for (const y of [ground + 5, ground + 6]) bp.set(x0, y, z, 'air');
    }
  }
  return bp;
}
const apartment = ruinedBuilding({ x0: 34, z0: 14, w: 9, d: 8, floors: 2, ground: F, ramp: true });
const house = ruinedBuilding({ x0: -41, z0: -4, w: 6, d: 6, floors: 1, ground: F, roof: 'spruce_planks' });
const lookout = ruinedBuilding({ x0: 32, z0: -32, w: 5, d: 5, floors: 1, ground: F + 9 });

/** Columns of a ruined wall, `heights` tall one after another from (x, z) along +x (or +z), broken and uneven. */
function ruin(x: number, z: number, along: 'x' | 'z', heights: number[], bp: Blueprint) {
  heights.forEach((h, i) => {
    const cx = along === 'x' ? x + i : x;
    const cz = along === 'z' ? z + i : z;
    bp.fill(at(cx, F + 1, cz), at(cx, F + h, cz), i % 3 === 1 ? 'cobblestone' : 'stone_bricks');
  });
}
/** Two broken stone walls out on the field: cover for whoever's using it. */
const wallA = new Blueprint(at(32, F + 1, -8), at(6, 4, 5));
ruin(32, -8, 'x', [3, 3, 2, 3, 1, 2], wallA);
ruin(32, -7, 'z', [2, 1, 2, 3], wallA);
const wallB = new Blueprint(at(-34, F + 1, -18), at(6, 4, 5));
ruin(-34, -14, 'x', [2, 3, 3, 1, 2, 3], wallB);
ruin(-29, -18, 'z', [2, 1, 2, 3], wallB);

// -------------------------------------------------------------------------------------------------
// The field: wrecks (burnt out, hollow where you could get in), barricades, skyline
// -------------------------------------------------------------------------------------------------

const soot = (a: string, salt: number) => (x: number, y: number, z: number) => (rnd(x, y, z, salt) < 0.3 ? 'black_concrete' : a);

/** A burnt-out army lorry on the west lane, nose toward +x: wheels, a cargo bed with the ribs of its canvas, a hollow cab with a seat. */
const truck = new Blueprint(at(-40, F + 1, 8), at(8, 5, 3));
for (const [x, z] of [[-39, 8], [-39, 10], [-35, 8], [-35, 10], [-34, 8], [-34, 10]]) truck.set(x, F + 1, z, 'black_concrete');
box(truck, -40, F + 2, 8, -33, F + 2, 10, 'black_concrete'); // the frame
for (const z of [8, 10]) box(truck, -40, F + 3, z, -36, F + 3, z, (x, y, zz) => (rnd(x, y, zz, 80) < 0.7 ? 'gray_concrete' : null)); // the bed's sides
truck.set(-40, F + 3, 9, 'gray_concrete');
for (const x of [-39, -37]) box(truck, x, F + 4, 8, x, F + 4, 10, (xx, y, z) => (rnd(xx, y, z, 81) < 0.6 ? 'black_concrete' : null)); // canvas ribs
walls(truck, -35, 8, -33, 10, F + 3, F + 4, (x, y, z) => ((x === -33 && y === F + 4) || (z === 8 && x === -34 && y === F + 3) ? null : soot('gray_concrete', 82)(x, y, z)));
box(truck, -35, F + 5, 8, -33, F + 5, 10, 'black_concrete'); // the cab roof
truck.set(-34, F + 3, 9, 'black_concrete'); // the seat

/** Burnt-out cars: wheels, a body, a cabin with the windows gone. */
function car(x0: number, z0: number) {
  const c = new Blueprint(at(x0, F + 1, z0), at(5, 4, 3));
  for (const [x, z] of [[x0, z0], [x0, z0 + 2], [x0 + 4, z0], [x0 + 4, z0 + 2]]) c.set(x, F + 1, z, 'black_concrete');
  box(c, x0, F + 2, z0, x0 + 4, F + 2, z0 + 2, soot('gray_concrete', 83));
  walls(c, x0 + 1, z0, x0 + 3, z0 + 2, F + 3, F + 3, (x, _y, z) => (z !== z0 + 1 && x === x0 + 2 ? null : 'gray_concrete'));
  box(c, x0 + 1, F + 4, z0, x0 + 3, F + 4, z0 + 2, 'gray_concrete');
  return c;
}
const cars = [car(36, 6), car(-3, 36), car(-38, -14), car(22, -42)];

/** A gutted school bus, nose toward +x: a hollow shell you can walk through, the windows blown out, a bench seat or two inside. */
const bus = new Blueprint(at(6, F + 1, -38), at(11, 5, 4));
walls(bus, 6, -38, 16, -35, F + 1, F + 4, (x, y, z) => {
  const window = y === F + 3 && (z === -38 || z === -35) && x % 2 === 0 && x > 6 && x < 16;
  const door = x === 16 && z === -36 && y <= F + 2;
  const ripped = y === F + 4 && rnd(x, y, z, 84) < 0.25;
  return window || door || ripped ? null : y === F + 1 ? 'black_concrete' : rnd(x, y, z, 85) < 0.5 ? 'orange_concrete' : 'black_concrete';
});
box(bus, 7, F + 4, -37, 15, F + 4, -36, (x, y, z) => (rnd(x, y, z, 86) < 0.2 ? null : 'gray_concrete')); // the roof
for (let x = 8; x <= 14; x += 3) bus.set(x, F + 1, -37, 'black_concrete'); // seats

/** A crashed helicopter on the south lane: skids, a hollow cabin with a door and a hole torn in its side, a nose with the glass gone, a snapped tail boom and a bent rotor. */
const heli = new Blueprint(at(-14, F + 1, -44), at(18, 8, 13));
for (const x of [-9, -6]) box(heli, x, F + 1, -37, x, F + 1, -33, 'black_concrete'); // the skids
box(heli, -9, F + 2, -37, -6, F + 2, -33, 'gray_concrete'); // the floor
walls(heli, -9, -37, -6, -33, F + 3, F + 4, (x, y, z) => {
  const door = x === -9 && z >= -36 && z <= -35;
  const torn = x === -6 && z >= -36 && z <= -34 && rnd(x, y, z, 87) < 0.8;
  return door || torn ? null : soot('gray_concrete', 88)(x, y, z);
});
box(heli, -9, F + 5, -37, -6, F + 5, -33, (x, y, z) => (rnd(x, y, z, 89) < 0.2 ? null : 'gray_concrete')); // the roof
box(heli, -8, F + 3, -32, -7, F + 3, -32, 'gray_concrete'); // the nose, its glass gone
box(heli, -8, F + 4, -43, -8, F + 4, -38, 'gray_concrete'); // the tail boom, snapped
box(heli, -8, F + 5, -43, -8, F + 6, -43, 'gray_concrete'); // its fin
box(heli, -9, F + 6, -41, -7, F + 6, -41, 'gray_concrete'); // the stabiliser
box(heli, -8, F + 6, -35, -8, F + 7, -35, 'iron_block'); // the rotor mast
for (let x = -13; x <= -2; x++) heli.set(x, F + 8 - (x < -10 || x > -4 ? 1 : 0), -35, 'black_concrete'); // the blades, drooping

/** Jersey barriers across the lanes, staggered so the road is a chicane. */
const barricades = new Blueprint(at(-40, F + 1, -40), at(81, 2, 81));
for (const [x0, z0, x1, z1] of [[31, 4, 31, 8], [34, -2, 34, 2], [-8, 31, -4, 31], [-2, 34, 2, 34], [-31, -8, -31, -4], [-34, -2, -34, 2], [4, -31, 8, -31], [-8, -31, -4, -31]]) box(barricades, x0, F + 1, z0, x1, F + 2, z1, 'light_gray_concrete');

/** A hollow ruined tower on the skyline: walls full of windows and gaps, floors with holes, a ragged top. */
function tower(cx: number, cz: number, w: number, h: number) {
  const x0 = cx - Math.floor(w / 2);
  const z0 = cz - Math.floor(w / 2);
  const bp = new Blueprint(at(x0, F + 1, z0), at(w, h, w));
  for (let x = x0; x < x0 + w; x++) {
    for (let z = z0; z < z0 + w; z++) {
      const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + w - 1;
      const top = edge ? h - Math.floor(rnd(x, 0, z, 4) * 9) : h;
      for (let y = 1; y <= top; y++) {
        if (edge) {
          const window = (y % 6 === 2 || y % 6 === 3) && (x + z) % 3 !== 0;
          if (!window && rnd(x, y, z, 5) > 0.1) bp.set(x, F + y, z, rnd(x, y, z, 6) < 0.5 ? 'gray_concrete' : 'light_gray_concrete');
        } else if (y % 6 === 0 && rnd(x, y, z, 7) > 0.35) bp.set(x, F + y, z, 'gray_concrete');
      }
    }
  }
  return bp;
}
const skyline = [tower(60, 28, 7, 30), tower(-58, -8, 6, 24), tower(24, -70, 7, 34), tower(-30, 62, 6, 26)];

// -------------------------------------------------------------------------------------------------
// The field: wreckage
// -------------------------------------------------------------------------------------------------

/** Rubble heaps, shell craters (a bowl with a scorched rim), charred trees, scorched shrubs and burning oil drums: the same on every screen (a seeded roll), clear of everything else. */
function wreckage() {
  let s = 0x51e6e;
  const roll = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const keepOut = [at(-36, 0, 9), at(38, 0, 17), at(-38, 0, -1), at(34, 0, -30), at(11, 0, -36), at(-6, 0, -36), at(38, 0, 7), at(-1, 0, 37), at(-36, 0, -13), at(24, 0, -41), at(34, 0, -6), at(-31, 0, -16), at(-34, 0, 26)];
  const free = (x: number, z: number) => {
    if (Math.hypot(x, z) < 31 || Math.hypot(x, z) > 48) return false;
    if (TERRAIN.some((t) => Math.hypot(x - t.x, z - t.z) < t.radius + t.blend + 3)) return false;
    return !keepOut.some((k) => Math.hypot(x - k.x, z - k.z) < 9);
  };
  const spot = () => {
    for (let i = 0; i < 80; i++) {
      const x = Math.round((roll() * 2 - 1) * 48);
      const z = Math.round((roll() * 2 - 1) * 48);
      if (free(x, z)) return { x, z };
    }
    return null;
  };
  const bp = new Blueprint(at(-52, F - 1, -52), at(105, 9, 105));
  const rubble = ['cobblestone', 'stone_bricks', 'bricks', 'andesite', 'gray_concrete', 'light_gray_concrete'];
  for (let i = 0; i < 16; i++) {
    const p = spot();
    if (!p) continue;
    for (let k = 0; k < 5; k++) {
      const x = p.x + Math.round(roll() * 2 - 1);
      const z = p.z + Math.round(roll() * 2 - 1);
      const h = 1 + Math.floor(roll() * 2);
      bp.fill(at(x, F + 1, z), at(x, F + h, z), rubble[Math.floor(roll() * rubble.length)]);
    }
    COVER.push({ x: p.x, z: p.z });
  }
  for (let i = 0; i < 10; i++) {
    const p = spot();
    if (!p) continue;
    bp.columns(p.x, p.z, 5, (x, z, d) => {
      if (d <= 2.6) bp.set(x, F, z, 'air');
      if (d <= 1.6) bp.set(x, F - 1, z, 'air');
      if (d > 2.6 && d <= 4.4 && roll() < 0.8) bp.set(x, F, z, 'deepslate');
    });
    bp.set(p.x + 3, F + 1, p.z + 1, 'cobblestone').set(p.x - 3, F + 1, p.z - 2, 'stone_bricks');
    COVER.push({ x: p.x, z: p.z });
  }
  for (let i = 0; i < 6; i++) {
    const p = spot();
    if (!p) continue;
    const h = 3 + Math.floor(roll() * 3);
    bp.fill(at(p.x, F + 1, p.z), at(p.x, F + h, p.z), 'black_concrete').set(p.x + 1, F + h - 1, p.z, 'black_concrete').set(p.x, F + h - 2, p.z - 1, 'black_concrete');
  }
  for (let i = 0; i < 24; i++) {
    const p = spot();
    if (p) bp.set(p.x, F + 1, p.z, 'dead_bush');
  }
  for (let i = 0; i < 6; i++) {
    const p = spot();
    if (p) bp.fill(at(p.x, F + 1, p.z), at(p.x, F + 2, p.z), 'black_concrete').set(p.x, F + 3, p.z, 'glowstone');
  }
  return bp;
}

/** Everything stamped into the world while it generates. */
export const STRUCTURES = [base, hut, apartment, house, lookout, wallA, wallB, truck, ...cars, bus, heli, barricades, ...skyline, wreckage()];