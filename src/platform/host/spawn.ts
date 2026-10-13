import { TerrainGen, type VoxelWorld } from '@engine/voxel_engine.js';
import type { GameDefinition, Vec3 } from '../api/types';
import { applyWorldConfig } from '../workers/config';
import type { WorldGenConfig } from '../workers/protocol';
import type { Registry } from '../world/registry';

/**
 * Where a new world starts: the game's own spawn (`fixed`), or the generator's pick near the
 * origin, which `groundSpawn` settles onto open ground once its column is loaded.
 */
export function startSpawn(def: GameDefinition, seed: number, cfg: WorldGenConfig): { x: number; y: number; z: number; yaw: number; fixed: boolean } {
  const opts = def.world ?? {};
  if (opts.spawn && opts.spawn !== 'auto') return { ...opts.spawn, yaw: opts.spawnYaw ?? 0, fixed: true };
  const gen = new TerrainGen(seed);
  applyWorldConfig(gen, cfg);
  const s = gen.find_spawn();
  gen.free();
  return { x: s[0] + 0.5, y: s[1] + 2, z: s[2] + 0.5, yaw: Math.PI * 0.25, fixed: false };
}

const GROUND = new Set(['grass_block', 'dirt', 'sand', 'snowy_grass', 'podzol', 'stone', 'gravel']);

/** The nearest natural ground with room to stand, spiralling out from (x, z); null if none within 12. */
export function groundSpawn(world: VoxelWorld, registry: Registry, surfaceY: (x: number, z: number) => number, x0: number, z0: number): Vec3 | null {
  const sx = Math.floor(x0);
  const sz = Math.floor(z0);
  for (let r = 0; r <= 12; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = sx + dx;
        const z = sz + dz;
        const y = surfaceY(x, z);
        const top = registry.blocks[world.get_block(x, y, z)];
        if (y > 0 && top && GROUND.has(top.name) && world.get_block(x, y + 1, z) !== 255) return { x: x + 0.5, y: y + 1.02, z: z + 0.5 };
      }
    }
  }
  return null;
}
