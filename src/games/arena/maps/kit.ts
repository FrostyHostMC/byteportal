import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { FLOOR, type Box, type Gate } from './registry';

/** A steady pseudo-random number in [0, 1) for a column (weathering, scatter). */
export function hash(x: number, z: number, k = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One of `list`, steadily for a column. */
export const pickAt = <T>(list: readonly T[], x: number, z: number, k = 0): T => list[Math.floor(hash(x, z, k) * list.length) % list.length];

/** The yaw that looks from (x, z) toward (tx, tz) (0 looks toward -z). */
export const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** A gate `r` blocks out from `c` at angle `a` (0 toward +x, turning toward +z), facing in, its feet on the floor. */
export function gateAt(c: { x: number; z: number }, a: number, r: number, spread?: number): Gate {
  const x = c.x + Math.cos(a) * r;
  const z = c.z + Math.sin(a) * r;
  return { at: { x, y: FLOOR + 1.05, z }, yaw: yawTo(x, z, c.x, c.z), ...(spread !== undefined ? { spread } : {}) };
}

/** A box from two corners (in any order). */
export const box = (a: Vec3, b: Vec3): Box => ({
  min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
  max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
});

/** The facing (a stair's, a torch's) that looks from the middle of a ring out toward angle `a`: 'east' at 0, 'south' at a quarter turn. */
export function facingOut(a: number): 'north' | 'east' | 'south' | 'west' {
  const q = Math.round(a / (Math.PI / 2));
  return (['east', 'south', 'west', 'north'] as const)[((q % 4) + 4) % 4];
}

/** The opposite facing. */
export const back = (f: 'north' | 'east' | 'south' | 'west') => ({ north: 'south', south: 'north', east: 'west', west: 'east' })[f] as typeof f;

/**
 * A picture in micro-blocks for a prop (a banner, a crest): `rows` from the top down, a character
 * per block looked up in `palette` ('.' or a missing one: nothing), `depth` blocks thick toward +z.
 * Its blocks start at (0, 0, 0): x along the rows, y up from the bottom row.
 */
export function picture(rows: string[], palette: Record<string, BlockRef>, depth = 1): Blueprint {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const bp = new Blueprint({ x: 0, y: 0, z: 0 }, { x: w, y: h, z: depth });
  rows.forEach((row, i) => {
    for (let x = 0; x < row.length; x++) {
      const b = palette[row[x]];
      if (b !== undefined) for (let z = 0; z < depth; z++) bp.set(x, h - 1 - i, z, b);
    }
  });
  return bp;
}

/** A micro-block model from a function over its cells (`undefined`: nothing there). */
export function voxels(size: Vec3, fn: (x: number, y: number, z: number) => BlockRef | undefined): Blueprint {
  const bp = new Blueprint({ x: 0, y: 0, z: 0 }, size);
  for (let y = 0; y < size.y; y++)
    for (let z = 0; z < size.z; z++)
      for (let x = 0; x < size.x; x++) {
        const b = fn(x, y, z);
        if (b !== undefined) bp.set(x, y, z, b);
      }
  return bp;
}

/** Torch on a wall, pointing `facing` (out from the wall). */
export const wallTorch = (facing: 'north' | 'east' | 'south' | 'west') => `torch[facing=${facing}]`;

/** The `face` (a `Decor`'s) that turns a prop's front (+z) from (x, z) toward (tx, tz). */
export const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
