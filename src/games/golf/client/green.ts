import type { ClientKit } from '@platform/client';
import { course } from '../course';
import { dirOf } from '../scale';
import type { GolfState } from './state';

/**
 * Reading the green. Near your hole's green (walking up to it, or over a putt), dots flow across
 * it the way the ground falls: slowly where it's nearly flat (blue), quicker where it tilts
 * (yellow), fast on the steep parts (red). Over a putt, a line of dots runs from the ball along the
 * aim, as far as the hole.
 */
export function greenKit(st: GolfState): ClientKit {
  let points: { x: number; y: number; z: number; vx: number; vz: number; c: [number, number, number] }[] = [];
  let hole = -1;
  let emit = 0;
  let line = 0;

  const build = (i: number) => {
    hole = i;
    points = [];
    const h = course.holes[i];
    const g = h.green;
    const r = Math.max(g.ra, g.rc) + 2.5;
    const step = 1.6;
    for (let dz = -r; dz <= r; dz += step)
      for (let dx = -r; dx <= r; dx += step) {
        const x = g.x + dx;
        const z = g.z + dz;
        if (!course.onGreen(i, x, z)) continue;
        const s = course.slope(x, z);
        const pct = Math.hypot(s.x, s.z) * 100;
        const c: [number, number, number] = pct < 1.2 ? [0.55, 0.8, 1] : pct < 2.6 ? [1, 0.9, 0.45] : [1, 0.5, 0.35];
        // Downhill, quicker the steeper.
        points.push({ x, y: course.height(x, z) + 0.05, z, vx: -s.x * 26, vz: -s.z * 26, c });
      }
  };

  return {
    name: 'golf.green',
    frame(client, dt) {
      const r = st.round;
      const a = st.address;
      const me = client.me.position;
      if (!r || r.mode === 'done') return;
      const i = Math.min(r.hole, 17);
      const pin = course.pin(i);
      const putting = a && client.me.hand.item === 'putter';
      const near = Math.hypot(me.x - pin.x, me.z - pin.z) < 24 && !client.me.inVehicle;
      // The line of the putt.
      const dots = putting && a ? Math.min(24, Math.ceil(Math.hypot(pin.x - a.ball.x, pin.z - a.ball.z) / 0.5) + 2) : 0;
      if (dots) {
        const d = dirOf(client.me.look.yaw);
        for (let k = 1; k <= dots; k++) {
          const x = a!.ball.x + d.x * k * 0.5;
          const z = a!.ball.z + d.z * k * 0.5;
          client.hud.marker(`golf:line${k}`, { x, y: course.height(x, z) + 0.04, z }, { shape: 'dot', color: '#ffffff', size: k === dots ? 5 : 4 });
        }
      }
      for (let k = dots + 1; k <= line; k++) client.hud.marker(`golf:line${k}`, null);
      line = dots;
      if (!(putting || near)) return;
      if (hole !== i) build(i);
      emit += dt;
      if (emit < 0.35) return;
      emit = 0;
      for (const p of points)
        client.fx.particles({ x: p.x, y: p.y, z: p.z }, p.c, { count: 1, speed: 0, size: 0.03, gravity: 0, life: 1.2, glow: 0.15, velocity: { x: p.vx, y: 0, z: p.vz } });
    },
  };
}
