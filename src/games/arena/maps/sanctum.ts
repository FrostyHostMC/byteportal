import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { box, gateAt, hash, voxels } from './kit';
import { banner, type BannerDesign, type Model } from './models';
import { FLOOR, type ArenaMap, type Box, type Decor, type Fire, type TrapSpec } from './registry';

/**
 * The Frozen Sanctum: a temple of ice in a mountain cirque, under an aurora. The fight's in a
 * sunken court of blue stone (a great snowflake inlaid in it, a ring of runes glowing round its
 * edge), two benches of ice and four flights of stairs up to a snowy terrace; pillars of glacier
 * ice stand round the terrace, frost burning cold on them. North, the temple on
 * its podium: a grand stair guarded by frost dragons that breathe across it, an altar with a great
 * crystal, a portico hung with banners, its doors a gate. South, a vaulted colonnade hung with
 * icicles leads to the gatehouse; ice caves open in the cliffs east, west and north-west; out on
 * the terrace's south-west, a frozen pool with open water in it, freezing whatever's knocked in.
 * Snowy mountains all round, an icefall behind the temple, pines on the lower ridges.
 */

/** Its middle block, and that block's middle in the world. */
const O = { x: 512, z: 512 };
const C = { x: O.x + 0.5, z: O.z + 0.5 };
/** A block's middle in the world, from where it is from the middle block. */
const w = (lx: number, y: number, lz: number): Vec3 => ({ x: O.x + lx + 0.5, y, z: O.z + lz + 0.5 });

/** The court's edge (its floor block at LOW), where the terrace begins (the steps between), the cliffs' foot, the cirque's outer edge. */
const COURT = 13;
const RIM = 16;
const LOW = FLOOR - 2;
const FOOT = 26.5;
const OUTER = 56;
const GROUND = 80;
const TOP = FLOOR + 40;

const DEG = Math.PI / 180;
/** The four flights up out of the court, north, east, south and west, five wide. */
const FLIGHTS = [-90, 0, 90, 180].map((d) => d * DEG);
/** The terrace's pillars, between the flights (the one at 120 broken and fallen). */
const PILLARS = [0, 60, 120, 180, 240, 300].map((d) => d * DEG);
const PILLAR_R = 20.5;
/** The ice caves in the cliffs: east, west, north-west. */
const CAVES = [-15, 195, -140].map((d) => d * DEG);
/** Their pens, this far out. */
const PEN = 28.5;

const TAU = Math.PI * 2;
/** How far apart two angles are (radians, 0..π). */
const apart = (a: number, b: number) => {
  const t = Math.abs((((a - b) % TAU) + TAU) % TAU);
  return Math.min(t, TAU - t);
};

/** Smooth value noise in [0, 1): `s` blocks across a bump. */
function noise(x: number, z: number, s: number, k: number): number {
  const fx = x / s;
  const fz = z / s;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0, k) + (hash(x0 + 1, z0, k) - hash(x0, z0, k)) * sx;
  const b = hash(x0, z0 + 1, k) + (hash(x0 + 1, z0 + 1, k) - hash(x0, z0 + 1, k)) * sx;
  return a + (b - a) * sz;
}

/** Where the temple stands (its podium and stair), clear of the mountain. */
const inTemple = (lx: number, lz: number) => Math.abs(lx) <= 11 && lz <= -16 && lz >= -33;

/**
 * Which step of a flight a block is (0: the first stair up out of the court, 1 its tread, 2 the
 * stair onto the terrace) and which way it climbs, or null where there's no flight; and how far
 * across from the nearest flight it is (blocks).
 */
function flight(lx: number, lz: number): { step: number; facing: string } | null {
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  if (az <= 2 && ax >= COURT && ax <= COURT + 2) return { step: ax - COURT, facing: lx > 0 ? 'east' : 'west' };
  if (ax <= 2 && az >= COURT && az <= COURT + 2) return { step: az - COURT, facing: lz > 0 ? 'south' : 'north' };
  return null;
}
const beside = (lx: number, lz: number) => Math.min(Math.abs(lx), Math.abs(lz)) - 2;

/**
 * The frozen pool out on the terrace's south-west, off the way of anything coming in: open water
 * in a sheet of ice. Lure them over it.
 */
const hole = (lx: number, lz: number) => ((lx + 19.3) / 2.1) ** 2 + ((lz - 11.4) / 2.9) ** 2 <= 1;
const pond = (lx: number, lz: number) => ((lx + 19) / 4.2) ** 2 + ((lz - 11) / 5) ** 2 <= 1;



/**
 * The mountain at a column: how many blocks over the floor it stands (0: none), rising steeply
 * from its foot (which wanders) to a crest, higher in the north, falling away again outside.
 */
