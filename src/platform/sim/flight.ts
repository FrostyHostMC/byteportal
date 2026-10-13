import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { FlightWorld } from '../items/throwable';
import type { Registry } from '../world/registry';

/**
 * Solid blocks, as a flight meets them: through plants, torches and anything else bodies walk
 * through, stopping where a damaged block (or a slab) really is.
 */
export function flightWorld(world: VoxelWorld, registry: Registry): FlightWorld {
  return {
    hit(ox, oy, oz, dx, dy, dz, max) {
      let from = 0;
      for (let i = 0; i < 8; i++) {
        const r = world.raycast(ox + dx * from, oy + dy * from, oz + dz * from, dx, dy, dz, max - from);
        if (!r[0]) return null;
        const t = from + r[8];
        if (registry.blocks[r[7]]?.solid) return { t, nx: r[4], ny: r[5], nz: r[6] };
        from = t + 0.02;
        if (from >= max) return null;
      }
      return null;
    },
  };
}
