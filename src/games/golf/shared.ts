import { defineShared } from '@platform';
import { BLOCKS } from './blocks';
import { cartVehicle } from './cart';
import { course } from './course';
import { buildCourse } from './course/build';
import meta from './meta';
import { BASE, GROUND_DEPTH } from './scale';

const first = course.holes[0];

/**
 * The course's footing, built the first time a world needs it (a golf room, a screen playing
 * golf), not whenever a server lists the game: it's half a second's work and 4,000 tiles.
 */
let footing: ReturnType<typeof buildCourse> | undefined;

/**
 * The course (every screen builds its blocks, and the ball and the cart run on its ground), the
 * blocks it's made of, the golfer, and the cart they drive.
 */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    ground: { y: BASE - 1, top: 'rough', fill: 'dirt', depth: GROUND_DEPTH },
    get structures() {
      return (footing ??= buildCourse(course));
    },
    spawn: { x: first.cartTee.x, y: first.tee.y + 1, z: first.cartTee.z + 2 },
    spawnYaw: first.tee.yaw,
    time: 0.36,
    freezeTime: true,
    viewDistance: 12,
  },
  blocks: BLOCKS,
  player: {
    health: false,
    fallDamage: false,
    hotbar: 'items',
    movement: { walk: 4.6, sprint: 7.2, jump: 1.25 },
  },
  vehicles: { cart: cartVehicle },
  hud: {
    health: 'none',
    nameTags: 'always',
    theme: {
      display: "'Barlow Condensed', 'Arial Narrow', sans-serif",
      text: "'Barlow', system-ui, sans-serif",
      fonts: ['Barlow Condensed:500;600;700', 'Barlow:400;600'],
      colors: { accent: '#9be26b', ink: '#0d1a10', paper: '#10231599', text: '#f3f7ef', danger: '#ff6b5a', good: '#9be26b' },
    },
  },
});