function mountain(lx: number, lz: number, d: number, a: number): { h: number; crest: number } {
  const foot = FOOT + 2.2 * noise(Math.cos(a) * 30, Math.sin(a) * 30, 7, 51);
  const t = d - foot;
  if (t < 0 || inTemple(lx, lz)) return { h: 0, crest: 0 };
  const north = (1 - Math.sin(a)) / 2;
  const crest = 12 + 15 * north + 7 * noise(lx, lz, 10, 52);
  let h = Math.min(crest, 2.5 + 3.3 * t + 2.5 * noise(lx, lz, 4, 53));
  h = Math.min(h, (OUTER - d) * 2.6);
  return { h: Math.max(0, Math.round(h)), crest };
}

/** The glaciers: tongues of blue ice down the cirque's walls where the rock gives way. */
const glacial = (a: number) => noise(Math.cos(a) * 30, Math.sin(a) * 30, 9, 61) > 0.6;

function build(): Blueprint {
  const bp = Blueprint.centered(O.x, O.z, OUTER + 1, FLOOR - 4, TOP);
  const put = (lx: number, y: number, lz: number, b: BlockRef) => bp.set(O.x + lx, y, O.z + lz, b);
  const pines: { lx: number; lz: number; y: number }[] = [];

  bp.columns(O.x, O.z, OUTER, (x, z, d, a) => {
    const lx = x - O.x;
    const lz = z - O.z;
    if (d < COURT) return court(put, lx, lz, d, a);
    if (d < RIM) return rim(put, lx, lz, d, a);
    const m = mountain(lx, lz, d, a);
    if (!m.h) return terrace(put, lx, lz, d, a);
    // The mountain: rock in strata (or a glacier's ice: the icefall behind the temple is one), snow on top.
    const fall = Math.abs(lx) <= 6 - Math.max(0, -lz - 44) * 0.5 && lz < -30;
    const ice = glacial(a) || fall;
    for (let y = FLOOR; y <= FLOOR + m.h; y++) {
      const top = y === FLOOR + m.h || (y === FLOOR + m.h - 1 && m.h > 9 && hash(x, z, 62) < 0.6);
      let b: BlockRef = 'stone';
      if (top && !fall) b = 'snow_block';
      else if (fall) b = (lx + Math.floor(noise(lx, y, 3, 66) * 3)) % 3 === 0 ? 'glacier' : hash(lx, y, 67) < 0.15 ? 'ice' : 'packed_ice';
      else if (ice) b = (y + Math.floor(hash(x >> 2, z >> 2, 63) * 3)) % 5 === 0 ? 'glacier' : 'packed_ice';
      else if ((y + Math.floor(noise(x, z, 6, 64) * 4)) % 6 < 2) b = 'andesite';
      else if (hash(x, z, y) < 0.05) b = 'diorite';
      put(lx, y, lz, b);
    }
    // Pines on the lower ridges, up on the crest.
    if (!ice && Math.sin(a) > -0.3 && m.h >= m.crest - 1.5 && m.h < 22 && hash(x, z, 65) < 0.045) pines.push({ lx, lz, y: FLOOR + m.h + 1 });
  });

  temple(put);
  colonnade(put);
  for (const a of CAVES) cave(put, a);
  pillars(put);
  for (const p of pines) pine(put, p.lx, p.y, p.lz);
  // Pines at the terrace's edge between the gates, and cold braziers either side of each cave.
  for (const deg of [38, 64, 124, -32, -50]) pine(put, Math.round(Math.cos(deg * DEG) * 24.5), FLOOR + 1, Math.round(Math.sin(deg * DEG) * 24.5));
  for (const b of CAVE_BRAZIERS) {
    put(b.lx, FLOOR + 1, b.lz, 'packed_ice');
    put(b.lx, FLOOR + 2, b.lz, 'glacier');
  }
  return bp;
}

type Put = (lx: number, y: number, lz: number, b: BlockRef) => void;

/**
 * The court: sunk two blocks, dark blue stone paved round a great snowflake of glacier ice, its
 * arms pointing north and south and to the diagonals between; a ring of glowing runes near its
 * edge.
 */
function court(put: Put, lx: number, lz: number, d: number, a: number) {
  put(lx, LOW - 1, lz, 'sanctum_stone');
  for (let y = LOW + 1; y <= FLOOR + 1; y++) put(lx, y, lz, 'air');
  const t = (((a + Math.PI / 2) / (Math.PI / 3)) % 1 + 1) % 1;
  const off = Math.min(t, 1 - t) * (Math.PI / 3) * d;
  let floor: BlockRef = 'sanctum_stone';
  if (d < 1.6) floor = 'rune_stone';
  else if (d > 12.4) floor = 'ice_bricks';
  else if (d > 11.6) floor = 'rune_stone';
  else if (off < 0.6 && d < 11) floor = 'glacier';
  else if (d > 5 && d < 9 && Math.abs(off - (d - 5) * 0.75 - 0.2) < 0.45) floor = 'packed_ice';
  else if (d > 2.6 && d < 3.4 && off < 1.6) floor = 'packed_ice';
  put(lx, LOW, lz, floor);
}

