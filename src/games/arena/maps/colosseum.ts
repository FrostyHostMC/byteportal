import { Blueprint, type BlockRef } from '@platform';
import { box, faceTo, gateAt, hash, wallTorch } from './kit';
import { banner, figure, lionHead, statue, throne, type BannerDesign } from './models';
import { FLOOR, type ArenaMap, type Decor, type Fire, type TrapSpec } from './registry';

/**
 * The Colosseum: a sand pit walled in travertine, its podium wall painted Pompeian red under
 * lions' heads that breathe fire, ten tiers of crowd rising to a gallery and the arcaded facade,
 * masts on its rim. Four gates with portcullises (the north one under the emperor's box), iron
 * grates over the hypogeum where spikes wait, two podia to fight from, broken columns and statues.
 */

/** Its middle: the middle of block (0, 0), which every ring below is round. */
const C = { x: 0.5, z: 0.5 };
/** The pit's wall (its inner face), the podium's outer edge, the stands' back wall, the facade's outer face. */
const PIT = 22;
const POD = 25;
const BACK = 35;
const OUT = 39.5;
/** How far the facade's columns and cornices stand out from it. */
const RELIEF = OUT + 0.7;
/** The podium's top (the front row stands on it). */
const POD_TOP = FLOOR + 6;
/** Where the tiers end, and the gallery's floor over them. */
const TIERS = BACK - POD;
const GALLERY = POD_TOP + TIERS + 1;
const ATTIC = FLOOR + 27;
/** Round the ring: the aisles up the stands, the podium's pilasters, the gallery's columns, the facade's bays, the masts. */
const AISLES = 16;
const PILASTERS = 20;
const COLUMNS = 36;
const BAYS = 60;
const MASTS = 20;
/** The plaza round it. */
const PLAZA = 54;

/** The gates: east, south, west and north (under the emperor's box). */
const GATES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
/** The lions' heads on the pit wall, either side of each quarter between the gates. */
const LIONS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.PI / 8 + (i * Math.PI) / 4);
/** The broken columns, on the diagonals (between two lions, out of their fire). */
const COLUMNS_AT = [Math.PI / 4, (Math.PI * 3) / 4, (-Math.PI * 3) / 4, -Math.PI / 4];
/** The gates' braziers stand this far round from them (radians), banners hung under them. */
const FLANK = 0.2;
/** Monsters come into the gates' pens here. */
const PEN = 27.5;

/** The spike grates: in front of the north gate (before the emperor) and the south one. */
const GRATES = [box({ x: -2, y: FLOOR, z: -12 }, { x: 2, y: FLOOR, z: -8 }), box({ x: -2, y: FLOOR, z: 8 }, { x: 2, y: FLOOR, z: 12 })];
/**
 * The podia to fight from, east and west: x from..to, a block high (a monster hops a block, so
 * nobody stands out of their reach up there).
 */
const PODIA = [
  { x0: 13, x1: 16, z0: -3, z1: 3 },
  { x0: -16, x1: -13, z0: -3, z1: 3 },
];

const TAU = Math.PI * 2;
/** Where angle `a` falls among `n` equal divisions of the circle: 0 at a division, up to 1 just before the next. */
const turn = (a: number, n: number) => ((((a / TAU) * n) % 1) + 1) % 1;
/** How far (blocks, round the ring at radius `d`) angle `a` is from the nearest of `n` divisions. */
const off = (a: number, n: number, d: number) => Math.abs(turn(a, n) - Math.round(turn(a, n))) * (TAU / n) * d;
/** Where block (x, z) is across a gate's way (its `side`, blocks from the axis), and along it. */
function inGate(x: number, z: number): { g: number; side: number; along: number } | null {
  for (let g = 0; g < GATES.length; g++) {
    const fx = Math.cos(GATES[g]);
    const fz = Math.sin(GATES[g]);
    const along = x * fx + z * fz;
    const side = -x * fz + z * fx;
    if (along > 0 && Math.abs(side) < 4.5) return { g, side, along };
  }
  return null;
}

