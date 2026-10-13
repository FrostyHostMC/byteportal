import type { Entity } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { launch } from './_harness';

/**
 * Probe: how often an Arena skeleton's arrows land on a player standing still or strafing (A/D,
 * switching every second or so), at a few distances. The skeleton is held in place (speed 0) so
 * the distance stays put; every other monster is cleared as it arrives.
 * `node scripts/headless.mjs tests/headless/_archers.ts`
 */
export default function archers() {
  const FLOOR = 70;
  const rows: string[] = [];
  for (const mode of ['stand', 'strafe'] as const) {
    for (const d of [5, 10, 15, 20]) {
      const h = launch('arena', { seed: 1000 + d });
      const game = h.ctx;
      const me = game.player;
      me.maxHealth = 1e6;
      me.health = 1e6;
      me.teleport({ x: -10, y: FLOOR + 1, z: 8.5 }, -Math.PI / 2, 0);
      let skel: Entity | null = null;
      let hits = 0;
      game.events.on('playerDamage', (e) => {
        if (skel && e.source === skel) hits++;
      });
      let flip = 0;
      let dir = 'KeyA';
      const pilot: Pilot = () => {
        for (const e of game.entities.all()) if (e !== skel) e.remove();
        if (!skel) {
          skel = game.entities.spawn('skeleton', { x: -10 + d, y: FLOOR + 1.05, z: 8.5 }, { yaw: Math.PI / 2 });
          skel.setSpeed(0);
          const proto = Object.getPrototypeOf(skel) as { shoot: (...a: unknown[]) => void; __wrapped?: boolean };
          if (!proto.__wrapped) {
            const shoot = proto.shoot;
            proto.shoot = function (this: unknown, ...a: unknown[]) {
              (globalThis as unknown as { __shots: number }).__shots++;
              return shoot.apply(this, a);
            };
            proto.__wrapped = true;
          }
          (globalThis as unknown as { __shots: number }).__shots = 0;
        }
        me.health = 1e6;
        // Arrows knock them back: put them back on their mark (the strafe carries on along z).
        if (Math.abs(me.position.x + 10) > 0.3 || (mode === 'stand' && Math.abs(me.position.z - 8.5) > 0.3)) me.teleport({ x: -10, y: FLOOR + 1, z: mode === 'stand' ? 8.5 : me.position.z }, -Math.PI / 2, 0);
        if (mode === 'stand') return { yaw: -Math.PI / 2, pitch: 0 };
        if ((flip -= 1 / 60) <= 0) {
          flip = 0.8 + Math.random() * 0.8;
          dir = dir === 'KeyA' ? 'KeyD' : 'KeyA';
        }
        // Keep to the line (a wide strafe back and forth across it).
        const off = me.position.z - 8.5;
        const key = off > 3 ? 'KeyA' : off < -3 ? 'KeyD' : dir;
        return { yaw: -Math.PI / 2, pitch: 0, down: [key] };
      };
      h.run(100, { pilot });
      const shots = (globalThis as unknown as { __shots: number }).__shots;
      const dist = skel ? Math.hypot((skel as Entity).position.x - me.position.x, (skel as Entity).position.z - me.position.z) : NaN;
      rows.push(`${mode.padEnd(6)} ${String(d).padStart(2)} blocks (now ${dist.toFixed(1)}): ${hits}/${shots} hit = ${shots ? Math.round((100 * hits) / shots) : 0}%`);
    }
  }
  console.log(rows.join('\n'));
}
