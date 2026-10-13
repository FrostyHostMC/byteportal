import type { Blueprint, BlockRef, Vec3 } from '@platform';
import type { BedwarsMap, TeamBase, TeamColor } from '../map';
import { COLORS, disc, floatingIsland, framed, hash, noise, pad, placeBed, turn, turnedFootprint, unturn, yawToward, type Footprint, type IslandStyle, type Level, type MapDef } from './kit';

// ---------------------------------------------------------------------------------------------
// Sunscar Canyon: a sprawling desert map with the teams in the corners. Drawn in red's frame
// (red's island in the +x +z quadrant) and turned a quarter at a time for blue (+x -z), green
// (-x -z) and yellow (-x +z). Every walkable floor's top block is at y = FLOOR.
//
//   team islands  21 x 21 mesas, x and z 26..46, the corner facing the centre cut square
//                 across (x + z >= 56); the bed in the back corner
//   diamonds      round mesas (radius 5) on the axes, 38 out: between two neighbours
//   centre        a ring round a sinkhole (radius 6.5 to 17) with four spurs reaching 24.5
//                 out toward the teams; emeralds on the ring at (0, +-12), ruins for cover
//
// Gaps: team front -> spur end ~15 blocks on the diagonal, team side -> diamond 21, diamond ->
// ring 16. Neighbours are 52 apart straight across, so raids go by a diamond or the centre.
// ---------------------------------------------------------------------------------------------

const FLOOR = 72;
const FEET = FLOOR + 1;
const VOID_Y = 40;
const LEVEL: Level = { floor: FLOOR, voidY: VOID_Y };

const LO = 26;
const HI = 46;
/** The cut front corner: cells with x + z below this are open air. */
const FRONT = 56;
const DIAMOND_AT = 38;
const RING_IN = 6.5;
const RING_OUT = 17;
const SPUR_OUT = 24.5;

// Red's island (red's frame).
const SPAWN = { x: 35, z: 35 };
const BED_FOOT = { x: 41, z: 41 };
const BED_HEAD = { x: 42, z: 41 };
const GEN = { x: 30, z: 39 };
const SHOP = { x: 39, z: 30 };

// --- Desert rock --------------------------------------------------------------------------------

/** Badlands strata: sandstone under the floor, then bands of orange, brown and pale rock. */
function strata(x: number, y: number, z: number, k: number, depth: number, s: IslandStyle): BlockRef {
  const h = hash(x, y, z, s.seed + 11);
  if (k <= 2) return h < 0.3 ? 'sand' : 'sandstone';
  if (k >= depth - 1 && h < 0.35) return 'granite';
  const band = Math.floor(y + noise(x / 7, z / 7, s.seed) * 3) % 7;
  const b = (band + 7) % 7;
  if (h < 0.06) return 'sandstone';
  return (['orange_concrete', 'sandstone', 'brown_concrete', 'orange_concrete', 'sandstone', 'granite', 'white_concrete'] as const)[b];
}

const DESERT = (seed: number, extra: Partial<IslandStyle> = {}): IslandStyle => ({ seed, taper: 1.3, maxDepth: 16, spikes: 8, band: 'sandstone', sub: 'sandstone', rock: strata, ...extra });

/** A palm: a leaning trunk and drooping fronds. */
function palm(bp: Blueprint, x: number, z: number, lean: [number, number], seed: number) {
  const height = 6 + Math.floor(hash(x, 1, z, seed) * 2);
  let tx = x;
  let tz = z;
  for (let k = 0; k < height; k++) {
    if (k === 3 || k === 5) {
      tx += lean[0];
      tz += lean[1];
    }
    bp.set(tx, FEET + k, tz, 'oak_log');
  }
  const top = FEET + height;
  bp.set(tx, top, tz, 'oak_leaves');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const diag = dx !== 0 && dz !== 0;
    const reach = diag ? 2 : 3;
    for (let r = 1; r <= reach; r++) bp.set(tx + dx * r, top - (r === reach ? 1 : 0), tz + dz * r, 'oak_leaves');
    if (!diag) bp.set(tx + dx * (reach + 1), top - 2, tz + dz * (reach + 1), 'oak_leaves');
  }
}

/** A cactus 2..3 tall. */
function cactus(bp: Blueprint, x: number, z: number, seed: number) {
  const h = 2 + Math.floor(hash(x, 2, z, seed) * 2);
  for (let k = 0; k < h; k++) bp.set(x, FEET + k, z, 'cactus');
}

// --- Team islands -------------------------------------------------------------------------------

