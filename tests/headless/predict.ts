import { readFileSync } from 'node:fs';
import type { BlockRef } from '../../src/platform/api/types';
import { Predictor } from '../../src/platform/client/predict';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { worldGenConfig } from '../../src/platform/workers/config';
import type { HostBatch, PlayerInput } from '../../src/platform/net/protocol';
import { loadRegistry } from '../../src/platform/world/registry';
import { check, games } from './_harness';

/**
 * Client-side prediction holds: a client walking, turning, sprinting and jumping at 60 frames a
 * second, predicting on its own copy of the world, gets the server's frames three steps late and
 * replays what the server hadn't applied yet. The server's word should barely move it.
 */
export default function predict() {
  const def = games.find((g) => g.id === 'sandbox')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 4242, remote: true, radius: 3, budget: Infinity });
  const registry = loadRegistry();
  const mine = new GeneratedWorld(host.seed, worldGenConfig(def, (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id)));
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  const predictor = new Predictor(mine.world);
  const late: HostBatch[] = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
  let shoved = 0;
  for (let frame = 0; frame < 60 * 12; frame++) {
    mine.update([me.state], 3, Infinity);
    const t = frame / 60;
    const input: PlayerInput = {
      active: true,
      down: ['KeyW', ...(frame % 240 > 120 ? ['ControlLeft'] : []), ...(frame % 90 < 10 ? ['Space'] : [])],
      pressed: frame % 90 === 0 ? ['Space'] : [],
      buttons: 0,
      clicked: 0,
      mouseX: 0,
      mouseY: 0,
      wheel: 0,
      yaw: Math.sin(t * 0.7) * 2,
      pitch: 0,
      viewSeq: me.viewSeq,
    };
    predictor.step(input, 1 / 60, frame + 1);
    host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
    // Once, the server shoves the player (a knockback the client couldn't know about).
    if (frame === 600) me.api.impulse(0, 9, 6);
    if (frame % 2 === 1) {
      late.push(host.step(1 / 30).get(ann.id)!);
      // Three steps (100 ms) of latency.
      if (late.length > 3) {
        const f = late.shift()!.frame!;
        predictor.reconcile(f.players.find((p) => p.id === ann.id)!);
        if (frame >= 600) shoved = Math.max(shoved, predictor.lastCorrection);
        else if (frame > 60) {
          worst = Math.max(worst, predictor.lastCorrection);
          sum += predictor.lastCorrection;
          n++;
        }
      }
    }
  }
  const s = me.state;
  console.log(`  10 s walking, sprinting, turning, jumping with 100 ms latency: corrections average ${(sum / n).toFixed(5)}, worst ${worst.toFixed(5)} blocks · then a server-side shove corrected it by ${shoved.toFixed(2)} · walked to ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);
  check(worst < 0.01, `prediction drifted: worst correction ${worst}`);
  check(shoved > 0.1, `the shove should have corrected the prediction: ${shoved}`);
}
