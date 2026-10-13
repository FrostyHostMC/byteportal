import { Blueprint, type BlockRef, type Vec3 } from '@platform';

/*
 * Sky islands in the void. Home isle is at the origin with a pier running east to where the
 * airship is moored; five more islands, each with a beacon, lie out across the sky at different
 * heights. Floors are the top layer of each island; players stand one above.
 */

export interface Isle {
  name: string;
  /** Middle of the island's floor (its top layer). */
  at: Vec3;
  radius: number;
}

export const HOME: Isle = { name: 'Home Isle', at: { x: -12, y: 79, z: 0 }, radius: 10 };
/** Where the crew starts: on the pier, looking out at the ship. */
export const PIER_SPAWN: Vec3 = { x: -1.5, y: 80, z: 0.5 };
/** Where the ship is moored (its origin, the middle of its main deck), and which way it faces. */
export const MOORING: Vec3 = { x: 14, y: 80, z: 0 };

export const ISLES: Isle[] = [
  { name: 'Lantern Rock', at: { x: 10, y: 92, z: -150 }, radius: 7 },
  { name: 'Gull Spire', at: { x: 150, y: 108, z: -215 }, radius: 6 },
  { name: 'Mossfall', at: { x: 235, y: 84, z: -55 }, radius: 9 },
  { name: 'High Tor', at: { x: 165, y: 124, z: 115 }, radius: 7 },
  { name: 'Fernhollow', at: { x: -45, y: 98, z: 165 }, radius: 8 },
];

/** Below this, whoever's falling is lost to the sky. */
export const VOID_Y = 40;

// --- Noise --------------------------------------------------------------------------------------

function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function noise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, 0, zi, seed) + (hash(xi + 1, 0, zi, seed) - hash(xi, 0, zi, seed)) * sx;
  const b = hash(xi, 0, zi + 1, seed) + (hash(xi + 1, 0, zi + 1, seed) - hash(xi, 0, zi + 1, seed)) * sx;
  return a + (b - a) * sz;
}

// --- Islands ------------------------------------------------------------------------------------

/**
 * A round floating island: grass on top, a ragged rim, and an underside of dirt and stone that
 * tapers to hanging points.
 */
function island(isle: Isle, seed: number): Blueprint {
  const { at, radius: r } = isle;
  const cx = Math.floor(at.x);
  const cz = Math.floor(at.z);
  const depth = Math.round(r * 1.6) + 4;
  const bp = new Blueprint({ x: cx - r - 3, y: at.y - depth - 6, z: cz - r - 3 }, { x: 2 * r + 7, y: depth + 20, z: 2 * r + 7 });
  for (let z = cz - r - 2; z <= cz + r + 2; z++)
    for (let x = cx - r - 2; x <= cx + r + 2; x++) {
      const d = Math.hypot(x + 0.5 - at.x, z + 0.5 - at.z);
      const edge = r + (noise(x / 3, z / 3, seed) - 0.5) * 3;
      if (d > edge) continue;
      const inward = edge - d;
      const n = noise(x / 2.5, z / 2.5, seed + 7);
      const down = Math.min(depth, Math.round(2 + inward * 1.3 + n * 4 + (n > 0.7 ? (n - 0.7) * 20 : 0)));
      bp.set(x, at.y, z, 'grass_block');
      for (let k = 1; k <= down; k++) {
        const h = hash(x, k, z, seed);
        const b: BlockRef = k <= 2 ? 'dirt' : k === down && h < 0.4 ? 'cobblestone' : h < 0.12 ? 'andesite' : h < 0.2 ? 'gravel' : 'stone';
        bp.set(x, at.y - k, z, b);
      }
      // Flowers and grass here and there.
      const f = hash(x, 0, z, seed + 3);
      if (inward > 1.5 && f < 0.08) bp.set(x, at.y + 1, z, f < 0.03 ? 'poppy' : f < 0.05 ? 'dandelion' : 'short_grass');
    }
  return bp;
}

/** A small oak on an island. */
function tree(bp: Blueprint, x: number, y: number, z: number, height: number) {
  for (let dy = -2; dy <= 1; dy++)
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy) > 3) continue;
        bp.set(x + dx, y + height + dy, z + dz, 'oak_leaves');
      }
  for (let h = 1; h <= height; h++) bp.set(x, y + h, z, 'oak_log');
}

/** Where each island's beacon is: the middle of its 3x3 pad (standing on it lights it). */
export function beaconPad(isle: Isle): Vec3 {
  return { x: Math.floor(isle.at.x) + 0.5, y: isle.at.y + 2, z: Math.floor(isle.at.z) + 0.5 };
}

/** The block a beacon's light sits in (dark until lit). */
export function beaconLamp(isle: Isle): Vec3 {
  return { x: Math.floor(isle.at.x), y: isle.at.y + 5, z: Math.floor(isle.at.z) };
}

/** A beacon: an iron pad, four pillars and a roof with a lamp under it. */
function beacon(bp: Blueprint, isle: Isle) {
  const cx = Math.floor(isle.at.x);
  const cz = Math.floor(isle.at.z);
  const y = isle.at.y;
  bp.fill({ x: cx - 1, y: y + 1, z: cz - 1 }, { x: cx + 1, y: y + 1, z: cz + 1 }, 'iron_block');
  for (const [dx, dz] of [
    [-2, -2],
    [2, -2],
    [-2, 2],
    [2, 2],
  ])
    for (let h = 1; h <= 4; h++) bp.set(cx + dx, y + h, cz + dz, 'stone_bricks');
  bp.fill({ x: cx - 2, y: y + 6, z: cz - 2 }, { x: cx + 2, y: y + 6, z: cz + 2 }, (x, _y, z) => (Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2 ? 'stone_bricks' : 'glass'));
  const lamp = beaconLamp(isle);
  bp.set(lamp.x, lamp.y, lamp.z, 'black_concrete');
}

/** Home isle: grass, trees, and the pier out to the mooring. */
function home(): Blueprint[] {
  const bp = island(HOME, 101);
  const { at } = HOME;
  tree(bp, at.x - 5, at.y, at.z - 4, 4);
  tree(bp, at.x - 3, at.y, at.z + 5, 5);
  // The pier: planks on posts, a wider landing with lanterns at the end.
  const end = MOORING.x - 6;
  const pier = new Blueprint({ x: at.x + 5, y: at.y - 4, z: -3 }, { x: end - at.x - 4, y: 6, z: 7 });
  for (let x = at.x + 6; x <= end; x++)
    for (let z = -1; z <= 1; z++) {
      pier.set(x, at.y, z, 'spruce_planks');
      if ((x - at.x) % 4 === 0 && z !== 0) for (let k = 1; k <= 3; k++) pier.set(x, at.y - k, z, 'spruce_log');
    }
  pier.fill({ x: end, y: at.y, z: -2 }, { x: end, y: at.y, z: 2 }, 'spruce_planks');
  pier.set(end, at.y + 1, -2, 'sea_lantern');
  pier.set(end, at.y + 1, 2, 'sea_lantern');
  return [bp, pier];
}

export function islands(): Blueprint[] {
  const out = home();
  ISLES.forEach((isle, i) => {
    const bp = island(isle, 200 + i * 17);
    beacon(bp, isle);
    const cx = Math.floor(isle.at.x);
    const cz = Math.floor(isle.at.z);
    tree(bp, cx + isle.radius - 3, isle.at.y, cz - 1, 4);
    if (isle.radius > 6) tree(bp, cx - isle.radius + 3, isle.at.y, cz + 2, 5);
    out.push(bp);
  });
  return out;
}
