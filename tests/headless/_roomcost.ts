import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { RoomCore } from '../../src/platform/host/room';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { games } from './_harness';

/**
 * Probe: what a room costs a step, part by part, as a server runs it (sim step, frames and
 * patches, encoding, compression), with PLAYERS pilots flying and shooting.
 * `GAME=starfighter PLAYERS=4 node scripts/headless.mjs tests/headless/_roomcost.ts`
 */
export default function roomCost() {
  const def = games.find((g) => g.id === (process.env.GAME ?? 'starfighter'))!;
  const players = Number(process.env.PLAYERS ?? 2);
  const seconds = Number(process.env.SECONDS ?? 60);
  let bytes = 0;
  let deflateMs = 0;
  let sends = 0;
  const core = new RoomCore(def, { game: def.id, instance: 'public', tickRate: 30, cheats: true, dev: false, saveEvery: 1e9 }, readFileSync('engine/pkg/voxel_engine_bg.wasm'), undefined, {
    send: (_c, text) => {
      bytes += text.length;
      sends++;
      const t0 = performance.now();
      deflateRawSync(text, { level: 3, memLevel: 7, windowBits: 13 });
      deflateMs += performance.now() - t0;
    },
    counts: () => {},
    log: () => {},
  });
  const c = core as unknown as { timer: ReturnType<typeof setInterval>; step(dt: number): void };
  clearInterval(c.timer);
  const ids = Array.from({ length: players }, (_, i) => `s${i}`);
  for (const id of ids) {
    core.connect(id);
    core.command(id, { t: 'start', name: id });
  }
  // A command once they've joined (Call of Blocky's mode and map: COMMAND='mode tdm kahuna').
  if (process.env.COMMAND) core.host.sim.ctx.commands.run(process.env.COMMAND);
  const idle = (o: Partial<PlayerInput> = {}): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1, ...o });
  const seq = new Map<string, number>();
  const host = core.host;
  // Time the host's step alone by wrapping it.
  let hostMs = 0;
  const step = host.step.bind(host);
  host.step = (dt: number, running?: boolean) => {
    const t0 = performance.now();
    const r = step(dt, running);
    hostMs += performance.now() - t0;
    return r;
  };
  let totalMs = 0;
  let worst = 0;
  const warm = Number(process.env.WARM ?? 0) * 30;
  const steps = seconds * 30;
  for (let i = -warm; i < steps; i++) {
    if (i === 0) { hostMs = 0; deflateMs = 0; bytes = 0; }
    const t = i / 30;
    ids.forEach((id, k) => {
      for (let j = 0; j < 2; j++) {
        const n = (seq.get(id) ?? 0) + 1;
        seq.set(id, n);
        core.command(id, { t: 'input', input: idle({ mouseX: Math.sin(t + k) * 5, mouseY: Math.cos(t * 0.7 + k) * 2, buttons: i % 40 < 25 ? 1 : 0, down: i % 150 < 40 ? ['KeyW'] : [] }), seq: n, dt: 1 / 60 });
      }
    });
    const d0 = deflateMs;
    const t0 = performance.now();
    c.step(1 / 30);
    const ms = performance.now() - t0 - (deflateMs - d0);
    if (i >= 0) totalMs += ms;
    if (i > 60) worst = Math.max(worst, ms);
  }
  const per = (x: number) => (x / steps).toFixed(2);
  console.log(`${def.id}, ${players} players: step ${per(totalMs)} ms (host ${per(hostMs)}, send/patch/encode ${per(totalMs - hostMs)}), + deflate ${per(deflateMs)} ms; worst ${worst.toFixed(1)} ms; ${((bytes / seconds) / 1024).toFixed(0)} KB/s raw; CPU at 30 Hz ≈ ${(((totalMs + deflateMs) / seconds / 1000) * 100).toFixed(1)}% of a core`);
  core.stop();
}