function insideRed(x: number, z: number): boolean {
  if (x < LO || x > HI || z < LO || z > HI || x + z < FRONT) return false;
  // Trim the two side corners and round the back one.
  if (Math.abs(x - z) > 17) return false;
  const bx = Math.max(0, x - (HI - 4));
  const bz = Math.max(0, z - (HI - 4));
  return Math.hypot(bx, bz) <= 4.6;
}

function teamIsland(color: TeamColor, i: number, seed: number): { bp: Blueprint; base: TeamBase } {
  const wool = `${color}_wool`;
  const fp = turnedFootprint(i, { x0: LO, z0: LO, x1: HI, z1: HI }, insideRed);
  const deck = { x0: BED_FOOT.x - 3, x1: BED_HEAD.x + 3, z0: BED_FOOT.z - 3, z1: BED_FOOT.z + 3 };
  const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.abs(x - p.x) <= r && Math.abs(z - p.z) <= r;
  const floorAt = (wx: number, wz: number, e: number): BlockRef => {
    const { x, z } = unturn(i, wx, wz);
    const h = hash(wx, 0, wz, seed);
    if (x + z <= FRONT + 1) return wool; // the starting line for bridges
    if (near(x, z, SPAWN, 1)) return x === SPAWN.x && z === SPAWN.z ? 'sea_lantern' : wool;
    // A boardwalk from the spawn to the front, the team's colour down the middle.
    if (Math.abs(x - z) <= 1 && x + z < SPAWN.x + SPAWN.z) return x === z ? wool : 'birch_planks';
    if (x >= deck.x0 && x <= deck.x1 && z >= deck.z0 && z <= deck.z1) {
      const corner = (x === deck.x0 || x === deck.x1) && (z === deck.z0 || z === deck.z1);
      return corner ? wool : 'spruce_planks';
    }
    if (near(x, z, GEN, 2)) return 'granite';
    if (near(x, z, SHOP, 2)) return 'spruce_planks';
    if (e < 1.5) return h < 0.5 ? 'sand' : 'sandstone';
    if (noise(wx / 4, wz / 4, seed + 1) > 0.64) return 'sand';
    return h < 0.04 ? 'granite' : 'sandstone';
  };
  const bp = floatingIsland(fp, DESERT(seed), floorAt, LEVEL);
  const f = framed(bp, i);
  const put = f.put;

  // The bed.
  const fw = f.at(BED_FOOT.x, BED_FOOT.z);
  const hw = f.at(BED_HEAD.x, BED_HEAD.z);
  const bed = placeBed(bp, color, { x: fw.x, y: FEET, z: fw.z }, { x: hw.x, y: FEET, z: hw.z });

  // Resource generator.
  const g = f.at(GEN.x, GEN.z);
  const generator = pad(bp, g.x, g.z, FEET, 'gold_ore', 'iron_block', 'glowstone');

  // Shop: a sandstone stall with its back to the island's edge (red frame: the -z side), a
  // striped awning and a lantern on each front post.
  for (const [x, z] of [[SHOP.x - 2, SHOP.z - 2], [SHOP.x + 2, SHOP.z - 2], [SHOP.x - 2, SHOP.z + 2], [SHOP.x + 2, SHOP.z + 2]])
    for (let y = FEET; y < FEET + 3; y++) put(x, y, z, 'sandstone');
  for (let x = SHOP.x - 1; x <= SHOP.x + 1; x++) for (let y = FEET; y < FEET + 2; y++) put(x, y, SHOP.z - 2, y === FEET ? 'sandstone' : 'orange_concrete');
  for (let x = SHOP.x - 2; x <= SHOP.x + 2; x++)
    for (let z = SHOP.z - 2; z <= SHOP.z + 2; z++) put(x, FEET + 3, z, (x - SHOP.x) % 2 === 0 ? wool : 'white_wool');
  for (const x of [SHOP.x - 1, SHOP.x + 1]) put(x, FEET + 2, SHOP.z + 2, wool);
  put(SHOP.x - 2, FEET + 4, SHOP.z + 2, 'torch');
  put(SHOP.x + 2, FEET + 4, SHOP.z + 2, 'torch');

  // A low sandstone wall round the back of the island, with slab caps.
  for (let x = LO; x <= HI; x++)
    for (let z = LO; z <= HI; z++) {
      if (!insideRed(x, z) || x + z < 80) continue;
      const edge = !insideRed(x + 1, z) || !insideRed(x, z + 1) || !insideRed(x - 1, z) || !insideRed(x, z - 1);
      if (!edge) continue;
      put(x, FEET, z, 'sandstone');
      if ((x + z) % 3 === 0) put(x, FEET + 1, z, 'sandstone_slab[type=bottom]');
    }

  // Palms at the side corners, leaning out; cacti by the back wall.
  const p1 = f.at(29, 43);
  const p2 = f.at(43, 29);
  const lean1 = f.at(-1, 1);
  const lean2 = f.at(1, -1);
  palm(bp, p1.x, p1.z, [lean1.x, lean1.z], seed);
  palm(bp, p2.x, p2.z, [lean2.x, lean2.z], seed + 1);
  for (const [x, z] of [[34, 44], [44, 34]]) {
    const w = f.at(x, z);
    cactus(bp, w.x, w.z, seed);
  }
  // Dead bushes in the sand.
  for (let x = LO; x <= HI; x++)
    for (let z = LO; z <= HI; z++) {
      const w = f.at(x, z);
      if (!insideRed(x, z) || bp.get(w.x, FEET, w.z) !== undefined || bp.get(w.x, FLOOR, w.z) !== 'sand') continue;
      if (hash(w.x, 7, w.z, seed) < 0.12) bp.set(w.x, FEET, w.z, 'dead_bush');
    }
  // A banner pole beside the bed deck: the team's colours over the dunes.
  const pole = f.at(36, 44);
  for (let y = FEET; y < FEET + 7; y++) bp.set(pole.x, y, pole.z, 'spruce_log');
  bp.set(pole.x, FEET + 7, pole.z, 'glowstone');
  for (let k = 1; k <= 3; k++) for (let y = FEET + 4; y <= FEET + 6; y++) put(36 - k, y, 44, wool);

  const s = f.at(SPAWN.x, SPAWN.z);
  const spawn = { x: s.x + 0.5, y: FEET, z: s.z + 0.5 };
  const sh = f.at(SHOP.x, SHOP.z);
  const shop = { x: sh.x + 0.5, y: FEET, z: sh.z + 0.5 };
  return {
    bp,
    base: { color, bed, spawn, spawnYaw: yawToward(spawn, { x: 0.5, y: FEET, z: 0.5 }), generator, shop, shopYaw: yawToward(shop, spawn) },
  };
}