function build(): Blueprint {
  const bp = Blueprint.centered(0, 0, Math.ceil(RELIEF) + 1, FLOOR - 4, ATTIC + 7);

  bp.columns(0, 0, RELIEF, (x, z, d, a) => {
    if (d < PIT) return pit(bp, x, z, d, a);
    if (d < POD) return podium(bp, x, z, d, a);
    if (d < BACK) return tier(bp, x, z, d, a);
    return rim(bp, x, z, d, a);
  });
  gates(bp);
  box_(bp);
  features(bp);
  return bp;
}

/** The pit's floor: a mosaic in the middle, paths to the gates, sand stained and scuffed, paving round the wall's foot. */
function pit(bp: Blueprint, x: number, z: number, d: number, a: number) {
  for (let y = FLOOR - 3; y < FLOOR; y++) bp.set(x, y, z, 'stone');
  let floor: BlockRef;
  if (d < 4.6) floor = mosaic(d, a);
  else if (d > PIT - 1.6) floor = hash(x, z, 1) < 0.15 ? 'travertine' : 'travertine_bricks';
  else {
    const g = inGate(x, z);
    const worn = hash(x, z, 2);
    if (g && Math.abs(g.side) < 1.6) floor = worn < 0.2 ? 'arena_sand' : worn < 0.3 ? 'travertine' : 'travertine_bricks';
    else {
      // Sand; blood soaked in here and there, a stain spreading.
      const stain = hash(x >> 1, z >> 1, 3) < 0.035 || (hash(x >> 1, z >> 1, 3) < 0.06 && worn < 0.5);
      floor = stain ? 'bloody_sand' : worn < 0.05 ? 'sandstone' : 'arena_sand';
    }
  }
  bp.set(x, FLOOR, z, floor);
}

/** The emperor's star: red rays on white marble in a gilt ring. */
function mosaic(d: number, a: number): BlockRef {
  if (d > 3.9) return 'gilt';
  if (d < 0.8) return 'gilt';
  const ray = Math.abs(Math.sin(a * 4)) < 0.5 / Math.max(d, 1) + 0.1;
  return ray ? 'red_concrete' : 'marble';
}

/**
 * The podium wall: Pompeian red panels between travertine pilasters, a gilt band, a cornice; on
 * top, a parapet and the front row of the crowd.
 */
function podium(bp: Blueprint, x: number, z: number, d: number, a: number) {
  for (let y = FLOOR - 3; y <= POD_TOP; y++) bp.set(x, y, z, 'travertine');
  if (d < PIT + 1) {
    const pilaster = off(a, PILASTERS, PIT) < 0.75;
    for (let y = FLOOR + 1; y <= POD_TOP; y++) {
      let b: BlockRef = 'travertine_bricks';
      if (y === FLOOR + 1) b = 'travertine';
      else if (y === FLOOR + 5) b = 'gilt';
      else if (y < FLOOR + 5 && !pilaster) b = 'red_concrete';
      bp.set(x, y, z, b);
    }
    // The parapet over it.
    bp.set(x, POD_TOP + 1, z, 'travertine_slab');
    return;
  }
  bp.set(x, POD_TOP, z, 'travertine_bricks');
  // The front row: senators in white.
  if (d >= POD - 1.2 && hash(x, z, 7) < 0.7) bp.set(x, POD_TOP + 1, z, 'crowd_b');
}

/** The tiers: a step a row, the crowd on them; aisles every so often, and doorways into the stands. */
function tier(bp: Blueprint, x: number, z: number, d: number, a: number) {
  const i = Math.floor(d - POD);
  const top = POD_TOP + 1 + i;
  for (let y = FLOOR - 3; y <= top; y++) bp.set(x, y, z, 'travertine');
  const aisle = off(a, AISLES, d) < 0.7;
  bp.set(x, top, z, aisle ? 'travertine_slab[type=top]' : i % 2 ? 'travertine' : 'travertine_bricks');
  if (aisle) {
    // A doorway (a vomitorium) in some aisles, halfway up.
    if (i === 4 && Math.round((a / TAU) * AISLES + AISLES) % 2 === 1) {
      bp.set(x, top + 1, z, 'air');
      bp.set(x, top + 2, z, 'air');
    }
    return;
  }
  // The crowd: most seats taken, the odd one cheering.
  const r = hash(x, z, 9);
  if (r < 0.78) bp.set(x, top + 1, z, r < 0.12 ? 'crowd_c' : r < 0.45 ? 'crowd_a' : 'crowd_b');
}

