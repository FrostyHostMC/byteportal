import { defineShared } from '@platform';
import meta from './meta';
import { peek } from './peek';
import { BASE, FLOOR, STRUCTURES, TERRAIN } from './site';

/** The field's height, and the mound the site stands on. */
export { BASE, FLOOR };

/**
 * The world and the player: what the server and every screen read. A war-torn site under the night
 * sky. Bullets carve every block that stands on the ground: the base, the ruins, the wrecks and
 * whatever the team builds. Only the ground itself can't be shot apart.
 */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    ground: { y: FLOOR, top: 'gravel', fill: 'andesite', depth: 6 },
    terraform: TERRAIN,
    maxViewDistance: 8,
    structures: STRUCTURES,
    destructible: { above: FLOOR - 4, blocks: 'all', except: ['gravel', 'andesite', 'deepslate', 'bedrock'] }, // every block of the base and the ruins; only the ground itself stands
    spawn: { x: 4.5, y: BASE + 1.05, z: 4.5 },
    time: 0.5,
  },
  player: {
    health: 100,
    // Out of the fight a few seconds, a wound closes: so a firefight can flow.
    regen: { delay: 6, perSecond: 9 },
    fallDamage: false,
    hotbar: 'items',
    // A shooter's movement: sprint on Shift, a slide out of the sprint on C, a vault onto ledges, a lean on Q and E.
    movement: {
      walk: 5.4,
      sprint: 8,
      crouch: 2.6,
      jump: 1.3,
      gravity: 30,
      acceleration: 16,
      airControl: 4,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: { speed: 11, time: 0.8, friction: 1.3, cooldown: 0.6 },
      mantle: 1.1,
      abilities: { peek },
    },
  },
});
