import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './shared';

/**
 * Each player's screen: the platform's kits it uses (the standard voices, the first-person view,
 * other players' figures), and how its one item looks here. The server says what a heart does;
 * the screen draws it (as the built-in heart sprite), and the win screen names it (`{ item }`).
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup(client) {
    client.items.look('heart', { icon: 'heart' });
  },
});
