import type { ClientKit } from '@platform/client';
import { course } from '../course';
import { dirOf } from '../scale';
import type { GolfState } from './state';

/** Keys that end the fly-over early (getting on with it). */
const SKIP = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyF'];
const LENGTH = 6;

/**
 * A look down each hole as you come to its tee: the camera rises behind the tee, flies the line of
 * play over the fairway and comes down behind the green, looking at the flag. Moving (or E, F,
 * Space) ends it; it gives the camera back where you stand.
 */
export function flyoverKit(st: GolfState): ClientKit {
  let hole = -1;
  let t = -1;
  let keys: { p: { x: number; y: number; z: number }; at: { x: number; y: number; z: number } }[] = [];

  const plan = (i: number) => {
    const h = course.holes[i];
    const pin = h.green.pin;
    const up = (x: number, z: number, dy: number) => ({ x, y: course.height(x, z) + dy, z });
    const back = course.point(i, -14, 0);
    const mid = course.point(i, h.len * 0.5, 0);
    const late = course.point(i, h.len * 0.82, 0);
    const d = dirOf(course.yawAt(i, h.len));
    keys = [
      { p: up(back.x, back.z, 9), at: up(mid.x, mid.z, 0) },
      { p: up(mid.x, mid.z, 22), at: up(late.x, late.z, 0) },
      { p: up(pin.x - d.x * 18, pin.z - d.z * 18, 8), at: { x: pin.x, y: pin.y + 1, z: pin.z } },
    ];
  };

  return {
    name: 'golf.flyover',
    setup() {
      st.onRound((r) => {
        if (r.hole !== hole && r.mode === 'walk' && r.strokes === 0 && r.hole < 18) {
          hole = r.hole;
          plan(hole);
          t = 0;
        }
      });
    },
    frame(client, dt) {
      if (t < 0) return;
      t += dt;
      // Up to the ball already: the swing has the camera.
      if (st.address) {
        t = -1;
        return;
      }
      if ((t > 0.3 && SKIP.some((k) => client.input.isDown(k))) || t >= LENGTH) {
        t = -1;
        client.camera.release(1.1);
        return;
      }
      // Along the keys, eased.
      const u = Math.min(1, t / LENGTH) * (keys.length - 1);
      const i = Math.min(keys.length - 2, Math.floor(u));
      const k = u - i;
      const e = k * k * (3 - 2 * k);
      const a = keys[i];
      const b = keys[i + 1];
      const mix = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => ({ x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e, z: p.z + (q.z - p.z) * e });
      client.camera.take({ position: mix(a.p, b.p), target: mix(a.at, b.at), fov: 60 });
    },
  };
}
