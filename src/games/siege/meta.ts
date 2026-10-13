import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/**
 * Siege Night: a team of operators keeps a VIP alive in a military base through five nights until extraction.
 * Up to eight people; bots fill the empty seats of a six-person team.
 */
export default defineMeta({
  id: 'siege-night',
  title: 'Siege Night',
  tagline: 'Keep the VIP alive until extraction',
  accent: '#d9a441',
  cover,
  instances: true,
  controls: [
    ['LMB / RMB', 'fire / aim · hold LMB at your own wall to take it down'],
    ['R', 'reload'],
    ['Shift', 'sprint · then C to slide into cover'],
    ['Space', 'jump · jump at a ledge to vault it'],
    ['Q / E', 'lean out left / right round a corner'],
    ['1-9', 'weapons and building materials (RMB places a block)'],
    ['F', 'hold over a downed teammate to revive them'],
    ['Right-click the quartermaster, or /shop', 'weapons, ammo, materials, turrets'],
  ],
  // Touch: revive at hand; leaning in the drawer.
  touch: { RB: ['KeyF', 'revive'], Up: ['KeyQ', 'lean left'], Right: ['KeyE', 'lean right'], Down: null },
  achievements: {
    first_night: { title: 'First Light', description: 'Keep the VIP alive through your first night' },
    all_nights: { title: 'Extraction', description: 'Keep the VIP alive through all five nights' },
    medic: { title: 'Combat Medic', description: 'Revive three teammates in one operation' },
  },
});