/**
 * Between the court and the terrace: two benches a block each all round, a blue riser of glacier
 * ice under a tread of temple stone (anything can climb out anywhere, and nobody camps a ledge out
 * of reach), cut by four flights of stairs, north, east, south and west: a stair, a tread, a
 * stair. (Full blocks and stairs, never slabs, where anyone stands: a fighter standing half a block
 * up is lost to the monsters' path-finding for as long as they stand there.)
 */
function rim(put: Put, lx: number, lz: number, d: number, a: number) {
  const f = flight(lx, lz);
  for (let y = LOW - 1; y <= LOW; y++) put(lx, y, lz, 'sanctum_stone');
  if (f) {
    put(lx, LOW + 1, lz, f.step === 0 ? `stone_brick_stairs[facing=${f.facing}]` : 'ice_bricks');
    put(lx, FLOOR, lz, f.step === 2 ? `stone_brick_stairs[facing=${f.facing}]` : 'air');
    put(lx, FLOOR + 1, lz, 'air');
    return;
  }
  const upper = d >= COURT + 1.5;
  put(lx, LOW + 1, lz, upper ? 'sanctum_stone' : 'glacier');
  put(lx, FLOOR, lz, upper ? 'glacier' : 'air');
  put(lx, FLOOR + 1, lz, 'air');
  // Frost crystals growing on the upper bench, here and there and beside each flight.
  const eighth = (a / TAU) * 8;
  if (upper && (beside(lx, lz) === 1 || (Math.abs(eighth - Math.round(eighth)) < 0.03 && Math.round(eighth) % 2))) put(lx, FLOOR + 1, lz, 'frost_crystal');
}

/**
 * The terrace: blue stone flags drifted with snow, paths of ice bricks out to the gates, a border
 * round the court's rim; snow banked against the cliffs' foot, frost crystals growing there.
 */
function terrace(put: Put, lx: number, lz: number, d: number, a: number) {
  for (let y = FLOOR - 3; y < FLOOR; y++) put(lx, y, lz, 'stone');
  if (hole(lx, lz)) {
    // Two deep: the dead don't wander in, but knocked in they don't climb out.
    put(lx, FLOOR, lz, 'water');
    put(lx, FLOOR - 1, lz, 'water');
    put(lx, FLOOR - 2, lz, 'glacier');
    return;
  }
  if (pond(lx, lz)) {
    put(lx, FLOOR, lz, hash(lx, lz, 6) < 0.15 ? 'packed_ice' : 'ice');
    return;
  }
  const path = [...CAVES, ...FLIGHTS].some((g) => apart(a, g) * d < 2.2);
  const foot = FOOT + 2.2 * noise(Math.cos(a) * 30, Math.sin(a) * 30, 7, 51);
  let floor: BlockRef = hash(lx, lz, 2) < 0.18 ? 'ice_bricks' : 'sanctum_stone';
  if (d < RIM + 1.2 || path) floor = 'ice_bricks';
  else if (noise(lx, lz, 5, 21) > 0.6 || d > foot - 1.5) floor = 'snow_block';
  put(lx, FLOOR, lz, floor);
  if (!path && d > foot - 1 && !inTemple(lx, lz)) {
    if (hash(lx, lz, 3) < 0.45) put(lx, FLOOR + 1, lz, 'snow_block');
    else if (hash(lx, lz, 4) < 0.08) put(lx, FLOOR + 1, lz, 'frost_crystal');
  }
}

/**
 * The temple, north: a grand stair in half blocks up to a podium; frost dragons on plinths either
 * side of the stair; an altar at its head; a portico of glacier columns before the hall, whose
 * doors are a gate; a pediment and a gabled roof under snow.
 */
