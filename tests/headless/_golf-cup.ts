import { Surf } from '../../src/games/golf/course/types';
import { puttSpeed, simulate, type Terrain } from '../../src/games/golf/physics';
import { BASE, CUP_R, S } from '../../src/games/golf/scale';

/**
 * The cup, probed: putts on a flat green rolled at the hole from 10 feet, off the middle by a share
 * of the cup's radius, at paces that would carry them this many feet past it. What drops, what lips
 * out, what hops over. For tuning the cup; not a test.
 */
export default function cup() {
  const flat: Terrain = {
    ground: () => ({ y: BASE, surf: Surf.Green }),
    slope: (_x, _z, out = { x: 0, z: 0 }) => ((out.x = 0), (out.z = 0), out),
    blockTop: () => BASE,
    treesNear: () => [],
    inBounds: () => true,
  };
  const ft = 0.3048 * S;
  const pin = { x: 0, y: BASE, z: -10 * ft };
  const past = [0.2, 1, 2, 4, 6, 9, 13, 18];
  console.log(`  off \ past   ${past.map((p) => `${p} ft`.padStart(6)).join('')}`);
  for (const off of [0, 0.25, 0.5, 0.7, 0.85, 0.95]) {
    const row = past.map((p) => {
      const speed = puttSpeed(((10 + p) * ft) / S, 0.25);
      const r = simulate(flat, { x: off * CUP_R, y: BASE, z: 0, speed, yaw: 0, angle: 0, spin: 0, tilt: 0, roll: 0.25, wind: { x: 0, z: 0 }, pin, seed: 1 });
      const lip = r.events.some((e) => e.kind === 'lip');
      return (r.outcome === 'holed' ? (lip ? 'in*' : 'IN') : lip ? 'lip' : 'miss').padStart(6);
    });
    console.log(`  ${off.toFixed(2).padStart(4)} R        ${row.join('')}`);
  }
}