// --- Diamond mesas ------------------------------------------------------------------------------

function diamondIsland(cx: number, cz: number, seed: number): { bp: Blueprint; drop: Vec3 } {
  const fp: Footprint = disc(cx, cz, 5.1);
  const bp = floatingIsland(fp, DESERT(seed, { taper: 2, maxDepth: 13 }), (x, z, e) => {
    const h = hash(x, 0, z, seed);
    if (e < 1.5) return h < 0.5 ? 'sand' : 'sandstone';
    return h < 0.3 ? 'sand' : 'sandstone';
  }, LEVEL);
  const drop = pad(bp, cx, cz, FEET, 'obsidian', 'diamond_ore', 'sea_lantern');
  // Two broken columns on the outer side (away from the centre) and a scatter of scrub.
  const out = Math.hypot(cx, cz);
  const ox = Math.round((cx / out) * 3);
  const oz = Math.round((cz / out) * 3);
  const side = { x: -oz, z: ox };
  for (const s of [-1, 1]) {
    const x = cx + ox + side.x * s;
    const z = cz + oz + side.z * s;
    const h = 2 + Math.floor(hash(x, 3, z, seed) * 2);
    for (let k = 0; k < h; k++) bp.set(x, FEET + k, z, k === h - 1 ? 'sandstone_slab[type=bottom]' : 'sandstone');
  }
  bp.fill({ x: cx - 5, y: FEET, z: cz - 5 }, { x: cx + 5, y: FEET, z: cz + 5 }, (x, _y, z) => {
    if (!fp.inside(x, z) || bp.get(x, FEET, z) !== undefined || bp.get(x, FLOOR, z) !== 'sand') return undefined;
    return hash(x, 6, z, seed) < 0.18 ? 'dead_bush' : undefined;
  });
  return { bp, drop };
}

// --- The centre: a ring round a sinkhole --------------------------------------------------------

/** The team a spur of the centre points at. */
function spurTeam(x: number, z: number): TeamColor {
  for (let i = 0; i < 4; i++) {
    const l = unturn(i, x, z);
    if (l.x > 0 && l.z > 0) return COLORS[i];
  }
  return 'red';
}

