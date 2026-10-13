import { defineClient } from '@platform/client';
import { effects, figures, firstPerson, hud, items, sounds } from '@platform/client/kits';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { GUN_RULES, shared } from './shared';

/**
 * High Noon on each player's screen: the platform's kits it uses, in the order they run (its guns,
 * played by its rules, `GUN_RULES`, as its server plays them; the standard voices, the first-person view, the gunslingers' figures, the held gun's HUD, gunfire in
 * the world; no throwables in Dry Gulch), then its own look: each gun's model, icon, hold, tracer
 * and sounds (`client/looks.ts`), and its voices (`client/sounds.ts`).
 */
export default defineClient(shared, {
  kits: [items.guns(GUN_RULES), ...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), hud.gunner(), effects.gunfire()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
