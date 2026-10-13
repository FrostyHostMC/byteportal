import type { Blueprint, Vec3 } from '@platform';
import { skyhold } from './maps/skyhold';

export type TeamColor = 'red' | 'blue' | 'green' | 'yellow';

/** One team's island. All positions are world block coordinates. */
export interface TeamBase {
  color: TeamColor;
  /** The two bed blocks (`<color>_bed`), side by side. Breaking either one destroys the bed. */
  bed: [Vec3, Vec3];
  /** Where team members (re)spawn: the block they stand on is at y - 1. */
  spawn: Vec3;
  /** Facing when spawning (radians; 0 looks toward -z, PI/2 toward -x). */
  spawnYaw: number;
  /** The resource generator: iron and gold drop here (centre of the top of its pad, y = pad top + 1). */
  generator: Vec3;
  /** Where the shopkeeper stands (feet), and which way it faces. */
  shop: Vec3;
  shopYaw: number;
}

export interface BedwarsMap {
  blueprints: Blueprint[];
  /** Red, blue, green, yellow (in that order). */
  teams: TeamBase[];
  /** Diamond generators (drop points), on the small islands. */
  diamonds: Vec3[];
  /** Emerald generators (drop points), on the centre island. */
  emeralds: Vec3[];
  /** The centre of the map (top of the middle island). */
  center: Vec3;
  /** Anything below this falls into the void and dies. */
  voidY: number;
}

/** The first map, Skyhold (every map is in `maps/`; `MAP_DEFS` in `maps/index.ts` lists them). */
export function buildMap(): BedwarsMap {
  return skyhold.build();
}
