import { FROSTLINE } from './maps/frostline';
import { SPACEPORT } from './maps/spaceport';
import type { MapSpec } from './maps/kit';

export type { MapSpec, PostSpec, SpawnPoint } from './maps/kit';

/**
 * Blockfront's maps, all built into the one world (far apart, so only the one being played is
 * loaded and drawn: `maxViewDistance`). The first is the home page's, and the one a new room
 * starts on.
 */
export const MAPS: readonly MapSpec[] = [SPACEPORT, FROSTLINE];

export const mapById = (id: string): MapSpec | undefined => MAPS.find((m) => m.id === id);

/** What the maps share: the world's seed, the floor they stand on, everything built. */
export const WORLD = {
  seed: 1977,
  floorY: SPACEPORT.floorY,
  time: SPACEPORT.time,
  ground: SPACEPORT.ground,
  structures: MAPS.flatMap((m) => m.structures),
  terraform: MAPS.flatMap((m) => m.terraform),
};

for (const m of MAPS) if (m.floorY !== WORLD.floorY) throw new Error(`map ${m.id}: every map stands at y ${WORLD.floorY}`);
