import { Blueprint, type BlockRef } from '@platform';
import { box, disc, dist, hash, Patchwork, Place, type Canvas } from './build';
import { spawnAt, type MapSpec, type PostSpec, type SpawnPoint } from './kit';
import * as props from './props';
import * as ships from './ships';

/**
 * Frostline Base: a Rebel outpost on an ice planet, a snowfield between a glacier and the
 * mountains, 768 blocks east of Mos Blockley in the same world (far enough that neither is ever
 * drawn from the other).
 *
 * - **A, the base's hangar** (west, the Rebels' for good): a great cavern cut into the glacier's
 *   cliff, a transport, a Vox-wing and a snowspeeder parked in it; its blast-door mouth
 *   opens east, and a tunnel each side comes out further along the cliff.
 * - **B, the shield generator** (the Rebels' at the start): a big dish on its pylon, walls of
 *   packed snow round the post, and in front of it the trench line: a zigzag of plank-lined
 *   trenches the length of the field, gun emplacements behind them, ramps out and planks across.
 * - **C, the ion cannon** (the middle, nobody's): a great sphere on its base with its barrel to
 *   the sky; its control bunker, power converters and fuel round the post.
 * - **D, the ridge** (the Empire's at the start): a long snow ridge across the field, a pass
 *   through each end, a walker lying dead on its side up on top with its legs out across the post.
 * - **E, the landing zone** (the Empire's for good): a cleared field of plates and bunkers, a
 *   shuttle down, and a walker standing over it all (walk under it).
 *
 * Three ways across: the middle (drifts, the cannon, over or through the ridge), the north (along
 * the mountains' foot, round the ridge's end) and the south (down a frozen gully). The snow's
 * drifts are steep on one side and walkable on the other, some facing each way; rocks and wrecked
 * speeders do the rest. Nothing a bot can climb onto is a pocket it can't walk out of.
 *
 * The world's ground is sand, so the map lays its own snow: the field in one Blueprint, the
 * mountains round it in four more, and a single course of snow out to the view distance.
 */

const OX = 768;
const FLOOR = 64;
const G = FLOOR - 1;
/** How deep the trenches go: feet three down. */
const TRENCH = -3;

/** The play area's edge in the map's own coordinates (mountains and the glacier just outside). */
const WEST = -104;
const EAST = 104;
const NORTH = -58;
const SOUTH = 58;

// The canvases: the field (and the glacier, and the mountains' first slopes), the mountains round
// it, and one course of snow out to where anyone could see.
const field = new Blueprint({ x: OX - 112, y: FLOOR - 6, z: -64 }, { x: 225, y: 40, z: 129 });
const bands = [
  new Blueprint({ x: OX - 150, y: G, z: -94 }, { x: 301, y: 35, z: 30 }),
  new Blueprint({ x: OX - 150, y: G, z: 65 }, { x: 301, y: 35, z: 30 }),
  new Blueprint({ x: OX - 150, y: G, z: -64 }, { x: 38, y: 35, z: 129 }),
  new Blueprint({ x: OX + 113, y: G, z: -64 }, { x: 38, y: 35, z: 129 }),
];
const floor = new Blueprint({ x: OX - 330, y: G, z: -280 }, { x: 661, y: 1, z: 561 });
const canvas = new Patchwork([field, ...bands, floor]);
/** The map in its own coordinates (x from its middle): what's built here lands at OX. */
const L = new Place(canvas, OX, 0);
const set = (x: number, y: number, z: number, b: BlockRef) => L.set(x, y, z, b);
const get = (x: number, y: number, z: number) => L.get(x, y, z);
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined)) =>
  box(L, x0, y0, z0, x1, y1, z1, b);
/** A prop built nose west, put at (x, z) turned `turns` quarter turns. */
const at = (x: number, z: number, turns = 0): Canvas => new Place(L, x, z, turns);

/** Smooth value noise in [0, 1). */
function noise(x: number, z: number, scale: number, k: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const sm = (t: number) => t * t * (3 - 2 * t);
  const tx = sm(fx - ix);
  const tz = sm(fz - iz);
  const a = hash(ix, iz, k) + (hash(ix + 1, iz, k) - hash(ix, iz, k)) * tx;
  const b = hash(ix, iz + 1, k) + (hash(ix + 1, iz + 1, k) - hash(ix, iz + 1, k)) * tx;
  return a + (b - a) * tz;
}

// ---------------------------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------------------------

/** The glacier's cliff: its face a little ragged along the west. */
const faceX = (z: number) => WEST + 27 - Math.round(2 * noise(0, z, 7, 41));
/** Where the mountains start, north, south and east. */
const edgeN = (x: number) => NORTH + 2 - 3 * noise(x, 0, 8, 42);
const edgeS = (x: number) => SOUTH - 2 + 3 * noise(x, 0, 8, 43);
const edgeE = (z: number) => EAST + 1 + 3 * noise(0, z, 8, 44);

/** The hangar's cavern (x from its back to the cliff), and its mouth. */
const CAVE = { x0: -108, x1: -79, z: 16 };
const MOUTH = 9;
const SHIELD = { x: -58, z: -16 };
const CANNON = { x: 4, z: -8 };
const RIDGE = { x: 45, z0: -46, z1: 40 };
const DEAD = { x: 45, z: -2 };
const WALKER = { x: 86, z: 0 };

// ---------------------------------------------------------------------------------------------
// The snowfield: a height for every column of it, in half blocks
// ---------------------------------------------------------------------------------------------

const HX0 = -112;
const HZ0 = -64;
const HW = 225;
const HD = 129;
const heights = new Float32Array(HW * HD);
const hi = (x: number, z: number) => (x < HX0 || z < HZ0 || x >= HX0 + HW || z >= HZ0 + HD ? -1 : x - HX0 + (z - HZ0) * HW);
const H = (x: number, z: number) => {
  const i = hi(x, z);
  return i < 0 ? 0 : heights[i];
};
const raise = (x: number, z: number, h: number) => {
  const i = hi(x, z);
  if (i >= 0) heights[i] = Math.max(heights[i], h);
};
const level = (x: number, z: number, h: number) => {
  const i = hi(x, z);
  if (i >= 0) heights[i] = h;
};
/** Where the paths are trodden (packed snow on top). */
const trodden = new Uint8Array(HW * HD);

/**
 * A drift: `len` either way along z, climbing gently from one side over `wid` blocks to its crest
 * and falling sheer on the other (`lee`: +1, sheer to the east; -1, to the west), rounded off at
 * its ends.
 */
function drift(cx: number, cz: number, len: number, wid: number, height: number, lee: 1 | -1) {
  for (let z = cz - len; z <= cz + len; z++)
    for (let x = cx - wid - 1; x <= cx + wid + 1; x++) {
      const u = (z - cz) / (len + 0.5);
      const v = (x - cx) * lee;
      const across = v > 0 ? (v <= 1 ? 1 : 0) : Math.max(0, 1 + v / wid);
      raise(x, z, height * (1 - u * u) * across);
    }
}

