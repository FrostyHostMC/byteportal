import * as engine from '@engine/voxel_engine.js';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { RayHit, Vec3, VehicleWorld } from '../api/types';
import type { Registry } from '../world/registry';

/** Highest block in a column that isn't air or something small (a plant, a torch); -1 if it isn't loaded. */
export function surfaceY(world: VoxelWorld, registry: Registry, x: number, z: number): number {
  for (let y = 255; y > 0; y--) {
    const id = world.get_block(x, y, z);
    if (id === 255) return -1;
    const d = registry.blocks[id];
    if (d && d.shape !== 'air' && !d.small) return y;
  }
  return 0;
}

/** The first block a ray meets (a torch, a slab, a bed only where it really is). */
export function rayHit(world: VoxelWorld, o: Vec3, d: Vec3, max: number): RayHit | null {
  const r = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
  if (!r[0]) return null;
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const t = r[8] / len;
  return { x: r[1], y: r[2], z: r[3], normal: { x: r[4], y: r[5], z: r[6] }, block: r[7], point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } };
}

/**
 * Read-only questions about a world: the host's, or a client's copy of it. A vehicle's `step`
 * asks the same questions on both, so a pilot's screen predicts what the host will do.
 */
export function worldQuery(world: VoxelWorld, registry: Registry): VehicleWorld {
  return {
    getBlock: (x, y, z) => {
      const id = world.get_block(Math.floor(x), Math.floor(y), Math.floor(z));
      return id === 255 ? -1 : id;
    },
    blockName: (id) => registry.blocks[id]?.name ?? 'unknown',
    raycast: (o, d, max) => rayHit(world, o, d, max),
    lineOfSight: (a, b) => world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
    surfaceY: (x, z) => surfaceY(world, registry, Math.floor(x), Math.floor(z)),
    seaLevel: engine.sea_level(),
  };
}