/**
 * The rim: the stands' back wall, a gallery over the top tier with the plebs standing under a
 * colonnade, and the facade: three orders of arches between engaged columns, cornices standing
 * out between them, an attic with windows, masts on top.
 */
function rim(bp: Blueprint, x: number, z: number, d: number, a: number) {
  const u = turn(a, BAYS);
  const pier = u < 0.24 || u > 0.86;
  const column = u < 0.1 || u > 0.96;
  if (d >= OUT) {
    // Standing out from the facade: a half-column at each pier, the cornices between the orders.
    bp.set(x, FLOOR, z, 'travertine_bricks');
    for (const level of [7, 14, 21, 27]) bp.set(x, FLOOR + level, z, 'travertine_bricks');
    if (column) for (let level = 1; level <= 20; level++) if (level % 7 !== 0) bp.set(x, FLOOR + level, z, level % 7 === 1 || level % 7 === 6 ? 'travertine_bricks' : 'travertine');
    return;
  }
  for (let y = FLOOR - 3; y <= FLOOR; y++) bp.set(x, y, z, 'travertine');
  if (d < BACK + 1) {
    // The back wall up to the gallery's floor (dark stone where it's seen through the arches); on
    // it, the plebs standing under a colonnade.
    for (let y = FLOOR + 1; y < GALLERY; y++) bp.set(x, y, z, 'stone_bricks');
    bp.set(x, GALLERY, z, 'travertine_bricks');
    if (off(a, COLUMNS, d) < 0.6) for (let y = GALLERY + 1; y <= GALLERY + 4; y++) bp.set(x, y, z, y === GALLERY + 4 ? 'travertine_bricks' : 'marble');
    else if (hash(x, z, 10) < 0.6) bp.set(x, GALLERY + 1, z, hash(x, z, 11) < 0.5 ? 'crowd_a' : 'crowd_c');
    portico(bp, x, z);
    return;
  }
  if (d < BACK + 3) {
    // The ambulatory behind the arches, two blocks deep: dark corridors between floors; the
    // gallery over them.
    for (let y = FLOOR + 1; y <= GALLERY; y++) {
      const level = y - FLOOR;
      const floor = level === 7 || level === 14 || y === GALLERY;
      bp.set(x, y, z, floor ? 'travertine_bricks' : 'air');
    }
    bp.set(x, FLOOR, z, 'stone_bricks');
    if (d < BACK + 2 && hash(x, z, 13) < 0.5) bp.set(x, GALLERY + 1, z, hash(x, z, 14) < 0.5 ? 'crowd_b' : 'crowd_a');
    portico(bp, x, z);
    return;
  }
  // The facade, bay by bay (`u` across a bay: the pier at 0, the arch's middle at a half).
  for (let y = FLOOR + 1; y <= ATTIC; y++) {
    const level = y - FLOOR;
    let b: BlockRef | 'air' = 'travertine';
    if (level <= 21) {
      // Three orders of 7: an arch 5 high, rounded at the top, its keystone; the entablature.
      const lv = ((level - 1) % 7) + 1;
      if (lv === 7) b = 'travertine_bricks';
      else if (!pier && lv <= 4) b = 'air';
      else if (!pier && lv === 5 && u > 0.34 && u < 0.76) b = 'air';
      else if (!pier && lv === 6 && u > 0.5 && u < 0.6) b = 'travertine_bricks';
    } else {
      // The attic: a small window in every other bay, a band at its foot, pilasters, its cornice.
      const lv = level - 21;
      if (!pier && lv >= 3 && lv <= 4 && Math.floor((a / TAU) * BAYS + BAYS) % 2 === 0 && u > 0.38 && u < 0.72) b = 'air';
      else if (lv === 1 || y === ATTIC || column) b = 'travertine_bricks';
    }
    bp.set(x, y, z, b);
  }
  // Masts on the rim (the velarium's), a gilt finial each.
  if (d > OUT - 1 && off(a, MASTS, OUT) < 0.6) for (let y = ATTIC + 1; y <= ATTIC + 6; y++) bp.set(x, y, z, y === ATTIC + 1 ? 'travertine_bricks' : y === ATTIC + 6 ? 'gilt' : 'oak_log');
}