/** A bank of snow: a smooth mound, `rx` by `rz`, `h` high in the middle (climbable, but it hides what's behind it). */
function bank(cx: number, cz: number, rx: number, rz: number, h: number) {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
      if (d < 1) raise(x, z, h * (1 - d * d));
    }
}

/** The banks between the three ways across the field, north and south: snow and rock by turns, with passes (not in line). */
const DIVIDERS: { z: number; passes: number[]; k: number }[] = [
  { z: -27, passes: [-41, -9, 17], k: 1 },
  { z: 27, passes: [-47, -21, 5], k: 2 },
];
const dividerSlots = (d: (typeof DIVIDERS)[number], fn: (x: number, z: number, snow: boolean) => void) => {
  for (let x = -58; x <= 22; x += 4) {
    if (d.passes.some((p) => Math.abs(x - p) < 5)) continue;
    fn(x + 0.5, d.z + 0.5 + (noise(x, d.z, 6, 120 + d.k) - 0.5) * 2, ((x + 58) / 4) % 2 === 0);
  }
};

/** Snow banks elsewhere (x, z, rx, rz, h). */
const BANKS: [number, number, number, number, number][] = [
  [-48, -33, 4, 3.5, 4.5],
  [-18, -33, 4, 3.5, 4.5],
  [8, -33, 4, 3.5, 4.5],
  [-36, -48, 4, 3.5, 4.5],
  [-56, 33, 4, 3.5, 4.5],
  [-28, 33, 4, 3.5, 4.5],
  [2, 33, 4, 3.5, 4.5],
  [-40, 36, 4, 3, 4],
  [-16, 37, 3.5, 3, 4],
  [8, 49, 4, 3.5, 4.5],
  [44, 48, 4, 3.5, 4.5],
  [-40, -15, 4, 3.5, 4.5],
  [-58, 17, 4, 3.5, 4.5],
  [15, -20, 3.5, 3.5, 4.5],
  [30, 4, 3, 4, 4],
  [28, -6, 2.5, 3, 3.5],
  [-22, -13, 3.5, 3.5, 4],
];

/** The ridge D stands on: a long bank four up, walkable up either side anywhere, round the post a wide top. */
function ridge() {
  for (let z = RIDGE.z0 - 8; z <= RIDGE.z1 + 8; z++)
    for (let x = RIDGE.x - 22; x <= RIDGE.x + 22; x++) {
      const along = Math.min(1, Math.max(0, (z - RIDGE.z0 + 8) / 8), Math.max(0, (RIDGE.z1 + 8 - z) / 8));
      let h = Math.min(4, Math.max(0, (13.5 - Math.abs(x - RIDGE.x)) * 0.5)) * along;
      const d = dist(x, z, DEAD.x + 0.5, DEAD.z + 0.5);
      h = Math.max(h, Math.min(4, Math.max(0, (22 - d) * 0.5)));
      raise(x, z, h);
    }
}

/** The gully the south way runs down: two below the field, sloping in at the sides and ends. */
function gully() {
  for (let z = 32; z <= 50; z++)
    for (let x = -66; x <= 34; x++) {
      const across = Math.max(0, Math.abs(z - 41) - 3) * 0.5;
      const ends = Math.max(0, Math.max(-60 - x, x - 28)) * 0.5;
      const h = Math.min(0, -2 + across + ends);
      const i = hi(x, z);
      if (i >= 0) heights[i] = Math.min(heights[i], h);
    }
}

/** The trench line's centre, in axis-aligned legs (x, z corners in order), north to south. */
const TRENCH_LINE: [number, number][] = [
  [-31, -52],
  [-31, -37],
  [-27, -37],
  [-27, -22],
  [-31, -22],
  [-31, -8],
  [-27, -8],
  [-27, 6],
  [-31, 6],
  [-31, 20],
  [-27, 20],
  [-27, 34],
  [-31, 34],
  [-31, 50],
];
/** Ramps out of it, west (toward the base) and east (toward the field), and the planks across it. */
const TRENCH_RAMPS = [-44, -29, -15, 0, 13, 27, 42];
const TRENCH_RAMPS_EAST = [-47, -33, -18, -4, 10, 24, 38];
const TRENCH_PLANKS = [-45, -30, -16, 0, 12, 26, 41];

function trenchCells(fn: (x: number, z: number) => void) {
  for (let i = 0; i + 1 < TRENCH_LINE.length; i++) {
    const [ax, az] = TRENCH_LINE[i];
    const [bx, bz] = TRENCH_LINE[i + 1];
    for (let x = Math.min(ax, bx) - 1; x <= Math.max(ax, bx) + 1; x++) for (let z = Math.min(az, bz) - 1; z <= Math.max(az, bz) + 1; z++) fn(x, z);
  }
}
const inTrench = new Set<number>();

function trenches() {
  trenchCells((x, z) => {
    level(x, z, TRENCH);
    inTrench.add(hi(x, z));
  });
  // Ramps out, six half steps up to the field: west to the base, east to the field.
  for (const rz of TRENCH_RAMPS) {
    let edge = -99;
    for (let x = -40; x <= -20; x++) if (inTrench.has(hi(x, rz))) edge = edge === -99 ? x : edge;
    for (let i = 1; i <= 6; i++) for (let z = rz - 1; z <= rz + 1; z++) level(edge - i, z, TRENCH + i * 0.5);
  }
  for (const rz of TRENCH_RAMPS_EAST) {
    let edge = 99;
    for (let x = -20; x >= -40; x--) if (inTrench.has(hi(x, rz))) edge = edge === 99 ? x : edge;
    for (let i = 1; i <= 6; i++) for (let z = rz - 1; z <= rz + 1; z++) if (!inTrench.has(hi(edge + i, z))) level(edge + i, z, TRENCH + i * 0.5);
  }
}

/** Flatten a disc (the posts, the apron, the landing zone) to the field's level. */
function flat(cx: number, cz: number, r: number) {
  disc(cx, cz, r, (x, z) => {
    if (!inTrench.has(hi(x, z))) level(x, z, 0);
  });
}

/** Tread a path of packed snow between points, `w` wide, a little ragged. */
function path(points: [number, number][], w = 2) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k <= n; k++) {
      const cx = ax + ((bx - ax) * k) / n;
      const cz = az + ((bz - az) * k) / n;
      const r = w + noise(cx, cz, 4, 45) * 1.5;
      disc(cx, cz, r, (x, z) => {
        const j = hi(x, z);
        if (j >= 0) trodden[j] = 1;
      });
    }
  }
}

