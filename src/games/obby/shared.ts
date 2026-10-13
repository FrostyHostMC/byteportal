import { defineShared } from '@platform';
import { course } from './course';
import meta from './meta';

/** The course in the sky (every screen builds its blocks too) and the player. */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures: course.blueprints,
    spawn: course.stages[0].spawn,
    spawnYaw: course.stages[0].yaw,
    time: 0.3,
    freezeTime: true,
    viewDistance: 10,
  },
  player: { health: false, fallDamage: false, hotbar: 'items' },
});
