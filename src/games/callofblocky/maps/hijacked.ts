import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { hash, Place, slab, spawnAt, stairs, type Facing, type Fill, type MapSpec, type SpawnPoint } from './kit';

/**
 * Hijacked: the Gold Watch, a superyacht adrift at sundown 512 blocks west of Jackrabbit Lane,
 * with nothing but sea round it to the haze. She lies along x, her stern to the west, her bow to
 * the east, 125 blocks long and 29 across, over five levels:
 *
 * - **The swim platform** at the waterline behind her stern, the hijackers' speedboat tied up
 *   alongside it; stairs up both sides of the transom to the aft deck.
 * - **The lower deck**, inside the hull: the beach club (its garage door open onto the swim
 *   platform), the engine room, a corridor of cabins to the lobby at the foot of the grand
 *   staircase, the crew mess and the galley stores, the crew stairs, the owner's suite, and the
 *   hold in the bow.
 * - **The main deck**: the aft deck (a lounge under the deck above, sunpads, the transom rail);
 *   the salon, the atrium with the grand staircase (down to the lobby, up to the sky lounge), the
 *   dining room, the foyer and the galley; the side decks down both sides under the deck above;
 *   and the foredeck, the helipad with the owner's helicopter on it, the anchor gear at the bow.
 * - **The upper deck**: the hot tub and the stairs on its aft deck, the sky lounge, the bridge
 *   and its wings, side decks over the ones below (stairs up from them by the bridge).
 * - **The sun deck** on top, under the radar arch.
 *
 * Lanes, stern to bow: the lower deck's corridor, through the salon and the dining room, the two
 * side decks, and over the top. Overboard is the end of you (`sea`). Everything above the
 * waterline can be shot through; the sea and her floors at the waterline can't.
 *
 * The Briefcase: the attackers come aboard at the stern (the speedboat, the swim platform); the
 * defenders hold the foredeck. A: the bridge. B: the crew mess, on the lower deck.
 */

/** Where her middle is in the world: as far west of Jackrabbit Lane as Big Kahuna Burger is east. */
const OX = -512;
/** The lower deck, the beach club and the swim platform: fighters stand here (the map's floor). */
const FLOOR = 64;
/** The sea's surface, and her floors at the waterline. */
const G = FLOOR - 1;
const MAIN = FLOOR + 5;
const UPPER = MAIN + 5;
const SUN = UPPER + 5;
/** Her keel, and the sea's floor under her. */
const KEEL = G - 5;
/** The highest block written (the radar domes): under the Attack Chopper's ceiling. */
const TOP = 83;

// The hull: the transom, where the full beam ends and the bow begins, half the beam.
const STERN = -58;
const MID = 20;
const BEAM = 14;
/** The swim platform's aft edge. */
const PLATFORM = -65;
// The superstructure on the main deck: its aft wall (glass doors onto the aft deck), its forward
// wall (a door onto the foredeck), its side walls (the side decks outside them).
const SX0 = -34;
const SX1 = 20;
const SW = 9;
// The upper deck's floor (over the aft lounge and the side decks too), and its edge.
const UX0 = -49;
const UX1 = 22;
const UW = 13;
// The sky lounge and the bridge on it (the sun deck their roof): aft wall, windscreen, side walls.
const LX0 = -22;
const LX1 = 22;
const LW = 8;

const bp = new Blueprint({ x: OX - 77, y: KEEL, z: -22 }, { x: 144, y: TOP - KEEL + 1, z: 39 });
/** The yacht in her own coordinates (x from her middle): what's built here lands at OX. */
const Y = new Place(bp, OX, 0);
const set = (x: number, y: number, z: number, b: BlockRef) => Y.set(x, y, z, b);
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => Y.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);
/** Both sides at once: z0..z1 to starboard, and the same to port. */
const both = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => {
  for (const s of [1, -1]) fill(x0, y0, z0 * s, x1, y1, z1 * s, b);
};
/** Which way the port side (-z) and the starboard side (+z) face, outward. */
const outward = (s: 1 | -1): Facing => (s > 0 ? 'south' : 'north');
const inward = (s: 1 | -1): Facing => (s > 0 ? 'north' : 'south');

// ---------------------------------------------------------------------------------------------
// The hull's shape
// ---------------------------------------------------------------------------------------------

/** How far forward the stem reaches at height y: raked, further forward the higher. */
const stem = (y: number) => (y >= G ? 54 + (y - G) * 1.6 : 54 - (G - y) * 1.5);

/** Half her width at (x, y) (negative: no hull there): full aft, rounding to the stem, a V under water. */
function half(x: number, y: number): number {
  const s = stem(y);
  if (x < STERN || x > s) return -1;
  let h = BEAM;
  if (x > MID) {
    const t = (x - MID) / (s - MID);
    h = BEAM * Math.pow(Math.max(0, 1 - t * t), 0.62);
  }
  if (x < STERN + 4) h -= (STERN + 4 - x) ** 2 / 8;
  if (y < G) h -= (G - y) * 1.3;
  return h;
}

const inHull = (x: number, y: number, z: number) => Math.abs(z) <= half(x, y);
/** Her skin: in the hull, beside a cell that isn't (or at the keel). */
const skin = (x: number, y: number, z: number) => inHull(x, y, z) && (y === KEEL || !inHull(x + 1, y, z) || !inHull(x - 1, y, z) || !inHull(x, y, z + 1) || !inHull(x, y, z - 1));
/** The outermost cell of the hull on side `s` at (x, y). */
const edge = (x: number, y: number, s: 1 | -1) => s * Math.floor(half(x, y));