function snowfield() {
  // Little waves blown into the snow, half a block high.
  for (let z = NORTH; z <= SOUTH; z++) for (let x = WEST; x <= EAST; x++) if (noise(x, z, 5, 46) > 0.74) raise(x, z, 0.5);
  // Drifts: sheer to the east shelter the Rebels, sheer to the west the Empire.
  const DRIFTS: [number, number, number, number, number, 1 | -1][] = [
    [-15, -20, 8, 5, 3, 1],
    [-17, 24, 7, 5, 3, 1],
    [17, 26, 8, 5, 3, -1],
    [19, -27, 7, 5, 3, -1],
    [-46, -42, 7, 4, 2.5, 1],
    [-2, -44, 6, 4, 2.5, 1],
    [24, -48, 5, 4, 2.5, -1],
    [68, -42, 6, 4, 2.5, -1],
    [68, 42, 6, 4, 2.5, -1],
    [-64, 30, 6, 4, 2.5, 1],
    [-64, -30, 6, 4, 2.5, 1],
    [-8, 50, 5, 4, 2.5, 1],
  ];
  for (const [x, z, len, wid, h, lee] of DRIFTS) drift(x, z, len, wid, h, lee);
  ridge();
  gully();
  for (const [x, z, rx, rz, h] of BANKS) bank(x, z, rx, rz, h);
  for (const d of DIVIDERS) dividerSlots(d, (x, z, snow) => snow && bank(x, z, 4.5, 3.6, 5));
  trenches();
  // Level ground for the posts, the hangar's apron, the cannon and the landing zone.
  flat(-63, 0, 15);
  flat(-48, 4, 12);
  flat(SHIELD.x, SHIELD.z, 9);
  flat(CANNON.x, CANNON.z, 12);
  flat(2, 10, 11);
  for (let z = -40; z <= 40; z++) for (let x = 62; x <= EAST + 4; x++) level(x, z, 0);
  // Round to half blocks (slabs).
  for (let i = 0; i < heights.length; i++) heights[i] = Math.round(heights[i] * 2) / 2;
  // The ways trodden between the posts.
  path([[-76, 0], [-62, 0], [-48, 4], [-36, 4], [-20, 8], [2, 10], [24, 4], [36, -2], [45, -2], [58, 0], [70, 0], [86, 0]], 2);
  path([[-76, -32], [-60, -44], [-30, -46], [0, -50], [30, -52], [60, -50], [80, -30]]);
  path([[-76, 32], [-62, 41], [-30, 41], [0, 41], [28, 41], [45, 50], [70, 44], [82, 28]]);
}

/**
 * Write a column of the field at feet height FLOOR + h: snow to the top (a slab for a half),
 * packed snow on a trodden path, dug out below the field's level where it's lower.
 */
function column(x: number, z: number, h: number) {
  const feet = FLOOR + h;
  const top = Math.floor(feet) - 1;
  const half = feet - Math.floor(feet) >= 0.5;
  const worn = trodden[hi(x, z)] === 1 && !inTrench.has(hi(x, z));
  for (let y = FLOOR - 6; y <= top; y++) set(x, y, z, y === top && worn && !half ? 'packed_snow' : 'snow_block');
  if (half) set(x, top + 1, z, 'snow_slab');
  for (let y = top + (half ? 2 : 1); y <= G; y++) set(x, y, z, 'air');
}

// ---------------------------------------------------------------------------------------------
// The glacier and the mountains round the field
// ---------------------------------------------------------------------------------------------

/** How high the mountains stand over a column outside the field (0: none). */
function mountain(x: number, z: number): number {
  const out = Math.max(edgeN(x) - z, z - edgeS(x), x - edgeE(z));
  if (out <= 0) return 0;
  const peaks = 16 * noise(x, z, 23, 47) + 8 * noise(x, z, 9, 48);
  return Math.round(Math.min(33, 6 + out * 1.6 + peaks));
}

/** How high the glacier stands over a column west of its cliff (0: none). */
function glacier(x: number, z: number): number {
  if (x >= faceX(z)) return 0;
  return Math.round(Math.min(33, 22 + 5 * noise(x, z, 11, 49) + Math.max(0, faceX(z) - x - 20) * 0.3));
}

/** Rock or ice faces where a column stands clear of its neighbour, snow on top. */
function peak(x: number, z: number, h: number, face: BlockRef, heightOf: (x: number, z: number) => number) {
  const low = Math.min(heightOf(x + 1, z), heightOf(x - 1, z), heightOf(x, z + 1), heightOf(x, z - 1));
  for (let k = 0; k <= h; k++) {
    const y = G + k;
    const snowy = k >= h - (h - low <= 1 ? 1 : 0);
    set(x, y, z, snowy ? 'snow_block' : (k + Math.floor(noise(x, z, 5, 50) * 3)) % 7 === 0 ? 'ice' : face);
  }
}

function surroundings() {
  // Every column's height once (the faces below look at their neighbours'): glacier or mountain.
  const X0 = -151;
  const Z0 = -95;
  const W = 303;
  const D = 191;
  const tall = new Float32Array(W * D);
  const isGlacier = new Uint8Array(W * D);
  for (let z = Z0; z < Z0 + D; z++)
    for (let x = X0; x < X0 + W; x++) {
      const g = glacier(x, z);
      const m = mountain(x, z);
      const i = x - X0 + (z - Z0) * W;
      tall[i] = Math.max(g, m);
      isGlacier[i] = g >= m && g > 0 ? 1 : 0;
    }
  const both = (x: number, z: number) => (x < X0 || z < Z0 || x >= X0 + W || z >= Z0 + D ? 0 : tall[x - X0 + (z - Z0) * W]);
  for (let z = -94; z <= 94; z++)
    for (let x = -150; x <= 150; x++) {
      const i = x - X0 + (z - Z0) * W;
      if (tall[i] > 0) peak(x, z, tall[i], isGlacier[i] ? 'glacier' : 'frost_rock', both);
    }
  // One course of snow over the sand everywhere else anyone could see.
  for (let z = -280; z <= 280; z++) for (let x = -330; x <= 330; x++) if (x < -150 || x > 150 || z < -94 || z > 94) set(x, G, z, 'snow_block');
}

// ---------------------------------------------------------------------------------------------
// A: the hangar in the glacier
// ---------------------------------------------------------------------------------------------

