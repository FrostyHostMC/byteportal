import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { GameDefinition } from '../../src/platform/api/types';
import { devGames, games } from '../../src/games/server';
import { Headless, type HeadlessOptions } from '../../src/platform/host/headless';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** The development games too (High Noon, the moves course, the previews): tests run as development does. */
const dev = await devGames();

/**
 * Start a game headless, as if the player had just clicked Play: a registered game or a dev game
 * by id (`launch('highnoon')`), or any definition. `Math.random` is seeded too (some games use it
 * rather than `game.rng`), so a run with the same seed and the same pilot plays out identically: a
 * failure reproduces.
 */
export function launch(game: string | GameDefinition, o: Partial<HeadlessOptions> = {}): Headless {
  const def = typeof game === 'string' ? [...games, ...dev].find((g) => g.id === game) : game;
  if (!def) throw new Error(`no game "${String(game)}" (games: ${[...games, ...dev].map((g) => g.id).join(', ')})`);
  Math.random = mulberry32((o.seed ?? 1) ^ 0x5bd1e995);
  const h = new Headless(def, { wasm, wire: true, ...o });
  h.start();
  return h;
}

export { games };

/** The title of the last `hud.screen` the game opened (victory, defeat), if any. */
export function lastScreen(h: Headless): string | undefined {
  const c = h.find('hud', 'screen').at(-1);
  return (c?.args[1] as { title?: string } | undefined)?.title;
}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A room's worker thread, as the development servers start them: its modules compiled by the test
 * runner's Vite (scripts/dev-worker.mjs), or by a Vite of its own when run some other way.
 */
export function roomWorker(workerData: unknown): Worker {
  const make = (globalThis as { __blockyardDevWorker?: (data: unknown) => Worker }).__blockyardDevWorker;
  return make ? make(workerData) : new Worker(resolve('scripts/room-worker-dev.mjs'), { workerData });
}
