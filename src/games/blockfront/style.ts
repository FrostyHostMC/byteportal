import type { GltfSpec } from '@platform';

/**
 * How the platform draws and moves the voxel troopers and heroes (`Models.gltf` options): their
 * chunky proportions (a big head, big fists) as Call of Blocky's fighters have them. Blasters held
 * big enough in those fists to read; first-person arms life size with smaller fists.
 */
export const STYLE: Pick<GltfSpec, 'firstPerson' | 'poses'> = {
  firstPerson: { scale: 1.0, hands: 0.62 },
  poses: {
    heldScale: 0.68,
    pistolUnder: 0.6,
    gait: { width: 0.15 },
    rifle: { hip: [-0.13, -0.22, 0.32], ads: [-0.05, -0.12, 0.36] },
  },
};