/** The plaza round it: travertine paving in rings, a kerb at its edge. */
function plaza(): Blueprint {
  const bp = Blueprint.centered(0, 0, PLAZA, FLOOR, FLOOR);
  bp.columns(0, 0, PLAZA, (x, z, d, a) => {
    if (d < RELIEF) return;
    const joint = Math.floor(d) % 4 === 0 || off(a, 96, d) < 0.5;
    bp.set(x, FLOOR, z, d > PLAZA - 1 ? 'travertine_bricks' : joint ? 'travertine' : hash(x, z, 30) < 0.5 ? 'travertine_bricks' : 'travertine');
  });
  return bp;
}

/** The colonnade's entablature and roof over the gallery. */
function portico(bp: Blueprint, x: number, z: number) {
  bp.set(x, GALLERY + 5, z, 'travertine_bricks');
  bp.set(x, GALLERY + 6, z, 'travertine_slab');
}

/**
 * The gates: tunnels through the podium and under the stands to their pens, torch-lit; the arches
 * on the pit wall framed in brick with a gilt keystone.
 */
function gates(bp: Blueprint) {
  const R = Math.ceil(PEN + 4);
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const g = inGate(x, z);
      if (!g || g.along < PIT - 0.6 || g.along > PEN + 3) continue;
      const pen = g.along > PEN - 2;
      const half = pen ? 3.6 : 2.6;
      if (Math.abs(g.side) > half + 1) continue;
      const wall = Math.abs(g.side) > half || g.along > PEN + 2.4;
      for (let y = FLOOR + 1; y <= FLOOR + 6; y++) bp.set(x, y, z, wall || y === FLOOR + 6 ? 'travertine_bricks' : 'air');
      bp.set(x, FLOOR, z, wall ? 'travertine_bricks' : 'stone_bricks');
    }
  for (const a of GATES) {
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    const at = (along: number, side: number) => ({ x: Math.round(fx * along - fz * side), z: Math.round(fz * along + fx * side) });
    // The arch on the pit wall: rounded at its top corners, framed, a keystone.
    for (let side = -3; side <= 3; side++) {
      const p = at(PIT, side);
      for (let y = FLOOR + 1; y <= FLOOR + 6; y++) {
        const edge = Math.abs(side) === 3;
        const corner = Math.abs(side) === 2 && y === FLOOR + 5;
        if (edge || y === FLOOR + 6 || corner) bp.set(p.x, y, p.z, side === 0 && y === FLOOR + 6 ? 'gilt' : 'travertine_bricks');
      }
    }
    // Torches down the tunnel on its walls, pointing in toward its middle.
    for (let along = PIT + 3; along < PEN; along += 3) {
      for (const s of [-1, 1]) {
        const p = at(along, s * 2);
        bp.set(p.x, FLOOR + 3, p.z, wallTorch(facing(s * fz, -s * fx)));
      }
    }
  }
}

/** The way a block faces that's nearest to (dx, dz). */
const facing = (dx: number, dz: number) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north');

/**
 * The emperor's box over the north gate: a balcony on gilt columns under a purple canopy, red
 * drapes behind; the throne (a prop) stands at its back.
 */
