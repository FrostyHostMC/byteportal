import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { energyBar, taggers } from './client/tagger';
import { shared } from './shared';

/**
 * Laser Tag on each player's screen: its own tagger kit's screen half (`client/tagger.ts`) first,
 * then the platform's kits (voices, the first person, the figures), and the tagger's energy bar.
 * How a tagger looks (for now): a sword's sprite, held as an item.
 */
export default defineClient(shared, {
  kits: [taggers(), ...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), energyBar()],
  setup(client) {
    client.items.look('zapper', { icon: 'diamond_sword' });
    client.items.look('lance', { icon: 'iron_sword' });
  },
});
