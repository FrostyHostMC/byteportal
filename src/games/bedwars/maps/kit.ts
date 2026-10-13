import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import type { BedwarsMap, TeamColor } from '../map';

/** A Bed Wars map the lobby can vote for. */
export interface MapDef {
  id: string;
  name: string;
  /** One line for the vote menu. */
  blurb: string;
  build(): BedwarsMap;
}

/** The teams, in the order every map lists them. */
export const COLORS: TeamColor[] = ['red', 'blue', 'green', 'yellow'];

/** Unit direction from the centre to each team on a cardinal map (red +z, blue +x, green -z, yellow -x). */
export const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * Maps are drawn once, in red's frame, and turned round the origin for the other teams: team
 * `i`'s copy of red's point (x, z) is `turn(i, x, z)` (quarter turns: red +z, blue +x, green -z,
 * yellow -x). `unturn` goes back.
 */
export function turn(i: number, x: number, z: number): { x: number; z: number } {
  const [dx, dz] = DIRS[i];
  return { x: dx * z + dz * x, z: dz * z - dx * x };
}

export function unturn(i: number, x: number, z: number): { x: number; z: number } {
  const [dx, dz] = DIRS[i];
  return { x: dz * x - dx * z, z: dx * x + dz * z };
}

/** Build in red's frame on team `i`'s blueprint: `put` / `get` take red's coordinates. */
export function framed(bp: Blueprint, i: number) {
  return {
    at: (x: number, z: number) => turn(i, x, z),
    put(x: number, y: number, z: number, block: BlockRef) {
      const w = turn(i, x, z);
      bp.set(w.x, y, w.z, block);
    },
    get(x: number, y: number, z: number): BlockRef | undefined {
      const w = turn(i, x, z);
      return bp.get(w.x, y, w.z);
    },
    /** A facing in red's frame, turned for this team. */
    facing: (f: Facing) => turnFacing(i, f),
  };
}

export type Facing = 'north' | 'east' | 'south' | 'west';

/** The facing a direction (a unit step on x or z) points (north is -z, east +x). */
export function facingOf(dx: number, dz: number): Facing {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  return dz > 0 ? 'south' : 'north';
}

/** Red's facing turned for team `i`. */
export function turnFacing(i: number, f: Facing): Facing {
  const v = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[f];
  const t = turn(i, v[0], v[1]);
  return facingOf(t.x, t.z);
}

export const stairs = (material: string, f: Facing, top = false) => `${material}_stairs[facing=${f},half=${top ? 'top' : 'bottom'}]`;
export const slab = (material: string, top = false) => `${material}_slab[type=${top ? 'top' : 'bottom'}]`;

/** Where a map's floors are: every walkable floor's top block is at `floor`; below `voidY` is death. */
export interface Level {
  floor: number;
  voidY: number;
}

// --- Deterministic noise ----------------------------------------------------------------------

export function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in 0..1. */
export function noise(x: number, z: number, seed: number): number {
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

// --- Footprints -------------------------------------------------------------------------------

/** The columns an island covers: a bounding box and a test. */
export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  inside(x: number, z: number): boolean;
}

/** A round footprint (radius in blocks from the centre column). */
export function disc(cx: number, cz: number, r: number): Footprint {
  const R = Math.ceil(r);
  return { x0: cx - R, z0: cz - R, x1: cx + R, z1: cz + R, inside: (x, z) => Math.hypot(x - cx, z - cz) <= r };
}

/**
 * Red's footprint (a box in red's frame and a test in red's coordinates) turned for team `i`:
 * the world box, and a test that takes world columns.
 */
export function turnedFootprint(i: number, box: { x0: number; z0: number; x1: number; z1: number }, insideRed: (x: number, z: number) => boolean): Footprint {
  const a = turn(i, box.x0, box.z0);
  const b = turn(i, box.x1, box.z1);
  return {
    x0: Math.min(a.x, b.x),
    z0: Math.min(a.z, b.z),
    x1: Math.max(a.x, b.x),
    z1: Math.max(a.z, b.z),
    inside: (x, z) => {
      const l = unturn(i, x, z);
      return insideRed(l.x, l.z);
    },
  };
}

// --- Floating islands -------------------------------------------------------------------------

export interface IslandStyle {
  seed: number;
  /** How many blocks the underside deepens per block away from the rim. */
  taper: number;
  /** Deepest the underside gets below the floor (before hanging spikes). */
  maxDepth: number;
  /** How far the hanging rock spikes (clumps under the island) reach below the rest. */
  spikes: number;
  /** Glowing tips on the underside (the centre island). */
  glow?: boolean;
  /** The layer under the rim of the floor (default stone bricks, a built edge). */
  band?: BlockRef;
  /** The layer under the rest of the floor (default dirt). */
  sub?: BlockRef;
  /** The underside's rock, `k` blocks under the floor of a column `depth` deep (default `rock`: dirt, then grey stone strata). */
  rock?: (x: number, y: number, z: number, k: number, depth: number, s: IslandStyle) => BlockRef;
}

