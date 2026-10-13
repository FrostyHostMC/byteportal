import { math, type VehicleDefinition } from '@platform';
import { course } from './course';
import { Surf } from './course/types';
import { clamp, dirOf } from './scale';

/**
 * The golf cart: a vehicle (`player.drive('cart', …)`), so it answers the moment its driver
 * presses a key, online too. W / S drive and reverse, A / D steer, Space brakes; the mouse looks
 * round. It runs on the course's smooth ground (so it glides over the half-block steps), leaning
 * with the slope, faster on the path and slower in the rough and the sand; water, greens and tree
 * trunks stop it. Pure: it asks nothing of the world but the course, which every screen has.
 */

export interface CartState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Blocks a second along its heading (negative reversing). */
  speed: number;
  /** The front wheels' angle (radians, left positive). */
  steer: number;
  pitch: number;
  roll: number;
  /** The camera turned about the cart by the mouse (radians), and tipped. */
  look: number;
  tip: number;
  /** Something stopped it this step (a green, water, a tree): the game says so. */
  blocked: number;
}

const WHEELBASE = 1.6;
const TOP = 12.5;
const REVERSE = 4.5;
/** How fast it can go on each kind of ground (times `TOP`). */
const GRIP: Record<Surf, number> = {
  [Surf.Out]: 0.55,
  [Surf.Rough]: 0.75,
  [Surf.Deep]: 0.55,
  [Surf.Fairway]: 1,
  [Surf.Fringe]: 0.6,
  [Surf.Green]: 0.4,
  [Surf.Tee]: 0.8,
  [Surf.Sand]: 0.3,
  [Surf.Water]: 0,
  [Surf.Path]: 1.25,
};

export function freshCart(x: number, z: number, yaw: number): CartState {
  return { x, y: course.height(x, z), z, yaw, speed: 0, steer: 0, pitch: 0, roll: 0, look: 0, tip: 0.18, blocked: 0 };
}

/** Where a cart may not go: water, greens (and their fringe), tree trunks. */
function barred(x: number, z: number): number {
  const g = course.ground(x, z);
  if (g.surf === Surf.Water) return 1;
  if (g.surf === Surf.Green) return 2;
  for (const t of course.treesNear(x, z)) if ((t.x - x) ** 2 + (t.z - z) ** 2 < 1.1 * 1.1) return 3;
  return 0;
}

const _e = new math.Euler(0, 0, 0, 'YXZ');
const _v = new math.Vector3();
const _w = new math.Vector3();

export const cartVehicle: VehicleDefinition<CartState> = {
  step(s, c, dt) {
    const fwd = c.isDown('KeyW') || c.isDown('ArrowUp');
    const back = c.isDown('KeyS') || c.isDown('ArrowDown');
    const left = c.isDown('KeyA') || c.isDown('ArrowLeft');
    const right = c.isDown('KeyD') || c.isDown('ArrowRight');
    const brake = c.isDown('Space');
    const here = course.ground(s.x, s.z).surf;
    const top = TOP * GRIP[here];

    // Throttle, brakes and coasting.
    if (brake) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), 18 * dt);
    else if (fwd && !back) s.speed += (s.speed < 0 ? 16 : 7) * dt;
    else if (back && !fwd) s.speed -= (s.speed > 0 ? 14 : 5) * dt;
    else s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), 3 * dt);
    // Slopes help or hold it a little; the ground caps it.
    s.speed -= Math.sin(s.pitch) * 3.5 * dt;
    if (s.speed > top) s.speed = Math.max(top, s.speed - 10 * dt);
    if (s.speed < -REVERSE) s.speed = -REVERSE;

    // Steering: the wheels turn toward the keys, less at speed; the cart turns about its back axle.
    const want = ((left ? 1 : 0) - (right ? 1 : 0)) * (0.62 - 0.02 * Math.abs(s.speed));
    s.steer += (want - s.steer) * Math.min(1, dt * 7);
    s.yaw += ((s.speed * Math.tan(s.steer)) / WHEELBASE) * dt;

    // Move, unless the way is barred (it bumps back a touch).
    const d = dirOf(s.yaw);
    const nx = s.x + d.x * s.speed * dt;
    const nz = s.z + d.z * s.speed * dt;
    const nose = Math.sign(s.speed) * 1.3;
    const why = barred(nx + d.x * nose, nz + d.z * nose);
    if (why) {
      s.blocked = why;
      s.speed = -s.speed * 0.25;
    } else {
      s.blocked = 0;
      s.x = nx;
      s.z = nz;
    }

    // Sit on the ground, leaning with it.
    const fy = course.height(s.x + d.x * 1, s.z + d.z * 1);
    const by = course.height(s.x - d.x * 1, s.z - d.z * 1);
    const ly = course.height(s.x - d.z * 0.6, s.z + d.x * 0.6);
    const ry = course.height(s.x + d.z * 0.6, s.z - d.x * 0.6);
    const y = (fy + by + ly + ry) / 4;
    s.y += (y - s.y) * Math.min(1, dt * 18);
    s.pitch += (Math.atan2(fy - by, 2) - s.pitch) * Math.min(1, dt * 10);
    s.roll += (Math.atan2(ly - ry, 1.2) - s.roll) * Math.min(1, dt * 10);

    // The mouse looks round; driving, the view drifts back behind.
    s.look = clamp(s.look - c.mouseX * 0.0035, -Math.PI, Math.PI);
    s.tip = clamp(s.tip + c.mouseY * 0.0025, -0.1, 0.9);
    if (Math.abs(s.speed) > 2 && Math.abs(c.mouseX) < 0.5) s.look *= Math.exp(-dt * 1.2);
  },

  pose(s, position, quaternion) {
    position.set(s.x, s.y + 0.02, s.z);
    quaternion.setFromEuler(_e.set(s.pitch, s.yaw, s.roll, 'YXZ'));
  },

  camera(s, cam, dt) {
    const a = s.yaw + s.look;
    const d = dirOf(a);
    const dist = 6.2;
    const want = _v.set(s.x - d.x * dist * Math.cos(s.tip), s.y + 2.1 + Math.sin(s.tip) * dist, s.z - d.z * dist * Math.cos(s.tip));
    want.y = Math.max(want.y, course.height(want.x, want.z) + 0.8);
    cam.position.lerp(want, cam.snap ? 1 : 1 - Math.exp(-dt * 10));
    const look = _w.set(s.x + d.x * 5, s.y + 1.3, s.z + d.z * 5);
    cam.target.lerp(look, cam.snap ? 1 : 1 - Math.exp(-dt * 14));
    cam.fov = 72 + Math.min(8, Math.abs(s.speed) * 0.5);
  },
};