function hull() {
  for (let y = KEEL; y <= MAIN - 1; y++)
    for (let x = STERN; x <= 64; x++)
      for (let z = -BEAM; z <= BEAM; z++) {
        if (!inHull(x, y, z)) continue;
        const out = skin(x, y, z);
        let b: BlockRef;
        if (y < G) b = out && y >= G - 2 ? 'white_concrete' : 'gray_concrete';
        else if (y <= FLOOR) b = out ? 'black_concrete' : y === G ? 'spruce_planks' : 'air';
        else if (y < MAIN - 1) b = out ? 'white_concrete' : 'air';
        else b = out ? 'gilt' : 'teak_deck';
        set(x, y, z, b);
      }
  // The bulwarks round the main deck, capped in teak (too high to hop): all but the transom, which has a rail.
  for (let x = STERN + 1; x <= 64; x++)
    for (let z = -BEAM; z <= BEAM; z++) {
      if (!skin(x, MAIN - 1, z)) continue;
      set(x, MAIN, z, 'white_concrete');
      set(x, MAIN + 1, z, slab('teak'));
    }
  fill(STERN, MAIN, -8, STERN, MAIN, 8, 'rail');
  // Portholes along the lower deck (not the engine room, nor where her name is).
  for (let x = STERN + 3; x <= 40; x += 3) {
    if (x > -44 && x < -29) continue;
    for (const s of [1, -1] as const) set(x, FLOOR + 2, edge(x, FLOOR + 2, s), `porthole[facing=${outward(s)}]`);
  }
}

// ---------------------------------------------------------------------------------------------
// The swim platform, and the speedboat alongside
// ---------------------------------------------------------------------------------------------

function swimPlatform() {
  fill(PLATFORM, G, -13, STERN - 1, G, 13, (x, _y, z) => (x <= PLATFORM + 1 && Math.abs(z) > 11 ? undefined : 'teak'));
  // Its edge in white.
  fill(PLATFORM, G, -11, PLATFORM, G, 11, 'white_concrete');
  // The garage door in the transom, open onto the beach club.
  fill(STERN, FLOOR, -5, STERN, FLOOR + 3, 5, 'air');
  fill(STERN, G, -5, STERN, G, 5, 'teak');
  // Lights under the aft deck's edge, either side of the door.
  for (const z of [-7, 7]) set(STERN, FLOOR + 3, z, 'sea_lantern');
}

/** The hijackers' ride: an offshore racer, nose aft, tied up off the port quarter. */
function speedboat() {
  const x0 = -76;
  const x1 = -60;
  const width = (x: number): [number, number] => {
    const k = x - x0;
    if (k === 0) return [-18, -17];
    if (k <= 2) return [-19, -16];
    return [-20, -15];
  };
  for (let x = x0; x <= x1; x++) {
    const [za, zb] = width(x);
    const k = x - x0;
    for (let z = za; z <= zb; z++) {
      const side = z === za || z === zb || x === x0 || x === x1;
      if (k >= 2 && z > za && z < zb) set(x, G - 2, z, 'black_concrete');
      set(x, G - 1, z, 'black_concrete');
      set(x, G, z, side ? 'red_concrete' : k < 6 ? 'white_concrete' : 'teak');
      // The cuddy's deck forward, the gunwales round the cockpit.
      if (k < 6) set(x, FLOOR, z, side ? 'black_concrete' : 'white_concrete');
      else if (side) set(x, FLOOR, z, 'black_concrete');
    }
  }
  // The windscreen, the seats, the engines at the stern.
  fill(x0 + 6, FLOOR + 1, -19, x0 + 6, FLOOR + 1, -16, 'yacht_glass');
  set(x0 + 6, FLOOR, -20, 'black_concrete');
  for (const z of [-19, -18]) set(x0 + 8, FLOOR, z, 'sofa[facing=west]');
  fill(x1 - 1, FLOOR, -19, x1, FLOOR, -16, 'black_concrete');
  fill(x1, FLOOR + 1, -19, x1, FLOOR + 1, -18, 'black_concrete');
  // Tied up: an opening in the starboard gunwale, a gangway across to the platform.
  fill(-64, FLOOR, -15, -63, FLOOR, -15, 'air');
  fill(-64, G, -14, -63, G, -12, 'teak');
  // A duffel bag of loot, a crowbar.
  set(x0 + 10, FLOOR, -17, 'black_wool');
  set(x0 + 11, FLOOR, -17, slab('stone'));
}

// ---------------------------------------------------------------------------------------------
// The lower deck
// ---------------------------------------------------------------------------------------------

/** A wall across the hull at x (inside it, y FLOOR..FLOOR+3), from z0 to z1, with a door (|z| <= door). */
function bulkhead(x: number, z0: number, z1: number, block: BlockRef, door = -1) {
  fill(x, FLOOR, z0, x, FLOOR + 3, z1, (xx, y, z) => (!inHull(xx, y, z) || skin(xx, y, z) ? undefined : Math.abs(z) <= door && y <= FLOOR + 1 ? 'air' : block));
}

function bed(x: number, z: number, facing: Facing, color = 'blue') {
  const [dx, dz] = facing === 'east' ? [1, 0] : facing === 'west' ? [-1, 0] : facing === 'south' ? [0, 1] : [0, -1];
  set(x, FLOOR, z, `${color}_bed[facing=${facing},part=foot]`);
  set(x + dx, FLOOR, z + dz, `${color}_bed[facing=${facing},part=head]`);
}

