import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/**
 * Sky Obby: a parkour course of ten stages floating in the sky, from stepping stones to lava,
 * crumbling sand, launch pads, blinking platforms, a spiral tower and a cannon-swept walkway.
 */
export default defineMeta({
  id: 'obby',
  title: 'Sky Obby',
  tagline: 'Ten stages of parkour in the sky. Race the clock, or your friends.',
  accent: '#ffd36b',
  cover,
  controls: [
    ['Ctrl', 'sprint'],
    ['Shift', 'sneak: don’t fall off edges'],
    ['R', 'back to your checkpoint'],
  ],
  achievements: {
    lava_lake: { title: 'Lava Walker', description: 'Get across the lava lake (stage 4)' },
    crumble: { title: 'Light on Your Feet', description: 'Get across the crumbling sand (stage 5)' },
    blink: { title: 'Blink and Miss It', description: 'Get across the blinking platforms (stage 7)' },
    spiral: { title: 'Top of the Tower', description: 'Climb the spiral tower (stage 8)' },
    crossfire: { title: 'Under Fire', description: 'Get past the cannons (stage 9)' },
    finish: { title: 'Head in the Clouds', description: 'Finish the course', reward: 'propeller_cap' },
    speedrun: { title: 'Speedrunner', description: 'Finish the course in under two minutes', reward: 'speedrunner' },
    flawless: { title: 'Sure-Footed', description: 'Finish the course without a single fall' },
    hot_feet: { title: 'Hot Feet', description: 'Step in the lava', hidden: true },
  },
  cosmetics: {
    propeller_cap: {
      name: 'Propeller Cap',
      slot: 'hat',
      how: 'Finish the course',
      model: {
        boxes: [
          { from: [-4.4, -2, 0], to: [0, 1, 4.4], color: '#e84a4a' },
          { from: [0, -2, 0], to: [4.4, 1, 4.4], color: '#f2c230' },
          { from: [-4.4, -2, -4.4], to: [0, 1, 0], color: '#3f7fe0' },
          { from: [0, -2, -4.4], to: [4.4, 1, 0], color: '#4caf50' },
          { from: [-4.4, -2, 4.4], to: [4.4, -1.4, 7], color: '#e84a4a' },
          { from: [-0.4, 1, -0.4], to: [0.4, 3, 0.4], color: '#9aa0a8' },
          { from: [-5, 3, -0.6], to: [5, 3.5, 0.6], color: '#f2c230' },
        ],
      },
    },
    speedrunner: { name: 'Speedrunner', slot: 'title', text: 'Speedrunner', how: 'Finish in under two minutes' },
  },
});