function hangar() {
  const ceiling = (z: number) => FLOOR + 7 + Math.round(6 * Math.sqrt(Math.max(0, 1 - (z / (CAVE.z + 1)) ** 2)));
  for (let z = -CAVE.z; z <= CAVE.z; z++)
    for (let x = CAVE.x0; x <= faceX(z) + 1; x++) {
      const mouth = x > CAVE.x1;
      if (mouth && Math.abs(z) > MOUTH) continue;
      const top = mouth ? FLOOR + 9 : ceiling(z);
      set(x, G, z, (x + z) % 6 === 0 ? 'floor_grate' : Math.abs(z) === 3 && x < CAVE.x1 ? 'hazard' : 'base_panel');
      for (let y = FLOOR; y <= top; y++) set(x, y, z, 'air');
    }
  // Panels up the walls, a strip of lights over them; lights hung along the vault.
  for (let z = -CAVE.z - 1; z <= CAVE.z + 1; z++)
    for (let x = CAVE.x0 - 1; x <= CAVE.x1; x++) {
      if (Math.abs(z) <= CAVE.z && x >= CAVE.x0) continue;
      for (let y = FLOOR; y <= FLOOR + 3; y++) set(x, y, z, y === FLOOR + 3 && (x + z) % 3 === 0 ? 'rebel_light' : 'base_panel');
    }
  for (let x = CAVE.x0 + 2; x < CAVE.x1; x += 4) for (const z of [-9, 0, 9]) set(x, ceiling(z), z, 'rebel_light');
  // The blast doors' frame round the mouth: panels, a lintel of lights, hazard at the foot.
  for (let z = -MOUTH - 2; z <= MOUTH + 2; z++) {
    const fx = faceX(z) + 1;
    for (let y = FLOOR; y <= FLOOR + 11; y++) {
      const post = Math.abs(z) > MOUTH;
      if (!post && y < FLOOR + 10) continue;
      set(fx, y, z, y === FLOOR + 10 && z % 3 === 0 ? 'rebel_light' : post && y === FLOOR ? 'hazard' : 'base_panel');
    }
  }
  // The transport along the north wall, nose to the mouth; a fighter and a speeder in the south half.
  ships.transport(at(-93, -9, 2), FLOOR);
  ships.xfighter(at(-104, 8, 2), FLOOR, 'orange_concrete');
  ships.snowspeeder(at(-87, 12, 2), FLOOR);
  props.crates(L, -107, FLOOR, 14, 2, 2, 2, 60);
  props.drums(L, -83, FLOOR, 13, 4, 61);
  props.crates(L, -104, FLOOR, -2, 2, 2, 1, 62);
  props.crates(L, -84, FLOOR, -14, 3, 2, 2, 63);
  props.commandPost(L, -88, FLOOR, 3, 'pad_amber', 2);
  // Cargo stacked just inside the mouth, staggered: cover coming in, and nobody sees the length of it.
  props.crates(L, -82, FLOOR, -4, 2, 4, 3, 66);
  props.crates(L, -84, FLOOR, 7, 2, 3, 3, 67);
  props.crates(L, -96, FLOOR, -3, 2, 3, 2, 68);
  // The tunnels north and south: along the cavern's side, out through the cliff further on.
  for (const s of [-1, 1]) {
    const tunnel = (x0: number, z0: number, x1: number, z1: number) =>
      fill(x0, G, z0, x1, FLOOR + 4, z1, (x, y, z) => {
        const edge = x === x0 || x === x1 ? (z === z0 || z === z1 ? 2 : 1) : z === z0 || z === z1 ? 1 : 0;
        if (y === G) return 'base_panel';
        if (y === FLOOR + 4) return edge ? undefined : (x + z) % 4 === 0 ? 'rebel_light' : 'air';
        return 'air';
      });
    tunnel(-97, s < 0 ? -34 : 16, -93, s < 0 ? -16 : 34);
    const zz = s * 32;
    for (let x = -97; x <= faceX(zz) + 1; x++) tunnel(x, zz - 2, x, zz + 2);
    for (let x = -96; x <= faceX(zz) + 1; x += 5) set(x, FLOOR + 2, zz - s * 3, 'rebel_light');
    // A frame where it comes out.
    const fx = faceX(zz) + 1;
    fill(fx, FLOOR, zz - 3, fx, FLOOR + 5, zz + 3, (_x, y, z) => (Math.abs(z - zz) <= 2 && y <= FLOOR + 3 ? undefined : 'base_panel'));
  }
  // The blast doors, swung open against the cliff either side of the mouth, and blast shields
  // standing out on the apron.
  for (const sgn of [-1, 1]) fill(faceX(sgn * 10) + 2, FLOOR, sgn * 10, faceX(sgn * 10) + 7, FLOOR + 8, sgn * 10, (x, y) => (y === FLOOR + 8 ? 'durasteel_dark' : (x + y) % 4 === 0 ? 'hazard' : 'base_panel'));
  fill(-69, FLOOR, -9, -69, FLOOR + 2, -4, (_x, y) => (y === FLOOR + 2 ? 'durasteel_dark' : 'base_panel'));
  fill(-62, FLOOR, 5, -62, FLOOR + 2, 9, (_x, y) => (y === FLOOR + 2 ? 'durasteel_dark' : 'base_panel'));
  // A sensor mast in the middle of the apron: panels, lights, an antenna.
  fill(-67, FLOOR, 1, -65, FLOOR + 7, 3, (x, y, z) => (y === FLOOR + 7 ? 'durasteel_dark' : y === FLOOR + 5 && (x + z) % 2 === 0 ? 'rebel_light' : 'base_panel'));
  fill(-66, FLOOR + 8, 2, -66, FLOOR + 12, 2, 'vaporator_pipe');
  set(-66, FLOOR + 13, 2, 'pad_amber');
  // The apron: landing lights, cover, a gun.
  for (let z = -MOUTH; z <= MOUTH; z += 4) for (const x of [-74, -66]) set(x, G, z, 'pad_amber');
  props.crates(L, -70, FLOOR, -12, 2, 2, 2, 64);
  props.crates(L, -68, FLOOR, 10, 3, 2, 2, 65);
  props.banner(L, faceX(-15) + 2, FLOOR, -16, 'banner_rebel', 9);
  props.banner(L, faceX(15) + 2, FLOOR, 13, 'banner_rebel', 9);
}

// ---------------------------------------------------------------------------------------------
// B: the shield generator and the trench line
// ---------------------------------------------------------------------------------------------

/** A wall of packed snow, two high with a slab on top, along x or z. */
function snowWall(x: number, z: number, n: number, along: 'x' | 'z') {
  for (let i = 0; i < n; i++) {
    const cx = along === 'x' ? x + i : x;
    const cz = along === 'z' ? z + i : z;
    const y = FLOOR + Math.floor(H(cx, cz));
    set(cx, y, cz, 'packed_snow');
    set(cx, y + 1, cz, hash(cx, cz, 70) < 0.3 ? 'snow_slab' : 'snow_block');
  }
}

function shieldGenerator() {
  const { x: cx, z: cz } = SHIELD;
  // A round plinth, the pylon, the dish on top tilted to the east's sky.
  disc(cx + 0.5, cz + 0.5, 6.5, (x, z, d) => set(x, FLOOR, z, d > 5.5 ? 'durasteel_dark' : 'base_panel'));
  fill(cx - 1, FLOOR + 1, cz - 1, cx + 2, FLOOR + 9, cz + 2, (x, y, z) => ((y - FLOOR) % 4 === 0 ? 'durasteel_dark' : (x + z) % 2 === 0 ? 'base_panel' : 'hull'));
  const R = 9;
  const tilt = (35 * Math.PI) / 180;
  for (let u = -R; u <= R; u += 0.5)
    for (let v = -R; v <= R; v += 0.5) {
      const r = Math.hypot(u, v);
      if (r > R) continue;
      const w = (r * r) / (4 * 7);
      // Tilt the bowl (u along x, w up) toward the east.
      const x = cx + 0.5 + u * Math.cos(tilt) + w * Math.sin(tilt) * -1;
      const y = FLOOR + 12 + w * Math.cos(tilt) + u * Math.sin(tilt);
      set(Math.floor(x), Math.floor(y), Math.floor(cz + 0.5 + v), r > R - 0.8 ? 'durasteel_dark' : 'base_panel');
    }
  fill(cx, FLOOR + 10, cz, cx + 1, FLOOR + 12, cz + 1, 'durasteel_dark');
  set(cx, FLOOR + 17, cz, 'pad_blue');
  // Equipment round the plinth.
  props.crates(L, cx + 5, FLOOR, cz + 5, 2, 2, 2, 71);
  fill(cx - 6, FLOOR, cz + 3, cx - 5, FLOOR + 2, cz + 5, (_x, y) => (y === FLOOR + 2 ? 'rebel_light' : 'durasteel_dark'));
}

