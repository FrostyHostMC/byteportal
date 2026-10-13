import { HIJACKED } from './maps/hijacked';
import { JACKRABBIT } from './maps/jackrabbit';
import { KAHUNA } from './maps/kahuna';
import { NUKEBLOCK } from './maps/nukeblock';
import { RUST } from './maps/rust';
import type { MapSpec } from './maps/kit';

export type { MapSpec, Site, SpawnPoint } from './maps/kit';

/**
 * Call of Blocky's maps, all built into the one world, far apart: Jackrabbit Lane at the middle,
 * Big Kahuna Burger 512 blocks east of it, Hijacked's yacht at sea 512 blocks west, the
 * Nukeblock test town 512 blocks south, and Rust's oil yard 512 blocks north. The world's view
 * is held to ten chunks (`maxViewDistance`), so only the map being played is ever loaded and
 * drawn; a match on another map moves everyone there (its spawns, its bounds for the bots'
 * walking grid, its hotspots). The first is the home page's, and the one a new room starts on.
 */
export const MAPS: readonly MapSpec[] = [JACKRABBIT, KAHUNA, HIJACKED, NUKEBLOCK, RUST];

export const mapById = (id: string): MapSpec | undefined => MAPS.find((m) => m.id === id);

/** What the maps share: the world's seed and time of day, the ground they stand on, everything built. */
export const WORLD = {
  seed: 300,
  /** Late afternoon going gold. */
  time: 0.72,
  /** The y players stand at on every map. */
  floorY: JACKRABBIT.floorY,
  structures: MAPS.flatMap((m) => m.structures),
  terraform: MAPS.flatMap((m) => m.terraform),
};

for (const m of MAPS) if (m.floorY !== WORLD.floorY) throw new Error(`map ${m.id}: every map stands at y ${WORLD.floorY}`);
