import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { picture, voxels } from './kit';

/**
 * The maps' props as micro-block builds (meshed with the world's block textures, `props.model`):
 * what moves (portcullises, levers, the traps' spikes, blades, hammer, bell and icicles) and
 * set pieces too fine for whole blocks (banners, the emperor and his guards, lions' heads,
 * statues). Each is a `Model`: its blocks, the size of one (`scale`, in blocks) and the point of it
 * that stands at the prop's position (`pivot`, in its own blocks).
 */
export interface Model {
  bp: Blueprint;
  scale: number;
  pivot: Vec3;
}

/** A box of one block in a build: [x0, y0, z0, x1, y1, z1] (inclusive), and the block. */
export type Part = [number, number, number, number, number, number, BlockRef];

/** A build from boxes (later ones over earlier ones), the bounds worked out from them. */
export function parts(list: Part[]): Blueprint {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    lo.x = Math.min(lo.x, x0);
    lo.y = Math.min(lo.y, y0);
    lo.z = Math.min(lo.z, z0);
    hi.x = Math.max(hi.x, x1);
    hi.y = Math.max(hi.y, y1);
    hi.z = Math.max(hi.z, z1);
  }
  const bp = new Blueprint(lo, { x: hi.x - lo.x + 1, y: hi.y - lo.y + 1, z: hi.z - lo.z + 1 });
  for (const [x0, y0, z0, x1, y1, z1, b] of list) bp.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);
  return bp;
}

// -------------------------------------------------------------------------------------------------
// Gates and levers
// -------------------------------------------------------------------------------------------------

/**
 * A portcullis `width` by `height` blocks: iron bars (gaps too narrow for a body) on oak cross
 * beams, pointed at the foot. Its pivot is the middle of its foot, its bars across x.
 */
export function portcullis(width: number, height: number): Model {
  const W = width * 8;
  const H = height * 8;
  const bp = voxels({ x: W, y: H, z: 3 }, (x, y, z) => {
    const bar = x % 5 === 2 || x % 5 === 3;
    const beam = y % 12 >= 8 && y % 12 <= 9 && y > 4;
    if (beam && z >= 0) return z === 1 ? 'spruce_planks' : x % 5 === 2 && z !== 1 ? 'bronze' : 'spruce_planks';
    if (!bar || z !== 1) return undefined;
    // The points: the bar's foot narrows.
    if (y < 3) return x % 5 === 2 && y >= 1 ? 'deepslate' : y >= 2 ? 'deepslate' : undefined;
    return 'deepslate';
  });
  return { bp, scale: 1 / 8, pivot: { x: W / 2, y: 0, z: 1.5 } };
}

/** A floor lever's stand: an iron quadrant on a stone foot. Pivot: the middle of its foot. */
export function leverStand(): Model {
  const bp = parts([
    [0, 0, 0, 7, 1, 9, 'stone_bricks'],
    [1, 2, 1, 6, 2, 8, 'deepslate'],
    [0, 2, 4, 0, 5, 5, 'deepslate'],
    [7, 2, 4, 7, 5, 5, 'deepslate'],
    [0, 3, 2, 0, 4, 7, 'deepslate'],
    [7, 3, 2, 7, 4, 7, 'deepslate'],
    [1, 2, 0, 6, 2, 0, 'gilt'],
    [1, 2, 9, 6, 2, 9, 'gilt'],
  ]);
  return { bp, scale: 1 / 8, pivot: { x: 4, y: 0, z: 5 } };
}

/** A lever's handle: an iron rod with a red grip, turning about its foot (pivot) along z. */
export function leverHandle(): Model {
  const bp = parts([
    [0, 0, 0, 1, 11, 1, 'deepslate'],
    [-1, 12, -1, 2, 15, 2, 'red_concrete'],
    [0, 16, 0, 1, 16, 1, 'red_concrete'],
  ]);
  return { bp, scale: 1 / 8, pivot: { x: 1, y: 0.5, z: 1 } };
}

// -------------------------------------------------------------------------------------------------
// The traps' moving parts
// -------------------------------------------------------------------------------------------------

/** A bed of iron spikes over `w` by `d` blocks: a plate, and a spike every half block. Pivot: its corner. */
export function spikes(w: number, d: number): Model {
  const W = w * 8;
  const D = d * 8;
  const bp = voxels({ x: W, y: 16, z: D }, (x, y, z) => {
    if (y === 0) return x % 4 === 0 || z % 4 === 0 ? 'deepslate' : undefined;
    const sx = x % 4;
    const sz = z % 4;
    // A spike every 4: two across at its foot, one at its tip; dark iron, honed bright to the point.
    const at = (sx === 1 || sx === 2) && (sz === 1 || sz === 2);
    if (!at) return undefined;
    if (y > 9) return sx === 1 && sz === 1 ? (y > 12 ? 'iron_block' : 'light_gray_concrete') : undefined;
    return y < 5 ? 'deepslate' : 'gray_concrete';
  });
  return { bp, scale: 1 / 8, pivot: { x: 0, y: 0, z: 0 } };
}

