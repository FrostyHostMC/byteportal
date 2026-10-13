import { readFileSync } from 'node:fs';
import { constants, deflateRawSync } from 'node:zlib';
import { GameHost } from '../../src/platform/host/game';
import { encode } from '../../src/platform/net/codec';
import { FrameWriter } from '../../src/platform/net/delta';
import type { SimFrame } from '../../src/platform/sim/sim';
import { games } from './_harness';

/**
 * What each game sends one player a second, as a server sends it (frame patches, compressed with
 * the window kept between messages), and what's biggest in it. Not a test: a probe
 * (`GAME=starfighter PLAYERS=4 node scripts/headless.mjs tests/headless/_netprobe.ts`).
 */
export default function netProbe() {
  const only = process.env.GAME;
  const players = Number(process.env.PLAYERS ?? 1);
  for (const def of games) {
    if (only && def.id !== only) continue;
    const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 7, remote: true, radius: 6, budget: Infinity, player: { id: 'p1', name: 'Player' } });
    const ids = Array.from({ length: players }, (_, i) => host.connect(`P${i}`).id);
    for (const id of ids) host.command(id, { t: 'start' });
    const writer = new FrameWriter<SimFrame>();
    let had: SimFrame | undefined;
    const parts = new Map<string, number>();
    const add = (k: string, n: number) => parts.set(k, (parts.get(k) ?? 0) + n);
    // A compressor with a kept window, the way the socket's is set up.
    const history: Buffer[] = [];
    let raw = 0;
    let wire = 0;
    let batches = 0;
    const seconds = 20;
    for (let i = 0; i < seconds * 30; i++) {
      for (const [k, id] of ids.entries()) host.command(id, { t: 'input', input: { active: true, down: i % 90 < 60 ? ['KeyW'] : ['KeyA'], pressed: [], buttons: i % 30 < 8 ? 1 : 0, clicked: 0, mouseX: k + 2, mouseY: 0, wheel: 0, yaw: i * 0.01, pitch: 0, viewSeq: -1 } });
      const out = host.step(1 / 30);
      const b = out.get(ids[0])!;
      if (b.frame) writer.next(b.frame);
      const f = b.frame ? writer.patchFor(had) : undefined;
      had = writer.current;
      const msg = encode({ events: b.events, f, time: i / 30 });
      if (i < 30 * 5) continue;
      batches++;
      raw += msg.length;
      history.push(Buffer.from(msg));
      if (f && typeof f === 'object') for (const [k, v] of Object.entries(f as object)) add(`frame.${k}`, encode(v).length);
      for (const e of b.events) add(e.t === 'call' ? `call ${e.call.target}.${e.call.method}` : `event ${e.t}`, encode(e).length);
    }
    // Compressed as a stream: each message flushed on its own, the window carried over.
    let before = 0;
    const all: Buffer[] = [];
    for (const m of history) {
      all.push(m);
      const z = deflateRawSync(Buffer.concat(all.slice(-8)), { level: 3, memLevel: 7, windowBits: 13, finishFlush: constants.Z_SYNC_FLUSH }).length;
      const zPrev = all.length > 1 ? deflateRawSync(Buffer.concat(all.slice(-8, -1)), { level: 3, memLevel: 7, windowBits: 13, finishFlush: constants.Z_SYNC_FLUSH }).length : 0;
      wire += Math.max(8, z - zPrev);
      before += m.length;
    }
    const per = (n: number) => `${(n / (batches / 30) / 1024).toFixed(1)} KB/s`;
    console.log(`\n${def.id} (${players} player${players > 1 ? 's' : ''}): ${per(raw)} patched, about ${per(wire)} compressed`);
    for (const [k, v] of [...parts].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k.padEnd(34)} ${per(v)}`);
    host.dispose();
  }
}
