import type { Vec3 } from './types';

/** Small vector helpers for game code. All return new objects. */
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distance2D = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
/** Point on a horizontal circle around `c`. */
export const onCircle = (c: Vec3, radius: number, angle: number, y = c.y): Vec3 => ({
  x: c.x + Math.cos(angle) * radius,
  y,
  z: c.z + Math.sin(angle) * radius,
});