function temple(put: Put) {
  // The stair: a stair and a tread for each block up from the terrace, cheek walls flush with each step.
  for (let k = 1; k <= 6; k++) {
    const lz = -16 - k;
    const full = FLOOR + Math.floor(k / 2);
    for (let lx = -5; lx <= 5; lx++) {
      const cheek = Math.abs(lx) === 5;
      for (let y = FLOOR - 3; y <= full; y++) put(lx, y, lz, cheek ? (y === full && !(k % 2) ? 'rune_stone' : 'sanctum_stone') : 'ice_bricks');
      if (k % 2) put(lx, full + 1, lz, cheek ? 'rune_stone' : 'stone_brick_stairs[facing=north]');
    }
  }
  // The plinths for the dragons: the east one by the lower steps, the west by the upper.
  for (const [x0, z0, top] of [
    [6, -18, FLOOR + 1],
    [-7, -20, FLOOR + 2],
  ] as const)
    for (let lx = x0; lx <= x0 + 1; lx++)
      for (let lz = z0; lz <= z0 + 1; lz++) for (let y = FLOOR; y <= top; y++) put(lx, y, lz, y === top ? 'rune_stone' : 'sanctum_stone');
  // The podium.
  for (let lx = -10; lx <= 10; lx++)
    for (let lz = -33; lz <= -22; lz++) {
      if (Math.abs(lx) <= 5 && lz === -22) continue;
      for (let y = FLOOR - 3; y <= FLOOR + 3; y++) {
        const face = lz === -22 || Math.abs(lx) === 10;
        put(lx, y, lz, y === FLOOR + 3 ? 'ice_bricks' : face && y === FLOOR + 2 ? 'rune_stone' : 'sanctum_stone');
      }
    }
  // The altar at the stair's head (the crystal stands on it).
  for (let lx = -1; lx <= 1; lx++) for (let lz = -24; lz <= -23; lz++) put(lx, FLOOR + 4, lz, 'rune_stone');
  // The portico's columns.
  for (const lx of [-9, -6, -3, 3, 6, 9]) {
    put(lx, FLOOR + 4, -25, 'ice_bricks');
    for (let y = FLOOR + 5; y <= FLOOR + 8; y++) put(lx, y, -25, 'glacier');
    put(lx, FLOOR + 9, -25, 'sanctum_stone');
  }
  // The hall: walls of ice brick coursed with stone, the front pierced by the doors (the gate).
  for (let lx = -10; lx <= 10; lx++)
    for (let lz = -32; lz <= -26; lz++)
      for (let y = FLOOR + 4; y <= FLOOR + 11; y++) {
        const wall = lz === -27 || lz === -32 || Math.abs(lx) === 10;
        const door = lz === -27 && Math.abs(lx) <= 2 && y <= FLOOR + 8;
        if (lz === -26) {
          // The portico, roofed over.
          put(lx, y, lz, y >= FLOOR + 10 ? 'sanctum_stone' : 'air');
          continue;
        }
        if (y >= FLOOR + 10) put(lx, y, lz, y === FLOOR + 11 ? 'sanctum_stone' : 'ice_bricks');
        else if (wall && !door) put(lx, y, lz, (y - FLOOR) % 3 === 1 ? 'sanctum_stone' : 'ice_bricks');
        else put(lx, y, lz, 'air');
      }
  // The entablature over the columns, a frieze of runes along its face.
  for (let lx = -10; lx <= 10; lx++) {
    put(lx, FLOOR + 10, -25, 'sanctum_stone');
    put(lx, FLOOR + 11, -25, 'rune_stone');
  }
  // The pediment and the gabled roof behind it, stepped, snow on every step.
  for (let s = 0; s <= 4; s++) {
    const y = FLOOR + 12 + s;
    const half = 10 - s * 2 - (s === 4 ? 1 : 0);
    for (let lx = -half; lx <= half; lx++)
      for (let lz = -32; lz <= -25; lz++) {
        const edge = Math.abs(lx) >= half - 1;
        put(lx, y, lz, edge ? 'snow_block' : lz === -25 && s >= 1 && s <= 2 && Math.abs(lx) <= 1 ? 'glacier' : 'sanctum_stone');
      }
  }
}

/**
 * The south: a vaulted colonnade over the way to the gatehouse, pillars of ice brick, icicles
 * hanging thick under its vault (they fall when its lever's pulled); the gatehouse a tall portal
 * of temple stone with a portcullis, its pen cut into the mountain.
 */
function colonnade(put: Put) {
  for (let lz = 16; lz <= 24; lz++)
    for (let lx = -4; lx <= 4; lx++) {
      const pillar = Math.abs(lx) === 4 && (lz - 17) % 3 === 0;
      if (pillar) for (let y = FLOOR + 1; y <= FLOOR + 6; y++) put(lx, y, lz, y === FLOOR + 1 || y === FLOOR + 6 ? 'sanctum_stone' : y % 2 ? 'glacier' : 'packed_ice');
      // The vault: its haunches, its crown, snow over it.
      if (Math.abs(lx) >= 3) put(lx, FLOOR + 6, lz, 'packed_ice');
      put(lx, FLOOR + 7, lz, Math.abs(lx) <= 1 ? 'glacier' : 'packed_ice');
      put(lx, FLOOR + 8, lz, 'snow_block');
      // Icicles under it, long and short.
      if (Math.abs(lx) <= 3 && lz > 16) {
        const r = hash(lx, lz, 7);
        if (Math.abs(lx) === 3 ? r < 0.8 : r < 0.6) put(lx, FLOOR + 5 + (Math.abs(lx) === 3 ? 0 : 1), lz, 'icicle');
        if (Math.abs(lx) <= 2 && r < 0.25) put(lx, FLOOR + 5, lz, 'icicle');
      }
    }
  // The gatehouse: the portal, stone filled in behind it to the mountain, the pen cut through.
  for (let lx = -6; lx <= 6; lx++)
    for (let lz = 25; lz <= 31; lz++)
      for (let y = FLOOR; y <= FLOOR + 10; y++) {
        const peak = lz === 25 ? FLOOR + 10 - Math.max(0, Math.abs(lx) - 3) : FLOOR + 7;
        if (y > peak) continue;
        const open = Math.abs(lx) <= (lz === 25 ? 2 : 3) && y >= FLOOR + 1 && y <= FLOOR + (lz === 25 ? 5 : 6) && lz <= 30;
        if (open) put(lx, y, lz, 'air');
        else if (lz === 25) put(lx, y, lz, y === FLOOR + 6 && Math.abs(lx) <= 3 ? 'rune_stone' : Math.abs(lx) === 3 && y <= FLOOR + 6 ? 'ice_bricks' : 'sanctum_stone');
        else put(lx, y, lz, y === FLOOR ? 'ice_bricks' : 'packed_ice');
      }
  for (const lx of [-5, 5]) {
    put(lx, FLOOR + 1, 24, 'sanctum_stone');
    put(lx, FLOOR + 2, 24, 'glacier');
  }
}

