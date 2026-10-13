import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { defineSounds } from './client/sounds';
import { shared } from './shared';

/**
 * Sky Obby on each player's screen: the standard voices (an empty hand swings), the first-person
 * view (that hand), the other runners' figures, then its own voices (`client/sounds.ts`). No guns
 * or throwables, so none of their HUD or effects.
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup(client) {
    defineSounds(client);
  },
});
