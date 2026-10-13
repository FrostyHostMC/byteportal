import type { HeldItem } from '@platform/client';
import { Vec3 } from '@platform/client/math';

/** A gun's points, in its own space (blocks): where the hands go, the muzzle, the sight, the magazine. */
export interface GunPoints {
  grip: Vec3;
  grip2: Vec3;
  muzzle: Vec3;
  sight: Vec3;
  mag: Vec3;
}

/**
 * A gun's points: what the held item marks (its spec's, else its file's), else guessed from its
 * size: the support hand halfway along it, the muzzle at its tip, the sight over the grip, the
 * magazine just ahead of the grip underneath.
 */
export function gunPoints(points: Record<string, Vec3>, box: HeldItem['bounds']): GunPoints {
  const grip = points.grip ?? new Vec3();
  return {
    grip,
    grip2: points.grip2 ?? new Vec3(grip.x, grip.y + 0.5 / 16, (grip.z + box.max.z) / 2),
    muzzle: points.muzzle ?? new Vec3(grip.x, box.max.y - 1 / 16, box.max.z),
    sight: points.sight ?? new Vec3(grip.x, box.max.y + 0.5 / 16, grip.z),
    mag: points.mag ?? new Vec3(grip.x, box.min.y + 1 / 16, grip.z + 3 / 16),
  };
}

/** A gun has the whole of a pistol's length or less ahead of the hand: held nearer the middle. */
export const isCompact = (pts: GunPoints) => pts.muzzle.z - pts.grip.z < 11 / 16;

/**
 * Two specs the same, value for value (arrays and plain objects compared inside, anything else,
 * functions and models' textures, by identity).
 */
export function sameSpec(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== Array.prototype) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameSpec((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