function trenchWorks() {
  // Plank walls down the trenches' sides, a snow parapet along the east lip.
  trenchCells((x, z) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (inTrench.has(hi(nx, nz)) || H(nx, nz) < 0) continue;
      for (let y = FLOOR + TRENCH; y < FLOOR; y++) set(nx, y, nz, (nx + nz) % 4 === 0 ? 'spruce_log' : 'spruce_planks');
      if (dx === 1 && hash(nx, nz, 72) < 0.8) set(nx, FLOOR, nz, hash(nx, nz, 73) < 0.5 ? 'snow_block' : 'packed_snow');
    }
  });
  // Where the banks between the ways cross the line, the trench is roofed over (a dugout).
  for (const dz of [-27, 27])
    trenchCells((x, z) => {
      if (Math.abs(z - dz) > 3) return;
      set(x, FLOOR, z, 'spruce_planks');
      set(x, FLOOR + 1, z, 'snow_block');
    });
  // Planks across.
  for (const pz of TRENCH_PLANKS)
    for (let x = -34; x <= -24; x++)
      for (let z = pz; z <= pz + 1; z++) if (inTrench.has(hi(x, z))) set(x, G, z, 'spruce_planks');
  // Guns behind the line, facing the field.
  for (const [x, z] of [[-38, -30], [-38, -1], [-38, 26]] as const) props.turret(at(x, z, 2), 0, FLOOR, 0);
  // Supports and crates along the trenches' floor.
  props.crates(L, -32, FLOOR + TRENCH, -30, 1, 2, 1, 74);
  props.drums(L, -28, FLOOR + TRENCH, 16, 2, 75);
}

function postB() {
  // Walls of packed snow round the post, broken for the ways through.
  snowWall(-56, -4, 5, 'z');
  snowWall(-56, 6, 7, 'z');
  snowWall(-44, -6, 6, 'x');
  snowWall(-50, 14, 7, 'x');
  snowWall(-40, 8, 4, 'z');
  props.crates(L, -45, FLOOR, 1, 2, 2, 2, 76);
  props.drums(L, -52, FLOOR, 8, 3, 77);
  props.commandPost(L, -48, FLOOR, 4, 'pad_amber', 2);
}

// ---------------------------------------------------------------------------------------------
// C: the ion cannon
// ---------------------------------------------------------------------------------------------

function ionCannon() {
  const { x: cx, z: cz } = CANNON;
  // Its base: a drum four high, dark banded.
  disc(cx + 0.5, cz + 0.5, 6.5, (x, z) => fill(x, FLOOR, z, x, FLOOR + 3, z, (_x, y) => (y === FLOOR || y === FLOOR + 3 ? 'durasteel_dark' : 'base_panel')));
  // The sphere, panelled, a dark band round its middle.
  const sy = FLOOR + 10;
  const R = 7;
  for (let y = sy - R; y <= sy + R; y++)
    disc(cx + 0.5, cz + 0.5, R, (x, z) => {
      const d = Math.hypot(x + 0.5 - cx - 0.5, y + 0.5 - sy, z + 0.5 - cz - 0.5);
      if (d > R || d < R - 1.6) return;
      set(x, y, z, Math.abs(y - sy) < 1 ? 'durasteel_dark' : (x + y + z) % 7 === 0 ? 'hull_dark' : 'hull');
    });
  // The barrel, up and to the east, a muzzle ring at its end.
  const dir = [0.62, 0.78];
  for (let t = 5; t <= 22; t += 0.4)
    for (let a = -1.6; a <= 1.6; a += 0.4)
      for (let b = -1.6; b <= 1.6; b += 0.4) {
        if (Math.hypot(a, b) > 1.6) continue;
        const ring = t > 20.5;
        if (!ring && Math.hypot(a, b) > 1.2) continue;
        const x = cx + 0.5 + dir[0] * t - dir[1] * a;
        const y = sy + 0.5 + dir[1] * t + dir[0] * a;
        set(Math.floor(x), Math.floor(y), Math.floor(cz + 0.5 + b), ring ? 'durasteel_dark' : 'hull');
      }
}

function postC() {
  // The control bunker: a squat hall half dug in, a door at each end, lights inside.
  fill(-14, FLOOR, 6, -5, FLOOR + 4, 12, (x, y, z) => {
    const edge = x === -14 || x === -5 || z === 6 || z === 12;
    if (y === FLOOR + 4) return 'durasteel_dark';
    if (!edge) return y === FLOOR + 3 && (x + z) % 3 === 0 ? 'rebel_light' : 'air';
    if ((x === -14 || x === -5) && z >= 8 && z <= 10 && y < FLOOR + 3) return 'air';
    return y === FLOOR + 2 && z === 6 && x % 3 === 0 ? 'cockpit' : 'base_panel';
  });
  fill(-13, G, 7, -6, G, 11, 'floor_grate');
  // Power converters, fuel, low walls round the post.
  for (const [x, z] of [[8, 4], [12, 14], [-2, 17], [-4, 1], [13, 10]] as const)
    fill(x, FLOOR, z, x + 1, FLOOR + 2, z + 2, (xx, y, zz) => (y === FLOOR + 2 ? (xx === x && zz === z + 1 ? 'pad_blue' : 'base_panel') : y === FLOOR + 1 && zz === z + 1 ? 'hazard' : 'durasteel_dark'));
  props.drums(L, 6, FLOOR, 17, 4, 80);
  props.crates(L, -4, FLOOR, 2, 2, 2, 2, 81);
  snowWall(14, 6, 5, 'z');
  snowWall(-6, 20, 5, 'x');
  props.commandPost(L, 2, FLOOR, 10, 'pad_blue', 2);
  // The approaches: low walls of packed snow and cargo, staggered, between the trench and the
  // cannon and between the cannon and the ridge.
  snowWall(-23, 6, 4, 'z');
  snowWall(-17, -10, 4, 'z');
  snowWall(-12, 15, 5, 'x');
  snowWall(-25, -3, 3, 'x');
  snowWall(19, 2, 4, 'z');
  snowWall(22, -5, 4, 'x');
  snowWall(16, 18, 4, 'x');
  props.crates(L, -19, FLOOR, 12, 2, 2, 2, 82);
  props.crates(L, 10, FLOOR, -3, 2, 2, 2, 83);
  props.drums(L, -14, FLOOR, 1, 3, 84);
  ships.snowspeeder(at(22, 10, 1), FLOOR, true);
}

