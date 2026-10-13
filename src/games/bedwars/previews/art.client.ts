import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { defineLooks, SPRITE_LOOKS } from '../client/looks';
import { shared } from './art.shared';

/** Dev preview: the kits it uses (the skins stand as figures, the sprites are held), and each sprite as an item's icon. */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup: (client) => defineLooks(client, SPRITE_LOOKS),
});
