import type { ClientPart } from './part';
import { announcer } from './hud/announcer';
import { cards } from './hud/cards';
import { crowd } from './hud/crowd';
import { hits } from './hud/hits';
import { music } from './hud/music';
import { progress } from './hud/progress';
import { status } from './hud/status';
import { hudState } from './hud/store';
import { vitals } from './hud/vitals';

/**
 * The HUD on each screen: the Arena's look over the platform's pieces is the theme's
 * (`hud/theme.ts`); these kits draw the rest from what the HUD's server part says (`hud/part.ts`):
 * the state they read (`hud/store.ts`, first), the standing HUD (the wave, gold and the crowd, the
 * party, blessings), the announcer, the wave-cleared card, experience and levels, hits (markers,
 * hit-stop, gore), the fighter's vitals, the music and the crowd in the stands. Its voices are `sounds/hud.ts`.
 */
export const hudClient: ClientPart = { name: 'hudClient', kits: [hudState(), status(), announcer(), cards(), progress(), hits(), vitals(), music(), crowd()] };
