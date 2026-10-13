import type { ClientPart } from './part';
import { mapsClient } from './maps';
import { bestiaryClient } from './bestiary';
import { bossesClient } from './bosses';
import { armoryClient } from './armory';
import { runClient } from './run';
import { hudClient } from './hud';

/** The Arena's parts on each screen, in order (`part.ts`). */
export const CLIENT_PARTS: readonly ClientPart[] = [mapsClient, bestiaryClient, bossesClient, armoryClient, runClient, hudClient];
