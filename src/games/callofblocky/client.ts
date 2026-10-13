import { defineClient } from '@platform/client';
import { effects, figures, firstPerson, hud, items, sounds } from '@platform/client/kits';
import { killcam } from './client/killcam';
import { defineLooks } from './client/looks';
import { potg } from './client/potg';
import { progressionHud } from './client/progression';
import { defineSounds } from './client/sounds';
import { streakCam } from './client/streaks';
import { shared } from './shared';

/**
 * Call of Blocky on each player's screen: the platform's kits it uses, in the order they run (its
 * lethals and guns, fired and thrown here at once as its server plays them; the standard voices,
 * the first-person view, the fighters' figures, the gun's and the lethals' HUD, gunfire and the
 * lethals in the world, its kill cam on screen: `client/killcam.ts`, the Play of the Game's title
 * sequence and call-outs: `client/potg.ts`, and what a pilot sees flying
 * a killstreak: `client/streaks.ts`), then its own look: each weapon's model, icon, hold, tracer
 * and trail (`client/looks.ts`), and its voices
 * (`client/sounds.ts`). Last, a kit of its own: the XP bar, the ticker of gains, the level-ups and
 * the match's XP (`client/progression.ts`).
 */
export default defineClient(shared, {
  kits: [items.throwables(), items.guns(), ...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), hud.gunner(), hud.throwables(), effects.gunfire(), effects.throwables(), killcam(), potg(), streakCam(), progressionHud()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