// ---------------------------------------------------------------------------------------------
// D: the ridge and its dead walker; E: the landing zone
// ---------------------------------------------------------------------------------------------

function postD() {
  const top = FLOOR + 4;
  ships.walkerWreck(at(DEAD.x, DEAD.z - 7, 2), top);
  ships.walkerHead(at(32, -24, 1), FLOOR + H(32, -24));
  // Wreckage strewn about, scorch in the snow.
  for (let i = 0; i < 18; i++) {
    const x = DEAD.x - 12 + Math.floor(hash(i, 1, 82) * 24);
    const z = DEAD.z - 16 + Math.floor(hash(i, 2, 82) * 22);
    const y = FLOOR + Math.floor(H(x, z));
    if (get(x, y, z) === undefined || get(x, y, z) === 'air') set(x, y - 1, z, hash(i, 3, 82) < 0.5 ? 'gray_concrete' : 'hull_dark');
  }
  props.crates(L, 40, top, 4, 2, 2, 2, 83);
  // Armour plates blown off it, lying on the slope toward the field: cover coming up.
  for (const [x, z, n] of [[35, 6, 3], [36, -12, 3], [33, -2, 2]] as const) {
    const y = FLOOR + Math.floor(H(x, z));
    fill(x, y, z, x, y + 1, z + n - 1, (_x, yy) => (yy === y ? 'durasteel_dark' : 'durasteel'));
  }
  props.drums(L, 50, top, 3, 3, 84);
  props.commandPost(L, DEAD.x, top, DEAD.z, 'imperial_red', 2);
}

function landingZone() {
  // Plates laid on the snow, the walker's feet planted among them.
  for (let z = -30; z <= 30; z++)
    for (let x = 64; x <= 100; x++) {
      const plate = Math.abs(x - WALKER.x) <= 13 && Math.abs(z) <= 9;
      if (plate) set(x, G, z, (x & 3) === 0 || (z & 3) === 0 ? 'durasteel_dark' : 'floor_grate');
    }
  ships.walker(at(WALKER.x, WALKER.z), FLOOR);
  // A shuttle down on the north side, a pad on the south.
  disc(92.5, -24.5, 9, (x, z, d) => set(x, G, z, d > 8 ? ((x + z) % 2 ? 'imperial_light' : 'durasteel_dark') : 'durasteel'));
  ships.shuttle(at(93, -24), FLOOR);
  disc(90.5, 24.5, 7, (x, z, d) => set(x, G, z, d > 6 ? ((x + z) % 2 ? 'imperial_red' : 'durasteel_dark') : 'durasteel'));
  // Bunkers: prefab huts with a door on the side away from the field.
  for (const [x0, z0, door] of [[68, -20, 1], [68, 13, 1], [98, -10, -1], [98, 5, -1]] as const) {
    fill(x0, FLOOR, z0, x0 + 5, FLOOR + 4, z0 + 5, (x, y, z) => {
      const edge = x === x0 || x === x0 + 5 || z === z0 || z === z0 + 5;
      if (y === FLOOR + 4) return 'durasteel_dark';
      if (!edge) return 'air';
      const doorX = door > 0 ? x0 + 5 : x0;
      if (x === doorX && z >= z0 + 2 && z <= z0 + 3 && y < FLOOR + 3) return 'air';
      return y === FLOOR + 2 && (x + z) % 3 === 0 ? 'imperial_light' : y === FLOOR ? 'durasteel_dark' : 'durasteel';
    });
    fill(x0 + 1, G, z0 + 1, x0 + 4, G, z0 + 4, 'floor_grate');
  }
  // Barriers of plate across the zone's north and south ends, staggered.
  for (const sgn of [-1, 1]) for (const [x0, zz] of [[66, 34], [78, 34], [90, 34], [72, 38], [84, 38], [96, 38]] as const) fill(x0, FLOOR, sgn * zz, x0 + 6, FLOOR + 2, sgn * zz, (x, y) => (y === FLOOR + 2 ? 'durasteel_dark' : y === FLOOR + 1 && x % 3 === 0 ? 'imperial_red' : 'durasteel'));
  // Cargo and barriers across the zone.
  props.crates(L, 76, FLOOR, -8, 2, 3, 2, 85);
  props.crates(L, 76, FLOOR, 6, 2, 3, 2, 86);
  props.crates(L, 94, FLOOR, -2, 2, 2, 2, 87);
  for (const s of [-1, 1]) fill(65, FLOOR, s * 4, 66, FLOOR + 1, s * 8, (_x, y) => (y === FLOOR ? 'durasteel_dark' : 'hull_dark'));
  props.crates(L, 74, FLOOR, -27, 2, 2, 2, 91);
  props.crates(L, 88, FLOOR, -30, 3, 2, 2, 93);
  props.crates(L, 92, FLOOR, 15, 2, 2, 2, 95);
  props.crates(L, 90, FLOOR, -17, 2, 2, 2, 96);
  props.crates(L, 101, FLOOR, 30, 2, 3, 2, 97);
  props.crates(L, 101, FLOOR, -32, 2, 3, 2, 98);
  props.crates(L, 82, FLOOR, 28, 3, 2, 2, 94);
  props.crates(L, 74, FLOOR, 25, 2, 2, 2, 92);
  props.banner(L, 64, FLOOR, -14, 'banner_imperial', 8);
  props.banner(L, 64, FLOOR, 11, 'banner_imperial', 8);
  props.commandPost(L, 86, FLOOR, 0, 'imperial_red', 2);
}

// ---------------------------------------------------------------------------------------------
// The field's furniture: rocks, wrecks
// ---------------------------------------------------------------------------------------------

/**
 * A mass of frost rock (an ellipse `rx` by `rz`) with ice in it and snow on top: sheer at the foot
 * (three up at least, nobody climbs it), lumpy above. Trenches go round it.
 */
function rock(cx: number, cz: number, rx: number, rz: number, h: number, k: number) {
  const inside = (x: number, z: number) => Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
  const base = FLOOR + footprintTop((fn) => {
    for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) if (inside(x, z) <= 1) fn(x, z);
  });
  for (let z = Math.floor(cz - rz - 1); z <= Math.ceil(cz + rz + 1); z++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const d = inside(x, z);
      if (d > 1 || inTrench.has(hi(x, z))) continue;
      const top = base + Math.round(3 + (h - 3) * (1 - d ** 6) + (noise(x, z, 2, 90 + k) - 0.5) * 2.5);
      for (let y = FLOOR + Math.floor(H(x, z)); y < top; y++) set(x, y, z, y === top - 1 ? 'snow_block' : hash(x, y, z + k) < 0.12 ? 'ice' : 'frost_rock');
    }
}

/**
 * The highest ground under a footprint (its cells given to `each`), in whole blocks: rocks and ice
 * stand three up from there at the least, so nothing on a slope beside them is a step onto them.
 */
