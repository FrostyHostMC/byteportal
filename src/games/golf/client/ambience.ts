import type { ClientKit, ClientLoop } from '@platform/client';
import { course } from '../course';

/**
 * The course's sound round you: birds now and then in the trees near you, and your cart's hum
 * while you drive, rising with its speed.
 */
export function ambienceKit(): ClientKit {
  let bird = 2;
  let hum: ClientLoop | null = null;
  let last: { x: number; z: number } | null = null;
  let speed = 0;
  return {
    name: 'golf.ambience',
    frame(client, dt) {
      const me = client.me.position;
      bird -= dt;
      if (bird <= 0) {
        bird = 2.5 + Math.random() * 6;
        const trees = course.treesNear(me.x, me.z);
        const t = trees[Math.floor(Math.random() * trees.length)];
        if (t) client.audio.play('golf_bird', { at: { x: t.x, y: t.base + t.cy, z: t.z }, pitch: 0.9 + Math.random() * 0.25 });
      }
      // The cart's hum.
      if (last && dt > 0) speed += (Math.hypot(me.x - last.x, me.z - last.z) / dt - speed) * Math.min(1, dt * 6);
      last = { x: me.x, z: me.z };
      if (client.me.inVehicle) {
        hum ??= client.audio.loop('golf_cart', { volume: 0 });
        hum.set({ volume: 0.25 + Math.min(1, speed / 12) * 0.6, pitch: 0.7 + Math.min(1.2, speed / 12) * 0.8 });
      } else if (hum) {
        hum.stop();
        hum = null;
      }
    },
    dispose() {
      hum?.stop();
    },
  };
}
