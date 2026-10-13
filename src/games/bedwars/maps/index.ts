import type { MapDef } from './kit';
import { canyon } from './canyon';
import { frostpeak } from './frostpeak';
import { sakura } from './sakura';
import { skyhold } from './skyhold';

export type { MapDef } from './kit';

/** Every Bed Wars map, in the vote menu's order (the first is the original, Skyhold). */
export const MAP_DEFS: MapDef[] = [skyhold, canyon, frostpeak, sakura];
