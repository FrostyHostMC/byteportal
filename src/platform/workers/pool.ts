import type { WorkerRequest, WorkerResponse, WorldGenConfig } from './protocol';
import { startWorker } from '../client/storage';
import engineWorker from './engine.worker?worker&url';

type Handler = (res: WorkerResponse) => void;

interface Slot {
  worker: Worker;
  inflight: number;
}

/** Fixed pool of engine workers sharing one compiled WebAssembly module. */
export class WorkerPool {
  private slots: Slot[] = [];
  private handlers = new Map<number, { slot: Slot; handler: Handler }>();
  private nextId = 1;
  readonly size: number;
  genMs = 0;
  meshMs = 0;
  genCount = 0;
  meshCount = 0;

  private constructor(size: number) {
    this.size = size;
  }

  static async create(module: WebAssembly.Module, seed: number, size: number, world: WorldGenConfig, blocks = '[]'): Promise<WorkerPool> {
    const pool = new WorkerPool(size);
    const ready: Promise<void>[] = [];
    for (let i = 0; i < size; i++) {
      const worker = startWorker(engineWorker, { name: `engine-${i}` });
      const slot: Slot = { worker, inflight: 0 };
      pool.slots.push(slot);
      ready.push(
        new Promise<void>((resolve, reject) => {
          worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
            if (ev.data.type === 'ready') {
              worker.onmessage = (e: MessageEvent<WorkerResponse>) => pool.onMessage(e.data);
              resolve();
            } else if (ev.data.type === 'error') {
              reject(new Error(ev.data.message));
            }
          };
          worker.onerror = (e) => reject(e);
        }),
      );
      const init: WorkerRequest = { type: 'init', module, seed, world, blocks };
      worker.postMessage(init);
    }
    await Promise.all(ready);
    return pool;
  }

  private onMessage(res: WorkerResponse) {
    if (res.type === 'ready') return;
    const entry = this.handlers.get(res.id);
    if (!entry) return;
    this.handlers.delete(res.id);
    entry.slot.inflight--;
    if (res.type === 'gen') {
      this.genMs += res.ms;
      this.genCount++;
    } else if (res.type === 'mesh') {
      this.meshMs += res.ms;
      this.meshCount++;
    } else if (res.type === 'error') {
      console.error('[engine worker]', res.message);
    }
    entry.handler(res);
  }

  /** Total jobs currently queued or running in workers. */
  get inflight(): number {
    let n = 0;
    for (const s of this.slots) n += s.inflight;
    return n;
  }

  /** Free capacity given a per-worker queue depth. */
  capacity(depth: number): number {
    let n = 0;
    for (const s of this.slots) n += Math.max(0, depth - s.inflight);
    return n;
  }

  private pick(): Slot {
    let best = this.slots[0];
    for (const s of this.slots) if (s.inflight < best.inflight) best = s;
    return best;
  }

  gen(cx: number, cz: number, handler: Handler) {
    const id = this.nextId++;
    const slot = this.pick();
    slot.inflight++;
    this.handlers.set(id, { slot, handler });
    const req: WorkerRequest = { type: 'gen', id, cx, cz };
    slot.worker.postMessage(req);
  }

  mesh(cx: number, cz: number, region: Uint8Array, handler: Handler) {
    const id = this.nextId++;
    const slot = this.pick();
    slot.inflight++;
    this.handlers.set(id, { slot, handler });
    const req: WorkerRequest = { type: 'mesh', id, cx, cz, region };
    slot.worker.postMessage(req, [region.buffer]);
  }

  dispose() {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.handlers.clear();
  }
}
