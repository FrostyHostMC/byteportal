import type { GltfSpec } from '@platform';

/**
 * How the platform draws and moves the voxel fighters (`Models.gltf` options), for their
 * proportions (a big head on a lean body):
 *
 * - `heldScale` 0.68 (the platform's 0.52): guns big enough to read against the big heads, as the
 *   voxel figures this look comes from carry them; a pistol is held as one under 0.6 m as held.
 * - The rifle at the hip and aimed held further out and lower, clear of the big head.
 * - First person: the arms life size, the fists smaller (`hands`), so the hands close on the grips
 *   with forearms of a proper thickness (the figures' own fists would fill the screen). Where the
 *   guns sit is each gun's `hold.gun` (weapons.ts).
 * - The feet as far apart as the hips.
 */
export const FIGHTER_STYLE: Pick<GltfSpec, 'firstPerson' | 'poses'> = {
  firstPerson: { scale: 1.0, hands: 0.62 },
  poses: {
    heldScale: 0.68,
    pistolUnder: 0.6,
    gait: { width: 0.15 },
    rifle: { hip: [-0.13, -0.22, 0.32], ads: [-0.05, -0.12, 0.36] },
  },
};