/** An ice cave into the cliffs at angle `a`: a mouth arched in packed ice, icicles at its lip, a pen at its end. */
function cave(put: Put, a: number) {
  const fx = Math.cos(a);
  const fz = Math.sin(a);
  const R = PEN + 5;
  for (let lx = -R; lx <= R; lx++)
    for (let lz = -R; lz <= R; lz++) {
      const along = lx * fx + lz * fz;
      const side = -lx * fz + lz * fx;
      if (along < 22.5 || along > PEN + 3) continue;
      const pen = along > PEN - 2;
      const half = pen ? 3.7 : 2.7;
      const tall = pen ? 5.6 : 5.2;
      if (Math.abs(side) > half + 1.6) continue;
      const end = along > PEN + 2;
      put(lx, FLOOR, lz, hash(lx, lz, 8) < 0.3 ? 'ice' : 'snow_block');
      for (let y = FLOOR + 1; y <= FLOOR + 8; y++) {
        const e = (side / half) ** 2 + ((y - FLOOR - 0.5) / tall) ** 2;
        if (e <= 1 && !end) {
          // The lip: icicles hanging from its top.
          const lip = along < 25.5 && e > 0.62 && y > FLOOR + 3 && hash(lx * 7 + y, lz, 9) < 0.5;
          put(lx, y, lz, lip ? 'icicle' : 'air');
        } else if (e <= 2 || end) put(lx, y, lz, (y + lx + lz) % 4 === 0 ? 'glacier' : 'packed_ice');
      }
    }
}

/** The terrace's pillars of glacier ice, a cold fire burning on each; the one at 120 broken, its drums fallen. */
function pillars(put: Put) {
  PILLARS.forEach((a, i) => {
    const cx = Math.round(Math.cos(a) * PILLAR_R);
    const cz = Math.round(Math.sin(a) * PILLAR_R);
    const broken = i === 2;
    const h = broken ? 4 : 8;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const corner = Math.abs(dx) + Math.abs(dz) === 2;
        put(cx + dx, FLOOR + 1, cz + dz, 'ice_bricks');
        if (!broken) put(cx + dx, FLOOR + h + 1, cz + dz, corner ? 'rune_stone' : 'sanctum_stone');
        if (corner) continue;
        for (let y = FLOOR + 2; y <= FLOOR + h; y++) {
          if (broken && y === FLOOR + h && hash(cx + dx, cz + dz, 11) < 0.5) continue;
          put(cx + dx, y, cz + dz, (y - FLOOR) % 3 === 0 ? 'packed_ice' : 'glacier');
        }
      }
    if (!broken) put(cx, FLOOR + h + 2, cz, 'glacier');
    else {
      // Its drums, fallen outward across the terrace.
      const ox = Math.round(Math.cos(a) * 3);
      const oz = Math.round(Math.sin(a) * 3);
      for (let k = 0; k < 3; k++) {
        put(cx + ox + Math.round(Math.cos(a) * k), FLOOR + 1, cz + oz + Math.round(Math.sin(a) * k), 'glacier');
        put(cx + ox + Math.round(Math.cos(a) * k) + 1, FLOOR + 1, cz + oz + Math.round(Math.sin(a) * k), 'glacier');
      }
    }
  });
}

/** A pine: a straight trunk, its boughs (three blocks clear of the ground) in tiers narrowing to the top, snow on each tier. */
function pine(put: Put, lx: number, y0: number, lz: number) {
  const h = 7 + Math.floor(hash(lx, lz, 12) * 4);
  for (let y = y0; y < y0 + h; y++) put(lx, y, lz, 'spruce_log');
  for (let y = y0 + 3; y <= y0 + h; y++) {
    const up = y - y0 - 3;
    const r = Math.max(0, Math.round((h - 3 - up) * 0.45 + (up % 2 ? -0.4 : 0.3)));
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if ((dx || dz) && Math.hypot(dx, dz) > r + 0.3) continue;
        if (!dx && !dz && y < y0 + h) continue;
        put(lx + dx, y, lz + dz, 'spruce_leaves');
        if (up % 2 === 1 || y === y0 + h) put(lx + dx, y + 1, lz + dz, Math.hypot(dx, dz) >= r - 0.5 || y === y0 + h ? 'snow_block' : 'spruce_leaves');
      }
  }
}

