import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Skyship: crew an airship across the sky islands and light the five beacons. */
export default defineMeta({
  id: 'skyship',
  title: 'Skyship',
  tagline: 'Crew an airship across the sky islands and light the five beacons.',
  accent: '#e0663a',
  cover,
  instances: true,
  controls: [
    ['E', 'take or leave the helm'],
    ['W / S', 'ahead / astern'],
    ['A / D', 'turn'],
    ['Space / Shift', 'climb / sink'],
    ['Wheel', 'zoom out from the helm'],
  ],
  // Touch: the helm at hand (a button, not in the drawer).
  touch: { X: ['KeyE', 'helm'], Up: null },
  achievements: {
    helmsman: { title: 'Captain', description: 'Take the helm of the airship', reward: 'captain' },
    first_beacon: { title: 'Firelighter', description: 'Light a beacon' },
    crew: { title: 'All Hands on Deck', description: 'Light a beacon while a crewmate steers (or steer while they light it)' },
    all_beacons: { title: 'Voyage Complete', description: 'Finish a voyage: all five beacons lit', reward: 'captain_hat' },
    swift_voyage: { title: 'Fair Winds', description: 'Finish a voyage in under six minutes' },
    cloud_nine: { title: 'Cloud Nine', description: 'Take the airship as high as she goes' },
    overboard: { title: 'Man Overboard', description: 'Fall off into the sky' },
    aground: { title: 'Mind the Rocks', description: 'Run the airship into an island', hidden: true },
  },
  cosmetics: {
    captain_hat: {
      name: 'Captain’s Hat',
      slot: 'hat',
      how: 'Light all five beacons',
      model: {
        boxes: [
          { from: [-4.8, -1.5, -4.8], to: [4.8, 2.5, 4.8], color: '#1d2b4f' },
          { from: [-4.8, 2.5, -4.8], to: [4.8, 3, 4.8], color: '#f2f2f2' },
          { from: [-4.9, -1.5, -4.9], to: [4.9, -0.3, 4.9], color: '#101626' },
          { from: [-4.3, -1.9, 4.4], to: [4.3, -1.3, 7.4], color: '#101626' },
          { from: [-1, -0.2, 4.8], to: [1, 1.4, 5], color: '#e8b923', glow: true },
        ],
      },
    },
    captain: { name: 'Captain', slot: 'title', text: 'Captain', how: 'Take the helm' },
  },
});
