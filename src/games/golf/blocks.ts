import type { BlockDefinition, BlockTexture } from '@platform';
import { LAYERS } from './scale';

/**
 * The course's own blocks. The course is drawn as smooth turf (`client/terrain.ts`); under it,
 * what feet stand on is `turf`, a solid block nobody sees, topped with a thinner one (an eighth,
 * a quarter… of a block) so the footing follows the drawn ground to within a sixteenth. Beyond
 * the course, the plain is `rough`, grass coloured to match the course's.
 */

/** Nothing to see: every pixel clear. */
const CLEAR: BlockTexture = { paint: () => null };

const layer = (n: number): BlockDefinition => ({
  label: `Turf (${n}/${LAYERS})`,
  texture: CLEAR,
  transparency: 'cutout',
  boxes: [[0, 0, 0, 16, (16 / LAYERS) * n, 16]],
  breakable: false,
  picker: false,
});

export const BLOCKS: Record<string, BlockDefinition> = {
  rough: {
    label: 'Rough',
    texture: { top: { color: ['#4a8631', '#4e8b34', '#47802f'], noise: 0.12, scale: 3 }, bottom: 'dirt', side: { color: '#437c2d', noise: 0.18 } },
  },
  turf: { label: 'Turf', texture: CLEAR, transparency: 'cutout', breakable: false, picker: false },
  ...Object.fromEntries(Array.from({ length: LAYERS - 1 }, (_, i) => [`turf_${i + 1}`, layer(i + 1)])),
};
