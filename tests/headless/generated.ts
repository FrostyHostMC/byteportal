import { readFileSync } from 'node:fs';
import type { BlockRef } from '../../src/platform/api/types';
import { GeneratedWorld } from '../../src/platform/host/game';
import { worldGenConfig } from '../../src/platform/workers/config';
import { loadEngineSync } from '../../src/platform/engine/wasm';
import { loadRegistry } from '../../src/platform/world/registry';
import { check, games } from './_harness';

/**
 * A server's world keeps the columns it made: a flier crossing the same sky again and again
 * doesn't have it generated again (generating is most of what a room costs). Past the cap, the
 * farthest from everyone go, never those in reach.
 */
export default function generated() {
  loadEngineSync(readFileSync('engine/pkg/voxel_engine_bg.wasm'));
  const registry = loadRegistry();
  const resolve = (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id);
  const def = games.find((g) => g.id === 'sandbox')!;
  const w = new GeneratedWorld(1, worldGenConfig(def, resolve));
  const radius = 3;
  // Back and forth along a line 20 columns long, ten times.
  const pass = (keep: number) => {
    let made = 0;
    for (let lap = 0; lap < 10; lap++) {
      for (let i = 0; i <= 40; i++) {
        const x = (lap % 2 ? 40 - i : i) * 8;
        for (let t = 0; t < 4; t++) made += w.update([{ x, z: 0 }], radius, Infinity, keep);
      }
    }
    return made;
  };
  const line = (21 + 2 * radius) * (2 * radius + 1);
  const made = pass(4096);
  check(made === line, `kept: each column made once (${made} for a strip of ${line})`);

  // Over the cap: trimmed to it, farthest first, never what's in reach.
  const small = new GeneratedWorld(1, worldGenConfig(def, resolve));
  let n = 0;
  for (let i = 0; i <= 40; i++) for (let t = 0; t < 130; t++) n += small.update([{ x: i * 16, z: 0 }], radius, Infinity, 100);
  const loaded = (small as unknown as { loaded: Map<string, [number, number]> }).loaded;
  const has = new Set([...loaded.keys()]);
  let inReach = 0;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) if (has.has(`${40 + dx},${dz}`)) inReach++;
  const farthest = Math.min(...[...loaded.values()].map(([cx]) => cx));
  check(loaded.size <= 100 && inReach === (2 * radius + 1) ** 2, `over the cap: ${loaded.size} kept, all ${inReach} in reach among them`);
  check(farthest > 20, `the farthest went first (nearest kept column at ${farthest})`);
  w.dispose();
  small.dispose();
  console.log(`  a strip flown ten times made once (${made} columns) · over the cap, trimmed to ${loaded.size}, farthest first`);
}
