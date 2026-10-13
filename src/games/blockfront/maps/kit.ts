import type { Blueprint, Vec3 } from '@platform';
import type { Team } from '../teams';

/**
 * What every Blockfront map is: blueprints standing on the world's plain ground, and the command
 * posts the match is fought over. Each map builds its own Blueprints; `server.ts` plays whichever
 * the match is on (its posts, its bounds for the bots' walking grid, its hotspots).
 */

/** Where a fighter appears: feet position, `yaw` 0 looks toward -z. */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * A command post: a place to hold. Standing in its `radius` (round `at`, within `height` above
 * and a little below its feet level) with nobody of the other side there turns it your way;
 * owned, it's somewhere your side spawns (`spawns`, round it, out of the open).
 *
 * - `owner`: who holds it when a match starts (null: nobody's, up for grabs).
 * - `locked`: a side's base: it can't be taken, so each side always has somewhere to spawn.
 */
export interface PostSpec {
  /** One letter: 'A' to 'E', along the map from the Rebels' end to the Empire's. */
  id: string;
  /** What it's called on the HUD ("the cantina"). */
  name: string;
  /** The middle of it, at feet level (where its marker stands). */
  at: Vec3;
  radius: number;
  /** How far above `at.y` still counts as standing in it (a rooftop, a balcony). Default 6. */
  height?: number;
  owner: Team | null;
  locked?: boolean;
  spawns: SpawnPoint[];
}

export interface Terraform {
  x: number;
  z: number;
  radius: number;
  blend: number;
  height: number;
}

/**
 * A map. `floorY` is the y players stand at on the ground (the ground's top block is at
 * `floorY - 1`). `bounds` is the playable box (bots walk inside it; under it is out of the map).
 * `home` is where people come in and what the home page looks at; `overview` a camera looking
 * over it. `hotspots` are places worth fighting over besides the posts (bots drift toward them).
 */
export interface MapSpec {
  id: string;
  name: string;
  /** A line about it, for the banner at the start of a match. */
  blurb: string;
  floorY: number;
  /** The world's time of day on it (0.5 noon), and the ground it stands on. */
  time: number;
  ground: { top: string; fill: string };
  structures: Blueprint[];
  terraform: Terraform[];
  bounds: { min: Vec3; max: Vec3 };
  /** In order from the Rebels' end (the first) to the Empire's (the last). */
  posts: PostSpec[];
  home: SpawnPoint;
  overview: { position: Vec3; target: Vec3 };
  /**
   * The opening fly-over's keyframes (the camera's place and the point it looks at), from the
   * Rebels' end of the map to the Empire's: each screen flies them (turned round for the Rebels, so
   * it ends over their own end), then comes down to its player (`cinema.ts`, `client/intro.ts`).
   * Without them it passes over each post in turn.
   */
  intro?: { at: Vec3; look: Vec3 }[];
  hotspots: Vec3[];
}

/** A steady pseudo-random number in [0, 1) for a column (weathering, scatter). */
export function hash(x: number, z: number, k = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Yaw that looks from (x, z) toward (tx, tz). */
export const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/** A spawn standing in block (x, z) on the floor at y, facing (tx, tz). */
export const spawnAt = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => ({ x: x + 0.5, y, z: z + 0.5, yaw: yawTo(x, z, tx, tz) });

/** Spawns in a ring round a point (block cells), facing out toward `face`. */
export function ringSpawns(cx: number, y: number, cz: number, r: number, n: number, face: { x: number; z: number }): SpawnPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return spawnAt(Math.round(cx + Math.cos(a) * r), y, Math.round(cz + Math.sin(a) * r), face.x, face.z);
  });
}