function footprintTop(each: (fn: (x: number, z: number) => void) => void): number {
  let top = -99;
  each((x, z) => (top = Math.max(top, Math.ceil(H(x, z)))));
  return top;
}

/** Seracs: a cluster of jagged ice columns, tall, blue, snow on their tops. */
function serac(cx: number, cz: number, r: number, h: number, k: number) {
  const base = FLOOR + footprintTop((fn) => disc(cx + 0.5, cz + 0.5, r, (x, z) => fn(x, z)));
  disc(cx + 0.5, cz + 0.5, r, (x, z, d) => {
    if (inTrench.has(hi(x, z))) return;
    const top = base + Math.max(3, Math.round(h * (0.55 + 0.45 * noise(x, z, 2, 110 + k)) * (1 - 0.35 * (d / r))));
    for (let y = FLOOR + Math.floor(H(x, z)); y < top; y++) set(x, y, z, y === top - 1 && hash(x, z, k) < 0.6 ? 'snow_block' : (x + z + y) % 5 === 0 ? 'glacier' : 'ice');
  });
}

function scatter() {
  // The rock in the banks between the ways (the snow's in the field already).
  for (const d of DIVIDERS) dividerSlots(d, (x, z, snow) => snow || rock(x, z, 3.2, 2.6, 6 + Math.round(noise(x, z, 4, 121 + d.k) * 2), d.k * 100 + Math.round(x)));
  // Across the middle: rock and ice staggered, so nobody sees along it.
  rock(-12, -6, 2.6, 7, 6, 1);
  serac(-20, 14, 3.5, 8, 2);
  rock(20, -12, 2.8, 5.5, 6, 3);
  serac(24, 13, 3, 8, 4);
  serac(15, -46, 2.5, 7, 47);
  serac(-19, 3, 2.9, 6, 48);
  // The landing zone's flanks.
  rock(62, -26, 3, 3, 6, 35);
  rock(62, 26, 3, 3, 6, 36);
  rock(-58, 46, 3, 3, 6, 51);
  serac(-44, 22, 2, 6, 52);
  serac(-34, -12, 2, 5, 50);
  for (const [x, z] of [[-60, 56], [-30, 57], [0, 56], [50, 56], [90, 55]] as const) rock(x, z, 4, 3, 7, 50 + x);
  // Along the north way, and against the mountains' foot.
  rock(-40, -56, 4, 3, 7, 23);
  rock(12, -56, 4, 3, 8, 24);
  rock(60, -55, 4, 3, 7, 25);
  rock(88, -52, 3, 3, 6, 26);
  serac(-60, -44, 3, 8, 5);
  rock(-26, -52, 4, 4, 6, 6);
  serac(-8, -40, 3, 7, 7);
  rock(26, -40, 4, 4, 6, 8);
  serac(8, -52, 3, 8, 9);
  rock(58, -49, 3, 3, 5, 10);
  // Down the south way's gully.
  serac(-44, 40, 2.5, 7, 11);
  rock(-26, 46, 3, 3, 6, 12);
  serac(-4, 38, 2.5, 8, 13);
  rock(14, 44, 3, 3, 6, 14);
  rock(58, 47, 3, 3, 5, 15);
  // Between the gully and the south bank, and against the mountains' foot.
  rock(-50, 51, 4, 3, 7, 30);
  rock(-10, 52, 4, 3, 7, 31);
  rock(30, 52, 4, 3, 8, 32);
  rock(72, 51, 4, 3, 7, 33);
  rock(102, -20, 3, 3, 7, 42);
  rock(102, 20, 3, 3, 7, 43);
  rock(66, -46, 3, 3, 6, 44);
  rock(66, 46, 3, 3, 6, 45);
  // By the base's apron, north and south, and ice buttresses out of the glacier's cliff.
  serac(-70, -38, 3.5, 9, 16);
  serac(-70, 38, 3.5, 9, 17);
  serac(-62, -24, 3, 8, 37);
  serac(-62, 24, 3, 8, 38);
  for (const bz of [-46, -20, 20, 46])
    for (let z = bz - 3; z <= bz + 3; z++) {
      const fx = faceX(z);
      const reach = 5 - Math.abs(z - bz) * 1.2;
      for (let x = fx; x <= fx + reach; x++) for (let y = FLOOR; y < FLOOR + 12 - Math.abs(z - bz) * 2; y++) set(x, y, z, (x + y + z) % 6 === 0 ? 'ice' : 'glacier');
    }
  // Speeders that didn't make it.
  ships.snowspeeder(at(-8, 30, 1), FLOOR + H(-8, 30), true);
  ships.snowspeeder(at(20, -44, 3), FLOOR + H(20, -44), true);
  ships.snowspeeder(at(-22, 41, 2), FLOOR + H(-22, 41), true);
  // Crates dropped along the ways.
  props.crates(L, -20, FLOOR + H(-20, -6), -6, 2, 1, 2, 88);
  props.crates(L, 86, FLOOR, -13, 2, 2, 2, 89);
  props.crates(L, 86, FLOOR, 12, 2, 2, 2, 90);
}

/** What snow settles on: flat tops of plate, panels, hulls and cargo. */
const SETTLES = new Set(['durasteel', 'durasteel_dark', 'base_panel', 'hull', 'hull_dark', 'crate', 'crate_metal', 'hazard', 'floor_grate', 'spruce_planks', 'vaporator_base']);

/** A dusting of snow (a slab) on every open-topped roof and machine three or more up. */
function dust() {
  const topY = field.origin.y + field.size.y - 1;
  for (let z = HZ0; z < HZ0 + HD; z++)
    for (let x = HX0; x < HX0 + HW; x++) {
      let y = topY;
      while (y > FLOOR + 2 && (get(x, y, z) === undefined || get(x, y, z) === 'air')) y--;
      const b = get(x, y, z);
      if (y > FLOOR + 2 && y < topY && typeof b === 'string' && SETTLES.has(b)) set(x, y + 1, z, 'snow_slab');
    }
}

// ---------------------------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------------------------

function build() {
  snowfield();
  for (let z = HZ0; z < HZ0 + HD; z++)
    for (let x = HX0; x < HX0 + HW; x++) {
      if (x >= faceX(z) - 1 && mountain(x, z) === 0) column(x, z, H(x, z));
    }
  surroundings();
  hangar();
  shieldGenerator();
  trenchWorks();
  postB();
  ionCannon();
  postC();
  postD();
  landingZone();
  scatter();
  dust();
}
build();

// ---------------------------------------------------------------------------------------------
// The posts
// ---------------------------------------------------------------------------------------------

/** Whether a cell is clear for a body: nothing there, air, or cloth overhead. */
const clear = (x: number, y: number, z: number) => {
  const b = get(x, y, z);
  return b === undefined || b === 'air' || (typeof b === 'string' && b.startsWith('awning'));
};
/** Whether something stands under a cell to stand on. */
const footing = (x: number, y: number, z: number) => {
  const b = get(x, y - 1, z);
  if (b === undefined) return y - 1 <= G;
  return b !== 'air' && !(typeof b === 'string' && (b.startsWith('awning') || b.startsWith('ladder')));
};

