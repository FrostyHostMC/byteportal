import type { MovementAbility } from '@platform';

/**
 * The dodge roll (Q, or LB on a controller): a quick low tumble the way the keys push (or back,
 * when standing still), then up at a run. On the ground only, and not again for a moment
 * (half as long with Fleet-footed: `quick`). A pure step, run on the host and ahead of it on the
 * roller's own screen, so it answers the moment Q goes down; the server makes the roller
 * untouchable for most of it (`ROLL.safe`), so a well-timed roll goes through an arrow, a swing
 * or a blast.
 */
export const ROLL = { key: 'KeyQ', speed: 11, time: 0.32, exit: 5.6, cooldown: 1.4, safe: 0.3, lean: 0.35, nod: 0.25 };

export interface RollState {
  /** Seconds of roll left (0: not rolling), and until the next. */
  left: number;
  cool: number;
  dx: number;
  dz: number;
  /** Fleet-footed: half the wait. */
  quick: boolean;
}

export const roll: MovementAbility<RollState> = {
  state: { left: 0, cool: 0, dx: 0, dz: 0, quick: false },
  step(s, c, body, dt) {
    s.cool = Math.max(0, s.cool - dt);
    if (c.pressed(ROLL.key) && s.cool === 0 && s.left === 0 && body.onGround && !body.inWater && !body.flying) {
      const w = Math.hypot(body.wish.x, body.wish.z);
      // No keys held: back, away from what's in front (the camera looks along (-sin yaw, -cos yaw)).
      [s.dx, s.dz] = w > 0.1 ? [body.wish.x / w, body.wish.z / w] : [Math.sin(body.yaw), Math.cos(body.yaw)];
      s.left = ROLL.time;
      s.cool = ROLL.cooldown * (s.quick ? 0.5 : 1);
      c.consume(ROLL.key);
      body.trigger('roll');
    }
    if (s.left <= 0) return;
    s.left = Math.max(0, s.left - dt);
    const speed = s.left > 0 ? ROLL.speed : ROLL.exit;
    body.setVelocity({ x: s.dx * speed, z: s.dz * speed });
    body.control = 0;
    body.jump = false;
    if (s.left <= 0) return;
    // Low through the tumble, the camera leaning the way they roll and dipping going forward.
    body.stance = 'low';
    const arc = Math.sin((1 - s.left / ROLL.time) * Math.PI);
    const right = s.dx * Math.cos(body.yaw) - s.dz * Math.sin(body.yaw);
    const ahead = -s.dx * Math.sin(body.yaw) - s.dz * Math.cos(body.yaw);
    body.camera.roll = right * arc * ROLL.lean;
    body.camera.pitch = -Math.max(0, ahead) * arc * ROLL.nod;
  },
};
