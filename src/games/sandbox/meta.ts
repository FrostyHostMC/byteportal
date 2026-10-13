import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Creative building in an endless procedural world: the platform with no rules on top. */
export default defineMeta({
  id: 'sandbox',
  title: 'Sandbox',
  tagline: 'Build anything in an endless world',
  accent: '#7fd46b',
  cover,
  controls: [
    ['Space ×2', 'fly'],
    ['LMB', 'break'],
    ['RMB', 'place'],
    ['E', 'blocks'],
    ['MMB', 'pick the block you look at'],
  ],
  // Touch: the block picker at hand.
  touch: { X: ['KeyE', 'blocks'], Up: null },
  achievements: {
    first_block: { title: 'Groundbreaker', description: 'Place your first block' },
    picker: { title: 'Fresh from the Picker', description: 'Place one of Sandbox’s own blocks: a crate, marble, a paper lantern… (E opens the picker)' },
    flight: { title: 'Take Flight', description: 'Fly 30 blocks above the ground (double-tap Space)' },
    sky_high: { title: 'Cloud Builder', description: 'Place a block high in the sky (height 200 or more)', reward: 'cloud_builder' },
    master_builder: { title: 'Master Builder', description: 'Place 1,000 blocks', reward: 'hard_hat' },
    wanderer: { title: 'Far and Away', description: 'Travel 1,000 blocks from the spawn', hidden: true },
  },
  cosmetics: {
    hard_hat: {
      name: 'Hard Hat',
      slot: 'hat',
      how: 'Place 1,000 blocks',
      model: {
        boxes: [
          { from: [-4.6, -1.5, -4.6], to: [4.6, 2.2, 4.6], color: '#f2c230' },
          { from: [-5.4, -1.8, -5.4], to: [5.4, -1.2, 5.8], color: '#f2c230' },
          { from: [-0.7, 2.2, -4.6], to: [0.7, 2.8, 4.6], color: '#d9a91d' },
        ],
      },
    },
    cloud_builder: { name: 'Cloud Builder', slot: 'title', text: 'Cloud Builder', how: 'Place a block high in the sky' },
  },
});
