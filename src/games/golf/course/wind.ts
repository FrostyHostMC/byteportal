import { mulberry } from '../scale';
import { HOLES } from './holes';

/**
 * Each hole's wind (m/s, world axes: the way it blows toward), fixed for the course so its flag,
 * built into the world, points downwind: calm on some holes, a stiff breeze on others.
 */
export const WINDS: { x: number; z: number }[] = (() => {
  const rnd = mulberry(2026);
  return HOLES.map((_, i) => {
    const speed = [0.6, 2.2, 3.4, 1.4, 4.6, 2.8, 1.8, 3.9, 5.2][i % 9] * (0.8 + rnd() * 0.4);
    const dir = rnd() * Math.PI * 2;
    return { x: Math.round(Math.cos(dir) * speed * 10) / 10, z: Math.round(Math.sin(dir) * speed * 10) / 10 };
  });
})();

/** Which way a hole's flag faces for its cloth to fly downwind (the cloth runs east of a north-facing flag). */
export function flagFacing(i: number): 'north' | 'east' | 'south' | 'west' {
  const w = WINDS[i];
  if (Math.abs(w.x) >= Math.abs(w.z)) return w.x >= 0 ? 'north' : 'south';
  return w.z >= 0 ? 'east' : 'west';
}

/** Miles an hour, as a golfer reads the wind. */
export const mph = (w: { x: number; z: number }) => Math.round(Math.hypot(w.x, w.z) * 2.237);
