import { defineMeta } from '@platform';

/** High Noon: last gunslinger standing in Dry Gulch. First to three rounds takes the town. */
export default defineMeta({
  id: 'highnoon',
  title: 'High Noon',
  tagline: 'Last gunslinger standing in Dry Gulch. First to three rounds takes the town.',
  accent: '#d9a441',
  controls: [
    ['LMB', 'fire'],
    ['RMB', 'aim'],
    ['R', 'load a round'],
    ['Q', 'dodge roll'],
    ['1 2', 'Peacemaker · Yellowboy'],
    ['Shift', 'run'],
    ['C', 'crouch'],
    ['O', 'your look'],
    ['Tab', 'scores'],
  ],
  gamepad: { LB: ['KeyQ', 'dodge roll'], Up: ['KeyO', 'your look'], Down: null },
  instances: true,
});