/** Distance from each column to the nearest column outside the footprint (rim columns = 1). */
export function rimDistance(fp: Footprint): (x: number, z: number) => number {
  const w = fp.x1 - fp.x0 + 1;
  const d = new Float32Array(w * (fp.z1 - fp.z0 + 1));
  const R = 14;
  for (let z = fp.z0; z <= fp.z1; z++)
    for (let x = fp.x0; x <= fp.x1; x++) {
      if (!fp.inside(x, z)) continue;
      let best = R;
      for (let oz = -R; oz <= R; oz++)
        for (let ox = -R; ox <= R; ox++) {
          const dist = Math.hypot(ox, oz);
          if (dist < best && !fp.inside(x + ox, z + oz)) best = dist;
        }
      d[(z - fp.z0) * w + (x - fp.x0)] = best;
    }
  return (x, z) => d[(z - fp.z0) * w + (x - fp.x0)];
}

/** Rock for the underside: a dirt band under the floor, then banded stone, darker at the bottom. */
export function rock(x: number, y: number, z: number, k: number, depth: number, s: IslandStyle): BlockRef {
  const h = hash(x, y, z, s.seed + 11);
  if (k <= 2 || (k === 3 && hash(x, 0, z, s.seed + 3) < 0.5)) return h < 0.05 ? 'gravel' : 'dirt';
  if (k === depth && s.glow && hash(x, 0, z, s.seed + 5) < 0.18) return 'glowstone';
  if (k >= depth - 1 && h < 0.45) return 'cobblestone';
  if (k > 10 && h < 0.55) return 'deepslate';
  const band = Math.sin(y * 0.8 + noise(x / 5, z / 5, s.seed) * 5);
  if (band > 0.6) return 'andesite';
  if (h < 0.07) return 'cobblestone';
  if (h < 0.1) return 'granite';
  if (h < 0.12 && k < 7) return 'dirt';
  return 'stone';
}

/**
 * A floating island: `floor` paints the top layer (y = level.floor), a band sits under the rim,
 * and the underside tapers down (the style's rock) with a few hanging spikes. The blueprint's box
 * reaches `headroom` blocks above the floor, for builds on top.
 */
export function floatingIsland(
  fp: Footprint,
  style: IslandStyle,
  floor: (x: number, z: number, rim: number) => BlockRef,
  level: Level,
  headroom = 25,
): Blueprint {
  const FLOOR = level.floor;
  const top = FLOOR + headroom;
  const bottom = level.voidY + 2;
  const bp = new Blueprint({ x: fp.x0 - 4, y: bottom, z: fp.z0 - 4 }, { x: fp.x1 - fp.x0 + 9, y: top - bottom + 1, z: fp.z1 - fp.z0 + 9 });
  const rim = rimDistance(fp);
  const stone = style.rock ?? rock;
  for (let z = fp.z0; z <= fp.z1; z++)
    for (let x = fp.x0; x <= fp.x1; x++) {
      if (!fp.inside(x, z)) continue;
      const e = rim(x, z);
      const n = noise(x / 4, z / 4, style.seed);
      let depth = Math.round(Math.min(style.maxDepth * (0.85 + 0.3 * n), 2 + (e - 1) * style.taper * (0.7 + 0.6 * n)));
      const clump = noise(x / 2.3, z / 2.3, style.seed + 9);
      if (e >= 1.5 && clump > 0.58) depth += Math.round(((clump - 0.58) / 0.42) * style.spikes * (0.6 + 0.4 * Math.min(1, e / 4)));
      depth = Math.min(depth, FLOOR - bottom);
      bp.set(x, FLOOR, z, floor(x, z, e));
      bp.set(x, FLOOR - 1, z, e < 1.5 ? (style.band ?? 'stone_bricks') : (style.sub ?? 'dirt'));
      for (let k = 2; k <= depth; k++) bp.set(x, FLOOR - k, z, stone(x, FLOOR - k, z, k, depth, style));
    }
  return bp;
}

// --- Small builds -----------------------------------------------------------------------------

/** A 3x3 generator pad at height `y` (one block up from the floor it stands on); returns the drop point above its centre. */
export function pad(bp: Blueprint, cx: number, cz: number, y: number, corner: BlockRef, edge: BlockRef, middle: BlockRef): Vec3 {
  bp.fill({ x: cx - 1, y, z: cz - 1 }, { x: cx + 1, y, z: cz + 1 }, (x, _y, z) => (x === cx && z === cz ? middle : x !== cx && z !== cz ? corner : edge));
  return { x: cx + 0.5, y: y + 1, z: cz + 0.5 };
}

/** A team's bed: the foot block, then the head block next to it (the facing points foot to head). */
export function placeBed(bp: Blueprint, color: TeamColor, foot: Vec3, head: Vec3): [Vec3, Vec3] {
  const f = facingOf(head.x - foot.x, head.z - foot.z);
  bp.set(foot.x, foot.y, foot.z, `${color}_bed[facing=${f},part=foot]`);
  bp.set(head.x, head.y, head.z, `${color}_bed[facing=${f},part=head]`);
  return [
    { x: foot.x, y: foot.y, z: foot.z },
    { x: head.x, y: head.y, z: head.z },
  ];
}

/** Yaw that looks from `from` toward `to` (0 = -z, PI/2 = -x). */
export function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** The centre of a block's top face (a standing spot on the block below `y`). */
export const standAt = (x: number, y: number, z: number): Vec3 => ({ x: x + 0.5, y, z: z + 0.5 });