/**
 * A pendulum: an iron pole `length` blocks long hanging from its pivot (the top), a great curved
 * blade of bright steel at its foot, its edge along x and glowing faintly (it shows at night; it
 * swings about x, so across z).
 */
export function scythe(length: number): Model {
  const L = Math.round(length * 8);
  const list: Part[] = [
    [-1, -2, -1, 1, 1, 1, 'deepslate'],
    [0, -L + 6, 0, 0, -2, 0, 'deepslate'],
    [-1, -L + 6, -1, 1, -L + 8, 1, 'gilt'],
  ];
  // The blade: a crescent below the pole's foot, wide across x, sharp at both ends.
  for (let x = -14; x <= 14; x++) {
    const u = x / 14;
    const top = -L + 6 - Math.round(4 * (1 - u * u));
    const bottom = top - Math.max(1, Math.round(5 * Math.sqrt(1 - u * u)));
    list.push([x, bottom, 0, x, top, 0, 'iron_block']);
    list.push([x, bottom, 0, x, bottom, 0, 'sea_lantern']);
  }
  return { bp: parts(list), scale: 1 / 8, pivot: { x: 0.5, y: 0.5, z: 0.5 } };
}

/** The drop hammer's head: a block of bronze-banded basalt, `w` blocks square and `h` high, its iron shaft above. Pivot: its foot's middle. */
export function hammerHead(w: number, h: number): Model {
  const list: Part[] = [[0, 0, 0, w - 1, h - 1, w - 1, 'basalt_bricks']];
  list.push([0, 1, 0, w - 1, 1, w - 1, 'bronze']);
  list.push([0, h - 2, 0, w - 1, h - 2, w - 1, 'bronze']);
  const m = Math.floor(w / 2);
  list.push([m, h, m, m, h + 9, m, 'deepslate']);
  return { bp: parts(list), scale: 1, pivot: { x: w / 2, y: 0, z: w / 2 } };
}

/** A great bronze bell, its crown at the pivot (it swings from there). */
export function bell(): Model {
  const R = 11;
  const H = 22;
  const bp = voxels({ x: R * 2 + 1, y: H + 3, z: R * 2 + 1 }, (x, y, z) => {
    const dx = x - R;
    const dz = z - R;
    const d = Math.hypot(dx, dz);
    if (y >= H) return d < 2.5 ? 'deepslate' : undefined;
    // Its profile: a flared lip, a waist, a round shoulder.
    const t = y / H;
    const r = t < 0.12 ? R - t * 10 : t < 0.8 ? R * (0.88 - (t - 0.12) * 0.42) : R * 0.6 * Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2)) + 1;
    if (d > r) return undefined;
    // Hollow under the shoulder, a clapper inside.
    if (t < 0.78 && d < r - 1.6) return d < 2 && y < 8 && y > 1 ? 'deepslate' : undefined;
    return y === 3 || y === 15 ? 'gilt' : 'bronze';
  });
  return { bp, scale: 1 / 8, pivot: { x: R + 0.5, y: H + 3, z: R + 0.5 } };
}

/** An icicle as it falls: a cone of ice, point down. Pivot: its point. */
export function fallingIcicle(): Model {
  const bp = voxels({ x: 5, y: 18, z: 5 }, (x, y, z) => {
    const r = 0.5 + (y / 18) * 2.2;
    return Math.hypot(x - 2, z - 2) <= r ? (y % 5 === 0 ? 'snow_block' : 'ice') : undefined;
  });
  return { bp, scale: 1 / 8, pivot: { x: 2.5, y: 0, z: 2.5 } };
}

// -------------------------------------------------------------------------------------------------
// Set pieces
// -------------------------------------------------------------------------------------------------

/** A banner's picture, 16 wide: rows from the top down; its palette by character. */
export interface BannerDesign {
  rows: string[];
  palette: Record<string, BlockRef>;
}

/** A banner hung by its top (the pivot: the middle of its top edge), the picture facing +z. */
export function banner(d: BannerDesign): Model {
  const bp = picture(d.rows, d.palette, 1);
  return { bp, scale: 1 / 8, pivot: { x: bp.size.x / 2, y: bp.size.y, z: 0.5 } };
}

