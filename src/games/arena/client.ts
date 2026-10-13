import { defineClient } from '@platform/client';
import { effects, figures, hud, items, sounds } from '@platform/client/kits';
import { fp } from './client/armory';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { CLIENT_PARTS } from './client/parts';
import { shared } from './shared';

/**
 * The Arena on each player's screen: the platform's kits it uses, in the order they run (bombs,
 * thrown and flying, the standard voices, the first-person view (the armory's, with its swings:
 * `client/armory.ts`), the fighters' and monsters' figures, the bomb count and warning markers,
 * the bombs' flight), then its parts' own
 * (`client/parts.ts`); and its own look: each weapon's icon and model (`client/looks.ts`), the
 * voices (`client/sounds/`), and each part's setup.
 */
export default defineClient(shared, {
  kits: [items.throwables(), ...sounds.standard(), fp, figures.humanoid(), hud.throwables(), effects.throwables(), ...CLIENT_PARTS.flatMap((p) => p.kits)],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
    for (const p of CLIENT_PARTS) p.setup?.(client);
  },
});
