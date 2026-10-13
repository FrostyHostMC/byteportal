import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, PlayerInput, ServerWelcome, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';

/**
 * Not a test: a player with no screen, for measuring how smooth others look. Joins a server as
 * `GHOST_NAME` (default Ann), takes off (Sandbox flight) and flies a steady circle for
 * `GHOST_SECONDS`, sending inputs at 60 a second like a browser.
 * `GHOST_URL=ws://localhost:8796/sandbox node scripts/headless.mjs tests/headless/_ghost.ts`
 */
export default async function ghost() {
  const url = process.env.GHOST_URL ?? 'ws://localhost:8796/sandbox';
  const seconds = Number(process.env.GHOST_SECONDS ?? 20);
  const ws = new WebSocket(url);
  const frames = new FrameReader<SimFrame>();
  let me = '';
  let frame: SimFrame | null = null;
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = (e) => {
      const m = decode<ServerWelcome | WireBatch>(String(e.data));
      if ('t' in m && m.t === 'welcome') return resolve();
      const w = m as WireBatch;
      if (w.f !== undefined) frame = frames.read(w.f);
      for (const ev of w.events) if (ev.t === 'joined') me = ev.player;
    };
  });
  const send = (c: ClientCommand) => ws.send(encode(c));
  send({ t: 'start', name: process.env.GHOST_NAME ?? 'Ann' });
  let seq = 0;
  let yaw = 0;
  const taps = [false, false];
  let lifted = false;
  const t0 = performance.now();
  let last = t0;
  await new Promise<void>((done) => {
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const t = (now - t0) / 1000;
      const p = frame?.players.find((x) => x.id === me);
      const down: string[] = [];
      const pressed: string[] = [];
      // Up in the air (a server with cheats), double-tap Space to fly (one press each), then fly a circle.
      if (!lifted && p && t > 0.3) {
        lifted = true;
        send({ t: 'exec', id: 1, line: `tp ${p.x.toFixed(1)} ${(p.y + 30).toFixed(1)} ${p.z.toFixed(1)}` });
      }
      if (!taps[0] && t > 0.6) (taps[0] = true), pressed.push('Space');
      else if (!taps[1] && t > 0.75) (taps[1] = true), pressed.push('Space');
      if (t > 2) {
        down.push('KeyW');
        yaw += dt * 0.7;
      }
      const input: PlayerInput = { active: true, down: [...down, ...pressed], pressed, buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw, pitch: 0, viewSeq: p?.view.seq ?? -1 };
      send({ t: 'input', input, seq: ++seq, dt: Math.min(0.1, dt) });
      if (process.env.GHOST_DEBUG && Math.floor(t * 2) !== Math.floor((t - dt) * 2)) console.log(`t ${t.toFixed(1)} me ${me} flying ${p?.flying} y ${p?.y.toFixed(1)} viewSeq ${p?.view.seq} ack ${p?.ack} seq ${seq}`);
      if (t < seconds) setTimeout(tick, 16.6);
      else done();
    };
    tick();
  });
  ws.close();
}
