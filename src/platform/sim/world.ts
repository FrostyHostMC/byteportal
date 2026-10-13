import type { VoxelWorld } from '@engine/voxel_engine.js';

/**
 * Where the simulation's blocks live and how edits land: the host's own world (columns generated
 * around the players), which also tells the clients about each edit so they can mirror it.
 */
export interface WorldHost {
  readonly world: VoxelWorld;
  /** Set one block. False if its chunk isn't loaded. */
  edit(x: number, y: number, z: number, id: number): boolean;
  /** Set many (explosions) so they appear together; returns how many changed. */
  editMany(cells: [number, number, number, number][]): number;
  /** Undo every edit this session (restart): blocks put back, whole. */
  revert(): number;
  /**
   * Carve little voxels out of destructible blocks (`VoxelWorld.carve`): a channel from `o` along
   * `d`, `radius` round and `depth` long. Returns how many went, and the blocks carved to nothing
   * (air now, as edits): where, and what they were.
   */
  carve(o: [number, number, number], d: [number, number, number], radius: number, depth: number): { removed: number; emptied: [number, number, number, number][] };
  /**
   * A blast's crater (`VoxelWorld.blast`): a ragged sphere of little voxels out of the carvable
   * blocks among `cells` (x, y, z triples). Returns what `carve` returns.
   */
  blast(center: [number, number, number], radius: number, roughness: number, seed: number, cells: Int32Array): { removed: number; emptied: [number, number, number, number][] };
}

/**
 * `host`, telling `changed` about each block that changes (the `blockChange` event): each edit
 * (set, broken, placed, blown up), each block a carve or a blast's crater takes bits out of, and on `revert` each block
 * it puts back. Only while `listening()`: with nobody listening it costs nothing (so a listener
 * should start before the world changes, in `setup`).
 */
export function watchBlocks(host: WorldHost, listening: () => boolean, changed: (x: number, y: number, z: number) => void): WorldHost {
  const w = host.world;
  // Blocks changed since the world was last put back: a revert tells about each again.
  const since = new Map<string, [number, number, number]>();
  const tell = (x: number, y: number, z: number) => {
    since.set(`${x},${y},${z}`, [x, y, z]);
    changed(x, y, z);
  };
  return {
    world: w,
    edit(x, y, z, id) {
      if (!host.edit(x, y, z, id)) return false;
      if (listening()) tell(x, y, z);
      return true;
    },
    editMany(cells) {
      const n = host.editMany(cells);
      // The ones that landed (a cell whose chunk isn't loaded doesn't).
      if (n && listening()) for (const [x, y, z, id] of cells) if (w.get_block(x, y, z) === id) tell(x, y, z);
      return n;
    },
    revert() {
      const n = host.revert();
      const back = [...since.values()];
      since.clear();
      if (listening()) for (const [x, y, z] of back) changed(x, y, z);
      return n;
    },
    carve(o, d, radius, depth) {
      const len = Math.hypot(d[0], d[1], d[2]);
      if (!listening() || !(len > 1e-12) || !(radius > 0) || ![...o, ...d, radius, depth].every(Number.isFinite)) return host.carve(o, d, radius, depth);
      // The blocks it can reach, walked the way the engine walks them, and what's left of each before.
      const r = Math.min(radius, 8);
      const k = Math.max(0, Math.min(depth, 32)) / len;
      const b = [o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k];
      const lo = [0, 1, 2].map((i) => Math.floor(Math.min(o[i], b[i]) - r));
      const hi = [0, 1, 2].map((i) => Math.floor(Math.max(o[i], b[i]) + r));
      const before: number[] = [];
      for (let y = Math.max(0, lo[1]); y <= Math.min(255, hi[1]); y++)
        for (let z = lo[2]; z <= hi[2]; z++)
          for (let x = lo[0]; x <= hi[0]; x++) {
            const id = w.get_block(x, y, z);
            // Nothing to carve in air or an unloaded chunk.
            if (id !== 0 && id !== 255) before.push(x, y, z, id, w.damage_left(x, y, z));
          }
      const out = host.carve(o, d, radius, depth);
      if (out.removed)
        for (let i = 0; i < before.length; i += 5) {
          const x = before[i];
          const y = before[i + 1];
          const z = before[i + 2];
          if (w.get_block(x, y, z) !== before[i + 3] || w.damage_left(x, y, z) !== before[i + 4]) tell(x, y, z);
        }
      return out;
    },
    blast(center, radius, roughness, seed, cells) {
      if (!listening()) return host.blast(center, radius, roughness, seed, cells);
      // Only the blocks it's given can change: what's left of each before.
      const before: number[] = [];
      for (let i = 0; i + 2 < cells.length; i += 3) before.push(w.get_block(cells[i], cells[i + 1], cells[i + 2]), w.damage_left(cells[i], cells[i + 1], cells[i + 2]));
      const out = host.blast(center, radius, roughness, seed, cells);
      if (out.removed)
        for (let i = 0, j = 0; i + 2 < cells.length; i += 3, j += 2) {
          const x = cells[i];
          const y = cells[i + 1];
          const z = cells[i + 2];
          if (w.get_block(x, y, z) !== before[j] || w.damage_left(x, y, z) !== before[j + 1]) tell(x, y, z);
        }
      return out;
    },
  };
}