function box_(bp: Blueprint) {
  const zf = -PIT + 2; // its front, over the pit
  const zb = -POD - 1;
  for (let x = -6; x <= 6; x++) {
    for (let z = zb - 2; z <= zf; z++) {
      // Clear the stands where it stands.
      for (let y = POD_TOP + 1; y <= POD_TOP + 8; y++) bp.set(x, y, z, 'air');
      bp.set(x, POD_TOP, z, z === zf ? 'gilt' : (x + z) % 2 ? 'purple_concrete' : 'white_concrete');
      if (z > -PIT) bp.set(x, POD_TOP - 1, z, 'travertine_bricks');
    }
    // A low balustrade along its front, posts at its ends and either side of the emperor.
    const post = Math.abs(x) === 6 || Math.abs(x) === 3;
    bp.set(x, POD_TOP + 1, zf, post ? 'travertine_bricks' : 'travertine_slab');
    if (post) bp.set(x, POD_TOP + 2, zf, 'gilt');
    // The back wall, hung with red drapes.
    for (let y = POD_TOP + 1; y <= POD_TOP + 7; y++) bp.set(x, y, zb - 2, y > POD_TOP + 5 ? 'gilt' : 'red_wool');
    // The canopy: purple and gilt stripes, a gilt rim.
    for (let z = zb - 2; z <= zf + 1; z++) bp.set(x, POD_TOP + 8, z, z === zf + 1 || Math.abs(x) === 6 ? 'gilt' : x % 2 ? 'purple_concrete' : 'magenta_concrete');
  }
  for (let z = zb - 2; z <= zf + 1; z++) bp.set(0, POD_TOP + 9, z, 'gilt');
  // The columns.
  for (const x of [-6, 6])
    for (const z of [zf, zb - 2]) for (let y = POD_TOP + 1; y <= POD_TOP + 7; y++) bp.set(x, y, z, y === POD_TOP + 1 || y === POD_TOP + 7 ? 'gilt' : 'white_concrete');
}

/**
 * In the pit: the grates over the hypogeum (lit from below, the spikes waiting under them), the
 * podia with their steps, broken columns, the statues' pedestals, braziers on the parapet.
 */
function features(bp: Blueprint) {
  for (const g of GRATES) {
    for (let x = g.min.x - 1; x <= g.max.x + 1; x++)
      for (let z = g.min.z - 1; z <= g.max.z + 1; z++) {
        const inside = x >= g.min.x && x <= g.max.x && z >= g.min.z && z <= g.max.z;
        if (!inside) {
          // A travertine kerb round it, the hypogeum's wall below.
          bp.set(x, FLOOR, z, 'travertine');
          for (let y = FLOOR - 3; y < FLOOR; y++) bp.set(x, y, z, 'stone_bricks');
          continue;
        }
        bp.set(x, FLOOR, z, 'arena_grate');
        bp.set(x, FLOOR - 1, z, 'air');
        bp.set(x, FLOOR - 2, z, 'air');
        bp.set(x, FLOOR - 3, z, (x + z) % 3 === 0 ? 'glowstone' : 'stone_bricks');
      }
  }
  for (const p of PODIA) {
    for (let x = p.x0; x <= p.x1; x++)
      for (let z = p.z0; z <= p.z1; z++) {
        const rim = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
        bp.set(x, FLOOR + 1, z, rim ? 'travertine_bricks' : 'travertine');
      }
  }
  // Broken columns, each its own height, a fallen drum beside the shortest.
  COLUMNS_AT.forEach((a, i) => {
    const cx = Math.round(Math.cos(a) * 11);
    const cz = Math.round(Math.sin(a) * 11);
    const h = [5, 3, 6, 2][i];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        bp.set(cx + dx, FLOOR + 1, cz + dz, 'travertine_bricks');
        if (Math.abs(dx) + Math.abs(dz) === 2) continue;
        for (let y = FLOOR + 2; y <= FLOOR + 1 + h; y++) {
          // Broken off raggedly at the top.
          if (y === FLOOR + 1 + h && hash(cx + dx, cz + dz, i) < 0.45) continue;
          bp.set(cx + dx, y, cz + dz, 'marble');
        }
      }
    if (h === 6) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bp.set(cx + dx, FLOOR + 8, cz + dz, Math.abs(dx) + Math.abs(dz) === 2 ? 'gilt' : 'travertine_bricks');
    if (h <= 3) {
      // A drum that fell, lying toward the middle.
      const fx = -Math.sign(cx);
      for (let k = 2; k <= 3; k++) {
        bp.set(cx + fx * k, FLOOR + 1, cz, 'marble');
        bp.set(cx + fx * k, FLOOR + 1, cz + Math.sign(cz), 'marble');
      }
    }
  });
  // Braziers on the parapet, either side of every gate and lion.
  for (const f of FIRES) {
    const x = Math.floor(f.at.x);
    const z = Math.floor(f.at.z);
    const top = Math.floor(f.at.y) - 1;
    bp.set(x, top, z, 'magma');
    bp.set(x, top - 1, z, 'gilt');
    for (let y = POD_TOP + 1; y < top - 1; y++) bp.set(x, y, z, 'travertine_bricks');
  }
}

