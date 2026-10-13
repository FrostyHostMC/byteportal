import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/**
 * Blockfront II: the Rebels against the Empire, troopers and heroes, fighting over the command
 * posts of a desert spaceport. Blasters that overheat, sabers that deflect them, and the Force.
 */
export default defineMeta({
  id: 'blockfront',
  title: 'Blockfront II',
  tagline: 'Rebels against the Empire: blasters, sabers and the Force, for the command posts of a desert spaceport.',
  accent: '#ffe81f',
  cover,
  controls: [
    ['LMB', 'fire · saber'],
    ['RMB', 'aim · block'],
    ['R', 'vent the heat'],
    ['Shift', 'sprint'],
    ['C', 'crouch · slide'],
    ['1 2', 'weapons'],
    ['G', 'thermal detonator'],
    ['Q E F', 'hero powers'],
    ['H', 'class · hero · where to spawn'],
    ['V', 'first person · third'],
    ['N', 'vote to skip this mode and map'],
    ['Tab', 'scores'],
  ],
  // Controllers: the platform's shooter layout (RT fire, LT aim, X vent, B crouch, L3 sprint), the
  // detonator on RB, the heroes' powers on the D-pad, the spawn menu on its down, and Y votes to
  // skip (LB alone switches weapons).
  gamepad: {
    RB: ['KeyG', 'detonator'],
    Left: ['KeyQ', 'power 1'],
    Up: ['KeyE', 'power 2'],
    Right: ['KeyF', 'power 3'],
    Down: ['KeyH', 'spawn menu'],
    Y: ['KeyN', 'vote to skip'],
  },
  // Touch: the first hero power at hand (the others in the drawer).
  touch: { LB: ['KeyQ', 'power 1'], Left: null },
  // Awarded by the server (`player.achieve`, server.ts).
  achievements: {
    dont_get_cocky: { title: "Don't Get Cocky", description: 'Get your first kill' },
    reporting_for_duty: { title: 'Reporting for Duty', description: 'Play a match through to the end' },
    medal_ceremony: { title: 'Medal Ceremony', description: 'Win a match with your side', reward: 'trooper_helmet' },
    high_ground: { title: 'The High Ground', description: 'Capture a command post in Conquest' },
    chosen_one: { title: 'Chosen One', description: 'Spend your battle points on a hero and take the field as one', reward: 'chosen_one' },
    giant_killer: { title: 'Giant Killer', description: 'As a trooper, take down an enemy hero' },
    elegant_weapon: { title: 'An Elegant Weapon', description: 'Cut someone down with a saber', reward: 'saber_hilt' },
    use_the_force: { title: 'Use the Force', description: 'Take someone down with a Force power' },
    galactic_veteran: { title: 'Galactic Veteran', description: 'Take down 100 fighters, over all your matches' },
    return_to_sender: { title: 'Return to Sender', description: 'Take someone down with their own bolt, turned back by your saber', hidden: true },
  },
  instances: true,
  cosmetics: {
    trooper_helmet: {
      name: 'Trooper Helmet',
      slot: 'hat',
      how: 'Win a match with your side',
      model: {
        boxes: [
          { from: [-4.6, -5, -4.6], to: [4.6, 0.8, 4.6], color: '#eceff2' },
          { from: [-3.8, -4.4, 4.5], to: [3.8, -2.8, 4.9], color: '#16181c' },
          { from: [-1, -7, 3.8], to: [1, -5, 4.8], color: '#c9ced4' },
          { from: [-4.7, -3, -1], to: [-4.4, -1, 1], color: '#16181c' },
          { from: [4.4, -3, -1], to: [4.7, -1, 1], color: '#16181c' },
        ],
      },
    },
    saber_hilt: {
      name: 'Saber Hilt',
      slot: 'back',
      how: 'Cut someone down with a saber',
      model: {
        boxes: [
          { from: [-0.6, -7, 0], to: [0.6, 0, 1.2], color: '#9aa0a8' },
          { from: [-0.7, -5, -0.1], to: [0.7, -4, 1.3], color: '#26282d' },
          { from: [-0.7, -3, -0.1], to: [0.7, -2, 1.3], color: '#26282d' },
          { from: [-0.8, 0, -0.1], to: [0.8, 1.2, 1.3], color: '#3a3d44' },
          { from: [-0.4, 1.2, 0.2], to: [0.4, 1.6, 1], color: '#7fd0ff', glow: true },
        ],
      },
    },
    chosen_one: { name: 'Chosen One', slot: 'title', text: 'Chosen One', how: 'Take the field as a hero' },
  },
});
