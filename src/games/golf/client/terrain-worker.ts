import { chunkFile } from './terrain-mesh';

/** Makes the course's squares off the game's thread (`terrain.ts` asks; `terrain-mesh.ts` makes). */
self.onmessage = (e: MessageEvent<{ id: string; x0: number; z0: number; shaped: boolean }>) => {
  const { id, x0, z0, shaped } = e.data;
  const bytes = chunkFile(x0, z0, shaped);
  (self as unknown as Worker).postMessage({ id, bytes }, [bytes.buffer]);
};
