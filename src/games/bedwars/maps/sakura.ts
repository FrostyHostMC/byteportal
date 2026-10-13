import type { Blueprint, BlockRef, Vec3 } from '@platform';
import type { BedwarsMap, TeamBase, TeamColor } from '../map';
import { COLORS, disc, floatingIsland, framed, hash, noise, pad, placeBed, stairs, turn, turnedFootprint, turnFacing, unturn, yawToward, type IslandStyle, type Level, type MapDef } from './kit';

// ---------------------------------------------------------------------------------------------
// Sakura Shrine: cherry-blossom islands in a pinwheel round a two-storey pagoda. Drawn in red's
// frame (red's island on +z, set off to the +x side) and turned a quarter at a time for blue
// (+x), green (-z) and yellow (-x), so every team's island sits to the left of the next one's
// line to the middle. Every island's floor top is at y = FLOOR.
//
//   team islands  17 wide x 19 deep, x 2..18 and z 28..46 (red): the front edge faces the
//                 centre's right-hand half, the torii gate on it
//   diamonds      round islets (radius 4) at (-14, 34) (red's frame): off each team's left side,
//                 11 blocks across, the long way round for anyone else
//   centre        25 x 25 (corners cut) garden round a pagoda: one emerald on its ground floor,
//                 one straight above on its upper floor (5 up, four stair flights, one per side)
//
// Gaps: team front -> centre 15 blocks, team side -> its diamond islet 11, islet -> centre 15.
// ---------------------------------------------------------------------------------------------

const FLOOR = 76;
const FEET = FLOOR + 1;
const VOID_Y = 44;
const LEVEL: Level = { floor: FLOOR, voidY: VOID_Y };

const X0 = 2;
const X1 = 18;
const MIDX = 10;
const FRONT = 28;
const BACK = 46;
const ISLET = { x: -14, z: 34 };
const MID = 12;
/** The pagoda: ground floor inside +-6, upper floor 5 up. */
const HALL = 6;
const UPPER = FEET + 4;

// Red's island.
const SPAWN = { x: 10, z: 34 };
const BED_FOOT = { x: 10, z: 41 };
const BED_HEAD = { x: 11, z: 41 };
const GEN = { x: 5, z: 33 };
const SHOP = { x: 15, z: 33 };
const POND = { x0: 3, x1: 5, z0: 38, z1: 40 };

// --- Blossom and rock ---------------------------------------------------------------------------

const GARDEN = (seed: number, extra: Partial<IslandStyle> = {}): IslandStyle => ({ seed, taper: 1.5, maxDepth: 14, spikes: 8, band: 'dirt', ...extra });

/** A cherry tree: a dark trunk with a kink, a wide flat crown of blossom, petals hanging off it. */
function cherry(bp: Blueprint, x: number, y: number, z: number, height: number, r: number, seed: number) {
  const lean = hash(x, 1, z, seed) < 0.5 ? 1 : -1;
  let tx = x;
  for (let k = 0; k < height; k++) {
    if (k === height - 2) tx += lean;
    bp.set(tx, y + k, z, 'spruce_log');
  }
  const cy = y + height;
  const rr = Math.ceil(r);
  for (let dy = -1; dy <= 2; dy++)
    bp.columns(tx, z, r, (cx, cz, d) => {
      const squash = dy === -1 ? 0.75 : dy === 2 ? 0.45 : 1;
      if (d > r * squash) return;
      const h = hash(cx, cy + dy, cz, seed);
      if (d > r * squash - 0.9 && h < 0.3) return;
      bp.set(cx, cy + dy, cz, h < 0.12 ? 'white_concrete' : h < 0.2 ? 'magenta_concrete' : 'pink_concrete');
    });
  // Petals hanging from the crown's rim.
  for (let dz = -rr; dz <= rr; dz++)
    for (let dx = -rr; dx <= rr; dx++) {
      const d = Math.hypot(dx, dz);
      if (d < r * 0.75 - 0.5 || d > r * 0.75 + 0.5) continue;
      if (hash(tx + dx, cy, z + dz, seed + 4) < 0.4) bp.set(tx + dx, cy - 2, z + dz, 'pink_concrete');
    }
}

/** A stone lantern (toro): a post, a glowing box and a cap. */
function lantern(bp: Blueprint, x: number, z: number, y = FEET) {
  bp.set(x, y, z, 'stone_bricks');
  bp.set(x, y + 1, z, 'glowstone');
  bp.set(x, y + 2, z, 'stone_brick_slab[type=bottom]');
}