/** The ground round it, snow as far as the haze. */
function ground(): Blueprint {
  const bp = Blueprint.centered(O.x, O.z, GROUND, FLOOR, FLOOR);
  bp.columns(O.x, O.z, GROUND, (x, z) => bp.set(x, FLOOR, z, hash(x, z, 13) < 0.06 ? 'packed_ice' : 'snow_block'));
  return bp;
}

// -------------------------------------------------------------------------------------------------
// Set pieces
// -------------------------------------------------------------------------------------------------

/** An ice maiden, about 4.4 blocks tall, hands folded round a glowing crystal, a crown of icicles. Pivot: her feet, facing +z. */
function maiden(): Model {
  const bp = voxels({ x: 15, y: 23, z: 11 }, (x, y, z) => {
    const dx = x - 7;
    const dz = z - 5;
    if (y <= 10) {
      // The gown, flaring to the ground.
      const rx = 2.1 + (10 - y) * 0.45;
      const rz = 1.6 + (10 - y) * 0.32;
      if ((dx / rx) ** 2 + (dz / rz) ** 2 <= 1) return y === 0 || y % 4 === 1 ? 'glacier' : 'packed_ice';
    }
    // Her hair, long behind her.
    if (y >= 9 && y <= 18 && dz === -2 && Math.abs(dx) <= 2 - (y < 12 ? 1 : 0)) return 'white_concrete';
    // Body and shoulders; arms down to her hands, folded in front round the crystal.
    if (y >= 11 && y <= 15 && Math.abs(dx) <= 2 && Math.abs(dz) <= 1) return 'packed_ice';
    if (y >= 11 && y <= 15 && Math.abs(dx) === 3 && dz >= -1 && dz <= 0) return 'packed_ice';
    if (y >= 10 && y <= 11 && Math.abs(dx) <= 2 && dz === 2) return 'packed_ice';
    if (y >= 11 && y <= 13 && dx >= -1 && dx <= 0 && dz === 3) return 'sea_lantern';
    // Her head, a crown of icicles on it.
    if (y >= 16 && y <= 19 && Math.abs(dx) <= 1 && dz >= -1 && dz <= 1) return 'packed_ice';
    if (y === 20 && Math.abs(dx) <= 2 && Math.abs(dz) <= 1 && (dx + dz) % 2 === 0) return 'white_concrete';
    if (y >= 21 && y <= 22 && dz === 0 && (dx === 0 || (Math.abs(dx) === 2 && y === 21))) return 'ice';
    return undefined;
  });
  return { bp, scale: 1 / 5, pivot: { x: 7.5, y: 0, z: 5.5 } };
}

/**
 * A frost dragon's head on its neck, jaws agape (the cold comes out of them), brows over glowing
 * eyes, horns swept back, spines down its neck. About three blocks long. Pivot: its mouth, facing +z.
 */
function dragonHead(): Model {
  const bp = voxels({ x: 19, y: 18, z: 25 }, (x, y, z) => {
    const dx = x - 9;
    const ax = Math.abs(dx);
    // The neck, rising out of the plinth at the back, spines along its top.
    if (z <= 7 && y <= 9 && Math.hypot(dx * 0.9, (z - 3.5) * 1.1) <= 4.4 - y * 0.06) return y % 3 === 0 ? 'packed_ice' : 'glacier';
    if (z <= 7 && dx === 0 && y >= 10 && y <= 11 && z % 2 === 0) return 'packed_ice';
    // The skull: rounded, a brow over each glowing eye.
    if (z >= 6 && z <= 14 && y >= 4 && y <= 12 && (ax / 4.6) ** 2 + ((y - 8) / 4.4) ** 2 <= 1) {
      if (y === 10 && z === 14 && ax >= 2 && ax <= 3) return 'sea_lantern';
      if (y === 11 && z >= 12 && ax >= 2 && ax <= 4) return 'packed_ice';
      return 'glacier';
    }
    // Horns, swept back and up from behind the brows.
    for (const sx of [-1, 1]) {
      const hz = 9 - (y - 10) * 1.3;
      if (y >= 10 && y <= 16 && Math.abs(dx - sx * (3 + (y - 10) * 0.35)) < 0.8 && Math.abs(z - hz) < 1) return 'packed_ice';
    }
    // The upper jaw, narrowing to the snout; nostrils at its tip; fangs hanging from it.
    if (z >= 14 && z <= 23 && y >= 7 && y <= 9 && ax <= 3.4 - (z - 14) * 0.17) return y === 9 ? 'packed_ice' : 'glacier';
    if ((z === 22 || z === 19) && y === 6 && ax === 2) return 'snow_block';
    // The lower jaw, dropped open; fangs standing up from it.
    if (z >= 14 && z <= 21 && y >= 2 && y <= 3 && ax <= 2.6 - (z - 14) * 0.12) return y === 2 ? 'packed_ice' : 'glacier';
    if (z === 21 && y === 4 && ax === 2) return 'snow_block';
    return undefined;
  });
  return { bp, scale: 1 / 8, pivot: { x: 9.5, y: 5.5, z: 23.5 } };
}