function lowerDeck() {
  const inside = (x: number, y: number, z: number) => inHull(x, y, z) && !skin(x, y, z);
  const floor = (x0: number, x1: number, z0: number, z1: number, b: Fill) => fill(x0, G, z0, x1, G, z1, (x, y, z) => (inside(x, y, z) ? (typeof b === 'function' ? b(x, y, z) : b) : undefined));

  // ----- The beach club: teak underfoot, a bar, loungers facing the open garage door, a jet ski.
  floor(STERN + 1, -45, -BEAM, BEAM, 'teak');
  bulkhead(-44, -BEAM, BEAM, 'white_concrete', 1);
  fill(-50, FLOOR, 7, -46, FLOOR, 7, 'spruce_planks');
  fill(-50, FLOOR + 1, 7, -46, FLOOR + 1, 7, slab('spruce', false));
  fill(-50, FLOOR, 10, -46, FLOOR, 10, 'spruce_planks');
  fill(-50, FLOOR + 1, 10, -46, FLOOR + 2, 10, (x) => ['neon_pink', 'neon_cyan', 'neon_yellow', 'glass', 'neon_pink'][x + 50]);
  for (const x of [-49, -47]) set(x, FLOOR, 5, slab('oak'));
  for (const z of [-2, 0, 2]) set(-52, FLOOR, z, 'lounger[facing=west]');
  // The jet ski on its trolley.
  fill(-55, FLOOR, -9, -51, FLOOR, -8, (x) => (x === -55 ? 'black_concrete' : 'yellow_concrete'));
  set(-53, FLOOR + 1, -9, 'black_concrete');
  set(-52, FLOOR + 1, -9, 'black_concrete');
  set(-54, FLOOR + 1, -8, 'yellow_concrete');
  // Gym corner: a bench, a rack of weights.
  fill(-47, FLOOR, -9, -46, FLOOR, -9, slab('stone'));
  fill(-47, FLOOR, -11, -45, FLOOR, -11, 'iron_block');
  for (const z of [-6, 6]) set(-44, FLOOR + 2, z, 'sea_lantern');
  for (const [x, z] of [[-54, -4], [-54, 4], [-49, 0]]) set(x, FLOOR + 3, z, 'glowstone');

  // ----- The engine room: tread plate, two big diesels, pipes overhead, the engineer's console.
  floor(-43, -30, -BEAM, BEAM, (x, _y, z) => ((x + z) % 2 === 0 ? 'iron_block' : 'light_gray_concrete'));
  bulkhead(-29, -BEAM, BEAM, 'white_concrete', 1);
  for (const s of [1, -1] as const) {
    fill(-41, FLOOR, 3 * s, -33, FLOOR + 1, 6 * s, (x, y, z) => (y === FLOOR + 1 && (x === -41 || Math.abs(z) === 3) ? 'black_concrete' : y === FLOOR + 1 && x % 3 === 0 ? 'red_concrete' : 'gray_concrete'));
    fill(-40, FLOOR + 2, 4 * s, -34, FLOOR + 2, 5 * s, (x) => (x % 2 === 0 ? 'iron_block' : undefined));
    fill(-42, FLOOR + 3, 8 * s, -30, FLOOR + 3, 8 * s, 'orange_concrete');
  }
  fill(-31, FLOOR, 6, -31, FLOOR, 8, 'black_concrete');
  fill(-31, FLOOR + 1, 6, -31, FLOOR + 1, 8, (_x, _y, z) => (z === 7 ? 'neon_cyan' : 'neon_yellow'));
  for (const [x, z] of [[-40, 0], [-34, 0], [-42, 10], [-32, -10], [-37, 10], [-37, -10]]) set(x, FLOOR + 3, z, 'sea_lantern');

  // ----- The corridor forward to the owner's suite, navy carpet, cabins either side.
  floor(-28, 19, -1, 1, 'blue_wool');
  const cabins: [number, number][] = [[-28, -21], [-19, -14], [-1, 5]];
  for (const s of [1, -1] as const) {
    // Walls along the corridor: none across the lobby (x -12..-3), nor the stair hall (port, x 14..19).
    fill(-28, FLOOR, 2 * s, 19, FLOOR + 3, 2 * s, (x) => ((x >= -12 && x <= -3) || (s < 0 && x >= 14) ? undefined : x % 4 === 0 ? 'birch_planks' : 'white_concrete'));
    for (const x of [-20, -13, -2, 6, 13]) fill(x, FLOOR, 3 * s, x, FLOOR + 3, BEAM * s, (xx, y, z) => (inside(xx, y, z) ? 'white_concrete' : undefined));
    for (const [c0, c1] of cabins) {
      floor(c0, c1, 3 * s, BEAM * s, 'white_wool');
      const door = c0 + 3;
      fill(door, FLOOR, 2 * s, door, FLOOR + 1, 2 * s, 'air');
      bed(c1 - 1, 6 * s, s > 0 ? 'south' : 'north');
      bed(c1 - 2, 6 * s, s > 0 ? 'south' : 'north');
      fill(c0, FLOOR, 7 * s, c0 + 1, FLOOR + 1, 7 * s, 'spruce_planks');
      set(c1, FLOOR, 4 * s, 'spruce_planks');
      set(c1, FLOOR + 1, 4 * s, 'glowstone');
      set(c0 + 3, FLOOR + 3, 6 * s, 'glowstone');
    }
    // Lamps along the corridor.
    for (const x of [-26, -17, 0, 10]) set(x, FLOOR + 2, 2 * s, 'sea_lantern');
  }
  // The lobby at the foot of the grand staircase: marble, a lounge, a fish tank in the port wall.
  floor(-12, -3, -BEAM, BEAM, (x, _y, z) => ((x + z) % 2 === 0 ? 'white_concrete' : 'light_gray_concrete'));
  fill(-10, FLOOR, -6, -6, FLOOR, -6, 'sofa[facing=north]');
  fill(-11, FLOOR, -9, -11, FLOOR, -7, 'sofa[facing=east]');
  fill(-9, FLOOR, -9, -7, FLOOR, -9, slab('spruce', true));
  fill(-10, FLOOR, -13, -5, FLOOR + 2, -11, (x, y, z) => (inside(x, y, z) ? (z === -11 ? 'glass' : y === FLOOR + 2 ? 'sea_lantern' : 'water') : undefined));
  for (const x of [-13, -2]) for (const z of [-5, 5]) set(x, FLOOR + 2, z, 'sea_lantern');
  for (const [x, z] of [[-8, -4], [-5, 9]]) set(x, FLOOR + 3, z, 'glowstone');
  // The crew mess (port): a long table and benches, a TV. The Briefcase's B.
  floor(7, 12, -BEAM, -3, 'light_gray_concrete');
  fill(8, FLOOR, -2, 11, FLOOR + 1, -2, 'air');
  fill(8, FLOOR, -6, 11, FLOOR, -6, 'spruce_planks');
  fill(8, FLOOR, -5, 11, FLOOR, -5, stairs('oak', 'south'));
  fill(8, FLOOR, -8, 11, FLOOR, -8, stairs('oak', 'north'));
  fill(9, FLOOR + 1, -12, 10, FLOOR + 2, -12, (_x, y, z) => (inside(9, y, z) ? 'black_concrete' : undefined));
  set(13, FLOOR + 2, -5, 'sea_lantern');
  set(10, FLOOR + 3, -9, 'glowstone');
  // The galley stores (starboard): shelves of tins, the cold store.
  floor(7, 12, 3, BEAM, 'light_gray_concrete');
  fill(9, FLOOR, 2, 9, FLOOR + 1, 2, 'air');
  fill(7, FLOOR, 6, 11, FLOOR + 1, 6, (x, y) => ((x + y) % 2 === 0 ? 'oak_planks' : 'bookshelf'));
  fill(7, FLOOR, 9, 8, FLOOR + 2, 10, (x, y, z) => (inside(x, y, z) ? 'snow_block' : undefined));
  set(13, FLOOR + 2, 5, 'sea_lantern');
  // The stair hall (port) where the crew stairs come down; a crew cabin (starboard).
  floor(14, 19, -BEAM, -2, 'blue_wool');
  floor(14, 19, 3, BEAM, 'white_wool');
  fill(16, FLOOR, 2, 16, FLOOR + 1, 2, 'air');
  bed(18, 5, 'south', 'green');
  bed(18, 7, 'south', 'green');

  // ----- The owner's suite: dark wood, a double bed facing the bow, a sofa, a desk, the wardrobe.
  bulkhead(20, -BEAM, BEAM, 'spruce_planks', 1);
  floor(21, 36, -BEAM, BEAM, 'spruce_planks');
  bed(32, -1, 'east', 'red');
  bed(32, 0, 'east', 'red');
  set(34, FLOOR, -2, 'spruce_planks');
  set(34, FLOOR + 1, -2, 'glowstone');
  set(34, FLOOR, 1, 'spruce_planks');
  set(34, FLOOR + 1, 1, 'glowstone');
  fill(24, FLOOR, 7, 27, FLOOR, 7, 'sofa[facing=north]');
  fill(24, FLOOR, 4, 27, FLOOR, 4, slab('spruce', true));
  fill(23, FLOOR, -9, 26, FLOOR, -9, 'spruce_planks');
  set(24, FLOOR + 1, -9, 'sea_lantern');
  fill(29, FLOOR, -11, 31, FLOOR + 2, -10, (x, y, z) => (inside(x, y, z) ? 'spruce_planks' : undefined));
  for (const [x, z] of [[22, -6], [22, 6], [30, 8], [28, -6], [35, 6]]) set(x, FLOOR + 3, z, 'glowstone');

  // ----- The hold in the bow: crates of the owner's wine and worse, the anchor chain's locker.
  bulkhead(37, -BEAM, BEAM, 'oak_planks', 1);
  floor(38, 56, -BEAM, BEAM, 'oak_planks');
  for (const [x, z, h] of [[39, -6, 2], [40, -6, 1], [39, 5, 1], [43, 3, 2], [44, 3, 1], [42, -3, 1], [47, -2, 2], [46, 2, 1]] as [number, number, number][])
    fill(x, FLOOR, z, x, FLOOR + h - 1, z, (xx, y, zz) => (inside(xx, y, zz) ? (hash(xx, zz, y) < 0.5 ? 'oak_planks' : 'spruce_planks') : undefined));
  fill(50, FLOOR, -1, 51, FLOOR + 3, 1, (x, y, z) => (inside(x, y, z) ? (z === 0 ? 'gray_concrete' : 'iron_block') : undefined));
  for (const [x, z] of [[40, 0], [46, -3], [43, 5], [52, 0]]) set(x, FLOOR + 3, z, 'glowstone');
}

