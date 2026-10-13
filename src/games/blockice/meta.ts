import { defineMeta } from '@platform';
import cover from './cover.webp?url';

export default defineMeta({
  id: 'blockice',
  title: 'Block Ice',
  tagline: 'Two on two on ice, big heads, bigger hits. Turbo up the wing, rattle the glass, light the lamp.',
  accent: '#3fa9f5',
  cover,
  controls: [
    ['WASD', 'skate (up and down the screen)'],
    ['Shift', 'turbo'],
    ['Space / LMB', 'shoot: tap for a wrister, hold for a slapper · hold as a pass comes for a one-timer'],
    ['E / RMB', 'pass · poke check'],
    ['Shift + E', 'body check'],
    ['M', 'teams · bots'],
  ],
  // Controllers: A shoots, X passes and pokes, the right trigger and bumper are turbo.
  gamepad: {
    A: ['Space', 'shoot'],
    RT: ['ShiftLeft', 'turbo'],
    RB: ['ShiftLeft', 'turbo'],
    X: ['KeyE', 'pass · poke'],
    LT: ['KeyE', 'pass · poke'],
    B: null,
    Y: ['KeyM', 'teams'],
    LB: null,
    L3: null,
    R3: null,
    Up: null,
    Down: null,
    Left: null,
    Right: null,
    Back: ['Tab', 'box score'],
  },
  // Touch: the big button shoots, the one beside it is turbo, pass and poke by them.
  touch: { RT: ['Space', 'shoot'], LT: ['ShiftLeft', 'turbo'], A: null, X: ['KeyE', 'pass · poke'], Y: ['KeyM', 'teams'], RB: null, LB: null, Back: null },
  instances: true,
  achievements: {
    first_goal: { title: 'Lamp Lighter', description: 'Score your first goal' },
    clapper: { title: 'Clapper', description: 'Score with a full slap shot' },
    one_timer: { title: 'One-Timer', description: 'Score on a one-timer' },
    hat_trick: { title: 'Hat Trick', description: 'Score three goals in one game', reward: 'bucket' },
    lights_out: { title: 'Lights Out', description: 'Check someone into the boards' },
    poke_check: { title: 'Poke Check', description: 'Strip someone of the puck' },
    on_fire: { title: "He's On Fire", description: 'Score three in a row and catch fire' },
    final_horn: { title: 'Final Horn', description: 'Win a game' },
    shutout: { title: 'Shutout', description: 'Win without letting one in', hidden: true },
  },
  cosmetics: {
    bucket: {
      name: 'Hockey Bucket',
      slot: 'hat',
      how: 'Score a hat trick in Block Ice',
      model: {
        boxes: [
          { from: [-4.7, -1.2, -4.9], to: [4.7, 2.6, 4.7], color: '#1d3f73' },
          { from: [-4.9, -3.4, -4.9], to: [-4.1, -1.2, 1.6], color: '#1d3f73' },
          { from: [4.1, -3.4, -4.9], to: [4.9, -1.2, 1.6], color: '#1d3f73' },
          { from: [-4.8, -0.2, 4.6], to: [4.8, 0.6, 5.6], color: '#d9dde4' },
          { from: [-0.5, 2.5, -4.6], to: [0.5, 2.9, 4.4], color: '#3fa9f5' },
        ],
      },
    },
  },
});
