import { CLUBS, strike } from '../../src/games/golf/clubs';
import { Surf } from '../../src/games/golf/course/types';
import { HZ, puttSpeed, simulate, type Terrain } from '../../src/games/golf/physics';
import { BASE, S, feet, yards } from '../../src/games/golf/scale';

/**
 * The bag on flat ground, no wind: each club's carry and roll at full, three-quarter and half
 * power, and putts on a flat green. For tuning the clubs against the real thing; not a test.
 */
export default function calibrate() {
  const flat = (surf: Surf, slope = { x: 0, z: 0 }): Terrain => ({
    ground: (x, z) => ({ y: BASE + slope.x * x + slope.z * z, surf }),
    slope: (_x, _z, out = { x: 0, z: 0 }) => ((out.x = slope.x), (out.z = slope.z), out),
    blockTop: (x, z) => BASE + slope.x * x + slope.z * z,
    treesNear: () => [],
    inBounds: () => true,
  });
  const fairway = flat(Surf.Fairway);
  const far = { x: 5000, y: -100, z: 5000 };
  for (const club of CLUBS) {
    if (club.putter) continue;
    const row: string[] = [];
    for (const power of [1, 0.75, 0.5, 0.25]) {
      const s = strike(club, { club: club.id, power, accuracy: 0, spin: 0, curve: 0, yaw: 0 }, Surf.Tee, () => 0.5, puttSpeed);
      const r = simulate(fairway, { x: 0, y: BASE, z: 0, speed: s.speed, yaw: 0, angle: s.angle, spin: s.spin, tilt: s.tilt, wind: { x: 0, z: 0 }, pin: far, seed: 1 });
      const land = r.events.find((e) => e.kind === 'land');
      row.push(`${Math.round(power * 100)}%: ${yards(r.carry).toFixed(0)}+${yards(r.total - r.carry).toFixed(0)}y`);
      if (power === 1) row.push(`apex ${(r.apex / S).toFixed(0)}m, hang ${land?.t.toFixed(1)}s, ${r.time.toFixed(1)}s`);
    }
    console.log(`  ${club.name.padEnd(15)} ${row.join('  ')}`);
  }
  // Spin control and the draw / fade with a 7 iron.
  const seven = CLUBS.find((c) => c.id === 'iron7')!;
  for (const [label, spin, curve, accuracy] of [
    ['7i backspin', -1, 0, 0],
    ['7i runner', 1, 0, 0],
    ['7i fade', 0, 1, 0],
    ['7i draw', 0, -1, 0],
    ['7i late 0.8', 0, 0, 0.8],
    ['7i early 1.3', 0, 0, -1.3],
  ] as const) {
    const s = strike(seven, { club: 'iron7', power: 1, accuracy, spin, curve, yaw: 0 }, Surf.Fairway, () => 0.5, puttSpeed);
    const r = simulate(flat(Surf.Green), { x: 0, y: BASE, z: 0, speed: s.speed, yaw: -s.face, angle: s.angle, spin: s.spin, tilt: s.tilt, wind: { x: 0, z: 0 }, pin: far, seed: 1 });
    console.log(`  ${label.padEnd(15)} carry ${yards(r.carry).toFixed(0)}y total ${yards(r.total).toFixed(0)}y, ${yards(r.end.x).toFixed(1)}y right  (${s.quality}; on a green)`);
  }
  // Putts on a flat green: the meter's distance and where it stops.
  const green = flat(Surf.Green);
  const putter = CLUBS.find((c) => c.putter)!;
  for (const ft of [5, 10, 20, 40]) {
    const scale = (ft * 0.3048 * S) / 1;
    const s = strike(putter, { club: 'putter', power: 1, accuracy: 0, spin: 0, curve: 0, yaw: 0, scale }, Surf.Green, () => 0.5, puttSpeed);
    const r = simulate(green, { x: 0, y: BASE, z: 0, speed: s.speed, yaw: 0, angle: 0, spin: 0, tilt: 0, roll: s.roll, wind: { x: 0, z: 0 }, pin: far, seed: 1 });
    console.log(`  putt ${String(ft).padStart(2)} ft on the meter: rolls ${feet(r.total).toFixed(1)} ft in ${r.time.toFixed(1)} s (${(s.speed).toFixed(2)} m/s)`);
  }
  // A 2% slope across a 20 ft putt: how far it breaks.
  const side = flat(Surf.Green, { x: 0.02, z: 0 });
  const s = strike(putter, { club: 'putter', power: 1, accuracy: 0, spin: 0, curve: 0, yaw: 0, scale: 20 * 0.3048 * S }, Surf.Green, () => 0.5, puttSpeed);
  const r = simulate(side, { x: 0, y: BASE, z: 0, speed: s.speed, yaw: 0, angle: 0, spin: 0, tilt: 0, roll: s.roll, wind: { x: 0, z: 0 }, pin: far, seed: 1 });
  console.log(`  20 ft putt across a 2% slope: breaks ${feet(-r.end.x).toFixed(1)} ft, rolls ${feet(-r.end.z).toFixed(1)} ft (samples ${r.path.length / 3} at ${HZ} Hz)`);
}
