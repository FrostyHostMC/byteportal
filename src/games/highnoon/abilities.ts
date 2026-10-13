import type { MovementAbility } from '@platform';

/**
 * The dodge roll (Q, or LB on a controller): a quick low tumble along the way the keys push (or
 * sideways, to the right, when standing still), then up and on at a run. On the ground only, and not
 * again for a while. A pure step: the platform runs it on the host and, ahead of it, on the
 * player's own screen, so it answers the moment Q goes down, online too.
 *
 * While it lasts the roller is low (`body.stance`: a slide's hitbox, eyes and figure, so bullets
 * aimed at a standing head go over), and their own camera tips through the tumble (`body.camera`:
 * leaning the way they roll, nose down rolling forward). It swallows jumps while it lasts.
 */
/** The roll: its key, speed and length, its exit speed, the wait for the next, and how far the camera leans and nods (radians). */
export const ROLL = { key: 'KeyQ', speed: 12.5, time: 0.34, exit: 7, cooldown: 2.2, lean: 0.42, nod: 0.3 };

export interface RollState {
  /** Seconds of roll left (0: not rolling), and until the next. */
  left: number;
  cool: number;
  dx: number;
  dz: number;
}

export const roll: MovementAbility<RollState> = {
  state: { left: 0, cool: 0, dx: 0, dz: 0 },
  step(s, c, body, dt) {
    s.cool = Math.max(0, s.cool - dt);
    if (c.pressed(ROLL.key) && s.cool === 0 && s.left === 0 && body.onGround && !body.inWater && !body.flying) {
      const w = Math.hypot(body.wish.x, body.wish.z);
      // No keys held: a sidestep to the right (the camera's right is (cos yaw, -sin yaw)).
      [s.dx, s.dz] = w > 0.1 ? [body.wish.x / w, body.wish.z / w] : [Math.cos(body.yaw), -Math.sin(body.yaw)];
      s.left = ROLL.time;
      s.cool = ROLL.cooldown;
      c.consume(ROLL.key);
      body.trigger('roll');
    }
    if (s.left <= 0) return;
    s.left = Math.max(0, s.left - dt);
    // Fast along the ground and steerless while it lasts; the last step lets them out at a run.
    const speed = s.left > 0 ? ROLL.speed : ROLL.exit;
    body.setVelocity({ x: s.dx * speed, z: s.dz * speed });
    body.control = 0;
    body.jump = false;
    if (s.left <= 0) return;
    // Low through the tumble, and the camera with it: over and back, leaning the way they roll
    // (how much of the roll is to their right, as they look now) and dipping its nose going forward.
    body.stance = 'low';
    const arc = Math.sin((1 - s.left / ROLL.time) * Math.PI);
    const right = s.dx * Math.cos(body.yaw) - s.dz * Math.sin(body.yaw);
    const ahead = -s.dx * Math.sin(body.yaw) - s.dz * Math.cos(body.yaw);
    body.camera.roll = right * arc * ROLL.lean;
    body.camera.pitch = -Math.max(0, ahead) * arc * ROLL.nod;
  },
};
