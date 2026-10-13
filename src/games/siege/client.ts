import { defineClient } from '@platform/client';
import { effects, figures, firstPerson, hud, items, sounds } from '@platform/client/kits';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { radioVoice } from './client/voice';
import { shared } from './shared';

/** Each player's screen: guns (fired here at once, as the server plays them), the standard voices, first-person view, figures, the ammo counter and gunfire, then the weapons' looks and voices. */
export default defineClient(shared, {
  kits: [items.guns(), ...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), hud.gunner(), effects.gunfire()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
    radioVoice(client);
  },
});
