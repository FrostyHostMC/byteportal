import { defineClient } from '@platform/client';
import { sounds } from '@platform/client/kits';
import { defineSounds } from './client/sounds';
import { shared } from './shared';

/**
 * Starfighter on each pilot's screen: the platform's standard voices (the blasts, the barrel
 * roll's whoosh), then its own (`client/sounds.ts`). The game flies the camera and the pilots sit
 * in their ships, so it has no first-person view, no figures to pose and no guns' HUD.
 */
export default defineClient(shared, {
  kits: [...sounds.standard()],
  setup(client) {
    defineSounds(client);
  },
});
