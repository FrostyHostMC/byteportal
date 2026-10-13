import type { Client, ClientKit } from '@platform/client';
import type { SkateState } from '../moves';
import { CAMERA, goal, HALF_LENGTH, HALF_WIDTH, ICE, type Side } from '../rink';
import type { IceView } from './state';

/**
 * The broadcast camera: up in the stands on the near side, panning with the puck along the rink
 * (easing, a little behind it), drifting a touch toward the far boards when the play's there,
 * punching in on a goal and shaking with a big hit. It's this screen's own (the server knows
 * nothing of it), and it watches from the home page too.
 *
 * And which way our own skater faces: where they're skating, squared to the net while they wind
 * up a shot (the view's turn is their figure's facing; the camera above is the screen's).
 */
export function cameraKit(view: IceView): ClientKit {
  let tx = 0;
  let tz = 0;
  let kick = 0;
  let started = false;
  return {
    name: 'ice.camera',
    frame(client, dt) {
      for (const m of view.moments) if (m.k === 'goal') kick = 1;
      kick = Math.max(0, kick - dt * 0.9);
      const at = puckAt(client, view);
      const lim = HALF_LENGTH - 7.5;
      const want = Math.max(-lim, Math.min(lim, at.x));
      const wantZ = Math.max(-HALF_WIDTH * 0.5, Math.min(HALF_WIDTH * 0.3, at.z * 0.35));
      const k = started ? 1 - Math.exp(-dt * 2.4) : 1;
      tx += (want - tx) * k;
      tz += (wantZ - tz) * (started ? 1 - Math.exp(-dt * 1.2) : 1);
      started = true;
      const p = kick * kick;
      // In development, a camera of one's own for shooting art (`__iceCam = { position, target, fov }`).
      const art = import.meta.env.DEV ? (globalThis as unknown as { __iceCam?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; fov?: number } }).__iceCam : undefined;
      if (art) return client.camera.take(art);
      client.camera.take({
        position: { x: tx * 0.84, y: CAMERA.y - p * 1.5, z: CAMERA.z + tz * 0.3 - p * 3 },
        target: { x: tx, y: ICE + 0.2, z: tz - 1.2 },
        fov: CAMERA.fov - p * 6,
      });
    },
    controls(client, c, dt) {
      const s = client.me.abilities?.skate as unknown as SkateState | undefined;
      if (!s || !c.active) return;
      const p = client.me.position;
      const v = client.me.velocity;
      let want: number | null = null;
      // Winding up, or a shot just let go: squared to the net.
      if (s.puck && (s.wind > 0 || c.isDown('Space') || c.button(0))) {
        const g = goal((s.side >= 0 ? 1 : -1) as Side);
        want = Math.atan2(-(g.x - p.x), -(g.z - p.z));
      } else if (Math.hypot(v.x, v.z) > 0.8 && s.stun <= 0) want = Math.atan2(-v.x, -v.z);
      let dy = 0;
      if (want !== null) {
        let d = want - c.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        dy = d * Math.min(1, dt * 14);
      }
      c.turn(-c.pitch, dy);
    },
  };
}

/** Where the puck is (whoever has it: their feet; or where it's sliding). */
function puckAt(client: Client, view: IceView): { x: number; z: number } {
  if (view.holder) {
    for (const f of client.figures.all) if (f.player === view.holder) return { x: f.root.position.x, z: f.root.position.z };
    if (view.holder === client.me.id) return client.me.position;
  }
  const f = view.flight;
  return f ? { x: f.x, z: f.z } : { x: 0, z: 0 };
}