function centreIsland(seed: number): { bp: Blueprint; emeralds: Vec3[]; center: Vec3 } {
  const onSpur = (x: number, z: number) => Math.abs(Math.abs(x) - Math.abs(z)) <= 3;
  const inside = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    if (d < RING_IN) return false;
    return d <= RING_OUT || (onSpur(x, z) && d <= SPUR_OUT);
  };
  const R = Math.ceil(SPUR_OUT);
  const fp: Footprint = { x0: -R, z0: -R, x1: R, z1: R, inside };
  const bp = floatingIsland(fp, DESERT(seed, { taper: 1.5, maxDepth: 22, spikes: 10 }), (x, z, e) => {
    const d = Math.hypot(x, z);
    const h = hash(x, 0, z, seed);
    // Team-coloured landings at the ends of the spurs.
    if (d > RING_OUT + 1 && d > SPUR_OUT - 2.5) return `${spurTeam(x, z)}_wool`;
    if (d > RING_OUT + 0.5) return Math.abs(x) === Math.abs(z) ? 'orange_concrete' : e < 1.5 ? 'sandstone' : 'birch_planks';
    if (d < RING_IN + 1.2) return 'orange_concrete';
    if (d >= 11.5 && d < 12.5) return 'orange_concrete';
    if (e < 1.5) return h < 0.4 ? 'sand' : 'sandstone';
    return h < 0.02 ? 'granite' : 'sandstone';
  }, LEVEL);

  // A slab rail round the sinkhole, open in front of each emerald and each arch.
  bp.columns(0, 0, RING_IN + 1.2, (x, z, d) => {
    if (d < RING_IN || !inside(x, z)) return;
    if (Math.min(Math.abs(x), Math.abs(z)) <= 1) return;
    bp.set(x, FEET, z, 'sandstone_slab[type=bottom]');
  });

  // The sun spire: a banded column rising out of the sinkhole, a lantern on top.
  const spireTop = FEET + 9;
  bp.columns(0, 0, 1.6, (x, z) => {
    for (let y = FLOOR - 20; y <= spireTop; y++) bp.set(x, y, z, (y - FLOOR) % 4 === 0 ? 'orange_concrete' : 'sandstone');
  });
  for (let y = FLOOR - 24; y < FLOOR - 20; y++) bp.set(0, y, 0, 'sandstone');
  bp.columns(0, 0, 2.3, (x, z, d) => {
    if (d > 1.6) bp.set(x, spireTop - 1, z, 'sandstone_slab[type=top]');
  });
  bp.set(0, spireTop + 1, 0, 'sea_lantern');
  bp.columns(0, 0, 1.2, (x, z) => bp.set(x, spireTop + 2, z, 'sandstone_slab[type=bottom]'));

  // Ruined arches on the east and west of the ring (cover between the emeralds).
  for (const sx of [-1, 1]) {
    const x = sx * 12;
    for (const z of [-3, 3]) for (let y = FEET; y < FEET + 5; y++) bp.set(x, y, z, 'sandstone');
    for (let z = -3; z <= 3; z++) {
      if (z === 1) continue; // fallen stones
      bp.set(x, FEET + 5, z, z === 0 ? 'orange_concrete' : 'sandstone');
    }
    bp.set(x, FEET, 1, 'sandstone_slab[type=bottom]');
    bp.set(x + sx, FEET, -1, 'sandstone_slab[type=bottom]');
  }
  // Broken columns round the ring (cover), the same in every quarter.
  for (const [ax, az] of [[7, 14], [14, 7]])
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const x = ax * sx;
      const z = az * sz;
      const h = 2 + ((ax + 14) % 2);
      for (let k = 0; k < h; k++) bp.set(x, FEET + k, z, k === h - 1 ? 'sandstone_slab[type=bottom]' : 'sandstone');
      bp.set(x, FEET + h - (h === 3 ? 2 : 1), z, 'orange_concrete');
    }
  // Palms at the root of each spur.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) palm(bp, sx * 15 + (sx > 0 ? -1 : 1) * 1, sz * 9, [sx, 0], seed + sx * 3 + sz);

  const emeralds = [pad(bp, 0, 12, FEET, 'obsidian', 'lime_concrete', 'sea_lantern'), pad(bp, 0, -12, FEET, 'obsidian', 'lime_concrete', 'sea_lantern')];
  return { bp, emeralds, center: { x: 0.5, y: FEET, z: 0.5 } };
}

// --- The map ------------------------------------------------------------------------------------

function build(): BedwarsMap {
  const teams = COLORS.map((color, i) => teamIsland(color, i, 400 + i));
  const diamondIslands = [0, 1, 2, 3].map((i) => {
    const at = turn(i, 0, DIAMOND_AT);
    return diamondIsland(at.x, at.z, 500 + i);
  });
  const mid = centreIsland(600);
  return {
    blueprints: [...teams.map((t) => t.bp), ...diamondIslands.map((d) => d.bp), mid.bp],
    teams: teams.map((t) => t.base),
    diamonds: diamondIslands.map((d) => d.drop),
    emeralds: mid.emeralds,
    center: mid.center,
    voidY: VOID_Y,
  };
}

export const canyon: MapDef = {
  id: 'canyon',
  name: 'Sunscar Canyon',
  blurb: 'Desert mesas in the corners, long bridges, and a sinkhole in the middle.',
  build,
};
