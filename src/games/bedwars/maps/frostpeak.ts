import type { Blueprint, BlockRef, Vec3 } from '@platform';
import type { BedwarsMap, TeamBase, TeamColor } from '../map';
import { COLORS, disc, floatingIsland, framed, hash, noise, pad, placeBed, stairs, turn, turnedFootprint, unturn, yawToward, type IslandStyle, type Level, type MapDef } from './kit';

// ---------------------------------------------------------------------------------------------
// Frostpeak: a small, close-quarters snow map. Drawn in red's frame (red's island on +z) and
// turned a quarter at a time for blue (+x), green (-z) and yellow (-x). Every island's floor
// top is at y = FLOOR; only the mountain in the middle climbs above it.
//
//   team islands  13 wide x 17 deep, front edge 20 and back edge 36 from the centre
//   diamonds      ice floes (radius 3.6) at (+-19, +-19): between each pair of neighbours,
//                 halfway in to the middle
//   centre        a 23 x 23 octagon plaza, a terrace 2 up (15 x 15) and the summit 4 up
//                 (9 x 9), stairs on all four sides; both emeralds on the summit, under a
//                 great spruce
//
// Gaps: team front -> plaza 8 blocks, team side -> floe 9, floe -> plaza ~6 on the diagonal.
// ---------------------------------------------------------------------------------------------

const FLOOR = 80;
const FEET = FLOOR + 1;
const VOID_Y = 50;
const LEVEL: Level = { floor: FLOOR, voidY: VOID_Y };

const TEAM_FRONT = 20;
const TEAM_BACK = 36;
const TEAM_HALF = 6;
const FLOE_AT = 19;
const PLAZA = 11;
const TERRACE = 7;
const SUMMIT = 4;

// Red's island: x across it, z out from the centre.
const SPAWN = { x: 0, z: 25 };
const BED_FOOT = { x: 0, z: 31 };
const BED_HEAD = { x: 1, z: 31 };
const GEN = { x: -4, z: 24 };
const SHOP = { x: 4, z: 24 };

// --- Ice and rock -------------------------------------------------------------------------------

/** Pale stone under a frozen crust, with ice running through it and icicles at the bottom. */
function glacier(x: number, y: number, z: number, k: number, depth: number, s: IslandStyle): BlockRef {
  const h = hash(x, y, z, s.seed + 11);
  if (k <= 2) return h < 0.3 ? 'diorite' : 'stone';
  if (k >= depth - 1) return h < 0.5 ? 'ice' : 'light_blue_concrete';
  if (k >= depth - 3 && h < 0.4) return 'ice';
  const band = Math.sin(y * 0.7 + noise(x / 5, z / 5, s.seed) * 5);
  if (band > 0.55) return 'diorite';
  if (band < -0.7) return 'ice';
  if (h < 0.08) return 'andesite';
  if (h < 0.12) return 'snow_block';
  return 'stone';
}

const FROZEN = (seed: number, extra: Partial<IslandStyle> = {}): IslandStyle => ({ seed, taper: 1.6, maxDepth: 15, spikes: 11, band: 'snow_block', sub: 'stone', rock: glacier, ...extra });

/** A snowy spruce: a trunk and stacked, snow-capped rings of needles from `skirt` blocks up. */
function spruce(bp: Blueprint, x: number, y: number, z: number, height: number, width: number, seed: number, skirt = 2) {
  for (let k = 0; k < height - 1; k++) bp.set(x, y + k, z, 'spruce_log');
  // Tiers: a wide layer of needles, then a narrow one, shrinking toward the top; snow lies on
  // the part of each wide layer the narrow one above leaves bare.
  const radius = (k: number) => {
    const t = (k - skirt) / (height - skirt);
    const r = width * (1 - t) + 0.9;
    return (k - skirt) % 2 === 0 ? r : Math.max(0.8, r * 0.55);
  };
  for (let k = skirt; k < height; k++) {
    const r = radius(k);
    const above = k + 1 < height ? radius(k + 1) : 0;
    bp.columns(x, z, r, (cx, cz, d) => {
      if (d > r - 0.5 && hash(cx, y + k, cz, seed) < 0.35) return;
      if (!(cx === x && cz === z)) bp.set(cx, y + k, cz, 'spruce_leaves');
      if ((k - skirt) % 2 === 0 && d > above && hash(cx, y + k + 1, cz, seed + 1) < 0.55) bp.set(cx, y + k + 1, cz, 'snow_block');
    });
  }
  bp.set(x, y + height - 1, z, 'spruce_leaves');
  bp.set(x, y + height, z, 'snow_block');
}