// --- Team islands -------------------------------------------------------------------------------

function insideRed(x: number, z: number): boolean {
  if (x < X0 || x > X1 || z < FRONT || z > BACK) return false;
  return Math.abs(x - MIDX) - 6 + (z - (BACK - 2)) <= 2;
}

function teamIsland(color: TeamColor, i: number, seed: number): { bp: Blueprint; base: TeamBase } {
  const wool = `${color}_wool`;
  const fp = turnedFootprint(i, { x0: X0, z0: FRONT, x1: X1, z1: BACK }, insideRed);
  const deck = { x0: BED_FOOT.x - 3, x1: BED_HEAD.x + 3, z0: BED_FOOT.z - 3, z1: BED_FOOT.z + 3 };
  const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.abs(x - p.x) <= r && Math.abs(z - p.z) <= r;
  const trees = [
    { x: X0 + 2, z: BACK - 3 },
    { x: X1 - 2, z: BACK - 3 },
  ];
  const floorAt = (wx: number, wz: number, e: number): BlockRef => {
    const { x, z } = unturn(i, wx, wz);
    const h = hash(wx, 0, wz, seed);
    if (z === FRONT) return wool; // the starting line for bridges
    if (near(x, z, SPAWN, 1)) return x === SPAWN.x && z === SPAWN.z ? 'sea_lantern' : wool;
    if (Math.abs(x - MIDX) <= 1 && z > FRONT && z < SPAWN.z - 1) return x === MIDX ? wool : 'stone_bricks';
    if (x >= deck.x0 && x <= deck.x1 && z >= deck.z0 && z <= deck.z1) {
      const corner = (x === deck.x0 || x === deck.x1) && (z === deck.z0 || z === deck.z1);
      return corner ? wool : 'birch_planks';
    }
    if (near(x, z, GEN, 2)) return 'andesite';
    if (near(x, z, SHOP, 2)) return 'spruce_planks';
    if (x >= POND.x0 && x <= POND.x1 && z >= POND.z0 && z <= POND.z1) return 'water';
    if (x >= POND.x0 - 1 && x <= POND.x1 + 1 && z >= POND.z0 - 1 && z <= POND.z1 + 1) return 'mossy_cobblestone';
    // Fallen petals under the trees.
    if (trees.some((t) => Math.hypot(x - t.x, z - t.z) < 3.2) && h < 0.4) return 'pink_concrete';
    if (e < 1.5) return 'grass_block';
    if (h < 0.05) return 'mossy_cobblestone';
    return noise(wx / 3, wz / 3, seed) > 0.68 ? 'podzol' : 'grass_block';
  };
  const bp = floatingIsland(fp, GARDEN(seed), floorAt, LEVEL);
  const f = framed(bp, i);
  const put = f.put;

  const fw = f.at(BED_FOOT.x, BED_FOOT.z);
  const hw = f.at(BED_HEAD.x, BED_HEAD.z);
  const bed = placeBed(bp, color, { x: fw.x, y: FEET, z: fw.z }, { x: hw.x, y: FEET, z: hw.z });

  const g = f.at(GEN.x, GEN.z);
  const generator = pad(bp, g.x, g.z, FEET, 'gold_ore', 'iron_block', 'glowstone');

  // Shop: a tea stall with paper screens at the back and a dark roof trimmed in the team's colour.
  const sx0 = SHOP.x - 2;
  const sx1 = SHOP.x + 2;
  for (const [x, z] of [[sx0, SHOP.z - 2], [sx0, SHOP.z + 2], [sx1, SHOP.z - 2], [sx1, SHOP.z + 2]])
    for (let y = FEET; y < FEET + 3; y++) put(x, y, z, 'spruce_log');
  for (let z = SHOP.z - 1; z <= SHOP.z + 1; z++) for (let y = FEET; y < FEET + 2; y++) put(sx1, y, z, y === FEET ? 'spruce_planks' : 'white_wool');
  for (let x = sx0 - 1; x <= sx1; x++)
    for (let z = SHOP.z - 3; z <= SHOP.z + 3; z++) {
      const edge = x === sx0 - 1 || z === SHOP.z - 3 || z === SHOP.z + 3;
      put(x, FEET + 3, z, x === sx0 - 1 ? wool : edge ? 'black_concrete' : 'gray_concrete');
    }
  for (let z = SHOP.z - 2; z <= SHOP.z + 2; z++) put(SHOP.x + 1, FEET + 4, z, 'black_concrete');
  put(sx0, FEET + 2, SHOP.z - 1, wool);
  put(sx0, FEET + 2, SHOP.z + 1, wool);

  // A torii gate over the front path.
  for (const x of [MIDX - 2, MIDX + 2]) for (let y = FEET; y < FEET + 4; y++) put(x, y, FRONT + 2, 'red_concrete');
  for (let x = MIDX - 1; x <= MIDX + 1; x++) put(x, FEET + 3, FRONT + 2, 'red_concrete');
  for (let x = MIDX - 3; x <= MIDX + 3; x++) put(x, FEET + 4, FRONT + 2, 'black_concrete');
  put(MIDX - 3, FEET + 5, FRONT + 2, 'black_concrete');
  put(MIDX + 3, FEET + 5, FRONT + 2, 'black_concrete');
  put(MIDX, FEET + 4, FRONT + 2, wool);

  // Stone lanterns by the spawn, cherry trees at the back corners.
  for (const x of [SPAWN.x - 3, SPAWN.x + 3]) {
    const w = f.at(x, SPAWN.z + 2);
    lantern(bp, w.x, w.z);
  }
  for (const t of trees) {
    const w = f.at(t.x, t.z);
    cherry(bp, w.x, FEET, w.z, 5, 3.2, seed + t.x);
  }

  const s = f.at(SPAWN.x, SPAWN.z);
  const spawn = { x: s.x + 0.5, y: FEET, z: s.z + 0.5 };
  const sh = f.at(SHOP.x, SHOP.z);
  const shop = { x: sh.x + 0.5, y: FEET, z: sh.z + 0.5 };
  return {
    bp,
    base: { color, bed, spawn, spawnYaw: yawToward(spawn, { x: 0.5, y: FEET, z: 0.5 }), generator, shop, shopYaw: yawToward(shop, spawn) },
  };
}