// ---------------------------------------------------------------------------------------------
// The main deck
// ---------------------------------------------------------------------------------------------

/** Window pillars along the superstructure, and at its corners. */
const pillar = (x: number) => x === SX0 || x === SX1 || (x - SX0) % 6 === 0;

function superstructure() {
  // Floors: the salon in pale oak, the atrium in marble, the dining room dark, the foyer and galley tiled.
  fill(SX0 + 1, MAIN - 1, -SW + 1, SX1 - 1, MAIN - 1, SW - 1, (x, _y, z) => {
    if (x <= -18) return 'birch_planks';
    if (x <= -7) return (x + z) % 2 === 0 ? 'white_concrete' : 'light_gray_concrete';
    if (x <= 6) return 'spruce_planks';
    return (x + z) % 2 === 0 ? 'white_concrete' : 'black_concrete';
  });
  // The side walls: a white sill, glass above it between the pillars, lights in the pillars' tops.
  for (const s of [1, -1] as const)
    fill(SX0, MAIN, SW * s, SX1, MAIN + 3, SW * s, (x, y) => {
      if (pillar(x)) return y === MAIN + 3 && x !== SX0 && x !== SX1 ? 'sea_lantern' : 'white_concrete';
      return y === MAIN ? 'white_concrete' : 'yacht_glass';
    });
  // Sliding doors off the side decks: the salon, the atrium, the dining room, the foyer.
  for (const x of [-31, -13, 0, 11]) both(x, MAIN, SW, x + 1, MAIN + 2, SW, 'air');
  // The aft wall, all glass, double doors in the middle; the forward wall, a door onto the foredeck.
  fill(SX0, MAIN, -SW + 1, SX0, MAIN + 3, SW - 1, (_x, y, z) => (Math.abs(z) === 5 ? 'white_concrete' : Math.abs(z) <= 2 && y < MAIN + 3 ? 'air' : 'yacht_glass'));
  fill(SX1, MAIN, -SW + 1, SX1, MAIN + 3, SW - 1, (_x, y, z) => (Math.abs(z) <= 1 && y < MAIN + 3 ? 'air' : Math.abs(z) >= 3 && Math.abs(z) <= 7 && (y === MAIN + 1 || y === MAIN + 2) ? 'yacht_glass' : 'white_concrete'));

  // ----- The salon: a sofa round a coffee table facing the screen, a grand piano, the island bar.
  fill(-26, MAIN, -8, -24, MAIN, -8, 'white_concrete');
  fill(-26, MAIN + 1, -8, -24, MAIN + 2, -8, 'black_concrete');
  fill(-27, MAIN, -3, -23, MAIN, -3, 'sofa[facing=north]');
  fill(-28, MAIN, -6, -28, MAIN, -4, 'sofa[facing=east]');
  fill(-22, MAIN, -6, -22, MAIN, -4, 'sofa[facing=west]');
  fill(-26, MAIN, -5, -24, MAIN, -5, slab('spruce'));
  fill(-31, MAIN, 4, -30, MAIN, 6, 'black_concrete');
  fill(-31, MAIN + 1, 4, -31, MAIN + 1, 6, slab('stone_brick'));
  set(-29, MAIN, 5, slab('spruce'));
  for (const [x, z] of [[-24, 5], [-24, 3]]) set(x, MAIN, z, 'sofa[facing=west]');
  fill(-20, MAIN, -7, -20, MAIN, -2, 'spruce_planks');
  fill(-20, MAIN + 1, -7, -20, MAIN + 1, -2, slab('spruce'));
  fill(-18, MAIN, -7, -18, MAIN, -2, 'spruce_planks');
  fill(-18, MAIN + 1, -7, -18, MAIN + 1, -2, (_x, _y, z) => ['neon_pink', 'glass', 'neon_cyan', 'neon_yellow', 'glass', 'neon_pink'][z + 7]);
  for (const z of [-7, -5, -3]) set(-21, MAIN, z, slab('oak'));
  set(-27, MAIN + 3, 0, 'glowstone');

  // ----- The atrium: the grand staircase down one side (built later), a gilt statue on its plinth.
  set(-12, MAIN, -4, 'white_concrete');
  fill(-12, MAIN + 1, -4, -12, MAIN + 2, -4, 'gilt');
  fill(-16, MAIN, -8, -15, MAIN, -8, 'sofa[facing=south]');
  fill(-9, MAIN, -8, -8, MAIN, -8, 'sofa[facing=south]');

  // ----- The dining room: a long table, chairs down both sides, chandeliers over it.
  fill(-3, MAIN, -1, 3, MAIN, 1, 'spruce_planks');
  for (let x = -3; x <= 3; x += 2) {
    set(x, MAIN, -2, stairs('spruce', 'north'));
    set(x, MAIN, 2, stairs('spruce', 'south'));
  }
  for (const x of [-2, 2]) set(x, MAIN + 3, 0, 'glowstone');
  for (const s of [1, -1] as const) fill(-5, MAIN, 7 * s, -4, MAIN, 7 * s, 'spruce_planks');
  // The partition to the foyer and the galley: a wide way through.
  fill(7, MAIN, -SW + 1, 7, MAIN + 3, SW - 1, (_x, y, z) => (Math.abs(z) <= 3 ? (y === MAIN + 3 ? 'white_concrete' : 'air') : 'white_concrete'));

  // ----- The galley (starboard): counters along the side, the range, an island.
  fill(14, MAIN, 8, 18, MAIN, 8, (x) => (x === 15 || x === 16 ? 'iron_block' : 'white_concrete'));
  fill(14, MAIN + 1, 8, 18, MAIN + 1, 8, (x) => (x === 15 || x === 16 ? 'black_concrete' : slab('stone')));
  fill(10, MAIN, 4, 15, MAIN, 5, 'white_concrete');
  fill(10, MAIN + 1, 4, 15, MAIN + 1, 5, slab('stone'));
  fill(18, MAIN, 6, 19, MAIN + 2, 7, 'iron_block');
  // ----- The foyer (port): a bench, a rack of life jackets.
  fill(8, MAIN, -8, 10, MAIN, -8, 'sofa[facing=south]');
  fill(19, MAIN, -8, 19, MAIN + 1, -7, 'orange_concrete');
  for (const x of [10, 16]) set(x, MAIN + 3, 3, 'glowstone');
}

