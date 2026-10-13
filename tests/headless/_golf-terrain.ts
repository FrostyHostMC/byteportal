import { writeFileSync } from 'node:fs';
import { chunkFile } from '../../src/games/golf/client/terrain-mesh';
import { course } from '../../src/games/golf/course';
import { CHUNK } from '../../src/games/golf/scale';

/** Every square of the course drawn as a glTF file: how long each takes and how big; one written out (`GOLF_GLB=path`). */
export default function terrain() {
  let total = 0;
  let worst = 0;
  let bytes = 0;
  const pin = course.pin(0);
  for (const c of course.chunks) {
    const t0 = performance.now();
    const f = chunkFile(c.x0, c.z0, c.shaped);
    const ms = performance.now() - t0;
    total += ms;
    worst = Math.max(worst, ms);
    bytes += f.length;
    if (process.env.GOLF_GLB && pin.x >= c.x0 && pin.x < c.x0 + CHUNK && pin.z >= c.z0 && pin.z < c.z0 + CHUNK) writeFileSync(process.env.GOLF_GLB, f);
    // The JSON parses and the binary chunk's length adds up.
    const dv = new DataView(f.buffer, f.byteOffset);
    const jl = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(f.subarray(20, 20 + jl)));
    if (dv.getUint32(20 + jl, true) !== json.buffers[0].byteLength || dv.getUint32(8, true) !== f.length) throw new Error(`chunk ${c.id} is malformed`);
  }
  console.log(`  ${course.chunks.length} chunks (${course.chunks.filter((c) => c.shaped).length} shaped): ${(total / 1000).toFixed(1)} s in all, ${worst.toFixed(0)} ms at worst, ${(bytes / 1e6).toFixed(1)} MB`);
}
