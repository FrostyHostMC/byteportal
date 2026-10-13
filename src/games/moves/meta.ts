import { defineMeta } from '@platform';

/** Movement lab (a development preview, `?game=moves`): a dash, a double jump and a wall-run, on a short course. */
export default defineMeta({
  id: 'moves',
  title: 'Movement lab',
  tagline: 'Dash, double jump, wall-run: moves of a game’s own',
  accent: '#8fd0ff',
  controls: [
    ['Q', 'dash'],
    ['Space in the air', 'double jump'],
    ['W along a wall', 'wall-run'],
    ['Space on a wall', 'wall-jump'],
    ['Shift', 'sprint'],
    ['Wheel', 'watch yourself (third person)'],
  ],
  gamepad: { X: ['KeyQ', 'dash'] },
});