function aftDeck() {
  // The pillars holding the deck above over the aft lounge.
  for (const x of [-47, -41]) both(x, MAIN, 11, x, MAIN + 3, 11, 'white_concrete');
  // The aft lounge: a U of sofas round a low table.
  fill(-43, MAIN, -1, -40, MAIN, 1, slab('spruce', true));
  fill(-45, MAIN, -2, -45, MAIN, 2, 'sofa[facing=east]');
  fill(-44, MAIN, -3, -39, MAIN, -3, 'sofa[facing=south]');
  fill(-44, MAIN, 3, -39, MAIN, 3, 'sofa[facing=north]');
  // Sunpads in the sun behind it.
  fill(-56, MAIN, -5, -52, MAIN, 5, (x, _y, z) => (x === -56 && Math.abs(z) % 3 === 1 ? 'light_blue_concrete' : 'white_wool'));
}

function sideDecks() {
  for (const s of [1, -1] as const) {
    // Deck boxes against the bulwark and the superstructure, staggered: cover all the way along.
    for (const [x, z] of [[-24, 13], [-8, 10], [4, 13], [-30, 12]] as [number, number][]) {
      fill(x, MAIN, z * s, x + 1, MAIN, z * s, 'white_concrete');
      fill(x, MAIN + 1, z * s, x + 1, MAIN + 1, z * s, slab('teak'));
    }
    // Lifebuoys on the pillars.
    for (const x of [-28, -4, 8]) set(x, MAIN + 1, (SW + 1) * s, `lifebuoy[facing=${outward(s)}]`);
  }
}