/** Braziers on the parapet: at the gates' sides and over the lions. */
const FIRES: Fire[] = [...GATES.flatMap((a) => [a - FLANK, a + FLANK]), ...LIONS].map((a) => {
  const r = PIT + 0.5;
  return { at: { x: Math.round(Math.cos(a) * r) + 0.5, y: POD_TOP + 4, z: Math.round(Math.sin(a) * r) + 0.5 }, size: 0.9 };
});

/** The Colosseum's banner: red, a gilt border, a laurel wreath round crossed swords, swallow-tailed. */
function design(): BannerDesign {
  const W = 16;
  const H = 40;
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const tail = y > H - 7 && Math.abs(x - 7.5) < (y - (H - 7)) * 1.2;
      const cx = x - 7.5;
      const cy = y - 17;
      const r = Math.hypot(cx, cy * 0.95);
      let c = 'r';
      if (y < 2) c = 'g';
      else if (x === 0 || x === W - 1 || y === 2) c = 'g';
      else if (r > 4.6 && r < 6.2 && cy > -5) c = (x + y) % 3 ? 'l' : 'g';
      else if (Math.abs(cx - cy * 0.75) < 0.8 && r < 5) c = 'w';
      else if (Math.abs(cx + cy * 0.75) < 0.8 && r < 5) c = 'w';
      else if (y === 28 || y === 30) c = 'g';
      if (tail) c = '.';
      row += c;
    }
    rows.push(row);
  }
  return { rows, palette: { r: 'red_concrete', g: 'gilt', l: 'lime_concrete', w: 'iron_block' } };
}
const BANNER = banner(design());

/** Banners down the podium wall either side of every gate, under its braziers, facing the middle. */
const BANNERS: Decor[] = GATES.flatMap((g) => [g - FLANK, g + FLANK]).map((a) => {
  const x = C.x + Math.cos(a) * (PIT - 0.56);
  const z = C.z + Math.sin(a) * (PIT - 0.56);
  return { model: BANNER, at: { x, y: POD_TOP + 0.9, z }, face: faceTo(x, z, C.x, C.z) };
});

const EMPEROR = figure({ robe: 'purple_concrete', trim: 'gilt', skin: 'flesh', hair: 'white_concrete', head: 'laurel' });
const GUARD = figure({ robe: 'red_concrete', trim: 'gilt', skin: 'flesh', hair: 'brown_concrete', head: 'helmet', arms: true });
const THRONE = throne();
const LION = lionHead();
const STATUE = statue();

const LION_MOUTH = (a: number) => ({ x: C.x + Math.cos(a) * (PIT - 0.5), y: FLOOR + 3.2, z: C.z + Math.sin(a) * (PIT - 0.5) });

const DECOR: Decor[] = [
  ...BANNERS,
  { model: THRONE, at: { x: 0.5, y: POD_TOP + 1, z: -PIT - 0.6 }, face: 0 },
  { model: EMPEROR, at: { x: 0.5, y: POD_TOP + 1, z: -PIT + 1.2 }, face: 0 },
  { model: GUARD, at: { x: -4, y: POD_TOP + 1, z: -PIT + 1.3 }, face: 0 },
  { model: GUARD, at: { x: 5, y: POD_TOP + 1, z: -PIT + 1.3 }, face: 0 },
  ...LIONS.map((a) => {
    const m = LION_MOUTH(a);
    return { model: LION, at: m, face: faceTo(m.x, m.z, C.x, C.z) };
  }),
  // Gladiators in marble at the back of the podia, facing the middle.
  ...PODIA.map((p) => {
    const x = p.x0 > 0 ? p.x1 - 0.5 : p.x0 + 1.5;
    return { model: STATUE, at: { x, y: FLOOR + 2, z: 0.5 }, face: faceTo(x, 0.5, C.x, C.z) };
  }),
];

