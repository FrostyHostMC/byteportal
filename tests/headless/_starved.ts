import { readFileSync } from 'node:fs';
import { RoomCore } from '../../src/platform/host/room';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { games } from './_harness';

/** Probe: a room on a starved machine (the event loop blocked most of the time). Does it keep time? */
export default async function starved() {
  const def = games.find((g) => g.id === 'starfighter')!;
  const core = new RoomCore(def, { game: def.id, instance: 'public', tickRate: 30, cheats: true, dev: false, saveEvery: 1e9 }, readFileSync('engine/pkg/voxel_engine_bg.wasm'), undefined, { send: () => {}, counts: () => {}, log: () => {} });
  core.connect('a');
  core.command('a', { t: 'start', name: 'Ann' });
  const idle: PlayerInput = { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 };
  let seq = 0;
  let lastInput = performance.now();
  // The pilot's screen: an input for every 60th of a second of wall time (sent in whatever bursts the loop allows).
  const inputs = setInterval(() => {
    const now = performance.now();
    while (now - lastInput >= 1000 / 60) {
      lastInput += 1000 / 60;
      core.command('a', { t: 'input', input: idle, seq: ++seq, dt: 1 / 60 });
    }
  }, 5);
  // A hog: the machine's other load, blocking the loop HOG ms out of every HOG + 10.
  const HOG = Number(process.env.HOG ?? 45);
  const hog = setInterval(() => {
    const until = performance.now() + HOG;
    while (performance.now() < until);
  }, 10);
  const t0 = performance.now();
  const host = core.host as unknown as { clients: Map<string, { moves: unknown[] | null }> };
  let worstQueue = 0;
  const watch = setInterval(() => {
    for (const c of host.clients.values()) worstQueue = Math.max(worstQueue, c.moves?.length ?? 0);
  }, 50);
  await new Promise((r) => setTimeout(r, 10_000));
  clearInterval(inputs);
  clearInterval(hog);
  clearInterval(watch);
  const wall = (performance.now() - t0) / 1000;
  const game = (core as unknown as { time: number }).time;
  console.log(`wall ${wall.toFixed(1)} s, game ${game.toFixed(1)} s (${((game / wall) * 100).toFixed(0)}%), worst input queue ${worstQueue}`);
  core.stop();
}
