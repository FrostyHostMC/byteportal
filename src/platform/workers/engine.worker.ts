/// <reference lib="webworker" />
import { initSync, set_game_blocks, TerrainGen, ChunkMesher } from '@engine/voxel_engine.js';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { applyWorldConfig } from './config';

declare const self: DedicatedWorkerGlobalScope;

let gen: TerrainGen | null = null;
let mesher: ChunkMesher | null = null;

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        initSync({ module: msg.module });
        // The game's own blocks first: the generator stamps them, the mesher draws them.
        set_game_blocks(msg.blocks);
        gen = new TerrainGen(msg.seed >>> 0);
        applyWorldConfig(gen, msg.world);
        mesher = new ChunkMesher();
        reply({ type: 'ready' });
        break;
      }
      case 'gen': {
        const t = performance.now();
        const data = gen!.generate(msg.cx, msg.cz);
        reply({ type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, data, ms: performance.now() - t }, [data.buffer]);
        break;
      }
      case 'mesh': {
        const t = performance.now();
        const data = mesher!.mesh(msg.region);
        reply({ type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, data, ms: performance.now() - t }, [data.buffer]);
        break;
      }
    }
  } catch (e) {
    const id = 'id' in msg ? msg.id : -1;
    reply({ type: 'error', id, message: String((e as Error)?.stack ?? e) });
  }
};
