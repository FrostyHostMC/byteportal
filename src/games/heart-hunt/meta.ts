import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Tutorial game from docs/PLATFORM.md: find ten glowing hearts scattered around a pedestal. */
export default defineMeta({
  id: 'heart-hunt',
  title: 'Heart Hunt',
  tagline: 'A gentle hunt for ten hidden hearts',
  accent: '#ff5a7a',
  cover,
  controls: [['Walk', 'into hearts to collect']],
  achievements: {
    first_heart: { title: 'Sweetheart', description: 'Find your first heart' },
    all_hearts: { title: 'Heart of Gold', description: 'Find all ten hearts', reward: 'heart_boppers' },
    speedy: { title: 'Cupid', description: 'Find all ten in under two minutes', hidden: true, reward: 'cupid' },
  },
  cosmetics: {
    heart_boppers: {
      name: 'Heart Boppers',
      slot: 'hat',
      how: 'Find all ten hearts',
      model: {
        boxes: [
          { from: [-4.4, 0, -1], to: [4.4, 0.6, 1], color: '#e05a8a' },
          { from: [-4.7, -3, -1], to: [-4.3, 0.6, 1], color: '#e05a8a' },
          { from: [4.3, -3, -1], to: [4.7, 0.6, 1], color: '#e05a8a' },
          { from: [-2.4, 0.6, -0.3], to: [-1.8, 4, 0.3], color: '#b9bec6' },
          { from: [1.8, 0.6, -0.3], to: [2.4, 4, 0.3], color: '#b9bec6' },
          { from: [-3.6, 4, -0.6], to: [-0.6, 6.4, 0.6], color: '#ff4f7b', glow: true },
          { from: [0.6, 4, -0.6], to: [3.6, 6.4, 0.6], color: '#ff4f7b', glow: true },
        ],
      },
    },
    cupid: { name: 'Cupid', slot: 'title', text: 'Cupid', how: 'Find all ten in under two minutes' },
  },
});