/** The owner's helicopter, nose to the bow, on the helipad: its cabin open both sides. */
function helicopter(cx: number) {
  // Skids.
  both(cx - 3, MAIN, 2, cx + 3, MAIN, 2, slab('stone'));
  // The cabin: a white body with a gold stripe, windows, open doors, the nose.
  fill(cx - 3, MAIN + 1, -1, cx + 3, MAIN + 4, 1, (x, y, z) => {
    if (y === MAIN + 1 || y === MAIN + 4) return x === cx + 3 && y === MAIN + 4 ? undefined : 'white_concrete';
    if (z === 0 && x > cx - 3 && x < cx + 3) return 'air';
    if (y === MAIN + 2) return Math.abs(z) === 1 ? 'yellow_concrete' : 'white_concrete';
    return x === cx - 3 ? 'white_concrete' : 'yacht_glass';
  });
  both(cx - 1, MAIN + 2, 1, cx, MAIN + 3, 1, 'air');
  fill(cx + 4, MAIN + 1, -1, cx + 4, MAIN + 2, 1, (_x, y, z) => (y === MAIN + 2 && z === 0 ? 'yacht_glass' : 'black_concrete'));
  set(cx + 5, MAIN + 1, 0, 'black_concrete');
  fill(cx - 2, MAIN + 2, 0, cx - 2, MAIN + 2, 0, 'sofa[facing=east]');
  // The tail boom, the fin, the tail rotor.
  fill(cx - 9, MAIN + 3, 0, cx - 4, MAIN + 3, 0, 'white_concrete');
  fill(cx - 9, MAIN + 4, 0, cx - 9, MAIN + 5, 0, 'white_concrete');
  set(cx - 9, MAIN + 5, 1, 'black_concrete');
  set(cx - 9, MAIN + 4, -1, 'yellow_concrete');
  // The rotor: its mast and two long blades.
  set(cx, MAIN + 5, 0, 'iron_block');
  fill(cx - 7, MAIN + 5, 0, cx + 7, MAIN + 5, 0, (x) => (x === cx ? 'iron_block' : 'black_concrete'));
  fill(cx, MAIN + 5, -7, cx, MAIN + 5, 7, (_x, _y, z) => (z === 0 ? 'iron_block' : 'black_concrete'));
}

function foredeck() {
  // Deck lockers by the door (port), the tender on its chocks (starboard).
  fill(22, MAIN, -10, 25, MAIN, -8, 'white_concrete');
  fill(22, MAIN + 1, -10, 25, MAIN + 1, -8, slab('teak'));
  for (const x of [23, 27]) fill(x, MAIN, 7, x, MAIN, 8, slab('spruce'));
  fill(22, MAIN + 1, 6, 28, MAIN + 1, 9, (x, _y, z) => (x === 22 || z === 6 || z === 9 ? 'gray_concrete' : 'white_concrete'));
  fill(29, MAIN + 1, 7, 29, MAIN + 2, 8, 'black_concrete');
  // The helipad: a pale disc, a yellow ring, the H.
  const cx = 38;
  for (let z = -8; z <= 8; z++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const r = Math.hypot(x - cx, z);
      if (r > 8.2 || !inHull(x, MAIN - 1, z) || skin(x, MAIN - 1, z)) continue;
      set(x, MAIN - 1, z, r > 6.9 ? 'helipad_line' : 'helipad');
    }
  both(cx - 3, MAIN - 1, 4, cx + 3, MAIN - 1, 4, 'helipad_mark');
  fill(cx, MAIN - 1, -3, cx, MAIN - 1, 3, 'helipad_mark');
  helicopter(cx);
  // The bow: two windlasses, their chains running forward, bollards, the jackstaff at the stem.
  for (const s of [1, -1] as const) {
    fill(50, MAIN, 3 * s, 51, MAIN, 3 * s, 'black_concrete');
    set(50, MAIN + 1, 3 * s, 'iron_block');
    fill(52, MAIN - 1, 2 * s, 58, MAIN - 1, 2 * s, 'gray_concrete');
    set(47, MAIN, 8 * s, 'iron_block');
    set(56, MAIN, 4 * s, 'iron_block');
  }
  fill(61, MAIN, 0, 61, MAIN + 3, 0, 'rail');
  set(61, MAIN + 4, 0, 'neon_red');
}

// ---------------------------------------------------------------------------------------------
// The upper deck, the sky lounge and the bridge
// ---------------------------------------------------------------------------------------------

const glassBay = (x: number) => x === LX0 || x === LX1 || (x - LX0) % 6 === 0;

function upperDeck() {
  // The deck: over the aft lounge, the superstructure and the side decks.
  fill(UX0, UPPER - 1, -UW, UX1, UPPER - 1, UW, 'teak_deck');
  // Its rail: across its aft edge (the stairs come up at its corners), down both sides, and the
  // side decks' forward ends.
  fill(UX0, UPPER, -UW + 2, UX0, UPPER, UW - 2, 'rail');
  both(UX0 + 2, UPPER, UW, UX1, UPPER, UW, 'rail');
  both(UX1, UPPER, LW + 1, UX1, UPPER, UW, 'rail');

  // The sky lounge and the bridge: carpet and wood floors, white walls, glass all round.
  fill(LX0 + 1, UPPER - 1, -LW + 1, LX1 - 1, UPPER - 1, LW - 1, (x) => (x < 8 ? 'white_wool' : 'spruce_planks'));
  for (const s of [1, -1] as const)
    fill(LX0, UPPER, LW * s, LX1, UPPER + 3, LW * s, (x, y) => {
      if (glassBay(x)) return y === UPPER + 3 && x !== LX0 && x !== LX1 ? 'sea_lantern' : 'white_concrete';
      return y === UPPER ? 'white_concrete' : 'yacht_glass';
    });
  fill(LX0, UPPER, -LW + 1, LX0, UPPER + 3, LW - 1, (_x, y, z) => (Math.abs(z) <= 1 && y < UPPER + 3 ? 'air' : Math.abs(z) === 4 || y === UPPER ? 'white_concrete' : 'yacht_glass'));
  fill(LX1, UPPER, -LW + 1, LX1, UPPER + 3, LW - 1, (_x, y) => (y === UPPER ? 'white_concrete' : 'yacht_glass'));
  // Doors: onto the side decks from the sky lounge and from the bridge (its wings).
  for (const x of [-2, 15]) both(x, UPPER, LW, x + 1, UPPER + 2, LW, 'air');
  // The partition between them, a door through it.
  fill(8, UPPER, -LW + 1, 8, UPPER + 3, LW - 1, (_x, y, z) => (Math.abs(z) <= 1 && y < UPPER + 3 ? 'air' : Math.abs(z) >= 3 && Math.abs(z) <= 6 && y > UPPER && y < UPPER + 3 ? 'yacht_glass' : 'white_concrete'));

  // ----- The sky lounge: a bar aft, sofas round a table, a card table, chandeliers.
  fill(-19, UPPER, -6, -19, UPPER, -2, 'black_concrete');
  fill(-19, UPPER + 1, -6, -19, UPPER + 1, -2, slab('stone_brick'));
  fill(-21, UPPER, -6, -21, UPPER + 1, -2, (_x, y, z) => (y === UPPER + 1 && z % 2 === 0 ? 'neon_yellow' : 'spruce_planks'));
  for (const z of [-6, -4, -2]) set(-18, UPPER, z, slab('oak'));
  fill(-6, UPPER, -6, -2, UPPER, -6, 'sofa[facing=south]');
  fill(-7, UPPER, -5, -7, UPPER, -3, 'sofa[facing=east]');
  fill(-5, UPPER, -4, -3, UPPER, -4, slab('spruce', true));
  fill(2, UPPER, 3, 4, UPPER, 4, 'spruce_planks');
  for (const x of [2, 4]) set(x, UPPER, 5, stairs('spruce', 'south'));
  set(3, UPPER, 2, stairs('spruce', 'north'));
  for (const x of [-10, 0]) set(x, UPPER + 3, 0, 'glowstone');

  // ----- The bridge: the helm console under the windscreen, the captain's chairs, the chart table.
  fill(21, UPPER, -6, 21, UPPER, 6, 'black_concrete');
  for (const z of [-5, -3, 3, 5]) set(21, UPPER + 1, z, z < 0 ? 'neon_cyan' : 'neon_yellow');
  for (const z of [-2, 2]) set(19, UPPER, z, 'sofa[facing=east]');
  fill(12, UPPER, -1, 13, UPPER, 1, 'spruce_planks');
  set(12, UPPER + 1, 0, slab('birch'));
  for (const z of [-6, 6]) set(10, UPPER, z, 'spruce_planks');

  // ----- The aft deck up here: the hot tub, loungers, sofas by the sky lounge's doors.
  fill(-42, UPPER, -3, -37, UPPER, 3, (x, _y, z) => (x === -42 || x === -37 || Math.abs(z) === 3 ? 'white_concrete' : 'water'));
  set(-42, UPPER, 0, stairs('teak', 'east'));
  for (const z of [-11, -9, 9, 11]) set(-46, UPPER, z, `lounger[facing=west]`);
  for (const s of [1, -1] as const) fill(-31, UPPER, 9 * s, -29, UPPER, 9 * s, `sofa[facing=${inward(s)}]`);
}

