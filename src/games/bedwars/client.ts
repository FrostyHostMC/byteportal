import { defineClient } from '@platform/client';
import { figures, firstPerson, items, sounds } from '@platform/client/kits';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { shared } from './shared';

/**
 * Bed Wars on each player's screen: the platform's kits it uses, in the order they run (the
 * eating's slowing, the standard voices, the first-person view, players' and bots' figures), then its own look: each
 * item's icon and model (`client/looks.ts`), and its voices (`client/sounds.ts`).
 */
export default defineClient(shared, {
  kits: [items.consumables(), ...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
