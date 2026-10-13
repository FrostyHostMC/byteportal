import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { defineLooks } from './client/looks';
import { shared } from './shared';

/**
 * The model gallery on each screen: the standard voices (the sword swings), the first-person view
 * (the player model's own arm, the sword and the cards in hand), the figures (the humanoids on the
 * platform's rig, and what the others hold), then its items' looks (`client/looks.ts`).
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup(client) {
    defineLooks(client);
  },
});
