import { defineShared } from '@platform';
import { buildDestroyer } from '../destroyer';
import { DESTROYER_CENTER, SEED } from '../layout';
import meta from './drydock.meta';

// Dev preview: the capital ship in place over the battle terrain. Hang in the air and move the
// camera with player.teleport + debugView (teleport unfreezes: freeze again after).
export const shared = defineShared({
  ...meta,
  world: { seed: SEED, structures: [buildDestroyer(DESTROYER_CENTER).blueprint], spawn: { x: -99.5, y: 150, z: 40.5 }, time: 0.42, freezeTime: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
});
