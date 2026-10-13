import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Bed Wars: four teams on sky islands, each guarding its bed. Bridge out, break theirs; last team standing wins. */
export default defineMeta({
  id: 'bedwars',
  title: 'Bed Wars',
  tagline: 'Guard your bed, bridge out, break theirs. Last team standing wins.',
  accent: '#ff5b5b',
  cover,
  instances: true,
  controls: [
    ['LMB', 'attack · hold to mine'],
    ['RMB', 'place block · use item'],
    ['RMB', 'talk to the shopkeeper'],
    ['M', 'lobby menu: team, map, ready'],
  ],
  // Controllers: the platform's layout, with the lobby's menu on X (nothing reloads here).
  gamepad: { X: ['KeyM', 'lobby menu'] },
  achievements: {
    first_blood: { title: 'First Blood', description: 'Take down an enemy' },
    retail_therapy: { title: 'Retail Therapy', description: 'Buy something from the Item Shop' },
    rude_awakening: { title: 'Rude Awakening', description: "Break an enemy team's bed", reward: 'bed_breaker' },
    final_kill: { title: 'Lights Out', description: 'Get a final kill: take down an enemy whose bed is gone' },
    into_the_void: { title: 'Into the Void', description: 'Knock an enemy off the islands into the void' },
    first_win: { title: 'Last Team Standing', description: 'Win a match' },
    sweet_dreams: { title: 'Sweet Dreams', description: 'Win a match with your own bed still standing', reward: 'nightcap' },
    veteran: { title: 'Bed Wars Veteran', description: 'Win 10 matches, all time', reward: 'team_red' },
    early_riser: { title: 'Early Riser', description: 'Break a bed in the first two minutes of a match', hidden: true },
  },
  cosmetics: {
    nightcap: {
      name: 'Nightcap',
      slot: 'hat',
      how: 'Win with your bed still standing',
      model: {
        boxes: [
          { from: [-4.4, -2, -4.4], to: [4.4, 1, 4.4], color: '#c83a3a' },
          { from: [-4.6, -2.2, -4.6], to: [4.6, -1.2, 4.6], color: '#f2f2ee' },
          { from: [-3.2, 1, -3.6], to: [3.2, 3, 2.4], color: '#c83a3a' },
          { from: [-2, 2.6, -5], to: [2, 4.4, -0.8], color: '#c83a3a' },
          { from: [-1.3, 2.8, -7], to: [1.3, 5, -4.6], color: '#f2f2ee' },
        ],
      },
    },
    bed_breaker: { name: 'Bed Breaker', slot: 'title', text: 'Bed Breaker', how: 'Break an enemy bed' },
    team_red: { name: 'Bed Wars Red', slot: 'tag', color: '#ff6b6b', how: 'Win 10 matches' },
  },
});
