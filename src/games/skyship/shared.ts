import { defineShared } from '@platform';
import meta from './meta';
import { islands, PIER_SPAWN } from './world';

const structures = islands();

/** The sky islands (every screen builds their blocks too) and the player. The airship is the server's (a prop). */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures,
    spawn: PIER_SPAWN,
    spawnYaw: -Math.PI / 2,
    time: 0.3,
    viewDistance: 12,
  },
  player: { health: false, hotbar: 'items' },
});