// ---------------------------------------------------------------------------------------------
// The sun deck
// ---------------------------------------------------------------------------------------------

function sunDeck() {
  fill(LX0, SUN - 1, -LW, LX1, SUN - 1, LW, 'teak_deck');
  // Its rail: round the sides and the front, and aft between the stairs' heads.
  both(LX0, SUN, LW, LX1, SUN, LW, 'rail');
  fill(LX1, SUN, -LW + 1, LX1, SUN, LW - 1, 'rail');
  fill(LX0, SUN, -3, LX0, SUN, 3, 'rail');
  both(LX0, SUN, 7, LX0, SUN, 7, 'rail');
  // The radar arch: two legs, the crossbeam, the domes and the masthead light on it.
  both(8, SUN, 7, 9, SUN + 2, 7, 'white_concrete');
  fill(8, SUN + 3, -7, 9, SUN + 3, 7, 'white_concrete');
  both(8, TOP, 3, 9, TOP, 3, 'white_concrete');
  set(8, TOP, 0, 'neon_red');
  // The bar under it, stools, loungers aft, a sofa forward looking over the bow.
  fill(5, SUN, -4, 5, SUN, 4, 'white_concrete');
  fill(5, SUN + 1, -4, 5, SUN + 1, 4, slab('teak'));
  for (const z of [-3, 0, 3]) set(4, SUN, z, slab('oak'));
  for (const z of [-5, -3, 3, 5]) set(-16, SUN, z, 'lounger[facing=west]');
  for (const z of [-5, -3, 3, 5]) set(-12, SUN, z, 'lounger[facing=west]');
  fill(17, SUN, -3, 17, SUN, 3, 'sofa[facing=east]');
}

// ---------------------------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------------------------

/**
 * A flight of teak stairs climbing along x (`dir` +1 east, -1 west) from its first step at x0
 * (its block at y0), z0..z1 wide: five steps up a deck, solid under, cleared over (cutting the
 * hole it comes up through in the deck above).
 */
function flight(x0: number, y0: number, z0: number, z1: number, dir: 1 | -1, base: number, n = 5) {
  for (let i = 0; i < n; i++) {
    const x = x0 + dir * i;
    const y = y0 + i;
    fill(x, base, z0, x, y - 1, z1, 'white_concrete');
    fill(x, y, z0, x, y, z1, stairs('teak', dir > 0 ? 'east' : 'west'));
    fill(x, y + 1, z0, x, y + 3, z1, 'air');
  }
}

function allStairs() {
  // The swim platform up either side of the transom to the aft deck.
  for (const s of [1, -1] as const) flight(-62, FLOOR, 9 * s, 11 * s, 1, FLOOR);
  // The aft deck up its corners to the deck above.
  for (const s of [1, -1] as const) flight(-54, MAIN, 12 * s, 13 * s, 1, MAIN);
  // The grand staircase from the atrium: up (west) to the sky lounge, down (east) to the lobby.
  flight(-13, MAIN, 5, 7, -1, MAIN);
  flight(-7, FLOOR, 5, 7, -1, FLOOR);
  fill(-10, MAIN, 4, -8, MAIN, 4, 'rail');
  fill(-7, MAIN, 5, -7, MAIN, 7, 'rail');
  fill(-16, UPPER, 4, -14, UPPER, 4, 'rail');
  fill(-13, UPPER, 5, -13, UPPER, 7, 'rail');
  // The crew stairs, from the foyer down to the stair hall.
  flight(18, FLOOR, -7, -5, -1, FLOOR);
  fill(15, MAIN, -4, 17, MAIN, -4, 'rail');
  fill(18, MAIN, -7, 18, MAIN, -5, 'rail');
  // Up from the side decks by the bridge to the side decks above.
  for (const s of [1, -1] as const) {
    flight(14, MAIN, 10 * s, 11 * s, 1, MAIN);
    fill(14, UPPER, 10 * s, 14, UPPER, 11 * s, 'rail');
  }
  // From the deck's aft deck up to the sun deck.
  for (const s of [1, -1] as const) flight(-27, UPPER, 4 * s, 6 * s, 1, UPPER);
}