// --- Diamond islets -----------------------------------------------------------------------------

function diamondIslet(i: number, seed: number): { bp: Blueprint; drop: Vec3 } {
  const c = turn(i, ISLET.x, ISLET.z);
  const fp = disc(c.x, c.z, 4.1);
  const bp = floatingIsland(fp, GARDEN(seed, { taper: 2.3, maxDepth: 12 }), (x, z, e) => {
    const h = hash(x, 0, z, seed);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > 1.5 && d < 2.6) return 'gravel';
    if (e < 1.5) return 'grass_block';
    return h < 0.2 ? 'mossy_cobblestone' : 'grass_block';
  }, LEVEL);
  const drop = pad(bp, c.x, c.z, FEET, 'obsidian', 'diamond_ore', 'sea_lantern');
  // A lantern on the side away from the centre and a sapling of a cherry beside it.
  const out = turn(i, ISLET.x, ISLET.z + 3);
  lantern(bp, out.x, out.z);
  const t = turn(i, ISLET.x - 3, ISLET.z + 1);
  cherry(bp, t.x, FEET, t.z, 4, 2.2, seed);
  return { bp, drop };
}

// --- The centre: a garden and a pagoda ----------------------------------------------------------

function centreIsland(seed: number): { bp: Blueprint; emeralds: Vec3[]; center: Vec3 } {
  const inside = (x: number, z: number) => Math.abs(x) <= MID && Math.abs(z) <= MID && Math.abs(x) + Math.abs(z) <= 2 * MID - 4;
  // Where each team's bridge arrives (red's frame: the +z edge, right of the middle).
  const landing = (x: number, z: number): TeamColor | null => {
    for (let i = 0; i < 4; i++) {
      const l = unturn(i, x, z);
      if (l.z >= MID - 1 && l.x >= 3 && l.x <= 7) return COLORS[i];
    }
    return null;
  };
  const fp = { x0: -MID, z0: -MID, x1: MID, z1: MID, inside };
  const bp = floatingIsland(fp, GARDEN(seed, { taper: 1.6, maxDepth: 20, spikes: 10, glow: true }), (x, z, e) => {
    const cheb = Math.max(Math.abs(x), Math.abs(z));
    const h = hash(x, 0, z, seed);
    const team = landing(x, z);
    if (team) return `${team}_wool`;
    // Paths from the landings in to the pagoda.
    for (let i = 0; i < 4; i++) {
      const l = unturn(i, x, z);
      if (l.x >= 4 && l.x <= 6 && l.z > HALL + 2) return 'stone_bricks';
    }
    if (cheb <= HALL) return cheb === HALL ? 'spruce_planks' : 'birch_planks';
    if (cheb <= HALL + 2) return h < 0.15 ? 'andesite' : 'gravel';
    if (e < 1.5) return 'grass_block';
    return h < 0.06 ? 'mossy_cobblestone' : h < 0.14 ? 'pink_concrete' : 'grass_block';
  }, LEVEL);

  // Ground-floor pillars, the upper floor (with a landing out over each stair), its pillars.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      for (let y = FEET; y < UPPER; y++) bp.set(sx * (HALL - 1), y, sz * (HALL - 1), 'red_concrete');
      for (let y = UPPER + 1; y < UPPER + 4; y++) bp.set(sx * (HALL - 1), y, sz * (HALL - 1), 'red_concrete');
    }
  bp.fill({ x: -HALL, y: UPPER, z: -HALL }, { x: HALL, y: UPPER, z: HALL }, (x, _y, z) => (Math.max(Math.abs(x), Math.abs(z)) === HALL ? 'spruce_planks' : 'birch_planks'));
  for (let i = 0; i < 4; i++) {
    const f = turnFacing(i, 'east');
    // Four steps up along the side (red's frame: z 7..8, x -5..-2, rising toward +x) ...
    for (let k = 0; k < 4; k++)
      for (const z of [HALL + 1, HALL + 2]) {
        const w = turn(i, -5 + k, z);
        for (let y = FEET; y < FEET + k; y++) bp.set(w.x, y, w.z, 'spruce_planks');
        bp.set(w.x, FEET + k, w.z, stairs('spruce', f));
      }
    // ... onto a landing that joins the upper floor.
    for (let x = -1; x <= 1; x++)
      for (const z of [HALL + 1, HALL + 2]) {
        const w = turn(i, x, z);
        bp.set(w.x, UPPER, w.z, 'spruce_planks');
      }
  }
  // The roof: three tiers of dark tiles, corners turned up, a finial on top.
  const roof = UPPER + 4;
  bp.fill({ x: -HALL - 1, y: roof, z: -HALL - 1 }, { x: HALL + 1, y: roof, z: HALL + 1 }, (x, _y, z) => (Math.max(Math.abs(x), Math.abs(z)) === HALL + 1 ? 'black_concrete' : 'gray_concrete'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bp.set(sx * (HALL + 1), roof + 1, sz * (HALL + 1), 'black_concrete');
  bp.fill({ x: -4, y: roof + 1, z: -4 }, { x: 4, y: roof + 1, z: 4 }, (x, _y, z) => (Math.max(Math.abs(x), Math.abs(z)) === 4 ? 'black_concrete' : 'gray_concrete'));
  bp.fill({ x: -2, y: roof + 2, z: -2 }, { x: 2, y: roof + 2, z: 2 }, 'gray_concrete');
  bp.set(0, roof + 3, 0, 'red_concrete');
  bp.set(0, roof + 4, 0, 'red_concrete');
  bp.set(0, roof + 5, 0, 'glowstone');
  // Lanterns hanging under the eaves of the ground floor.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bp.set(sx * HALL, UPPER - 1, sz * HALL, 'glowstone');

  // Cherry trees in the four corners of the garden, stone lanterns by the paths.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) cherry(bp, sx * 9, FEET, sz * 9, 5, 2.8, seed + sx * 2 + sz);
  for (let i = 0; i < 4; i++)
    for (const x of [3, 7]) {
      const w = turn(i, x, HALL + 4);
      lantern(bp, w.x, w.z);
    }

  const emeralds = [pad(bp, 0, 0, FEET, 'obsidian', 'green_wool', 'sea_lantern'), pad(bp, 0, 0, UPPER + 1, 'obsidian', 'green_wool', 'sea_lantern')];
  return { bp, emeralds, center: { x: 0.5, y: UPPER + 1, z: 0.5 } };
}

// --- The map ------------------------------------------------------------------------------------

function build(): BedwarsMap {
  const teams = COLORS.map((color, i) => teamIsland(color, i, 1000 + i));
  const islets = [0, 1, 2, 3].map((i) => diamondIslet(i, 1100 + i));
  const mid = centreIsland(1200);
  return {
    blueprints: [...teams.map((t) => t.bp), ...islets.map((d) => d.bp), mid.bp],
    teams: teams.map((t) => t.base),
    diamonds: islets.map((d) => d.drop),
    emeralds: mid.emeralds,
    center: mid.center,
    voidY: VOID_Y,
  };
}

export const sakura: MapDef = {
  id: 'sakura',
  name: 'Sakura Shrine',
  blurb: 'Cherry blossom in a pinwheel round a pagoda: one emerald downstairs, one up top.',
  build,
};
