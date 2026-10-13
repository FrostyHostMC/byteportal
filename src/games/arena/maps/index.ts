import { COLOSSEUM } from './colosseum';
import { FORGE } from './forge';
import { NECROPOLIS } from './necropolis';
import { SANCTUM } from './sanctum';
import type { ArenaMap } from './registry';

export { FLOOR, along, inBox, mapNear, type ArenaMap, type Box, type Fire, type Gate, type IntroKey, type TrapSpec } from './registry';
export { MAP_BLOCKS } from './blocks';

/** Every map, in the order the public rotation takes them (the first is the default). */
export const MAPS: readonly ArenaMap[] = [COLOSSEUM, NECROPOLIS, FORGE, SANCTUM];

export const mapById = (id: string): ArenaMap | undefined => MAPS.find((m) => m.id === id);
