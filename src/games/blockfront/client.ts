import { defineClient } from '@platform/client';
import { effects, firstPerson, hud, items, sounds } from '@platform/client/kits';
import { ambience } from './client/ambience';
import { blasterHud } from './client/blaster-hud';
import { bolts } from './client/bolts';
import { detonatorBlast } from './client/detonator';
import { hits } from './client/hits';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { heroKits } from './heroes/client';
import { intro } from './client/intro';
import { vitals } from './client/vitals';
import { weather } from './client/weather';
import { shared } from './shared';

/**
 * Blockfront II on each player's screen: the kits it uses, the platform's and its own (its
 * detonators and blasters, thrown and fired here at once as its server plays them; the standard
 * voices, first person for those who'd rather, the troopers' figures; the blaster's heat and
 * crosshair, over the shoulder or through the eyes: `client/blaster-hud.ts`; the detonators' HUD;
 * hit markers for every hit landed, powers and blasts too: `client/hits.ts`; the edges reddening
 * at low health: `client/vitals.ts`; blaster bolts flying and landing:
 * `client/bolts.ts`; detonators in the world, and their white-blue blast over the platform's:
 * `client/detonator.ts`; the spaceport's wind and distant fighting: `client/ambience.ts`; sand,
 * snow and breath on the air: `client/weather.ts`; the opening fly-over: `client/intro.ts`), then
 * its own look: each weapon's model, icon, hold and bolt (`client/looks.ts`), and its voices
 * (`client/sounds.ts`).
 */
/** The first-person view (the platform's kit): a hero's own screen swings its arm with the saber at once (`heroes/client`). */
const fp = new firstPerson.FirstPersonKit();
// (Development: tests and screenshots reach it, to freeze a swing with `timeScale`.)
if (import.meta.env.DEV) (globalThis as { __fp?: unknown }).__fp = fp;

export default defineClient(shared, {
  kits: [items.throwables(), items.guns(), ...sounds.standard(), fp, ...heroKits({ firstPerson: fp }) /* the figures (heroes' sabers and powers too), the heroes' effects and HUD: heroes/client */, blasterHud(), hud.throwables(), hits(), vitals(), bolts(), effects.throwables(), detonatorBlast(), ambience(), weather(), intro()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