// ---------------------------------------------------------------------------------------------

/** The sea: open water to the haze all round her (the plain's ground under it, dark). */
function sea(): Blueprint {
  const R = 240;
  const RZ = 200;
  const b = new Blueprint({ x: OX - R, y: KEEL - 1, z: -RZ }, { x: 2 * R + 1, y: G - KEEL + 2, z: 2 * RZ + 1 });
  b.fill({ x: OX - R, y: KEEL - 1, z: -RZ }, { x: OX + R, y: KEEL - 1, z: RZ }, 'black_concrete');
  b.fill({ x: OX - R, y: KEEL, z: -RZ }, { x: OX + R, y: G, z: RZ }, 'water');
  return b;
}

function build(): Blueprint {
  hull();
  lowerDeck();
  superstructure();
  aftDeck();
  sideDecks();
  foredeck();
  upperDeck();
  sunDeck();
  allStairs();
  swimPlatform();
  speedboat();
  return bp;
}

// ---------------------------------------------------------------------------------------------

/** A spawn standing in her block (x, z) on the deck at y, facing (tx, tz). */
const spawn = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => spawnAt(OX + x, y, z, OX + tx, tz);
const spot = (x: number, y: number, z: number): Vec3 => ({ x: OX + x + 0.5, y, z: z + 0.5 });

export const HIJACKED: MapSpec = {
  id: 'hijacked',
  name: 'Hijacked',
  blurb: 'A superyacht adrift at sundown, and her hold',
  floorY: FLOOR,
  // The sea first: she's built over it, her hull taking its place.
  structures: [sea(), build()],
  terraform: [],
  bounds: { min: { x: OX - 77, y: G - 1, z: -21 }, max: { x: OX + 64, y: TOP + 1, z: 15 } },
  sea: G + 0.8,
  spawns: [
    // The swim platform and the speedboat.
    spawn(-63, FLOOR, -4, 0, 0),
    spawn(-68, FLOOR, -17, 0, 0),
    // The lower deck: the beach club, the engine room, the cabins, the lobby, the mess, the owner's suite, the hold.
    spawn(-53, FLOOR, 6, 0, 0),
    spawn(-36, FLOOR, 0, 0, 0),
    spawn(-24, FLOOR, -6, -24, 0),
    spawn(-17, FLOOR, 4, -17, 0),
    spawn(-5, FLOOR, -3, 0, 0),
    spawn(10, FLOOR, -10, 10, 0),
    spawn(28, FLOOR, 4, 0, 0),
    spawn(44, FLOOR, 0, 0, 0),
    // The main deck: the aft deck, the salon, the dining room, the galley, the side decks, the foredeck.
    spawn(-55, MAIN, 8, 0, 0),
    spawn(-38, MAIN, -8, 0, 0),
    spawn(-29, MAIN, 1, 0, 0),
    spawn(-1, MAIN, 5, 0, 0),
    spawn(15, MAIN, 6, 0, 0),
    spawn(-20, MAIN, 11, 0, 11),
    spawn(6, MAIN, -11, 0, -11),
    spawn(26, MAIN, 3, 40, 0),
    spawn(50, MAIN, -5, 0, 0),
    // Up top: the deck's aft deck, the sky lounge, the bridge, the sun deck.
    spawn(-46, UPPER, 0, 0, 0),
    spawn(-9, UPPER, 4, 0, 0),
    spawn(16, UPPER, -3, 0, 0),
    spawn(-8, SUN, 0, 20, 0),
  ],
  // Team Deathmatch: the stern against the bow.
  teams: [
    [spawn(-63, FLOOR, -6, 0, 0), spawn(-63, FLOOR, 6, 0, 0), spawn(-55, MAIN, -8, 0, 0), spawn(-55, MAIN, 8, 0, 0), spawn(-51, FLOOR, 0, 0, 0), spawn(-45, UPPER, 7, 0, 0)],
    [spawn(50, MAIN, -4, 0, 0), spawn(50, MAIN, 4, 0, 0), spawn(27, MAIN, -5, 0, 0), spawn(30, MAIN, 11, 0, 0), spawn(44, FLOOR, 0, 0, 0), spawn(18, UPPER, 3, 0, 0)],
  ],
  // The Briefcase: the attackers come aboard over the stern; the defenders hold the foredeck.
  bomb: {
    attack: [spawn(-68, FLOOR, -17, 0, 0), spawn(-63, FLOOR, -6, 0, 0), spawn(-63, FLOOR, 6, 0, 0), spawn(-64, FLOOR, 0, 0, 0), spawn(-56, MAIN, -8, 0, 0), spawn(-56, MAIN, 8, 0, 0)],
    defend: [spawn(48, MAIN, -5, 0, 0), spawn(48, MAIN, 5, 0, 0), spawn(53, MAIN, 0, 0, 0), spawn(28, MAIN, -4, 0, 0), spawn(31, MAIN, 11, 0, 0), spawn(44, FLOOR, 0, 0, 0)],
    sites: [
      { name: 'A', label: 'the bridge', at: spot(16, UPPER, 0), radius: 3 },
      { name: 'B', label: 'the crew mess', at: spot(10, FLOOR, -4), radius: 3 },
    ],
  },
  // From the bow, over the helicopter, up at her superstructure.
  home: { x: OX + 55.5, y: MAIN + 0.05, z: 0.5, yaw: Math.PI / 2 },
  overview: { position: { x: OX + 62, y: FLOOR + 36, z: 58 }, target: { x: OX - 4, y: MAIN, z: 0 } },
  hotspots: [
    spot(-26, MAIN, 0),
    spot(-12, MAIN, 0),
    spot(0, MAIN, -4),
    spot(12, MAIN, -2),
    spot(-44, MAIN, -7),
    spot(32, MAIN, -6),
    spot(52, MAIN, 0),
    spot(-8, UPPER, 0),
    spot(16, UPPER, 0),
    spot(-34, UPPER, -6),
    spot(-4, SUN, 0),
    spot(-7, FLOOR, -3),
    spot(10, FLOOR, -4),
    spot(28, FLOOR, 0),
    spot(-50, FLOOR, 0),
    spot(-36, FLOOR, 0),
  ],
};