/** Clothes, skin and kit for the figures below. */
export interface Dress {
  robe: BlockRef;
  trim: BlockRef;
  skin: BlockRef;
  hair: BlockRef;
  /** A laurel (the emperor), a crested helmet (a guard). */
  head?: 'laurel' | 'helmet';
  /** A spear and a shield (a guard). */
  arms?: boolean;
}

/** A standing figure about 1.9 blocks tall, facing +z (its pivot: between its feet). */
export function figure(dress: Dress): Model {
  const { robe, trim, skin, hair } = dress;
  const list: Part[] = [
    // Legs and sandals under the robe's hem.
    [1, 0, 1, 2, 4, 2, skin],
    [4, 0, 1, 5, 4, 2, skin],
    [1, 0, 1, 2, 0, 3, 'brown_concrete'],
    [4, 0, 1, 5, 0, 3, 'brown_concrete'],
    // The robe, its hem trimmed, a sash across.
    [0, 4, 0, 6, 10, 3, robe],
    [0, 4, 0, 6, 4, 3, trim],
    [0, 9, 3, 1, 10, 3, trim],
    [2, 8, 3, 3, 9, 3, trim],
    [4, 6, 3, 5, 7, 3, trim],
    // Arms.
    [-2, 6, 1, -1, 10, 2, robe],
    [-2, 5, 1, -1, 5, 2, skin],
    [7, 6, 1, 8, 10, 2, robe],
    [7, 5, 1, 8, 5, 2, skin],
    // Neck and head, the hair behind.
    [2, 11, 1, 4, 11, 2, skin],
    [1, 12, 0, 5, 15, 3, skin],
    [1, 15, 0, 5, 16, 3, hair],
    [1, 12, 0, 5, 14, 0, hair],
    [2, 13, 3, 2, 13, 3, 'black_concrete'],
    [4, 13, 3, 4, 13, 3, 'black_concrete'],
  ];
  if (dress.head === 'laurel') {
    list.push([0, 15, 0, 6, 15, 3, 'lime_concrete'], [0, 15, 1, 0, 16, 2, 'gilt'], [6, 15, 1, 6, 16, 2, 'gilt'], [3, 16, 3, 3, 16, 3, 'gilt']);
  }
  if (dress.head === 'helmet') {
    list.push([0, 14, 0, 6, 17, 3, 'gilt'], [0, 13, 0, 0, 13, 3, 'gilt'], [6, 13, 0, 6, 13, 3, 'gilt'], [3, 18, -1, 3, 20, 4, 'red_concrete']);
    list.push([2, 13, 3, 4, 13, 3, 'black_concrete']);
  }
  if (dress.arms) {
    // A spear in the right hand, a round shield on the left arm.
    list.push([-2, 0, 2, -2, 24, 2, 'spruce_planks'], [-2, 25, 2, -2, 27, 2, 'iron_block']);
    for (let y = 3; y <= 11; y++) for (let z = -1; z <= 5; z++) if (Math.hypot(y - 7, z - 2) <= 4.2) list.push([9, y, z, 9, y, z, Math.hypot(y - 7, z - 2) < 1.2 ? 'gilt' : 'red_concrete']);
  }
  return { bp: parts(list), scale: 1 / 8, pivot: { x: 3.5, y: 0, z: 2 } };
}

/** A throne: gilt and purple, high-backed. Pivot: the middle of its foot, facing +z. */
export function throne(): Model {
  const bp = parts([
    [0, 0, 0, 11, 1, 9, 'gilt'],
    [1, 2, 1, 10, 5, 8, 'purple_concrete'],
    [0, 2, 0, 1, 9, 1, 'gilt'],
    [10, 2, 0, 11, 9, 1, 'gilt'],
    [0, 2, 0, 11, 16, 1, 'purple_concrete'],
    [0, 16, 0, 11, 17, 1, 'gilt'],
    [5, 18, 0, 6, 19, 1, 'gilt'],
    [0, 6, 2, 1, 7, 8, 'gilt'],
    [10, 6, 2, 11, 7, 8, 'gilt'],
  ]);
  return { bp, scale: 1 / 8, pivot: { x: 6, y: 0, z: 5 } };
}

/** Whether (x, y, z) is inside the ellipsoid round `c` with radii `r`. */
const inside = (x: number, y: number, z: number, c: [number, number, number], r: [number, number, number]) =>
  ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2 <= 1;