/** A spawn point near (x, y, z) in the map's coordinates, facing (tx, tz): the nearest open column. */
function s(x: number, y: number, z: number, tx: number, tz: number): SpawnPoint {
  for (let r = 0; r <= 4; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = x + dx;
        const cz = z + dz;
        for (const yy of [y, y + 0.5, y - 0.5, y + 1, y - 1]) {
          const fy = Math.floor(yy);
          if (footing(cx, fy, cz) && clear(cx, fy, cz) && clear(cx, fy + 1, cz)) return spawnAt(OX + cx, get(cx, fy - 1, cz) === 'snow_slab' ? fy - 0.5 : fy, cz, OX + tx, tz);
        }
      }
  throw new Error(`frostline: no room for a spawn near (${x}, ${y}, ${z})`);
}
/** A post's middle in the world. */
const post = (x: number, y: number, z: number) => ({ x: OX + x + 0.5, y, z: z + 0.5 });

const POSTS: PostSpec[] = [
  {
    id: 'A',
    name: 'the hangar',
    at: post(-88, FLOOR, 3),
    radius: 7,
    owner: 0,
    locked: true,
    spawns: [
      s(-101, FLOOR, 5, -88, 3),
      s(-101, FLOOR, -3, -88, 3),
      s(-96, FLOOR, 2, -80, 0),
      s(-96, FLOOR, -2, -80, 0),
      s(-86, FLOOR, 8, -76, 0),
      s(-84, FLOOR, -4, -76, 0),
      s(-95, FLOOR, -24, -88, 0),
      s(-95, FLOOR, 24, -88, 0),
      s(-100, FLOOR, 14, -80, 0),
      s(-102, FLOOR, 1, -80, 0),
    ],
  },
  {
    id: 'B',
    name: 'the shield generator',
    at: post(-48, FLOOR, 4),
    radius: 8,
    owner: 0,
    spawns: [
      s(-60, FLOOR, 4, -48, 4),
      s(-60, FLOOR, -4, -48, 4),
      s(-58, FLOOR, 12, -48, 4),
      s(-50, FLOOR, -8, -48, 4),
      s(-50, FLOOR, 17, -48, 4),
      s(-64, FLOOR, -10, -48, 4),
      s(-64, FLOOR, 18, -48, 4),
      s(-42, FLOOR, 16, -48, 4),
      s(-66, FLOOR, 0, -48, 4),
    ],
  },
  {
    id: 'C',
    name: 'the ion cannon',
    at: post(2, FLOOR, 10),
    radius: 8,
    owner: null,
    spawns: [
      s(-10, FLOOR, 9, 2, 10),
      s(-12, FLOOR, -8, 2, 10),
      s(14, FLOOR, -6, 2, 10),
      s(16, FLOOR, 12, 2, 10),
      s(4, FLOOR, 22, 2, 10),
      s(-6, FLOOR, 24, 2, 10),
      s(-4, FLOOR, -20, 2, 10),
      s(12, FLOOR, -20, 2, 10),
      s(18, FLOOR, 2, 2, 10),
    ],
  },
  {
    id: 'D',
    name: 'the ridge',
    at: post(DEAD.x, FLOOR + 4, DEAD.z),
    radius: 8,
    owner: 1,
    spawns: [
      s(56, FLOOR + 4, -4, DEAD.x, DEAD.z),
      s(56, FLOOR + 4, 4, DEAD.x, DEAD.z),
      s(52, FLOOR + 4, 10, DEAD.x, DEAD.z),
      s(38, FLOOR + 4, 10, DEAD.x, DEAD.z),
      s(34, FLOOR + 4, 0, DEAD.x, DEAD.z),
      s(58, FLOOR + 3, -12, DEAD.x, DEAD.z),
      s(62, FLOOR + 1, 6, DEAD.x, DEAD.z),
      s(45, FLOOR + 4, 13, DEAD.x, DEAD.z),
      s(60, FLOOR + 2, -2, DEAD.x, DEAD.z),
    ],
  },
  {
    id: 'E',
    name: 'the landing zone',
    at: post(WALKER.x, FLOOR, WALKER.z),
    radius: 8,
    owner: 1,
    locked: true,
    spawns: [
      s(101, FLOOR, -8, 86, 0),
      s(101, FLOOR, 8, 86, 0),
      s(92, FLOOR, -12, 70, 0),
      s(92, FLOOR, 12, 70, 0),
      s(100, FLOOR, 0, 70, 0),
      s(84, FLOOR, -14, 70, 0),
      s(84, FLOOR, 14, 70, 0),
      s(70, FLOOR, -17, 60, 0),
      s(70, FLOOR, 16, 60, 0),
      s(95, FLOOR, 0, 70, 0),
    ],
  },
];

export const FROSTLINE: MapSpec = {
  id: 'frostline',
  name: 'Frostline Base',
  blurb: 'An ice-planet base: hold the shield generator, the ion cannon and the ridge',
  floorY: FLOOR,
  time: 0.36,
  ground: { top: 'snow_block', fill: 'snow_block' },
  structures: [field, ...bands, floor],
  terraform: [],
  bounds: { min: { x: OX + WEST, y: FLOOR + TRENCH - 1, z: NORTH }, max: { x: OX + EAST, y: FLOOR + 14, z: SOUTH } },
  posts: POSTS,
  // Over the field behind the ion cannon, first looking west to the glacier and the base.
  home: spawnAt(OX + 30, FLOOR + 22, 30, OX - 60, -5),
  overview: { position: { x: OX + 20, y: FLOOR + 55, z: 90 }, target: { x: OX, y: FLOOR, z: 0 } },
  // The opening fly-over (cinema.ts): high over the glacier hangar, along the trench to the shield
  // generator, over the ion cannon and the ridge's fallen walker, up to the landing zone's standing one.
  intro: [
    { at: { x: OX - 120, y: FLOOR + 44, z: 60 }, look: { x: OX - 82, y: FLOOR + 2, z: 0 } },
    { at: { x: OX - 64, y: FLOOR + 28, z: 40 }, look: { x: OX - 48, y: FLOOR, z: 4 } },
    { at: { x: OX - 10, y: FLOOR + 30, z: 44 }, look: { x: OX + 2, y: FLOOR, z: 10 } },
    { at: { x: OX + 30, y: FLOOR + 28, z: 34 }, look: { x: OX + 45, y: FLOOR + 4, z: -2 } },
    { at: { x: OX + 104, y: FLOOR + 36, z: 40 }, look: { x: OX + 86, y: FLOOR + 8, z: 0 } },
  ],
  hotspots: [...POSTS.map((p) => ({ ...p.at })), { x: OX - 29, y: FLOOR + TRENCH, z: 0 }, { x: OX - 10, y: FLOOR, z: -44 }, { x: OX - 10, y: FLOOR - 2, z: 41 }, { x: OX + 45, y: FLOOR, z: -32 }, { x: OX + 45, y: FLOOR, z: 24 }],
};
