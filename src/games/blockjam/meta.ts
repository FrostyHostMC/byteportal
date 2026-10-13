import { defineMeta } from '@platform';
import cover from './cover.webp?url';

export default defineMeta({
  id: 'blockjam',
  title: 'Block Jam',
  tagline: 'Two on two, no fouls, big heads. Turbo to the rim, slam it home, catch fire.',
  accent: '#ff6b1a',
  cover,
  controls: [
    ['WASD', 'run (up and down the screen)'],
    ['Shift', 'turbo'],
    ['Space / LMB', 'shoot: let go at the top of the jump · jump to block'],
    ['Shift + Space', 'dunk, near the basket'],
    ['E / RMB', 'pass · steal'],
    ['Shift + E', 'shove'],
    ['M', 'teams · bots'],
  ],
  // Controllers: A shoots, X passes and steals, the right trigger and bumper are turbo.
  gamepad: {
    A: ['Space', 'shoot · jump'],
    RT: ['ShiftLeft', 'turbo'],
    RB: ['ShiftLeft', 'turbo'],
    X: ['KeyE', 'pass · steal'],
    LT: ['KeyE', 'pass · steal'],
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
  // Touch: the big button shoots, the one beside it is turbo, pass and steal by them.
  touch: { RT: ['Space', 'shoot'], LT: ['ShiftLeft', 'turbo'], A: null, X: ['KeyE', 'pass · steal'], Y: ['KeyM', 'teams'], RB: null, LB: null, Back: null },
  instances: true,
  achievements: {
    first_bucket: { title: 'Bucket', description: 'Score your first basket' },
    downtown: { title: 'From Downtown', description: 'Hit a three' },
    jam_session: { title: 'Jam Session', description: 'Throw down a dunk' },
    rejected: { title: 'Rejected', description: 'Block a shot or a dunk' },
    pickpocket: { title: 'Pickpocket', description: 'Steal the ball' },
    alley_oop: { title: 'Lob City', description: 'Finish an alley-oop' },
    on_fire: { title: "He's On Fire", description: 'Score three in a row and catch fire', reward: 'flame_kicks' },
    winner: { title: 'Ballgame', description: 'Win a game' },
    blowout: { title: 'Blowout', description: 'Win a game by 15 or more', hidden: true },
  },
  cosmetics: {
    flame_kicks: { name: 'Flame Kicks', slot: 'title', text: 'On Fire', how: 'Catch fire in Block Jam' },
  },
});