/**
 * A bronze lion's head on a wall, roaring (the fire comes out of its mouth), facing +z: a ragged
 * gilt mane, a broad brow and muzzle, eyes under a heavy brow, ears, the jaw dropped open on a
 * dark throat. Pivot: the mouth.
 */
export function lionHead(): Model {
  const bp = voxels({ x: 19, y: 20, z: 11 }, (x, y, z) => {
    const dx = x - 9;
    const dy = y - 10;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    // The mane: locks round the head, raggedly, deepest at the back.
    const lock = 8.4 + 1.3 * Math.sin(ang * 9) + 0.7 * Math.sin(ang * 4 + 1);
    if (z <= 3 && r <= lock - z * 0.35) return r > 6.5 ? (Math.sin(ang * 9) > 0.2 ? 'gilt' : 'bronze') : 'bronze';
    // The open mouth: a dark throat under the muzzle, fangs at its corners, the lower jaw below.
    if (inside(x, y, z, [9, 5.2, 7], [2.6, 1.6, 3.2]) && z >= 5) return x === 7 || x === 11 ? (y >= 5 ? 'white_concrete' : 'black_concrete') : 'black_concrete';
    if (inside(x, y, z, [9, 3, 6.4], [3.3, 1.2, 2.6])) return 'bronze';
    // The muzzle and nose; the brow and cheeks.
    if (inside(x, y, z, [9, 7.4, 8.3], [2.4, 1.6, 1.8])) return y >= 8 && Math.abs(dx) <= 1 && z >= 9 ? 'black_concrete' : 'gilt';
    if (inside(x, y, z, [9, 9, 5.4], [4.6, 4.6, 3.4])) {
      // The eyes, deep under the brow.
      if (z >= 7 && y >= 10 && y <= 11 && (x === 6 || x === 7 || x === 11 || x === 12)) return 'black_concrete';
      return y >= 12 && z >= 7 ? 'gilt' : 'bronze';
    }
    // The ears.
    if (inside(x, y, z, [4.5, 14.5, 4.5], [1.3, 1.5, 1.2]) || inside(x, y, z, [13.5, 14.5, 4.5], [1.3, 1.5, 1.2])) return 'bronze';
    return undefined;
  });
  return { bp, scale: 1 / 8, pivot: { x: 9.5, y: 5, z: 9 } };
}

/**
 * A marble statue of a gladiator standing guard on a plinth, about 3.4 blocks tall: a crested
 * helmet, a round shield on his left arm, his gladius raised, legs braced. Pivot: the middle of
 * the plinth's foot, facing +z.
 */
export function statue(): Model {
  const m = 'marble';
  const list: Part[] = [
    // The plinth, its moulding.
    [-5, 0, -4, 5, 2, 4, 'travertine_bricks'],
    [-6, 3, -5, 6, 3, 5, 'travertine'],
    // Legs, braced apart, greaves; a short tunic.
    [-3, 4, -1, -2, 11, 1, m],
    [2, 4, -1, 3, 11, 1, m],
    [-3, 4, 0, -2, 7, 2, m],
    [-4, 12, -2, 4, 15, 2, m],
    // The torso, a belt, the shoulders.
    [-3, 16, -2, 3, 22, 2, m],
    [-4, 15, -2, 4, 15, 2, 'gilt'],
    [-5, 21, -2, 5, 23, 2, m],
    // Neck and head, the helmet with its crest and cheek guards.
    [-1, 24, -1, 1, 24, 1, m],
    [-2, 25, -2, 2, 29, 2, m],
    [-3, 28, -3, 3, 30, 3, m],
    [0, 31, -4, 0, 34, -1, 'red_concrete'],
    [0, 30, -4, 0, 31, 3, 'red_concrete'],
    [-1, 27, 2, 1, 27, 2, 'black_concrete'],
    // The left arm down with the round shield on it.
    [-7, 15, -1, -6, 22, 1, m],
    // The right arm raised, the gladius up over the head.
    [6, 22, -1, 7, 25, 1, m],
    [6, 26, -1, 7, 29, 1, m],
    [6, 30, 0, 7, 30, 0, 'gilt'],
    [6, 31, 0, 7, 39, 0, 'iron_block'],
  ];
  // The shield: a disc on the left arm, a boss in its middle.
  for (let y = 12; y <= 24; y++)
    for (let z = -6; z <= 6; z++) {
      const d = Math.hypot(y - 18, z);
      if (d <= 6.2) list.push([-8, y, z, -8, y, z, d < 1.5 ? 'gilt' : d > 5.2 ? 'bronze' : m]);
    }
  return { bp: parts(list), scale: 1 / 10, pivot: { x: 0.5, y: 0, z: 0.5 } };
}