/** The traps: the spikes under the two grates (a lever beside each), and the lions' fire (a lever on the east podium). */
const TRAPS: TrapSpec[] = [
  {
    id: 'colosseum.spikes_n',
    name: 'Spike Pit',
    kind: 'spikes',
    lever: { at: { x: 4.5, y: FLOOR + 1, z: -9.5 }, face: Math.PI / 2 },
    price: 60,
    time: 8,
    cooldown: 30,
    zone: [GRATES[0]],
  },
  {
    id: 'colosseum.spikes_s',
    name: 'Spike Pit',
    kind: 'spikes',
    lever: { at: { x: -3.5, y: FLOOR + 1, z: 10.5 }, face: -Math.PI / 2 },
    price: 60,
    time: 8,
    cooldown: 30,
    zone: [GRATES[1]],
  },
  {
    id: 'colosseum.lions',
    name: "Lions' Fire",
    kind: 'jets',
    element: 'fire',
    lever: { at: { x: 14.5, y: FLOOR + 2, z: 0.5 }, face: Math.PI / 2 },
    price: 100,
    time: 7,
    cooldown: 40,
    zone: [],
    jets: LIONS.map((a) => {
      const m = LION_MOUTH(a);
      return { at: { x: m.x - Math.cos(a) * 0.6, y: FLOOR + 2.6, z: m.z - Math.sin(a) * 0.6 }, dir: { x: -Math.cos(a), y: -0.12, z: -Math.sin(a) }, length: 8.5 };
    }),
  },
];

const gate = (a: number) => gateAt(C, a, PEN);

export const COLOSSEUM: ArenaMap = {
  id: 'colosseum',
  name: 'The Colosseum',
  line: 'Sand, stone and a roaring crowd',
  color: '#ffb36b',
  icon: 'travertine_bricks',
  origin: C,
  build: () => [build(), plaza()],
  center: { x: 0.5, y: FLOOR + 1, z: 0.5 },
  radius: PIT - 1,
  gates: GATES.map(gate),
  // Bosses come in on open sand before the north and south gates (big ones need room).
  bossGates: [Math.PI / 2, -Math.PI / 2].map((a) => gateAt(C, a, 15)),
  portcullises: GATES.map((a) => ({ at: { x: C.x + Math.cos(a) * (PIT + 0.2), y: FLOOR + 1, z: C.z + Math.sin(a) * (PIT + 0.2) }, yaw: gate(a).yaw, width: 5, height: 5 })),
  lookout: { x: 0.5, y: POD_TOP + 5, z: POD + 3.5 },
  time: 0.66,
  dusk: 0.07,
  intro: [
    { at: { x: 60, y: FLOOR + 9, z: 47 }, look: { x: 0, y: FLOOR + 17, z: 0 } },
    { at: { x: 30, y: FLOOR + 35, z: 26 }, look: { x: 0, y: FLOOR + 8, z: 0 } },
    { at: { x: 6, y: FLOOR + 24, z: 20 }, look: { x: 0, y: FLOOR + 8, z: -20 } },
    { at: { x: -8, y: FLOOR + 11, z: 6 }, look: { x: 0.5, y: POD_TOP + 3, z: -24 } },
  ],
  shop: { x: -6.5, y: FLOOR + 1, z: 5.5 },
  chests: [
    { x: 7.5, y: FLOOR + 1, z: 5.5 },
    { x: -15.5, y: FLOOR + 1, z: -10.5 },
    { x: 16.5, y: FLOOR + 1, z: 10.5 },
  ],
  traps: TRAPS,
  // Spectators all round the stands, the front rows to the gallery.
  crowd: {
    at: Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * TAU;
      const r = POD + (i % 3) * 3.5;
      return { x: C.x + Math.cos(a) * r, y: POD_TOP + 2 + (r - POD), z: C.z + Math.sin(a) * r };
    }),
  },
  decor: DECOR,
  fires: FIRES,
  air: { kind: 'dust', heading: 0.6, wind: 1.2, gust: 3.5, loop: 'amb_arena_wind', calls: ['amb_hawk', 'amb_horn'] },
};
