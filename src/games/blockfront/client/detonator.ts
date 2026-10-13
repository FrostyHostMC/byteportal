import type { Vec3 } from '@platform';
import type { ClientKit } from '@platform/client';
import { DETONATOR } from '../weapons';

/** The thermal detonator's item. */
const ITEM = 'detonator';
/** Within this far a blast in sight whitens the screen for a moment; within this far it kicks the camera. */
const GLARE = 30;
const KICK = 14;

/**
 * A thermal detonator going off, over the platform's blast (its fireball, smoke and crater): a
 * white-blue core, a sphere of blue-white sparks thrown out to the edge of its reach, a ring of the
 * same racing out over the ground, an electric zing, and, close by and in sight, a flash of the
 * screen. From the throwables' `thrownEnd` event, where the server said it went off.
 */
export function detonatorBlast(): ClientKit {
  return {
    name: 'blockfront.detonator',
    frame(client) {
      for (const e of client.events) {
        if (e.t !== 'thrownEnd' || e.item !== ITEM || !e.at) continue;
        const at = e.at;
        const fx = client.fx;
        const reach = DETONATOR.blast?.radius ?? 5.5;
        // The core, white-hot and blue round it. (A particle's glow multiplies its colour: kept low,
        // so the blue isn't burnt out to white.)
        fx.particles(at, [0.6, 0.8, 1.3], { count: 12, speed: 2.5, size: 0.8, glow: 0.5, gravity: 0, life: 0.2, drag: 6, spread: 0.4, up: 0, collide: false });
        fx.particles(at, [0.2, 0.45, 1.3], { count: 26, speed: 6, size: 0.45, glow: 0.2, gravity: 0, life: 0.35, drag: 5, spread: 0.8, up: 0, collide: false });
        // A shell of blue round the fireball, outlasting it.
        fx.particles(at, [0.18, 0.42, 1.25], { count: 56, speed: 18, size: 0.42, glow: 0.5, gravity: -0.5, life: 0.8, drag: 4, spread: 0.5, up: 0.3, collide: false });
        // Sparks out to the edge of its reach (speed over drag: about as far as it hurts).
        fx.particles(at, [0.25, 0.5, 1.4], { count: 64, speed: reach * 3.2, size: 0.09, glow: 0.15, gravity: 2, life: 0.6, drag: 2.6, spread: 0.3, up: 0.5, collide: false });
        fx.particles(at, [0.5, 0.7, 1.3], { count: 24, speed: reach * 2.2, size: 0.07, glow: 0.3, gravity: 6, life: 0.8, drag: 1.8, spread: 0.2, up: 1.5, collide: true });
        fx.shockwave({ x: at.x, y: at.y - 0.4, z: at.z }, reach * 1.1, '#9fd8ff');
        client.audio.play('detonator_blast', { at, volume: 1.2, pitch: 0.95 + Math.random() * 0.1 });
        // Close by and in sight: the screen whitens a moment.
        const cam = client.camera.position;
        const d = Math.hypot(at.x - cam.x, at.y - cam.y, at.z - cam.z);
        if (d < GLARE && inSight(client.world.raycast.bind(client.world), cam, at, d)) fx.flash('rgba(190, 220, 255, 1)', 0.45 * (1 - d / GLARE), 0.4);
        // Close by, a harder kick than the platform's shake for a blast of its size (that one reaches further).
        if (d < KICK) fx.shake(0.9 * (1 - d / KICK) + 0.15, 0.5);
      }
    },
  };
}

/** Nothing solid between the eye and the blast (short of the blast's own block). */
function inSight(raycast: (from: Vec3, dir: Vec3, max: number) => { distance: number } | null, from: Vec3, to: Vec3, d: number): boolean {
  if (d < 0.5) return true;
  const dir = { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
  const hit = raycast(from, dir, d - 0.6);
  return hit === null;
}