/** The great frost crystal on the altar: shards of glacier ice round a glowing core. Pivot: its foot's middle. */
function greatCrystal(): Model {
  const shards: [number, number, number, number][] = [
    [6, 6, 2.3, 24],
    [3, 8, 1.4, 14],
    [9.5, 4, 1.5, 17],
    [8.5, 9.5, 1.2, 11],
    [3, 3.5, 1.3, 12],
  ];
  const bp = voxels({ x: 13, y: 25, z: 13 }, (x, y, z) => {
    if (y <= 1 && Math.hypot(x - 6, z - 6) <= 4.5 - y) return 'packed_ice';
    for (const [cx, cz, r, h] of shards) {
      const d = Math.hypot(x - cx, z - cz);
      const taper = Math.min(1, (h - y) / (r * 2.4));
      if (y < h && d <= r * taper + 0.2) return d < r * 0.45 && cx === 6 ? 'sea_lantern' : (y + Math.round(cx)) % 6 === 0 ? 'packed_ice' : 'glacier';
    }
    return undefined;
  });
  return { bp, scale: 1 / 4, pivot: { x: 6.5, y: 0, z: 6.5 } };
}

/** The Sanctum's banner: pale blue, a white snowflake, a silver border, swallow-tailed. */
function design(): BannerDesign {
  const W = 16;
  const H = 40;
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const tail = y > H - 7 && Math.abs(x - 7.5) < (y - (H - 7)) * 1.2;
      const cx = x - 7.5;
      const cy = y - 16.5;
      const r = Math.hypot(cx, cy);
      const ang = Math.atan2(cy, cx);
      const arm = (((ang / (Math.PI / 3)) % 1) + 1) % 1;
      const onArm = Math.min(arm, 1 - arm) * (Math.PI / 3) * r < 0.65 && r < 6.2;
      const branch = r > 3 && r < 5.6 && Math.abs(Math.min(arm, 1 - arm) * (Math.PI / 3) * r - (r - 3) * 0.7) < 0.55;
      let c = 'b';
      if (y < 2) c = 's';
      else if (x === 0 || x === W - 1 || y === 2 || y === H - 9) c = 's';
      else if (onArm || branch || r < 1.2) c = 'w';
      if (tail) c = '.';
      row += c;
    }
    rows.push(row);
  }
  return { rows, palette: { b: 'light_blue_concrete', w: 'white_concrete', s: 'iron_block' } };
}

const BANNER = banner(design());
const MAIDEN = maiden();
const DRAGON = dragonHead();
const CRYSTAL = greatCrystal();

/** Where the dragons' mouths are: the east one over the lower steps, the west over the upper. */
const EAST_MOUTH = { x: O.x + 5.7, y: FLOOR + 2.4, z: O.z - 17.0 };
const WEST_MOUTH = { x: O.x - 4.7, y: FLOOR + 3.4, z: O.z - 19.0 };

const DECOR: Decor[] = [
  { model: CRYSTAL, at: { x: C.x, y: FLOOR + 5, z: O.z - 23 }, face: 0 },
  { model: MAIDEN, at: { x: O.x - 8, y: FLOOR + 4, z: O.z - 22.7 }, face: 0 },
  { model: MAIDEN, at: { x: O.x + 9, y: FLOOR + 4, z: O.z - 22.7 }, face: 0 },
  { model: DRAGON, at: EAST_MOUTH, face: -Math.PI / 2 },
  { model: DRAGON, at: WEST_MOUTH, face: Math.PI / 2 },
  // Banners between the portico's columns either side of the doors, and either side of the gatehouse.
  ...[-4.5, 4.5].map((lx) => ({ model: BANNER, at: { x: O.x + lx + 0.5, y: FLOOR + 10, z: O.z - 23.92 }, face: 0 })),
  ...[-4.5, 4.5].map((lx) => ({ model: BANNER, at: { x: O.x + lx + 0.5, y: FLOOR + 9.6, z: O.z + 24.92 }, face: Math.PI })),
];

/** A brazier either side of each cave's mouth, out on the terrace. */
const CAVE_BRAZIERS = CAVES.flatMap((a) =>
  [-4.6, 4.6].map((side) => ({ lx: Math.round(Math.cos(a) * 23.5 - Math.sin(a) * side), lz: Math.round(Math.sin(a) * 23.5 + Math.cos(a) * side) })),
);

const pillarTop = (a: number) => ({ x: O.x + Math.round(Math.cos(a) * PILLAR_R) + 0.5, y: FLOOR + 11.1, z: O.z + Math.round(Math.sin(a) * PILLAR_R) + 0.5 });

