import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Starfighter: dogfight Bowtie squadrons in a Vox-wing, then knock out a Star Demolisher's shields and its bridge. */
export default defineMeta({
  id: 'starfighter',
  title: 'Starfighter',
  tagline: 'Dogfight Bowties and take down a Star Demolisher',
  accent: '#ff5a4a',
  cover,
  instances: true,
  controls: [
    ['Mouse', 'steer'],
    ['LMB', 'lasers'],
    ['RMB', 'torpedo'],
    ['W / S', 'boost / brake'],
    ['Q / E', 'barrel roll'],
    ['A / D', 'bank'],
  ],
  // Touch: barrel rolls at hand; nothing to switch.
  touch: { X: ['KeyQ', 'roll left'], RB: ['KeyE', 'roll right'], LB: null, Y: null, Left: null, Right: null },
  achievements: {
    first_kill: { title: 'Scratch One', description: 'Shoot down a Bowtie' },
    barrel_roll: { title: 'Do a Barrel Roll!', description: 'Deflect an enemy laser with a barrel roll (Q or E)' },
    stay_on_target: { title: 'Stay on Target', description: 'Shoot down a Bowtie with a proton torpedo' },
    shields_down: { title: 'Shields Down', description: "Destroy one of the Star Demolisher's shield generators" },
    great_shot: { title: 'Great Shot, Kid', description: 'Win the battle: bring down the Star Demolisher', reward: 'pilot_helmet' },
    not_a_scratch: { title: 'Not a Scratch', description: 'Win the battle from the first wave without being shot down' },
    rogue_leader: { title: 'Rogue Leader', description: 'Shoot down 100 Bowties, all time', reward: 'rogue_leader' },
    ramming_speed: { title: 'Ramming Speed', description: 'Finish off a Bowtie by ramming it', hidden: true },
    return_to_sender: { title: 'Return to Sender', description: 'Destroy an enemy with its own laser, turned back by a barrel roll', hidden: true },
  },
  cosmetics: {
    pilot_helmet: {
      name: 'Pilot’s Helmet',
      slot: 'hat',
      how: 'Win the battle',
      model: {
        boxes: [
          { from: [-4.6, 0, -4.6], to: [4.6, 1, 4.6], color: '#e56a2c' },
          { from: [-4.8, -6, -4.6], to: [-4.2, 1, 4.6], color: '#e56a2c' },
          { from: [4.2, -6, -4.6], to: [4.8, 1, 4.6], color: '#e56a2c' },
          { from: [-4.6, -7, -4.8], to: [4.6, 1, -4.2], color: '#e56a2c' },
          { from: [-0.6, 0, -4.8], to: [0.6, 1.2, 4.8], color: '#f0f0f0' },
          { from: [-3.6, -1.4, 4.3], to: [3.6, 0, 4.9], color: '#2a2d33' },
          { from: [-4.9, -4, -0.8], to: [-4.7, -2.4, 0.8], color: '#f0f0f0' },
          { from: [4.7, -4, -0.8], to: [4.9, -2.4, 0.8], color: '#f0f0f0' },
        ],
      },
    },
    rogue_leader: { name: 'Rogue Leader', slot: 'title', text: 'Rogue Leader', how: 'Shoot down 100 Bowties' },
  },
});
