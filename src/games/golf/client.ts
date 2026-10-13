import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { ambienceKit } from './client/ambience';
import { ballsKit } from './client/balls';
import { greenKit } from './client/green';
import { flyoverKit } from './client/flyover';
import { defineLooks } from './client/looks';
import { panelKit } from './client/panel';
import { defineSounds } from './client/sounds';
import { GolfState } from './client/state';
import { swingKit } from './client/swing';
import { terrainKit } from './client/terrain';
import { shared } from './shared';

const golf = new GolfState();

/**
 * Blockyard Links on each player's screen: the platform's voices, first-person view and figures,
 * then the golf: what the server says (`state`), the balls and their flights, the swing, the
 * panel, reading the greens, and the sounds of the course.
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), golf.kit(), terrainKit(golf), ballsKit(golf), swingKit(golf), panelKit(golf), greenKit(golf), flyoverKit(golf), ambienceKit()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