// --- Team islands -------------------------------------------------------------------------------

function insideRed(x: number, z: number): boolean {
  if (Math.abs(x) > TEAM_HALF || z < TEAM_FRONT || z > TEAM_BACK) return false;
  // Round off the back corners; the front stays square for bridging.
  return Math.abs(x) - 4 + (z - (TEAM_BACK - 2)) <= 2;
}

function teamIsland(color: TeamColor, i: number, seed: number): { bp: Blueprint; base: TeamBase } {
  const wool = `${color}_wool`;
  const fp = turnedFootprint(i, { x0: -TEAM_HALF, z0: TEAM_FRONT, x1: TEAM_HALF, z1: TEAM_BACK }, insideRed);
  const deck = { x0: BED_FOOT.x - 3, x1: BED_HEAD.x + 3, z0: BED_FOOT.z - 3, z1: BED_FOOT.z + 3 };
  const near = (x: number, z: number, p: { x: number; z: number }, r: number) => Math.abs(x - p.x) <= r && Math.abs(z - p.z) <= r;
  const floorAt = (wx: number, wz: number, e: number): BlockRef => {
    const { x, z } = unturn(i, wx, wz);
    const h = hash(wx, 0, wz, seed);
    if (z === TEAM_FRONT) return wool; // the starting line for bridges
    if (near(x, z, SPAWN, 1)) return x === SPAWN.x && z === SPAWN.z ? 'sea_lantern' : wool;
    if (Math.abs(x) <= 1 && z > TEAM_FRONT && z < SPAWN.z - 1) return x === 0 ? wool : 'spruce_planks';
    if (x >= deck.x0 && x <= deck.x1 && z >= deck.z0 && z <= deck.z1) {
      const corner = (x === deck.x0 || x === deck.x1) && (z === deck.z0 || z === deck.z1);
      return corner ? wool : 'spruce_planks';
    }
    if (near(x, z, GEN, 2)) return 'light_gray_concrete';
    if (near(x, z, SHOP, 2)) return 'spruce_planks';
    if (e < 1.5) return 'snow_block';
    if (h < 0.06) return 'ice';
    return noise(wx / 3, wz / 3, seed) > 0.6 ? 'snowy_grass' : 'snow_block';
  };
  const bp = floatingIsland(fp, FROZEN(seed), floorAt, LEVEL);
  const f = framed(bp, i);
  const put = f.put;

  const fw = f.at(BED_FOOT.x, BED_FOOT.z);
  const hw = f.at(BED_HEAD.x, BED_HEAD.z);
  const bed = placeBed(bp, color, { x: fw.x, y: FEET, z: fw.z }, { x: hw.x, y: FEET, z: hw.z });

  const g = f.at(GEN.x, GEN.z);
  const generator = pad(bp, g.x, g.z, FEET, 'gold_ore', 'iron_block', 'glowstone');

  // Shop: a log cabin stall, open toward the spawn, snow on its roof, the team's colour on the eaves.
  const sx0 = SHOP.x - 2;
  const sx1 = SHOP.x + 2;
  for (const [x, z] of [[sx0, SHOP.z - 2], [sx0, SHOP.z + 2], [sx1, SHOP.z - 2], [sx1, SHOP.z + 2]])
    for (let y = FEET; y < FEET + 3; y++) put(x, y, z, 'spruce_log');
  for (let z = SHOP.z - 1; z <= SHOP.z + 1; z++) for (let y = FEET; y < FEET + 2; y++) put(sx1, y, z, y === FEET ? 'spruce_planks' : 'bookshelf');
  for (let x = sx0; x <= sx1; x++)
    for (let z = SHOP.z - 2; z <= SHOP.z + 2; z++) {
      put(x, FEET + 3, z, x === sx0 ? wool : 'spruce_planks');
      if (x > sx0) put(x, FEET + 4, z, 'snow_block');
    }
  put(sx0, FEET + 2, SHOP.z - 1, wool);
  put(sx0, FEET + 2, SHOP.z + 1, wool);
  put(sx0, FEET + 4, SHOP.z - 2, 'torch');
  put(sx0, FEET + 4, SHOP.z + 2, 'torch');

  // Snowy spruces at the back corners, and a lantern post by the front.
  for (const side of [-1, 1]) {
    const t = f.at(side * 5, TEAM_BACK - 2);
    spruce(bp, t.x, FEET, t.z, 8, 1.6, seed + side);
    const l = f.at(side * 5, TEAM_FRONT + 1);
    bp.set(l.x, FEET, l.z, 'spruce_log');
    bp.set(l.x, FEET + 1, l.z, 'spruce_log');
    bp.set(l.x, FEET + 2, l.z, 'sea_lantern');
    bp.set(l.x, FEET + 3, l.z, 'snow_block');
  }
  // Snow drifts along the sides of the back half.
  for (let z = TEAM_FRONT; z <= TEAM_BACK; z++)
    for (const x of [-TEAM_HALF, TEAM_HALF]) {
      if (!insideRed(x, z) || z < SHOP.z + 3 || near(x, z, BED_FOOT, 4)) continue;
      if (hash(x, 9, z, seed) < 0.55 && f.get(x, FEET, z) === undefined) put(x, FEET, z, 'snow_block');
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

// --- Ice floes ----------------------------------------------------------------------------------

function diamondFloe(cx: number, cz: number, seed: number): { bp: Blueprint; drop: Vec3 } {
  const fp = disc(cx, cz, 3.6);
  const bp = floatingIsland(fp, FROZEN(seed, { taper: 2.6, maxDepth: 12, spikes: 9, band: 'ice' }), (x, z, e) => {
    const h = hash(x, 0, z, seed);
    if (e < 1.5) return h < 0.5 ? 'ice' : 'snow_block';
    return h < 0.3 ? 'ice' : 'snow_block';
  }, LEVEL);
  const drop = pad(bp, cx, cz, FEET, 'obsidian', 'diamond_ore', 'sea_lantern');
  // A shard of ice on the outer rim.
  const out = Math.hypot(cx, cz);
  const ox = cx + Math.round((cx / out) * 3);
  const oz = cz + Math.round((cz / out) * 3);
  for (let k = 0; k < 3; k++) bp.set(ox, FEET + k, oz, k === 2 ? 'light_blue_concrete' : 'ice');
  return { bp, drop };
}

// --- The mountain -------------------------------------------------------------------------------

const octagon = (x: number, z: number, half: number, cut: number) => Math.abs(x) <= half && Math.abs(z) <= half && Math.abs(x) + Math.abs(z) <= 2 * half - cut;

/** The team whose side of the centre a cell faces. */
function facingTeam(x: number, z: number): TeamColor {
  return Math.abs(z) > Math.abs(x) ? (z > 0 ? 'red' : 'green') : x > 0 ? 'blue' : 'yellow';
}

function centreIsland(seed: number): { bp: Blueprint; emeralds: Vec3[]; center: Vec3 } {
  const inPlaza = (x: number, z: number) => octagon(x, z, PLAZA, 4);
  const inTerrace = (x: number, z: number) => octagon(x, z, TERRACE, 3);
  const inSummit = (x: number, z: number) => octagon(x, z, SUMMIT, 2);
  const fp = { x0: -PLAZA, z0: -PLAZA, x1: PLAZA, z1: PLAZA, inside: inPlaza };
  const bp = floatingIsland(fp, FROZEN(seed, { taper: 1.7, maxDepth: 22, spikes: 12, glow: true }), (x, z, e) => {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const h = hash(x, 0, z, seed);
    if (e < 1.5 && Math.min(ax, az) <= 1) return `${facingTeam(x, z)}_wool`;
    if (Math.min(ax, az) <= 1) return 'stone_bricks';
    if (e < 1.5) return 'snow_block';
    if (h < 0.08) return 'ice';
    return 'snow_block';
  }, LEVEL, 30);

  // The terrace (2 up) and the summit (4 up): stone-brick walls, snow on top.
  const tier = (inside: (x: number, z: number) => boolean, half: number, y0: number) => {
    bp.fill({ x: -half, y: y0, z: -half }, { x: half, y: y0 + 1, z: half }, (x, y, z) => {
      if (!inside(x, z)) return undefined;
      const rim = !inside(x + 1, z) || !inside(x - 1, z) || !inside(x, z + 1) || !inside(x, z - 1);
      if (y === y0 + 1) return rim ? 'stone_bricks' : hash(x, y, z, seed) < 0.1 ? 'ice' : 'snow_block';
      return hash(x, y, z, seed + 2) < 0.15 ? 'mossy_cobblestone' : 'stone_bricks';
    });
  };
  tier(inTerrace, TERRACE, FEET);
  tier(inSummit, SUMMIT, FEET + 2);
  // Stairs up both tiers on every side, three wide.
  for (let i = 0; i < 4; i++) {
    const up = (['north', 'west', 'south', 'east'] as const)[i];
    for (let a = -1; a <= 1; a++) {
      const flight = [
        { r: TERRACE + 2, y: FEET },
        { r: TERRACE + 1, y: FEET + 1 },
        { r: SUMMIT + 2, y: FEET + 2 },
        { r: SUMMIT + 1, y: FEET + 3 },
      ];
      for (const { r, y } of flight) {
        const w = turn(i, a, r);
        bp.set(w.x, y, w.z, stairs('stone_brick', up));
        if (y > FEET && bp.get(w.x, y - 1, w.z) === undefined) bp.set(w.x, y - 1, w.z, 'stone_bricks');
      }
    }
  }

  // Ice crystals round the plaza (cover), the same in every quarter.
  for (const [ax, az] of [[9, 5], [5, 9]])
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const x = ax * sx;
      const z = az * sz;
      const h = 2 + (ax === 9 ? 1 : 0);
      for (let k = 0; k < h; k++) bp.set(x, FEET + k, z, k === h - 1 ? 'light_blue_concrete' : 'ice');
    }
  // Small spruces on the terrace corners, the great spruce on the summit.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) spruce(bp, sx * 5, FEET + 2, sz * 5, 7, 1.2, seed + sx * 5 + sz);
  const summitY = FEET + 4;
  // Its needles start 3 up, clear of anyone standing on the emerald pads.
  spruce(bp, 0, summitY, 0, 15, 3, seed + 7, 3);

  const emeralds = [pad(bp, 2, 2, summitY, 'obsidian', 'green_wool', 'sea_lantern'), pad(bp, -2, -2, summitY, 'obsidian', 'green_wool', 'sea_lantern')];
  return { bp, emeralds, center: { x: 0.5, y: summitY, z: 0.5 } };
}

// --- The map ------------------------------------------------------------------------------------

function build(): BedwarsMap {
  const teams = COLORS.map((color, i) => teamIsland(color, i, 700 + i));
  const floes = [0, 1, 2, 3].map((i) => {
    const at = turn(i, FLOE_AT, FLOE_AT);
    return diamondFloe(at.x, at.z, 800 + i);
  });
  const mid = centreIsland(900);
  return {
    blueprints: [...teams.map((t) => t.bp), ...floes.map((d) => d.bp), mid.bp],
    teams: teams.map((t) => t.base),
    diamonds: floes.map((d) => d.drop),
    emeralds: mid.emeralds,
    center: mid.center,
    voidY: VOID_Y,
  };
}

export const frostpeak: MapDef = {
  id: 'frostpeak',
  name: 'Frostpeak',
  blurb: 'Tight and snowy: short bridges, and both emeralds up on the mountain in the middle.',
  build,
};