/** The cold fires: on the standing pillars, the gatehouse's braziers, the crystal's heart. */
const FIRES: Fire[] = [
  ...PILLARS.filter((_, i) => i !== 2).map((a) => ({ at: pillarTop(a), size: 1, tint: 'frost' as const })),
  ...[-5, 5].map((lx) => ({ at: w(lx, FLOOR + 3.1, 24), size: 0.8, tint: 'frost' as const })),
  ...CAVE_BRAZIERS.map((b) => ({ at: w(b.lx, FLOOR + 3.1, b.lz), size: 0.7, tint: 'frost' as const })),
  { at: { x: C.x, y: FLOOR + 8, z: O.z - 22.5 }, size: 1.3, tint: 'frost' },
];

/** The open water of the frozen pool, as the hazard's zone (the cells it fills). */
function poolZone(): Box[] {
  const zone: Box[] = [];
  for (let lx = -24; lx <= -14; lx++)
    for (let lz = 6; lz <= 17; lz++) if (hole(lx, lz)) zone.push(box({ x: O.x + lx, y: FLOOR - 1, z: O.z + lz }, { x: O.x + lx, y: FLOOR, z: O.z + lz }));
  return zone;
}

const TRAPS: TrapSpec[] = [
  {
    id: 'sanctum.icicles',
    name: 'Icicle Fall',
    kind: 'icicles',
    lever: { at: { x: O.x - 5.5, y: FLOOR + 1, z: O.z + 16.5 }, face: Math.PI },
    price: 80,
    time: 8,
    cooldown: 35,
    zone: [box({ x: O.x - 3, y: FLOOR, z: O.z + 17 }, { x: O.x + 3, y: FLOOR, z: O.z + 24 })],
    vault: FLOOR + 5.4,
  },
  {
    id: 'sanctum.vents',
    name: 'Frost Dragons',
    kind: 'jets',
    element: 'frost',
    lever: { at: { x: O.x + 8.5, y: FLOOR + 1, z: O.z - 14.5 }, face: 0 },
    price: 70,
    time: 7,
    cooldown: 35,
    zone: [],
    jets: [
      { at: { x: EAST_MOUTH.x - 0.4, y: EAST_MOUTH.y, z: EAST_MOUTH.z }, dir: { x: -1, y: 0, z: 0 }, length: 11 },
      { at: { x: WEST_MOUTH.x + 0.4, y: WEST_MOUTH.y, z: WEST_MOUTH.z }, dir: { x: 1, y: 0, z: 0 }, length: 11 },
    ],
  },
];

const cavePen = (a: number) => gateAt(C, a, PEN);

export const SANCTUM: ArenaMap = {
  id: 'sanctum',
  name: 'The Frozen Sanctum',
  line: 'Cold light over a temple of ice',
  color: '#8fd8ff',
  icon: 'ice_bricks',
  origin: C,
  build: () => [ground(), build()],
  center: { x: C.x, y: LOW + 1, z: C.z },
  radius: 22,
  gates: [
    { at: { x: C.x, y: FLOOR + 4.05, z: O.z - 29.5 }, yaw: Math.PI },
    { at: { x: C.x, y: FLOOR + 1.05, z: O.z + 28.5 }, yaw: 0 },
    ...CAVES.map(cavePen),
  ],
  bossGates: [
    { at: { x: C.x, y: LOW + 1.05, z: O.z - 7.5 }, yaw: Math.PI },
    { at: { x: O.x + 8.5, y: LOW + 1.05, z: C.z }, yaw: Math.PI / 2 },
    { at: { x: O.x - 5.5, y: LOW + 1.05, z: O.z - 6.5 }, yaw: Math.atan2(-(C.x - (O.x - 5.5)), -(C.z - (O.z - 6.5))) },
  ],
  portcullises: [
    { at: { x: C.x, y: FLOOR + 4, z: O.z - 26.5 }, yaw: Math.PI, width: 5, height: 5 },
    { at: { x: C.x, y: FLOOR + 1, z: O.z + 25.5 }, yaw: 0, width: 5, height: 5 },
  ],
  lookout: { x: C.x, y: FLOOR + 17, z: O.z - 27.5 },
  time: 0.8,
  dusk: 0.06,
  intro: [
    { at: w(-4, FLOOR + 38, 62), look: w(0, FLOOR + 8, -18) },
    { at: w(-13, FLOOR + 15, 22), look: w(0, FLOOR + 2, 4) },
    { at: w(-12, FLOOR + 9, 3), look: w(0, FLOOR + 7, -23) },
    { at: w(6, FLOOR + 6, -9), look: w(0, LOW + 1, 5) },
  ],
  shop: w(-5, LOW + 1, 8),
  chests: [w(8, LOW + 1, -6), w(21, FLOOR + 1, 9), w(-15, FLOOR + 1, 19)],
  crowd: false,
  traps: TRAPS,
  hazards: [{ kind: 'frost', zone: poolZone() }],
  decor: DECOR,
  fires: FIRES,
  air: { kind: 'snow', heading: 2.3, wind: 1.6, gust: 7, loop: 'amb_ice_wind', calls: ['amb_creak', 'amb_chime'], aurora: true },
};

